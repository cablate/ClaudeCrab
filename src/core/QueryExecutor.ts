/**
 * QueryExecutor — Handles Claude SDK query execution with retry logic.
 *
 * Extracted from MessageProcessor to isolate SDK query concerns:
 * - V2 SDKSessionManager dispatch (primary path)
 * - no V1 SDKQueryManager fallback
 * - additionalDirectories configuration
 * - MCP server setup
 * - Callback wiring (delegates to StreamResponseRouter)
 * - Budget post-check logic (delegates to QueryMetricsRecorder)
 * - Session ID persistence after query
 * - Group context injection (prepareGroupContext / updateInjectionCursor)
 * - Conversation persistence
 * - Bot replied event emission
 */

import path from 'path';
import { EmbedBuilder } from 'discord.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import type { IConversationRepository, IQueryMetricsRepository } from '../persistence/types.js';
import type { ExecutionRecordRepository } from '../persistence/ExecutionRecordRepository.js';
import type { RateLimitRepository } from '../persistence/RateLimitRepository.js';
import type { ActivityService } from './ActivityService.js';
import type { TTSService } from '../services/TTSService.js';
import type { BudgetService } from '../services/BudgetService.js';
import type { TaskService } from '../services/TaskService.js';
import type { ActivityEventService } from '../services/ActivityEventService.js';
import { SessionManager } from './SessionManager.js';
import type { QueryResult, SDKQueryManager } from './SDKQueryManager.js';
import { SDKSessionManager } from './SDKSessionManager.js';
import { InteractionHandler } from './InteractionHandler.js';
import { EventBus } from './EventBus.js';
import { ContextInjector } from './ContextInjector.js';
import { decoratePromptWithConfiguredDecorations, getPromptDecorationDecision } from './PromptDecorator.js';
import { diagnoseQueryUsage, formatUsageAnomalySummary, splitMainSubagentUsage, type UsageAnomalyReport } from './UsageAnomalyDiagnostics.js';
import { analyzeCurrentTurn } from './CacheAnomalyAnalyzer.js';
import { getJsonlPath } from './SDKTranscriptDiagnostics.js';
import { formatBotLabel } from '../utils/format.js';
import { logger } from '../utils/logger.js';
import { EventType } from '../utils/events.js';
import { ProcessingError } from '../types/errors.js';
import {
  retryAsync,
  API_RETRY_OPTIONS,
  isRateLimitError,
  isTransientError,
} from '../utils/retry.js';
import { isGroupUserId, extractChatIdFromGroupUserId } from '../utils/groupSession.js';
import { buildMcpSetup } from '../McpToolSetup.js';
import { buildDiscordChannelUrl, buildDiscordMessageUrl } from '../types/runtimeContext.js';
import {
  buildQueryManagers,
  buildV2IntermediateMessageCallback,
  buildToolEventCallback,
  deliverFinalResponse,
  createStreamState,
} from './StreamResponseRouter.js';
import {
  recordQueryMetrics,
  recordExecutionAudit,
  handleBudgetPostCheck,
} from './QueryMetricsRecorder.js';

const qeLogger = logger.child({ module: 'QueryExecutor' });

/**
 * Dependencies injected into QueryExecutor
 */
export interface QueryExecutorDeps {
  sessionManager: SessionManager;
  sdkQueryManager: SDKQueryManager;
  sdkSessionManager: SDKSessionManager;
  activityService?: ActivityService;
  activityEventService?: ActivityEventService;
  ttsService?: TTSService;
  budgetService?: BudgetService;
  executionRecordRepository?: ExecutionRecordRepository;
  queryMetricsRepository?: IQueryMetricsRepository;
  conversationRepository?: IConversationRepository;
  taskService?: TaskService;
  getSystemPrompt?: (agentId: string) => Promise<string>;
  getBotInfo?: (agentId: string) => { username: string; id: number } | null;
  sendTypingIndicators: boolean;
  typingIndicatorIntervalMs: number;
  contextInjector?: ContextInjector;
  eventBus?: EventBus;
  rateLimitRepository?: RateLimitRepository;
  /** When false, hides in-chat tool status messages and usage summary card */
  inChatUsageSummary: boolean;
}

export interface QueryExecuteOptions {
  isGroupChat?: boolean;
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
    activityService,
    activityEventService,
    ttsService,
    budgetService,
    executionRecordRepository,
    queryMetricsRepository,
    taskService,
    getSystemPrompt,
    sendTypingIndicators,
    typingIndicatorIntervalMs,
    contextInjector,
    eventBus,
    getBotInfo,
    conversationRepository,
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
    adapter, chatId, sessionId, sdkSessionManager, options?.isGroupChat === true, deps.inChatUsageSummary
  );

  // Set up interaction handler for permission prompts and question prompts
  const interactionHandler = new InteractionHandler(adapter, chatId, 120_000, agentId);
  const canUseTool = interactionHandler.buildCanUseTool();

  // Prepare group context injection and build final prompt (ADR-019)
  const { finalPrompt, injectionContext } = prepareGroupContext(
    prompt, agentId, chatId, userId, platform, contextInjector, options?.isGroupChat
  );
  const promptDecoration = getPromptDecorationDecision(finalPrompt);
  const sdkPrompt = decoratePromptWithConfiguredDecorations(finalPrompt);
  const promptDecorationApplied = sdkPrompt !== finalPrompt;
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
      originalPromptLength: finalPrompt.length,
      decoratedPromptLength: sdkPrompt.length,
      decorationKeys: promptDecoration.keys,
      decorationTags: promptDecoration.tagNames,
    },
    promptDecorationApplied ? 'Query prompt decoration applied' : 'Query prompt decoration skipped'
  );

  // Build MCP tool configuration for this query
  const mcpCtx: import('../McpToolSetup.js').McpSetupContext = {
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
    ttsService,
    adapter,
    mcpCtx,
    taskService,
  );

  const streamOpts: import('./StreamResponseRouter.js').StreamRouterOptions = {};
  if (options?.isGroupChat === true) streamOpts.isGroupChat = true;
  if (options?.replyToMessageId !== undefined) streamOpts.replyToMessageId = options.replyToMessageId;

  try {
    // Track intermediate messages and delivery state
    const state = createStreamState();

    // Build callbacks via StreamResponseRouter
    const onIntermediateMessageV2 = buildV2IntermediateMessageCallback(
      state, adapter, chatId, agentId, statusManager, activityService, streamOpts
    );
    const onToolEvent = buildToolEventCallback(state, agentId, statusManager, activityService, hookManager);

    // Helper: execute SDK query with retry for rate limit / transient errors
    const executeWithRetry = async (resumeId: string | undefined) => {
      return await retryAsync(
        async () => {
          // V2 persistent session: keeps cli.js process alive so cache can persist.
          try {
            return await sdkSessionManager.executeQuery(
              sessionId,
              sdkPrompt,
              agent,
              {
                cwd: agent.path,
                systemPrompt,
                additionalDirectories: [
                  path.resolve(agent.path, '..', '_foundation'),
                  path.resolve(agent.path, '..', '_example'),
                ],
                runtimeContext: {
                  platform,
                  agentId,
                  chatId,
                  userId,
                  ...(process.env.DISCORD_GUILD_ID ? { guildId: process.env.DISCORD_GUILD_ID } : {}),
                  ...(options?.parentConversationId !== undefined ? { parentConversationId: options.parentConversationId } : {}),
                  ...(options?.replyToMessageId !== undefined ? { originalMessageId: options.replyToMessageId } : {}),
                  ...(options?.sourceMessageChannelId !== undefined ? { sourceMessageChannelId: options.sourceMessageChannelId } : {}),
                },
                ...(agent.config.settings?.maxTurns !== undefined
                  ? { maxTurns: agent.config.settings.maxTurns }
                  : {}),
                ...(Object.keys(mcpServers).length > 0
                  ? { mcpServers, allowedTools }
                  : {}),
                resume: resumeId,
                ...(internalSession.continuationState === 'pending' ? { requireResume: true } : {}),
                onIntermediateMessage: onIntermediateMessageV2,
                onToolEvent,
                onSubAgentEvent: async (event) => {
                  await subAgentManager?.handle(event);
                },
                onHookEvent: async (event) => {
                  await hookManager?.handle(event);
                },
                ...(subAgentManager ? { subAgentManager } : {}),
                additionalOptions: { canUseTool },
              }
            );
          } catch (v2Error) {
            // SDK abort may throw non-Error values like { value: "Claude Code process aborted by user" }
            const errMsg = v2Error instanceof Error
              ? v2Error.message
              : typeof v2Error === 'object' && v2Error !== null && 'value' in v2Error
                ? String((v2Error as { value: unknown }).value)
                : String(v2Error);
            // If query was cancelled by user (/stop) or interrupted, do not retry or fallback.
            // CLI binary emits [ede_diagnostic] when interrupt() fires mid-tool_use.
            if (
              errMsg.includes('cancelled by user') ||
              errMsg.includes('aborted by user') ||
              (errMsg.includes('ede_diagnostic') && errMsg.includes('stop_reason=tool_use'))
            ) {
              const savedSdkSessionId = (v2Error as { _sdkSessionId?: string })._sdkSessionId;
              if (savedSdkSessionId) {
                sessionManager.setSdkSessionId(platform, agentId, userId, savedSdkSessionId);
                qeLogger.info({ sessionId, sdkSessionId: savedSdkSessionId },
                  'V2 query interrupted/cancelled - sdkSessionId preserved for resume');
              } else {
                qeLogger.info({ sessionId, errMsg }, 'V2 query interrupted/cancelled - no sdkSessionId to preserve');
              }
              throw Object.assign(new Error('Query cancelled'), { _cancelled: true });
            }
            // V2 fail-closed errors must not be converted into a generic fallback-disabled error.
            if (
              v2Error instanceof Error &&
              (
                '_resumeRequired' in v2Error ||
                '_resumeRetryDisabled' in v2Error ||
                '_zombieRetryDisabled' in v2Error ||
                '_emptyStreamRetryDisabled' in v2Error
              )
            ) {
              throw v2Error;
            }

            const savedSdkSessionId = (v2Error as { _sdkSessionId?: string })._sdkSessionId;
            qeLogger.warn(
              { sessionId, error: errMsg, sdkSessionId: savedSdkSessionId },
              'V2 persistent session failed; V1 fallback disabled'
            );
            sdkSessionManager.destroySession(sessionId);

            const fallbackDisabledError = new Error(
              `V2 persistent session failed and V1 fallback is disabled to prevent duplicate high-cost query. Original error: ${errMsg}`
            );
            const typedError = fallbackDisabledError as Error & {
              _v1FallbackDisabled: true;
              _sdkSessionId?: string;
            };
            typedError._v1FallbackDisabled = true;
            if (savedSdkSessionId !== undefined) typedError._sdkSessionId = savedSdkSessionId;
            throw typedError;
          }
        },
        {
          ...API_RETRY_OPTIONS,
          isRetryable: (err) =>
            !(err instanceof Error && '_cancelled' in err) &&
            !(err instanceof Error && '_v1FallbackDisabled' in err) &&
            !(err instanceof Error && '_resumeRetryDisabled' in err) &&
            !(err instanceof Error && '_zombieRetryDisabled' in err) &&
            !(err instanceof Error && '_emptyStreamRetryDisabled' in err) &&
            (isRateLimitError(err) || isTransientError(err)),
          onRetry: (attempt, err, delayMs) => {
            state.intermediateMessages.length = 0;
            qeLogger.warn(
              {
                sessionId,
                attempt,
                delayMs,
                error: err instanceof Error ? err.message : String(err),
              },
              'Retrying SDK query'
            );
          },
        }
      );
    };

    // Capture the pre-query resume state. After a restart, resumed SDK sessions
    // can have in-memory messageCount 0/1 even though the transcript is old.
    const queryStartedWithResume =
      typeof internalSession.sdkSessionId === 'string' && internalSession.sdkSessionId.length > 0;

    // Execute query. Resume failures are fail-closed to avoid automatic duplicate sends.
    let result;
    try {
      result = await executeWithRetry(internalSession.sdkSessionId);
    } catch (error) {
      const isCancelled =
        (error instanceof Error && '_cancelled' in error) ||
        (error instanceof Error && error.name === 'AbortError') ||
        (error instanceof Error && error.message.includes('aborted by user')) ||
        (typeof error === 'object' && error !== null && 'value' in error &&
          String((error as { value: unknown }).value).includes('aborted by user'));
      if (isCancelled) {
        qeLogger.info({ sessionId, sdkSessionId: internalSession.sdkSessionId }, 'Query cancelled — returning empty response (sdkSessionId preserved)');
        return '';
      }

      const isResumeRequired = error instanceof Error && '_resumeRequired' in error;
      if (isResumeRequired) {
        qeLogger.warn(
          { sessionId, sdkSessionId: internalSession.sdkSessionId },
          'Schedule resume required but session returned empty — failing explicitly'
        );
        await adapter.sendFormattedMessage(
          chatId,
          '❌ 無法恢復排程對話的上下文。原始 session 可能已過期或損壞。請重新執行排程任務。'
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
        await adapter.sendFormattedMessage(
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
        await adapter.sendFormattedMessage(
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
            'Schedule thread resume failed — refusing to silently start new conversation'
          );
          await adapter.sendFormattedMessage(
            chatId,
            '❌ 無法恢復排程對話的上下文。原始 session 可能已過期或損壞。請重新執行排程任務。'
          );
          return '';
        }
        qeLogger.warn(
          { sessionId, sdkSessionId: internalSession.sdkSessionId, error: errorMsg },
          'SDK resume failed; automatic fresh-session retry disabled'
        );
        await adapter.sendFormattedMessage(
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
    const queryMetricId = recordQueryMetrics(result, agentId, platform, chatId, userId, queryMetricsRepository, sessionManager);
    recordExecutionAudit(result, agentId, 'chat', userId, chatId, options?.taskId, executionRecordRepository);
    handleBudgetPostCheck(agentId, budgetService, activityEventService);
    const usageAnomaly = reportQueryUsageAnomaly({
      result,
      sessionId,
      agentId,
      chatId,
      userId,
      agentCwd: agent.path,
      sdkSessionManager,
      hasResume: queryStartedWithResume,
      ...(activityEventService !== undefined ? { activityEventService } : {}),
      ...(queryMetricId !== undefined ? { queryMetricId } : {}),
      ...(options !== undefined ? { options } : {}),
    });

    // Update injection cursor (must happen AFTER query succeeds)
    updateInjectionCursor(injectionContext, userId, chatId, agentId, platform, contextInjector);

    // Persist conversation messages to DB for continuity and inspection.
    persistConversation(sessionId, prompt, state.intermediateMessages, result.response, agentId, conversationRepository, getBotInfo, options);

    await hookManager?.flushPending();

    // Deliver final response via StreamResponseRouter
    await deliverFinalResponse(state, result, adapter, chatId, agentId, sessionId, streamOpts);

    // Send per-turn usage summary for user-initiated queries.
    if (inChatUsageSummary) {
      await deliverUsageSummary(result, adapter, chatId, usageAnomaly);
    }

    // Build full response from intermediate messages + final response
    const allResponses = [...state.intermediateMessages];
    if (result.response.length > 0) {
      allResponses.push(result.response);
    }
    const fullResponse = allResponses.join('\n\n');

    // Activity event: chat responded
    void activityEventService?.log({
      type: 'chat.responded',
      agentId,
      message: `回覆完成（in ${result.usage?.inputTokens ?? 0} + out ${result.usage?.outputTokens ?? 0} tokens, $${((result.totalCostUsd ?? 0)).toFixed(3)}）`,
    });

    // v2.0: Workflow log (factual, sync)
    activityService?.emitWorkflow(agentId, 'completed', '回覆完成');

    // v2.0: Emit reply event for Live backlog
    if (result.response.length > 0) {
      activityService?.emitReply(agentId, result.response);
    }

    // v2.0: Status change only for completed (no Haiku)
    activityService?.emitStatusChange(agentId, 'completed', 'neutral');

    // Broadcast to other bots
    emitBotRepliedEvent(fullResponse, chatId, agentId, platform, state.lastSentMessageId, eventBus, getBotInfo, options);
    await statusManager?.finalizeAll();
    // Plan G: do NOT finalizeAll/dispose subAgentManager here. It's now
    // session-scoped — pre-drain on the next query (or /sync) will route
    // late task_notification events to update the chat message in place.

    return fullResponse;
  } finally {
    // Clean up interaction handler (deny any pending requests)
    interactionHandler.dispose();

    // Stop typing indicator
    if (typingInterval !== null) {
      clearInterval(typingInterval);
    }

    // Plan G: do NOT dispose subAgentManager here. Lifecycle is now session-scoped.
  }
}

// ---------------------------------------------------------------------------
// Query preparation helpers
// ---------------------------------------------------------------------------

/**
 * Prepare group chat context injection and build the final prompt.
 * Injects recent group messages as context prefix for multi-bot group chats (ADR-019).
 */
function prepareGroupContext(
  prompt: string,
  agentId: string,
  chatId: string,
  userId: string,
  platform: string,
  contextInjector: ContextInjector | undefined,
  isGroupChat?: boolean
): {
  finalPrompt: string;
  injectionContext: { formattedHistory: string; messageCount: number; lastMessageId: string | null } | null;
} {
  let injectionContext: { formattedHistory: string; messageCount: number; lastMessageId: string | null } | null = null;

  if (isGroupChat && contextInjector) {
    const groupChatId = isGroupUserId(userId) ? extractChatIdFromGroupUserId(userId) : chatId;
    injectionContext = contextInjector.getInjectionContext(agentId, groupChatId, platform);
    if (injectionContext.messageCount > 0) {
      qeLogger.info(
        { agentId, chatId: groupChatId, messageCount: injectionContext.messageCount },
        'Injecting group chat context'
      );
      qeLogger.debug(
        { agentId, formattedHistory: injectionContext.formattedHistory },
        'Injection context content'
      );
    }
  }

  const finalPrompt = injectionContext?.formattedHistory
    ? `${injectionContext.formattedHistory}\n${prompt}`
    : prompt;

  qeLogger.debug(
    { agentId, originalPrompt: prompt.substring(0, 100), hasInjection: !!injectionContext?.formattedHistory },
    'Final prompt built'
  );

  return { finalPrompt, injectionContext };
}

// ---------------------------------------------------------------------------
// Post-query helpers
// ---------------------------------------------------------------------------

/**
 * Update injection cursor after successful SDK query (ADR-019).
 */
function updateInjectionCursor(
  injectionContext: { lastMessageId: string | null } | null,
  userId: string,
  chatId: string,
  agentId: string,
  platform: string,
  contextInjector: ContextInjector | undefined
): void {
  if (injectionContext?.lastMessageId && contextInjector) {
    const groupChatId = isGroupUserId(userId)
      ? extractChatIdFromGroupUserId(userId)
      : chatId;
    contextInjector.updateCursor(agentId, groupChatId, platform, injectionContext.lastMessageId);
  }
}

/**
 * Persist user and assistant messages to database for continuity and inspection.
 */
function persistConversation(
  sessionId: string,
  prompt: string,
  intermediateMessages: string[],
  resultResponse: string,
  agentId: string,
  conversationRepository: import('../persistence/types.js').IConversationRepository | undefined,
  getBotInfo: ((agentId: string) => { username: string; id: number } | null) | undefined,
  options?: { isGroupChat?: boolean }
): void {
  if (conversationRepository === undefined) return;

  try {
    conversationRepository.appendMessage(sessionId, 'user', prompt);

    const botLabel =
      options?.isGroupChat && getBotInfo !== undefined
        ? formatBotLabel(getBotInfo(agentId), agentId)
        : null;

    for (const msg of intermediateMessages) {
      const labeledMsg = botLabel !== null ? `${botLabel}: ${msg}` : msg;
      conversationRepository.appendMessage(sessionId, 'assistant', labeledMsg);
    }

    if (resultResponse.length > 0) {
      const labeledResponse =
        botLabel !== null
          ? `${botLabel}: ${resultResponse}`
          : resultResponse;
      conversationRepository.appendMessage(sessionId, 'assistant', labeledResponse);
    }
  } catch (persistError) {
    qeLogger.warn(
      { error: persistError, sessionId },
      'Failed to persist conversation messages'
    );
  }
}

/**
 * Emit bot:replied event for group chat context injection (ADR-019).
 */
function emitBotRepliedEvent(
  fullResponse: string,
  chatId: string,
  agentId: string,
  platform: string,
  lastSentMessageId: string | undefined,
  eventBus: EventBus | undefined,
  getBotInfo: ((agentId: string) => { username: string; id: number } | null) | undefined,
  options?: { isGroupChat?: boolean }
): void {
  if (!options?.isGroupChat || eventBus === undefined || fullResponse.length === 0) {
    return;
  }

  const botLabel = formatBotLabel(getBotInfo?.(agentId), agentId);

  qeLogger.info(
    { chatId, agentId, botLabel, responsePreview: fullResponse.substring(0, 100), lastSentMessageId },
    'Emitting bot:replied event'
  );

  eventBus.emit('bot:replied', {
    chatId,
    agentId,
    response: `${botLabel}: ${fullResponse}`,
    platform,
    ...(lastSentMessageId !== undefined ? { replyMessageId: lastSentMessageId } : {}),
  });
}

interface UsageAnomalyReportContext {
  result: QueryResult;
  sessionId: string;
  agentId: string;
  chatId: string;
  userId: string;
  agentCwd: string;
  sdkSessionManager: SDKSessionManager;
  hasResume?: boolean;
  activityEventService?: ActivityEventService;
  queryMetricId?: number;
  options?: QueryExecuteOptions;
}

function reportQueryUsageAnomaly(ctx: UsageAnomalyReportContext): UsageAnomalyReport | null {
  const summaryReader = ctx.sdkSessionManager as SDKSessionManager & {
    getSessionSummaries?: () => ReturnType<SDKSessionManager['getSessionSummaries']>;
  };
  const sessionSummary = typeof summaryReader.getSessionSummaries === 'function'
    ? summaryReader.getSessionSummaries().find((summary) => summary.sessionId === ctx.sessionId)
    : undefined;
  const runtime = sessionSummary?.runtimeContext;
  const guildId = runtime?.guildId ?? process.env.DISCORD_GUILD_ID;
  const targetChatId = runtime?.chatId ?? ctx.chatId;
  const sourceChannelId = runtime?.sourceMessageChannelId ?? ctx.options?.sourceMessageChannelId ?? targetChatId;
  const sourceMessageId = runtime?.originalMessageId ?? ctx.options?.replyToMessageId;
  const discordUrl = buildDiscordChannelUrl(guildId, targetChatId);
  const sourceMessageUrl = buildDiscordMessageUrl(guildId, sourceChannelId, sourceMessageId);
  const cwd = sessionSummary?.cwd ?? ctx.agentCwd;
  const sdkSessionId = ctx.result.sdkSessionId || sessionSummary?.sdkSessionId;
  const jsonlPath = sdkSessionId !== undefined && cwd.length > 0
    ? getJsonlPath(sdkSessionId, cwd)
    : undefined;

  const report = diagnoseQueryUsage(ctx.result, {
    sessionId: ctx.sessionId,
    agentId: ctx.agentId,
    chatId: targetChatId,
    userId: ctx.userId,
    cwd,
    ...(sdkSessionId !== undefined ? { sdkSessionId } : {}),
    ...(ctx.queryMetricId !== undefined ? { queryMetricId: ctx.queryMetricId } : {}),
    ...(discordUrl !== undefined ? { discordUrl } : {}),
    ...(sourceMessageUrl !== undefined ? { sourceMessageUrl } : {}),
    ...(jsonlPath !== undefined ? { jsonlPath } : {}),
    ...(sessionSummary?.messageCount !== undefined ? { sessionMessageCount: sessionSummary.messageCount } : {}),
    ...(ctx.hasResume !== undefined ? { hasResume: ctx.hasResume } : {}),
    ...(sessionSummary?.lastPromptCacheMutation !== undefined ? { promptCacheMutation: sessionSummary.lastPromptCacheMutation } : {}),
  });
  if (report === null) return null;

  // Enrich with JSONL-based per-turn cause identification (main-only metrics)
  const enrichSplit = splitMainSubagentUsage(ctx.result.modelUsage, ctx.result.mainModel);
  if (jsonlPath !== undefined && ctx.result.usage !== undefined) {
    const mainMetrics = enrichSplit?.main;
    const jsonlFinding = analyzeCurrentTurn(
      {
        input_tokens: mainMetrics?.freshInputTokens ?? ctx.result.usage.inputTokens ?? 0,
        cache_read_input_tokens: mainMetrics?.cacheReadTokens ?? ctx.result.usage.cacheReadInputTokens ?? 0,
        cache_creation_input_tokens: mainMetrics?.cacheCreationTokens ?? ctx.result.usage.cacheCreationInputTokens ?? 0,
        output_tokens: mainMetrics?.outputTokens ?? ctx.result.usage.outputTokens ?? 0,
      },
      jsonlPath,
    );
    if (jsonlFinding !== null) {
      report.details += `\njsonlCause=${jsonlFinding.cause}${jsonlFinding.causeDetail ? ` detail=${jsonlFinding.causeDetail}` : ''}${jsonlFinding.causeLine ? ` at=L${jsonlFinding.causeLine}` : ''}`;
    }
  }

  const logPayload = {
    event_type: EventType.CACHE_QUERY_ANOMALY,
    sessionId: ctx.sessionId,
    sdkSessionId,
    agentId: ctx.agentId,
    chatId: targetChatId,
    userId: ctx.userId,
    queryMetricId: ctx.queryMetricId,
    severity: report.severity,
    shouldAlert: report.shouldAlert,
    likelyCause: report.likelyCause,
    findings: report.findings.map((finding) => finding.code),
    hasResume: ctx.hasResume,
    sessionMessageCount: sessionSummary?.messageCount,
    modelBreakdown: report.modelBreakdown,
    ...report.metrics,
    discordUrl,
    sourceMessageUrl,
    jsonlPath,
  };
  if (report.shouldAlert) {
    qeLogger.warn(logPayload, 'Query usage anomaly detected');
    void ctx.activityEventService?.log({
      type: report.activityType,
      level: 'warn',
      agentId: ctx.agentId,
      message: report.message,
      details: report.details,
      ...(report.links !== undefined ? { links: report.links } : {}),
      metadata: {
        sessionId: ctx.sessionId,
        sdkSessionId,
        queryMetricId: ctx.queryMetricId,
        chatId: targetChatId,
        userId: ctx.userId,
        jsonlPath,
        discordUrl,
        sourceMessageUrl,
        hasResume: ctx.hasResume,
        sessionMessageCount: sessionSummary?.messageCount,
        severity: report.severity,
        likelyCause: report.likelyCause,
        findings: report.findings.map((f) => f.code),
        metrics: report.metrics,
        modelBreakdown: report.modelBreakdown,
        split: splitMainSubagentUsage(ctx.result.modelUsage, ctx.result.mainModel),
        jsonlFinding: jsonlPath !== undefined && ctx.result.usage !== undefined
          ? analyzeCurrentTurn(
              {
                input_tokens: ctx.result.usage.inputTokens ?? 0,
                cache_read_input_tokens: ctx.result.usage.cacheReadInputTokens ?? 0,
                cache_creation_input_tokens: ctx.result.usage.cacheCreationInputTokens ?? 0,
                output_tokens: ctx.result.usage.outputTokens ?? 0,
              },
              jsonlPath,
            )
          : null,
      },
    });
  } else {
    qeLogger.info(logPayload, 'Query usage diagnostic note');
  }

  return report;
}

/**
 * Send per-turn usage summary as a Discord subtitle message.
 */
function formatTokenShort(value: number): string {
  const safeValue = Math.max(0, Math.round(value));
  if (safeValue >= 1_000_000) return `${(safeValue / 1_000_000).toFixed(1)}M`;
  if (safeValue >= 10_000) return `${Math.round(safeValue / 1000)}K`;
  if (safeValue >= 1000) return `${(safeValue / 1000).toFixed(1)}K`;
  return safeValue.toLocaleString();
}

function formatProgressBar(pct: number | undefined, width = 10): string {
  const safePct = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  const filled = Math.round((safePct / 100) * width);
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
}

function formatTurnLabel(turns: number): string {
  return `${turns} ${turns === 1 ? 'turn' : 'turns'}`;
}

function uniqueActualModels(result: import('./SDKQueryManager.js').QueryResult): string[] {
  if (result.modelUsage !== undefined) return Object.keys(result.modelUsage);
  return [...new Set(result.actualModels ?? [])];
}

function formatCounts(counts: Record<string, number> | undefined, suffix = ''): string | undefined {
  if (counts === undefined) return undefined;
  const entries = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return undefined;
  return entries.map(([name, count]) => `${name}:${suffix === 'ch' ? formatTokenShort(count) : count}${suffix}`).join(', ');
}

function compactContextCategoryName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('free')) return 'free';
  if (lower.includes('autocompact')) return 'autocompact';
  if (lower.includes('message')) return 'conversation';
  if (lower.includes('mcp')) return lower.includes('deferred') ? 'mcp(deferred)' : 'mcp';
  if (lower.includes('system prompt')) return 'system';
  if (lower.includes('tool')) return lower.includes('deferred') ? 'tools(deferred)' : 'tools';
  if (lower.includes('skill')) return 'skills';
  if (lower.includes('memory')) return 'memory';
  if (lower.includes('agent')) return 'agents';
  return name
    .replace(/\s+/g, '')
    .slice(0, 14);
}

function formatModelUsageLines(result: QueryResult, totalCost: number): string[] {
  const modelUsage = result.modelUsage;
  if (modelUsage !== undefined) {
    const entries = Object.entries(modelUsage)
      .filter(([, usage]) => usage.costUsd > 0 || usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cacheCreationInputTokens > 0 || usage.cacheReadInputTokens > 0)
      .sort(([, left], [, right]) => right.costUsd - left.costUsd);
    if (entries.length > 0) {
      return entries.map(([model, usage]) => `• ${model} · $${usage.costUsd.toFixed(3)}`);
    }
  }

  const actualModels = uniqueActualModels(result);
  if (actualModels.length === 1 && actualModels[0] !== undefined) {
    return [`• ${actualModels[0]} · $${totalCost.toFixed(4)}`];
  }
  return actualModels.map((model) => `• ${model}`);
}

function formatCacheModelBreakdown(result: QueryResult): string[] {
  const modelUsage = result.modelUsage;
  if (modelUsage === undefined) return [];
  const entries = Object.entries(modelUsage)
    .filter(([, usage]) => (usage.cacheCreationInputTokens ?? 0) > 0 || (usage.cacheReadInputTokens ?? 0) > 0)
    .sort(([, left], [, right]) => (right.cacheCreationInputTokens ?? 0) - (left.cacheCreationInputTokens ?? 0));
  if (entries.length <= 1) return [];
  return entries.map(([model, usage]) => {
    const shortModel = model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    return `  ${shortModel}: w ${formatTokenShort(usage.cacheCreationInputTokens ?? 0)} · r ${formatTokenShort(usage.cacheReadInputTokens ?? 0)}`;
  });
}

interface UsageQuotaSummary {
  fiveHourPct?: number;
  sevenDayPct?: number;
}

type UsageContext = NonNullable<QueryResult['contextUsage']>;

function sumContextCategories(ctx: UsageContext, predicate: (lowerName: string) => boolean): number | undefined {
  const total = ctx.categories
    .filter((entry) => entry.tokens > 0 && predicate(entry.name.toLowerCase()))
    .reduce((sum, entry) => sum + entry.tokens, 0);
  return total > 0 ? total : undefined;
}

function sumTokenItems(items: Array<{ tokens: number }> | undefined): number | undefined {
  const total = (items ?? []).reduce((sum, item) => sum + Math.max(0, item.tokens), 0);
  return total > 0 ? total : undefined;
}

function sumConversationBreakdown(ctx: UsageContext): number | undefined {
  const breakdown = ctx.messageBreakdown;
  if (breakdown === undefined) return undefined;
  const total =
    breakdown.userMessageTokens +
    breakdown.assistantMessageTokens +
    breakdown.toolCallTokens +
    breakdown.toolResultTokens +
    breakdown.attachmentTokens +
    breakdown.redirectedContextTokens +
    breakdown.unattributedTokens;
  return total > 0 ? total : undefined;
}

function formatContextMetric(value: number | undefined): string {
  return value === undefined ? '?K' : formatTokenShort(value);
}

function buildContextBreakdownLines(ctx: UsageContext): string[] {
  if (ctx.categories.length === 0) return [];
  return [ctx.categories
    .filter((c) => c.tokens > 0)
    .map((c) => `${c.name.toLowerCase()} ${formatTokenShort(c.tokens)}`)
    .join(' · ')];
}

function buildGovernanceLine(result: QueryResult): string | undefined {
  const governance = result.governanceSummary;
  if (governance === undefined) return undefined;

  const govParts: string[] = [];
  const explore = formatCounts(governance.explorationToolCounts);
  const subExplore = formatCounts(governance.subagentExplorationToolCounts);
  const output = formatCounts(governance.explorationOutputChars, 'ch');
  if (explore !== undefined) govParts.push(`main ${explore}`);
  if (subExplore !== undefined) govParts.push(`sub ${subExplore}`);
  if (output !== undefined) govParts.push(`toolOut ${output}`);
  if (governance.scoutDelegationCount > 0) govParts.push(`scout ${governance.scoutDelegationCount}`);
  return govParts.length > 0 ? govParts.join(' · ') : undefined;
}

function getUsageSummaryColor(hitPct: number, quota: UsageQuotaSummary): number {
  void quota;
  if (hitPct < 50) return 0xD83A34;
  if (hitPct < 85) return 0xF0B429;
  return 0x2E7D32;
}

function getUsageSummaryParts(
  result: QueryResult,
  quota: UsageQuotaSummary,
  providedAnomaly?: UsageAnomalyReport | null,
): {
  title: string;
  description: string;
  cache: string;
  anomaly?: string;
  context?: string;
  quota?: string;
  governance?: string;
  color: number;
} | null {
  if (!result.usage) return null;

  const u = result.usage;
  const turns = result.numTurns ?? 1;
  const cost = result.totalCostUsd ?? u.costUsd ?? 0;

  // Use main-session metrics for hit% when subagents are present
  const split = splitMainSubagentUsage(result.modelUsage, result.mainModel);
  const mainRead = split !== null ? split.main.cacheReadTokens : (u.cacheReadInputTokens ?? 0);
  const mainCreate = split !== null ? split.main.cacheCreationTokens : (u.cacheCreationInputTokens ?? 0);
  const mainFresh = split !== null ? split.main.freshInputTokens : u.inputTokens;
  const mainThroughput = mainFresh + mainRead + mainCreate;
  const hitPct = mainThroughput > 0 ? Math.round((mainRead / mainThroughput) * 100) : 0;

  const description = [
    `${formatTurnLabel(turns)} · fresh ${formatTokenShort(u.inputTokens)} · output ${formatTokenShort(u.outputTokens)}`,
    ...formatModelUsageLines(result, cost),
  ].join('\n');

  const cacheLines = [
    `${hitPct}% hit${split !== null ? ' (main)' : ''}`,
    formatProgressBar(hitPct),
    `fresh ${formatTokenShort(mainFresh)} · write ${formatTokenShort(mainCreate)} · read ${formatTokenShort(mainRead)}`,
    ...formatCacheModelBreakdown(result),
  ];
  if (split !== null && split.subagent.cacheCreationTokens > 0) {
    cacheLines.push(`subagent: write ${formatTokenShort(split.subagent.cacheCreationTokens)} · read ${formatTokenShort(split.subagent.cacheReadTokens)}`);
  }
  const cache = cacheLines.join('\n');

  let context: string | undefined;
  if (result.contextUsage !== undefined) {
    const ctx = result.contextUsage;
    context = [
      `${formatTokenShort(ctx.totalTokens)} / ${formatTokenShort(ctx.maxTokens)} · ${Math.round(ctx.percentage)}%`,
      formatProgressBar(ctx.percentage),
      ...buildContextBreakdownLines(ctx),
    ].join('\n');
  } else if (result.contextTokens !== undefined) {
    context = formatTokenShort(result.contextTokens);
  }

  const quotaParts: string[] = [];
  if (quota.fiveHourPct !== undefined) quotaParts.push(`5h ${quota.fiveHourPct.toFixed(0)}% ${formatProgressBar(quota.fiveHourPct, 6)}`);
  if (quota.sevenDayPct !== undefined) quotaParts.push(`7d ${quota.sevenDayPct.toFixed(0)}% ${formatProgressBar(quota.sevenDayPct, 6)}`);
  const governance = buildGovernanceLine(result);
  const anomalyReport = providedAnomaly ?? diagnoseQueryUsage(result);
  const anomaly = anomalyReport !== null ? formatUsageAnomalySummary(anomalyReport).slice(0, 1000) : undefined;

  return {
    title: `📊 Usage · $${cost.toFixed(4)}`,
    description,
    cache,
    ...(anomaly !== undefined ? { anomaly } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(quotaParts.length > 0 ? { quota: quotaParts.join('\n') } : {}),
    ...(governance !== undefined ? { governance } : {}),
    color: anomalyReport?.shouldAlert === true
      ? 0xD83A34
      : getUsageSummaryColor(hitPct, quota),
  };
}

function buildUsageSummaryCardText(
  result: QueryResult,
  quota: UsageQuotaSummary,
  anomaly?: UsageAnomalyReport | null,
): string | null {
  const parts = getUsageSummaryParts(result, quota, anomaly);
  if (parts === null) return null;

  const lines = [
    parts.title,
    parts.description,
    '',
    '🧊 Cache',
    parts.cache,
  ];

  if (parts.anomaly !== undefined) lines.push('', '⚠ Anomaly', parts.anomaly);
  if (parts.context !== undefined) lines.push('', '🧱 Context', parts.context);
  if (parts.quota !== undefined) lines.push('', '⏳ Quota', parts.quota);
  if (parts.governance !== undefined) lines.push('', '🛡 Governance', parts.governance);

  return lines.join('\n');
}

export function buildUsageSummaryEmbed(
  result: QueryResult,
  quota: UsageQuotaSummary = {},
  anomaly?: UsageAnomalyReport | null,
): EmbedBuilder | null {
  const parts = getUsageSummaryParts(result, quota, anomaly);
  if (parts === null) return null;

  const embed = new EmbedBuilder()
    .setTitle(parts.title)
    .setDescription(parts.description)
    .setColor(parts.color);

  embed.addFields({ name: '🧊 Cache', value: parts.cache, inline: true });
  if (parts.context !== undefined) embed.addFields({ name: '🧱 Context', value: parts.context, inline: true });
  if (parts.quota !== undefined) embed.addFields({ name: '⏳ Quota', value: parts.quota, inline: true });
  if (parts.anomaly !== undefined) embed.addFields({ name: '⚠ Anomaly', value: parts.anomaly, inline: false });
  if (parts.governance !== undefined) embed.addFields({ name: '🛡 Governance', value: parts.governance, inline: false });

  return embed;
}

export function buildUsageSummaryText(
  result: QueryResult,
  quota: UsageQuotaSummary = {},
  anomaly?: UsageAnomalyReport | null,
): string | null {
  return buildUsageSummaryCardText(result, quota, anomaly);
}

interface UsageEmbedSender {
  sendEmbed(chatId: string, embeds: EmbedBuilder[]): Promise<{ success: boolean; error?: string }>;
}

function getUsageEmbedSender(adapter: BaseAdapter): UsageEmbedSender | null {
  const candidate = adapter as BaseAdapter & { sendEmbed?: unknown };
  return typeof candidate.sendEmbed === 'function'
    ? { sendEmbed: candidate.sendEmbed.bind(adapter) as UsageEmbedSender['sendEmbed'] }
    : null;
}

async function deliverUsageSummary(
  result: QueryResult,
  adapter: BaseAdapter,
  chatId: string,
  anomaly?: UsageAnomalyReport | null,
): Promise<void> {
  let quota: UsageQuotaSummary = {};

  try {
    const { getOAuthUsage } = await import('../services/OAuthUsageService.js');
    const oauthUsage = await getOAuthUsage();
    if (oauthUsage) {
      quota = {
        ...(oauthUsage.five_hour ? { fiveHourPct: oauthUsage.five_hour.utilization } : {}),
        ...(oauthUsage.seven_day ? { sevenDayPct: oauthUsage.seven_day.utilization } : {}),
      };
    }
  } catch { /* ignore — OAuth usage is optional */ }

  const embed = buildUsageSummaryEmbed(result, quota, anomaly);
  const embedSender = getUsageEmbedSender(adapter);
  if (embed !== null && embedSender !== null) {
    const sendResult = await embedSender.sendEmbed(chatId, [embed]);
    if (sendResult.success) return;
  }

  const text = buildUsageSummaryText(result, quota, anomaly);
  if (text === null) return;
  await adapter.sendFormattedMessage(chatId, text);
}
