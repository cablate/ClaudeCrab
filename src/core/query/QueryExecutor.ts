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
import { decoratePromptWithConfiguredDecorations, getPromptDecorationDecision } from './PromptDecorator.js';
import { deliverUsageSummary } from './UsageCardFormatter.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';
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
}

export interface QueryExecuteOptions {
  replyToMessageId?: string;
  parentConversationId?: string;
  sourceMessageChannelId?: string;
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

  const promptDecoration = getPromptDecorationDecision(prompt);
  const sdkPrompt = decoratePromptWithConfiguredDecorations(prompt);
  const promptDecorationApplied = sdkPrompt !== prompt;
  qeLogger.info(
    {
      event_type: EventType.PROMPT_DECORATION,
      sessionId,
      agentId,
      chatId,
      userId,
      applied: promptDecorationApplied,
      shouldDecorate: promptDecoration.shouldDecorate,
      skipReason: promptDecoration.reason,
      promptLength: promptDecoration.promptLength,
      originalPromptLength: prompt.length,
      decoratedPromptLength: sdkPrompt.length,
      decorationKeys: promptDecoration.keys,
      decorationTags: promptDecoration.tagNames,
    },
    promptDecorationApplied ? 'Query prompt decoration applied' : 'Query prompt decoration skipped'
  );

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
      ...(process.env.DISCORD_GUILD_ID ? { guildId: process.env.DISCORD_GUILD_ID } : {}),
      ...(options?.parentConversationId !== undefined ? { parentConversationId: options.parentConversationId } : {}),
      ...(options?.replyToMessageId !== undefined ? { originalMessageId: options.replyToMessageId } : {}),
      ...(options?.sourceMessageChannelId !== undefined ? { sourceMessageChannelId: options.sourceMessageChannelId } : {}),
    };

    // Capture the pre-query resume state. After a restart, resumed SDK sessions
    // can have in-memory messageCount 0/1 even though the transcript is old.
    const queryStartedWithResume =
      typeof internalSession.sdkSessionId === 'string' && internalSession.sdkSessionId.length > 0;

    // Execute query. Resume failures are fail-closed to avoid automatic duplicate sends.
    let result: QueryResult;
    try {
      result = await executeSdkQueryWithRetry({
        sessionId,
        sdkPrompt,
        agent,
        platform,
        chatId,
        userId,
        systemPrompt,
        sdkSessionManager,
        resumeId: internalSession.sdkSessionId,
        continuationState: internalSession.continuationState ?? undefined,
        runtimeContext,
        ...(agent.config.settings?.maxTurns !== undefined
          ? { maxTurns: agent.config.settings.maxTurns }
          : {}),
        mcpServers,
        allowedTools,
        canUseTool,
        onIntermediateMessage: onIntermediateMessageV2,
        onToolEvent,
        onSubAgentEvent: async (event) => {
          await subAgentManager?.handle(event);
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
    } catch (error) {
      const isCancelled =
        (error instanceof Error && '_cancelled' in error) ||
        (error instanceof Error && error.name === 'AbortError') ||
        (error instanceof Error && error.message.includes('aborted by user')) ||
        (typeof error === 'object' && error !== null && 'value' in error &&
          String((error as { value: unknown }).value).includes('aborted by user'));
      if (isCancelled) {
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
          'Schedule thread resume failed. The original SDK session could not be resumed, so ClaudeCab will not silently start a new conversation. Please resend after checking context.'
        );
        return '';
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      const isV2RetryDisabled =
        error instanceof Error &&
        ('_resumeRetryDisabled' in error || '_zombieRetryDisabled' in error || '_emptyStreamRetryDisabled' in error);
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
          `V2 session returned no usable response. The broken process was closed, V1 fallback is disabled, and the SDK session id was preserved for V2 resume.\n\nPlease resend your message after checking context.\n\nReason: ${errorMsg}`
        );
        return '';
      }

      if (error instanceof Error && '_v1FallbackDisabled' in error) {
        qeLogger.warn(
          { sessionId, sdkSessionId: internalSession.sdkSessionId, error: errorMsg },
          'V2 session failed; V1 fallback disabled'
        );
        await adapter.sendMessage(
          chatId,
          `V2 session failed. V1 fallback is disabled to prevent duplicate high-cost query.\n\nReason: ${errorMsg}`
        );
        return '';
      }

      const isResumeError =
        errorMsg.includes('session') ||
        errorMsg.includes('resume') ||
        errorMsg.includes('not found') ||
        errorMsg.includes('expired') ||
        errorMsg.includes('tool_use ids must be unique');

      if (internalSession.sdkSessionId !== undefined && isResumeError) {
        // Schedule thread first handoff: fail explicitly, don't silently start new conversation
        if (internalSession.continuationState === 'pending') {
          qeLogger.warn(
            { sessionId, sdkSessionId: internalSession.sdkSessionId, error: errorMsg },
            'Schedule thread resume failed; refusing to silently start new conversation'
          );
          await adapter.sendMessage(
            chatId,
            'Schedule thread resume failed. The original SDK session could not be resumed, so ClaudeCab will not silently start a new conversation. Please resend after checking context.'
          );
          return '';
        }
        qeLogger.warn(
          { sessionId, sdkSessionId: internalSession.sdkSessionId, error: errorMsg },
          'SDK resume failed; automatic fresh-session retry disabled'
        );
        await adapter.sendMessage(
          chatId,
          'V2 session resume failed. Automatic fresh-session retry is disabled to prevent duplicate high-cost query. Please resend after checking context if needed.'
        );
        return '';
      } else {
        throw error;
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


