/**
 * QueryExecutor — Handles Claude SDK query execution with retry logic.
 *
 * Extracted from MessageProcessor to isolate SDK query concerns:
 * - SDKSessionManager dispatch
 * - MCP server setup
 * - Callback wiring (delegates to StreamResponseRouter)
 * - Budget post-check logic (delegates to QueryMetricsRecorder)
 * - Session ID persistence after query
 * - Conversation persistence
 */

import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import type { IConversationRepository, IQueryMetricsRepository } from '../../persistence/types.js';
import { SessionManager } from '../session/SessionManager.js';
import type { QueryResult } from './types.js';
import { SDKSessionManager } from '../session/SDKSessionManager.js';
import { InteractionHandler } from '../interaction/InteractionHandler.js';
import { deliverUsageSummary } from './UsageCardFormatter.js';
import { logger } from '../../utils/logger.js';
import { ProcessingError } from '../../types/errors.js';
import { executeSdkQueryWithRetry } from './QuerySdkRunner.js';
import { buildMcpSetup } from '../../McpToolSetup.js';
import {
  buildQueryManagers,
  buildV2IntermediateMessageCallback,
  buildToolEventCallback,
  deliverFinalResponse,
  createStreamState,
} from './StreamResponseRouter.js';
import {
  recordQueryMetrics,
} from './QueryMetricsRecorder.js';
import { persistConversation, reportQueryUsageAnomaly } from './QueryPostProcessing.js';

const qeLogger = logger.child({ module: 'QueryExecutor' });

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasRetryDisabledMarker(error: Error): boolean {
  return (
    '_resumeRetryDisabled' in error ||
    '_emptyStreamRetryDisabled' in error ||
    '_zombieRetryDisabled' in error
  );
}

function isResumeIdentityError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('resume') ||
    normalized.includes('no conversation found') ||
    normalized.includes('conversation not found') ||
    normalized.includes('session not found') ||
    (normalized.includes('session') && normalized.includes('not found')) ||
    (normalized.includes('session') && normalized.includes('expired')) ||
    normalized.includes('tool_use ids must be unique')
  );
}

function canRetryBrokenResumeAsFresh(params: {
  queryStartedWithResume: boolean;
  continuationState: string | undefined;
  error: unknown;
}): boolean {
  const { queryStartedWithResume, continuationState, error } = params;
  if (!queryStartedWithResume || continuationState === 'pending' || !(error instanceof Error)) {
    return false;
  }

  return hasRetryDisabledMarker(error) || isResumeIdentityError(error.message);
}

function isCancelledError(error: unknown): boolean {
  return (
    (error instanceof Error && '_cancelled' in error) ||
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof Error && error.message.includes('aborted by user')) ||
    (
      typeof error === 'object' &&
      error !== null &&
      'value' in error &&
      String((error as { value: unknown }).value).includes('aborted by user')
    )
  );
}

/**
 * Dependencies injected into QueryExecutor
 */
export interface QueryExecutorDeps {
  sessionManager: SessionManager;
  sdkSessionManager: SDKSessionManager;
  queryMetricsRepository?: IQueryMetricsRepository;
  conversationRepository?: IConversationRepository;
  getSystemPrompt?: (agentId: string) => string | Promise<string>;
  sendTypingIndicators: boolean;
  typingIndicatorIntervalMs: number;
  /** When false, hides the per-turn usage summary card */
  usageCardEnabled: boolean;
  /** When false, hides in-chat tool status messages */
  inChatUsageSummary: boolean;
  /** Discord guild id used for diagnostics links when runtime context does not provide one. */
  guildId?: string;
}

export interface QueryExecuteOptions {
  replyToMessageId?: string;
  parentConversationId?: string;
  sourceMessageChannelId?: string;
  guildId?: string;
  taskId?: string;
}

export interface QueryRequest {
  sessionId: string;
  prompt: string;
  adapter: BaseAdapter;
  chatId: string;
  platform: 'discord';
  agentId: string;
  userId: string;
  options?: QueryExecuteOptions;
}

/**
 * Executes a single Claude SDK query with all the wiring:
 * streaming callbacks, retry, budget checks, metrics recording.
 */
export async function executeQueryWithSDK(
  deps: QueryExecutorDeps,
  request: QueryRequest
): Promise<string> {
  const { sessionId, prompt, adapter, chatId, platform, agentId, userId, options } = request;
  const {
    sessionManager,
    sdkSessionManager,
    queryMetricsRepository,
    getSystemPrompt,
    sendTypingIndicators,
    typingIndicatorIntervalMs,
    conversationRepository,
    usageCardEnabled,
    inChatUsageSummary,
    guildId,
  } = deps;

  // Get internal session for agent info
  const internalSession = sessionManager.getInternalSession(platform, agentId, userId);

  if (internalSession === undefined || internalSession.agent === undefined) {
    throw new ProcessingError('PROCESSING_FAILED', 'Session or agent not found');
  }

  const agent = internalSession.agent;

  // Read fresh system prompt from disk (agent may have updated CLAUDE.md at runtime)
  const systemPrompt =
    getSystemPrompt !== undefined
      ? await getSystemPrompt(agent.id)
      : agent.systemPrompt;

  // Start typing indicator
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  if (sendTypingIndicators) {
    await adapter.sendTypingIndicator(chatId);
    typingInterval = setInterval(() => {
      void adapter.sendTypingIndicator(chatId);
    }, typingIndicatorIntervalMs);
  }

  // Build status/sub-agent/hook managers
  const { statusManager, subAgentManager, hookManager } = buildQueryManagers(
    adapter, chatId, sessionId, sdkSessionManager, inChatUsageSummary
  );

  // Set up interaction handler for permission prompts and question prompts
  const interactionHandler = new InteractionHandler(adapter, chatId, 120_000);
  const canUseTool = interactionHandler.buildCanUseTool();

  const sdkPrompt = prompt;

  // Build MCP tool configuration for this query
  const mcpCtx: import('../../McpToolSetup.js').McpSetupContext = {
    agentId, chatId, userId, platform,
  };
  if (options?.parentConversationId !== undefined) {
    mcpCtx.subConversationId = chatId;
    mcpCtx.parentConversationId = options.parentConversationId;
  }
  if (options?.taskId !== undefined) {
    mcpCtx.taskId = options.taskId;
  }
  const { mcpServers, allowedTools } = buildMcpSetup(
    adapter,
    mcpCtx,
  );

  const streamOpts: import('./StreamResponseRouter.js').StreamRouterOptions = {};
  if (options?.replyToMessageId !== undefined) streamOpts.replyToMessageId = options.replyToMessageId;

  try {
    // Track intermediate messages and delivery state
    const state = createStreamState();

    // Build callbacks via StreamResponseRouter
    const onIntermediateMessageV2 = buildV2IntermediateMessageCallback(
      state, adapter, chatId, agentId, statusManager, streamOpts
    );
    const onToolEvent = buildToolEventCallback(state, agentId, statusManager, hookManager);
    const runtimeContext = {
      platform,
      agentId,
      chatId,
      userId,
      ...(options?.guildId !== undefined ? { guildId: options.guildId } : guildId !== undefined ? { guildId } : {}),
      ...(options?.parentConversationId !== undefined ? { parentConversationId: options.parentConversationId } : {}),
      ...(options?.replyToMessageId !== undefined ? { originalMessageId: options.replyToMessageId } : {}),
      ...(options?.sourceMessageChannelId !== undefined ? { sourceMessageChannelId: options.sourceMessageChannelId } : {}),
    };

    // Capture the pre-query resume state. After a restart, resumed SDK sessions
    // can have in-memory messageCount 0/1 even though the transcript is old.
    const queryStartedWithResume =
      typeof internalSession.sdkSessionId === 'string' && internalSession.sdkSessionId.length > 0;

    const runSdkQuery = (resumeId: string | undefined): Promise<QueryResult> => executeSdkQueryWithRetry({
      sessionId,
      sdkPrompt,
      agent,
      platform,
      chatId,
      userId,
      systemPrompt,
      sdkSessionManager,
      resumeId,
      continuationState: internalSession.continuationState ?? undefined,
      runtimeContext,
      mcpServers,
      allowedTools,
      canUseTool,
      onIntermediateMessage: onIntermediateMessageV2,
      onToolEvent,
      onSubAgentEvent: async (event) => {
        const delivered = await subAgentManager?.handle(event);
        if (delivered) state.subAgentMessageDelivered = true;
      },
      onHookEvent: async (event) => {
        await hookManager?.handle(event);
      },
      ...(subAgentManager ? { subAgentManager } : {}),
      clearIntermediateMessages: () => {
        state.intermediateMessages.length = 0;
      },
      preserveSdkSessionId: (sdkSessionId) => {
        sessionManager.setSdkSessionId(platform, agentId, userId, sdkSessionId);
      },
    });

    const handleQueryError = async (error: unknown): Promise<''> => {
      if (isCancelledError(error)) {
        qeLogger.info({ sessionId, sdkSessionId: internalSession.sdkSessionId }, 'Query cancelled; returning empty response and preserving sdkSessionId');
        return '';
      }

      const isResumeRequired = error instanceof Error && '_resumeRequired' in error;
      if (isResumeRequired) {
        qeLogger.warn(
          { sessionId, sdkSessionId: internalSession.sdkSessionId },
          'Schedule resume required but session returned empty; failing explicitly'
        );
        await adapter.sendMessage(
          chatId,
          '排程對話的 session 無法恢復。ClaudeCab 不會自動開啟新對話以免遺失上下文，請確認上下文後重新發送訊息。'
        );
        return '';
      }

      const errorMsg = getErrorMessage(error);
      const isV2RetryDisabled = error instanceof Error && hasRetryDisabledMarker(error);
      if (isV2RetryDisabled) {
        const savedSdkSessionId = (error as Error & { _sdkSessionId?: string })._sdkSessionId;
        if (savedSdkSessionId !== undefined) {
          sessionManager.setSdkSessionId(platform, agentId, userId, savedSdkSessionId);
        }
        qeLogger.warn(
          { sessionId, sdkSessionId: savedSdkSessionId ?? internalSession.sdkSessionId, error: errorMsg },
          'V2 session returned no usable stream; automatic retry disabled'
        );
        await adapter.sendMessage(
          chatId,
          `處理你的訊息時 session 沒有回傳可用內容。問題 session 已關閉並保留 id 以便恢復，請確認上下文後重新發送訊息。\n\n原因：${errorMsg}`
        );
        return '';
      }

      if (error instanceof Error && '_v1FallbackDisabled' in error) {
        qeLogger.warn(
          { sessionId, sdkSessionId: internalSession.sdkSessionId, error: errorMsg },
          'V2 session failed; V1 fallback disabled'
        );
        const userMessage = errorMsg.includes('Claude Code CLI override is invalid')
          ? `Claude Code CLI 設定無效，session 無法啟動。\n\n${errorMsg}\n\n請修正或清除 CLAUDE_CLI_PATH，再重啟 ClaudeCab。`
          : `處理你的訊息時 session 發生錯誤。為避免重複消耗，不自動重試。\n\n原因：${errorMsg}`;
        await adapter.sendMessage(
          chatId,
          userMessage
        );
        return '';
      }

      const isResumeError = isResumeIdentityError(errorMsg);

      if (internalSession.sdkSessionId !== undefined && isResumeError) {
        // Schedule thread first handoff: fail explicitly, don't silently start new conversation.
        if (internalSession.continuationState === 'pending') {
          qeLogger.warn(
            { sessionId, sdkSessionId: internalSession.sdkSessionId, error: errorMsg },
            'Schedule thread resume failed; refusing to silently start new conversation'
          );
          await adapter.sendMessage(
            chatId,
            '排程對話的 session 無法恢復。ClaudeCab 不會自動開啟新對話以免遺失上下文，請確認上下文後重新發送訊息。'
          );
          return '';
        }
        qeLogger.warn(
          { sessionId, sdkSessionId: internalSession.sdkSessionId, error: errorMsg },
          'SDK resume failed; automatic fresh-session retry disabled'
        );
        await adapter.sendMessage(
          chatId,
          '恢復 session 失敗。為避免重複消耗，不自動建立新 session。請確認上下文後重新發送訊息。'
        );
        return '';
      }

      throw error;
    };

    // Execute query. Broken manual resumes get one fresh-session recovery;
    // schedule handoff resumes remain fail-closed to avoid losing context.
    let result: QueryResult;
    try {
      result = await runSdkQuery(internalSession.sdkSessionId);
    } catch (error) {
      const canRecoverFresh = canRetryBrokenResumeAsFresh({
        queryStartedWithResume,
        continuationState: internalSession.continuationState ?? undefined,
        error,
      });

      if (!canRecoverFresh) {
        return await handleQueryError(error);
      }

      const brokenSdkSessionId = internalSession.sdkSessionId;
      sessionManager.setSdkSessionId(platform, agentId, userId, undefined);
      state.intermediateMessages.length = 0;
      qeLogger.warn(
        { sessionId, brokenSdkSessionId, error: getErrorMessage(error) },
        'V2 resume failed or returned no usable response; cleared sdkSessionId and retrying with a fresh SDK session'
      );

      try {
        result = await runSdkQuery(undefined);
      } catch (freshError) {
        qeLogger.warn(
          {
            sessionId,
            brokenSdkSessionId,
            error: getErrorMessage(freshError),
          },
          'Fresh SDK session retry after broken resume also failed'
        );
        return await handleQueryError(freshError);
      }
    }

    // --- Post-query handling ---

    // Save SDK session ID for future conversation resume
    if (result.sdkSessionId && result.sdkSessionId !== internalSession.sdkSessionId) {
      sessionManager.setSdkSessionId(platform, agentId, userId, result.sdkSessionId);
      qeLogger.debug({ sessionId, sdkSessionId: result.sdkSessionId }, 'Updated SDK session ID');
    }

    // Schedule thread handoff succeeded — activate (keep continuation_source, set state to active)
    if (internalSession.continuationState === 'pending') {
      sessionManager.activateScheduleHandoff(platform, agentId, userId);
    }

    // Record query metrics, execution audit, budget check
    const queryMetricId = recordQueryMetrics(result, agentId, platform, chatId, userId, queryMetricsRepository);
    const usageAnomaly = reportQueryUsageAnomaly({
      result,
      sessionId,
      agentId,
      chatId,
      userId,
      agentCwd: agent.path,
      sdkSessionManager,
      hasResume: queryStartedWithResume,
      ...(queryMetricId !== undefined ? { queryMetricId } : {}),
      ...(options !== undefined ? { options } : {}),
    });

    // Persist conversation messages to DB for continuity and inspection.
    persistConversation(sessionId, prompt, state.intermediateMessages, result.response, agentId, conversationRepository);

    await hookManager?.flushPending();

    // Deliver final response via StreamResponseRouter
    await deliverFinalResponse(state, result, adapter, chatId, agentId, sessionId, streamOpts);

    // Send per-turn usage summary for user-initiated queries.
    if (usageCardEnabled) {
      await deliverUsageSummary(result, adapter, chatId, usageAnomaly);
    }

    // Build full response from intermediate messages + final response
    const allResponses = [...state.intermediateMessages];
    if (result.response.length > 0) {
      allResponses.push(result.response);
    }
    const fullResponse = allResponses.join('\n\n');

    // Finalize status/sub-agent managers
    await statusManager?.finalizeAll();
    subAgentManager?.cleanupStale();
    await subAgentManager?.finalizeAll();

    return fullResponse;
  } finally {
    // Clean up interaction handler (deny any pending requests)
    interactionHandler.dispose();

    // Stop typing indicator
    if (typingInterval !== null) {
      clearInterval(typingInterval);
    }
  }
}
