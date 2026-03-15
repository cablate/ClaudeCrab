import type { UnifiedMessage } from '../adapters/types.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import type { SendOptions, SendResult } from '../adapters/types.js';
import type { IConversationRepository, IQueryMetricsRepository } from '../persistence/types.js';
import { SessionManager } from './SessionManager.js';
import { SDKQueryManager, type QueryResult } from './SDKQueryManager.js';
import { SDKSessionManager } from './SDKSessionManager.js';
import { InteractionHandler } from './InteractionHandler.js';
import { EventBus } from './EventBus.js';
import { buildPromptContext, MEMORY_STOP_CHECKPOINT } from './constants.js';
import { logger } from '../utils/logger.js';
import { ProcessingError } from '../types/errors.js';
import { sendWithMarkdownFallback } from '../utils/telegramMarkdown.js';
import {
  isNoiseResponse,
  sendFinalResponse,
  sendErrorToUser,
} from './ResponseSender.js';
import { buildMcpSetup } from './McpToolSetup.js';
import { formatBotLabel } from '../utils/format.js';
import {
  retryAsync,
  API_RETRY_OPTIONS,
  isRateLimitError,
  isTransientError,
} from '../utils/retry.js';
import { ContextInjector } from './ContextInjector.js';
import {
  StatusMessageManager,
  isStatusCapable,
  type ToolEventEntry,
} from './StatusMessageManager.js';
import type { ActivityService } from './ActivityService.js';
import type { AgentCallService } from '../services/AgentCallService.js';
import type { BudgetService } from '../services/BudgetService.js';
import type { ExecutionRecordRepository } from '../persistence/ExecutionRecordRepository.js';
import type { TaskService } from '../services/TaskService.js';
import type { ActivityEventService } from '../services/ActivityEventService.js';

import type { TTSService } from '../services/TTSService.js';
import { buildGroupUserId, isGroupUserId, extractChatIdFromGroupUserId } from '../utils/groupSession.js';
import { playSound } from '../utils/localSound.js';

/** Debounce delay for status message updates */
const STATUS_DEBOUNCE_MS = 2000;
/** Maximum tool events shown in status messages */
const MAX_EVENTS_DISPLAY = 8;

/**
 * Options for MessageProcessor
 */
export interface MessageProcessorOptions {
  /** Session manager instance */
  sessionManager: SessionManager;

  /** Adapter registry to get adapters for sending responses */
  getAdapter: (platform: string, agentId: string) => BaseAdapter | undefined;

  /** Whether to send typing indicators */
  sendTypingIndicators?: boolean;

  /** Interval for typing indicators in ms */
  typingIndicatorIntervalMs?: number;

  /** Conversation repository for persisting SDK messages to database */
  conversationRepository?: IConversationRepository;

  /**
   * Read the current system prompt from disk for the given agent.
   * When provided, this is called on every query to get the latest systemPrompt,
   * allowing agents that self-update their CLAUDE.md to see changes reflected immediately.
   * Falls back to the cached agent.systemPrompt if not provided.
   */
  getSystemPrompt?: (agentId: string) => Promise<string>;

  /**
   * Get bot info for labeling assistant messages in group chats.
   */
  getBotInfo?: (agentId: string) => { username: string; id: number } | null;

  /**
   * Event bus for broadcasting events (e.g., bot:replied for group chats).
   */
  eventBus?: EventBus;

  /**
   * Context injector for multi-bot group chat history injection (ADR-019).
   */
  contextInjector?: ContextInjector;

  /**
   * Query metrics repository for token usage tracking (ADR-020 Phase 2).
   */
  queryMetricsRepository?: IQueryMetricsRepository;

  /**
   * Activity service for personality-driven lifecycle reactions (v2.0).
   */
  activityService?: ActivityService;

  /**
   * Notification service for cross-agent communication.
   * When provided, agents can send notifications to each other via Custom Tools.
   */
  agentCallService?: AgentCallService;

  /**
   * TTS service for text-to-speech.
   * When provided, agents can generate and play voice messages via Custom Tools.
   */
  ttsService?: TTSService;

  /**
   * Budget service for per-agent cost control.
   * When provided, queries are blocked if agent exceeds budget.
   */
  budgetService?: BudgetService;

  /**
   * Execution record repository for audit trail.
   * When provided, every SDK query is logged with trigger info, cost, status.
   */
  executionRecordRepository?: ExecutionRecordRepository;

  /**
   * Task service for structured task management.
   * When provided, agents can create/manage tasks via MCP tool.
   */
  taskService?: TaskService;

  /**
   * Activity event service for operational event dual-write.
   * When provided, events are sent to Discord #system-log/#alerts.
   */
  activityEventService?: ActivityEventService;
}

/**
 * Result of processing a message
 */
export interface ProcessingResult {
  /** Whether processing was successful */
  success: boolean;

  /** Response text sent to user */
  response?: string;

  /** Error message if failed */
  error?: string;

  /** Whether the message was skipped (duplicate) */
  skipped?: boolean;

  /** Session ID used for processing */
  sessionId?: string;
}

// Noise filtering, inline media extraction, response delivery, and error
// formatting are delegated to ResponseSender.

/**
 * Processes incoming messages and sends responses via adapters.
 * Uses Claude Agent SDK with automatic setting loading
 * and SDK-managed conversation history (via resume option).
 */
export class MessageProcessor {
  private readonly sessionManager: SessionManager;
  private readonly getAdapter: (
    platform: string,
    agentId: string
  ) => BaseAdapter | undefined;
  private readonly sendTypingIndicators: boolean;
  private readonly typingIndicatorIntervalMs: number;
  private readonly sdkQueryManager: SDKQueryManager;
  private readonly sdkSessionManager: SDKSessionManager;
  private readonly conversationRepository: IConversationRepository | undefined;
  private readonly getSystemPrompt:
    | ((agentId: string) => Promise<string>)
    | undefined;
  private readonly getBotInfo:
    | ((agentId: string) => { username: string; id: number } | null)
    | undefined;
  private readonly eventBus: EventBus | undefined;
  private readonly contextInjector: ContextInjector | undefined;
  private readonly queryMetricsRepository: IQueryMetricsRepository | undefined;
  private readonly activityService: ActivityService | undefined;
  private readonly agentCallService: AgentCallService | undefined;
  private readonly ttsService: TTSService | undefined;
  private readonly budgetService: BudgetService | undefined;
  private readonly executionRecordRepository: ExecutionRecordRepository | undefined;
  private readonly taskService: TaskService | undefined;
  private readonly activityEventService: ActivityEventService | undefined;

  constructor(options: MessageProcessorOptions) {
    this.sessionManager = options.sessionManager;
    this.getAdapter = options.getAdapter;
    this.sendTypingIndicators = options.sendTypingIndicators ?? true;
    this.typingIndicatorIntervalMs = options.typingIndicatorIntervalMs ?? 5000;
    this.sdkQueryManager = new SDKQueryManager();
    this.sdkSessionManager = new SDKSessionManager();
    this.conversationRepository = options.conversationRepository;
    this.getSystemPrompt = options.getSystemPrompt;
    this.getBotInfo = options.getBotInfo;
    this.eventBus = options.eventBus;
    this.contextInjector = options.contextInjector;
    this.queryMetricsRepository = options.queryMetricsRepository;
    this.activityService = options.activityService;
    this.agentCallService = options.agentCallService;
    this.ttsService = options.ttsService;
    this.budgetService = options.budgetService;
    this.executionRecordRepository = options.executionRecordRepository;
    this.taskService = options.taskService;
    this.activityEventService = options.activityEventService;

    logger.info('MessageProcessor initialized');
  }

  /**
   * Process an incoming message
   *
   * ADR-019: Simplified - no observeMode/silent mode.
   * Only the @mentioned bot processes the message via GroupBroadcaster.
   */
  async processMessage(
    message: UnifiedMessage,
    agentId: string,
    options?: {
      /** Whether this is a group chat (enables context injection) */
      isGroupChat?: boolean;
      /** Message ID to reply to (for group chats) */
      replyToMessageId?: string;
      /** Delegation depth for auto-delegation (ADR-021) */
      delegationDepth?: number;
      /** Delegation chain for cycle detection (ADR-021) */
      delegationChain?: string[];
      /** ADR-023: Whether this is an initiative-triggered message */
      isInitiative?: boolean;
    isSynthesis?: boolean;
    isSocial?: boolean;
    }
  ): Promise<ProcessingResult> {
    const { platform, userId, chatId, text, id: messageId } = message;
    const isGroupChat = message.metadata?.isGroupChat === true;

    // For group chats, use chatId-based session key to share history among all members
    // For Discord threads, use chatId (threadId) to isolate session per thread
    // For private chats, use userId-based session key
    const isDiscordThread = platform === 'discord' && message.metadata?.isThread === true;
    const effectiveUserId = isGroupChat
      ? buildGroupUserId(chatId)
      : isDiscordThread
        ? `${userId}::thread::${chatId}`
        : userId;

    logger.debug(
      { platform, userId, agentId, messageId, isGroupChat, effectiveUserId },
      'Processing message'
    );

    // Check for duplicate message (idempotency)
    if (
      this.sessionManager.isMessageProcessed(
        platform,
        agentId,
        effectiveUserId,
        messageId
      )
    ) {
      logger.debug({ messageId }, 'Skipping duplicate message');
      return { success: true, skipped: true };
    }

    // Activity event: chat received
    void this.activityEventService?.log({
      type: 'chat.received',
      agentId,
      message: `收到${platform === 'discord' ? ' Discord' : ''} 訊息「${text.slice(0, 50)}${text.length > 50 ? '...' : ''}」`,
    });

    // Budget pre-check: block query if agent exceeded budget
    if (this.budgetService !== undefined && !this.budgetService.canQuery(agentId)) {
      logger.warn({ agentId }, 'Agent paused due to budget — rejecting message');
      const adapter = this.getAdapter(platform, agentId);
      if (adapter !== undefined) {
        await adapter.sendMessage(chatId, '⚠️ 預算已超限，此 Agent 已暫停。請調整預算後再試。');
      }
      return { success: false, error: 'Agent paused: budget exceeded' };
    }

    // v2.0: Workflow log (factual, sync)
    const taskPreview = text.length > 40 ? text.substring(0, 40) + '...' : text;
    this.activityService?.emitWorkflow(agentId, 'task_received', `收到訊息「${taskPreview}」`, { taskContent: text });

    // v2.0: Emit task_received reaction (fire-and-forget, Haiku personality)
    // Skip Haiku for delegated messages — workflow event is sufficient
    if ((options?.delegationDepth ?? 0) === 0) {
      this.activityService?.emitReaction(agentId, 'task_received', {
        taskContent: text,
      });
    }

    // Get or create session
    let session;
    try {
      session = await this.sessionManager.getOrCreateSession({
        platform,
        userId: effectiveUserId,
        agentId,
      });
    } catch (error) {
      logger.error(
        { error, platform, userId, agentId },
        'Failed to get/create session'
      );
      return {
        success: false,
        error: `Failed to create session: ${(error as Error).message}`,
      };
    }

    // ADR-019: No silent mode - all messages are fully processed

    // Get adapter for sending response
    const adapter = this.getAdapter(platform, agentId);
    if (adapter === undefined) {
      logger.error(
        { platform, agentId },
        'No adapter found for platform and agent'
      );
      return {
        success: false,
        error: `No adapter for platform: ${platform}, agent: ${agentId}`,
      };
    }

    // Process with lock to prevent concurrent processing
    try {
      const result = await this.sessionManager.withLock(
        platform,
        agentId,
        effectiveUserId,
        async () => {
          // Mark message as processed (before processing to prevent duplicates)
          this.sessionManager.markMessageProcessed(
            platform,
            agentId,
            effectiveUserId,
            messageId
          );

          // Update session state
          this.sessionManager.updateState(
            platform,
            agentId,
            effectiveUserId,
            'processing'
          );

          try {
            // Process the message using SDK
            const queryOptions: {
              isGroupChat?: boolean;
              replyToMessageId?: string;
              delegationDepth?: number;
              delegationChain?: string[];
              isInitiative?: boolean;
              isSynthesis?: boolean;
              isSocial?: boolean;
              agentCallFrom?: string;
            } = {};
            // Agent call tag: pass the calling agent's ID so responses get tagged
            if (message.metadata?.isAgentCall === true && typeof message.metadata.fromAgent === 'string') {
              queryOptions.agentCallFrom = message.metadata.fromAgent;
            }
            if (options?.isGroupChat === true) {
              queryOptions.isGroupChat = true;
            }
            // Forward event flags for emitBotRepliedEvent propagation
            if (options?.delegationDepth !== undefined) {
              queryOptions.delegationDepth = options.delegationDepth;
            }
            if (options?.delegationChain !== undefined) {
              queryOptions.delegationChain = options.delegationChain;
            }
            if (options?.isInitiative === true) {
              queryOptions.isInitiative = true;
            }
            if (options?.isSynthesis === true) {
              queryOptions.isSynthesis = true;
            }
            if (options?.isSocial === true) {
              queryOptions.isSocial = true;
            }

            // Use replyToMessageId from options if provided, otherwise from metadata.
            // NOTE: For group chats, do NOT use metadata.originalMessageId as replyToMessageId
            // because in regular Telegram groups, each bot sees different message_ids
            // for the same physical message. The metadata ID may belong to a different bot.
            if (options?.replyToMessageId) {
              queryOptions.replyToMessageId = options.replyToMessageId;
            } else if (!isGroupChat && message.metadata?.originalMessageId) {
              queryOptions.replyToMessageId =
                message.metadata.originalMessageId;
            }

            const response = await this.executeQueryWithSDK(
              session.sessionId,
              text,
              adapter,
              chatId,
              platform,
              agentId,
              effectiveUserId,
              queryOptions
            );

            // Update session state back to idle
            this.sessionManager.updateState(
              platform,
              agentId,
              effectiveUserId,
              'idle'
            );

            // Play completion sound (non-blocking)
            playSound('C:\\Windows\\Media\\Ring01.wav').catch(() => {});

            return {
              success: true,
              response,
              sessionId: session.sessionId,
            };
          } catch (error) {
            // Update session state to error
            this.sessionManager.updateState(
              platform,
              agentId,
              effectiveUserId,
              'error'
            );
            throw error;
          }
        }
      );

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const errorDetails = {
        message: err.message,
        name: err.name,
        stack: err.stack,
        // Handle API errors which may have additional properties
        ...(typeof error === 'object' && error !== null && 'status' in error
          ? { status: (error as { status: number }).status }
          : {}),
        ...(typeof error === 'object' && error !== null && 'error' in error
          ? { apiError: (error as { error: unknown }).error }
          : {}),
      };

      logger.error(
        { err: errorDetails, platform, userId, agentId },
        'Failed to process message'
      );

      // v2.0: Workflow log (factual, sync)
      const errorPreview = err.message.length > 60 ? err.message.substring(0, 60) + '...' : err.message;
      this.activityService?.emitWorkflow(agentId, 'error', `發生錯誤: ${errorPreview}`, { error: err.message });

      // v2.0: Emit error reaction (fire-and-forget, Haiku personality)
      this.activityService?.emitReaction(agentId, 'error', {
        error: err.message,
      });

      // Send error message to user
      await sendErrorToUser(adapter, chatId, err);

      return {
        success: false,
        error: err.message,
        sessionId: session.sessionId,
      };
    }
  }

  /**
   * Execute query using Claude Agent SDK
   *
   * ADR-019: No observeOnly mode - always send reply.
   */
  private async executeQueryWithSDK(
    sessionId: string,
    prompt: string,
    adapter: BaseAdapter,
    chatId: string,
    platform: string,
    agentId: string,
    userId: string,
    options?: {
      isGroupChat?: boolean;
      replyToMessageId?: string;
      /** Event flags forwarded from processMessage for emitBotRepliedEvent */
      delegationDepth?: number;
      delegationChain?: string[];
      isInitiative?: boolean;
      isSynthesis?: boolean;
      isSocial?: boolean;
      /** If set, this response is from an agent call — tag the first message with the caller's ID */
      agentCallFrom?: string;
    }
  ): Promise<string> {
    // Get internal session for agent info
    const internalSession = this.sessionManager.getInternalSession(
      platform,
      agentId,
      userId
    );

    if (internalSession === undefined || internalSession.agent === undefined) {
      throw new ProcessingError(
        'PROCESSING_FAILED',
        'Session or agent not found'
      );
    }

    const agent = internalSession.agent;
    const isNewSession = internalSession.sdkSessionId === undefined;

    // ADR-020: Determine group chat ID for group memory paths
    const groupChatIdForContext = options?.isGroupChat
      ? (isGroupUserId(userId) ? extractChatIdFromGroupUserId(userId) : chatId)
      : undefined;

    // Read fresh system prompt from disk (agent may have updated CLAUDE.md at runtime)
    const systemPrompt =
      this.getSystemPrompt !== undefined
        ? await this.getSystemPrompt(agent.id)
        : agent.systemPrompt;

    // Start typing indicator
    let typingInterval: ReturnType<typeof setInterval> | null = null;
    if (this.sendTypingIndicators) {
      await adapter.sendTypingIndicator(chatId);
      typingInterval = setInterval(() => {
        void adapter.sendTypingIndicator(chatId);
      }, this.typingIndicatorIntervalMs);
    }

    // Set up StatusMessageManager for real-time tool event feedback
    // ADR-030: In group chats, use typing indicators only (no text status messages)
    const statusManager = isStatusCapable(adapter) && !options?.isGroupChat
      ? new StatusMessageManager(adapter, chatId, {
          debounceMs: STATUS_DEBOUNCE_MS,
          maxEventsDisplay: MAX_EVENTS_DISPLAY,
        })
      : null;

    // Set up interaction handler for permission prompts and question prompts
    const interactionHandler = new InteractionHandler(adapter, chatId, 120_000, agentId);
    const canUseTool = interactionHandler.buildCanUseTool();

    try {
      // Track intermediate messages sent via streaming callback
      const intermediateMessages: string[] = [];
      // Track the last sent message ID (for bot:replied event in group chats)
      let lastSentMessageId: string | undefined;
      // v2.0: Only emit one tool_use reaction per query to avoid noise
      let toolUseReacted = false;
      // Agent call: track whether the response prefix has been applied
      let agentCallPrefixApplied = false;

      // Context injection for multi-bot group chats (ADR-019)
      // Get messages since last query to inject as context
      let injectionContext: { formattedHistory: string; messageCount: number; lastMessageId: string | null } | null = null;
      if (options?.isGroupChat && this.contextInjector) {
        // Extract chatId from group userId format
        const groupChatId = isGroupUserId(userId) ? extractChatIdFromGroupUserId(userId) : chatId;
        injectionContext = this.contextInjector.getInjectionContext(
          agentId,
          groupChatId,
          platform
        );
        if (injectionContext.messageCount > 0) {
          logger.info(
            { agentId, chatId: groupChatId, messageCount: injectionContext.messageCount },
            'Injecting group chat context'
          );
          logger.debug(
            { agentId, formattedHistory: injectionContext.formattedHistory },
            'Injection context content'
          );
        }
      }

      // Build final prompt with injected context
      const finalPrompt = injectionContext?.formattedHistory
        ? `${injectionContext.formattedHistory}\n${prompt}`
        : prompt;

      logger.debug(
        { agentId, originalPrompt: prompt.substring(0, 100), hasInjection: !!injectionContext?.formattedHistory },
        'Final prompt built'
      );

      // Build MCP servers and allowed tools from available services
      // Pass thread metadata for agent-call cross-channel routing (Discord only)
      const mcpCtx: import('./McpToolSetup.js').McpSetupContext = {
        agentId, chatId, userId, platform,
      };
      // If this is a Discord thread, chatId IS the threadId
      if (platform === 'discord' && options?.isGroupChat !== true) {
        // chatId differs from the agent's configured channel → it's a thread
        const agentConfig = this.sessionManager.getInternalSession(platform, agentId, userId)?.agent;
        if (agentConfig !== undefined && agentConfig.config.discordChannelId !== undefined && chatId !== agentConfig.config.discordChannelId) {
          mcpCtx.threadId = chatId;
          mcpCtx.parentChannelId = agentConfig.config.discordChannelId;
        }
      }
      const { mcpServers, allowedTools } = buildMcpSetup(
        this.agentCallService,
        this.ttsService,
        adapter,
        mcpCtx,
        this.taskService,
      );

      // Helper: execute SDK query with retry for rate limit / transient errors
      // V2 persistent session: if resuming, try SDKSessionManager first (keeps cli.js process alive
      // → prompt cache persists → ~95% cache efficiency vs V1's ~25%).
      // Falls back to V1 SDKQueryManager if V2 fails.
      const executeWithRetry = async (resumeId: string | undefined) => {
        return await retryAsync(
          async () => {
            // V2 persistent session: keeps cli.js process alive → cache persists → ~84%+ efficiency.
            // MCP servers routed via h9 sdkMcpMap (in-process), not CLI --mcp-config args.
            // See: _special-research/sdk-reverse-engineering-v76.md §十一
            if (resumeId && this.sdkSessionManager) {
              try {
                return await this.sdkSessionManager.executeQuery(
                  sessionId,
                  finalPrompt,
                  agent,
                  {
                    cwd: agent.path,
                    systemPrompt,
                    ...(agent.config.settings?.maxTurns !== undefined
                      ? { maxTurns: agent.config.settings.maxTurns }
                      : {}),
                    ...(Object.keys(mcpServers).length > 0
                      ? { mcpServers, allowedTools }
                      : {}),
                    resume: resumeId,
                    onIntermediateMessage: async (text: string): Promise<void> => {
                      if (isNoiseResponse(text)) return;
                      await statusManager?.finalizeCurrentBatch();
                      await adapter.sendTypingIndicator(chatId);
                      const sendOpts: SendOptions = {};
                      if (options?.isGroupChat && options?.replyToMessageId) {
                        sendOpts.replyToMessageId = options.replyToMessageId;
                      }
                      let textToSend = text;
                      if (options?.agentCallFrom && !agentCallPrefixApplied) {
                        textToSend = `🔗 _回覆 ${options.agentCallFrom} 的協作請求_\n\n${text}`;
                        agentCallPrefixApplied = true;
                      }
                      const sendResult = await sendWithMarkdownFallback(adapter, chatId, textToSend, sendOpts);
                      if (sendResult.success && sendResult.messageId) {
                        lastSentMessageId = sendResult.messageId;
                      }
                      intermediateMessages.push(text);
                      this.activityService?.emitReply(agentId, text);
                      statusManager?.markNeedNewMessage();
                    },
                    onToolEvent: async (event) => {
                      if (event.type === 'tool_use' && !toolUseReacted) {
                        toolUseReacted = true;
                        this.activityService?.emitStatusChange(agentId, 'tool_use', 'focused');
                      }
                      if (statusManager === null) return;
                      let statusLine: string;
                      let detail: string | undefined;
                      if (event.type === 'tool_use') {
                        statusLine = `🔧 ${event.toolName}`;
                        if (event.summary) detail = event.summary.substring(0, 80);
                      } else if (event.type === 'tool_result') {
                        statusLine = `✓ ${event.toolName} 完成`;
                        if (event.summary) detail = event.summary.replace(/\n/g, ' ').substring(0, 60);
                      } else if (event.type === 'tool_progress') {
                        statusLine = `⏳ ${event.toolName}`;
                        if (event.elapsedSeconds !== undefined) statusLine += ` (${Math.round(event.elapsedSeconds)}s)`;
                      } else {
                        statusLine = `• ${event.toolName}`;
                      }
                      const toolEvent: ToolEventEntry = { toolName: event.toolName, status: statusLine };
                      if (detail !== undefined) toolEvent.detail = detail;
                      await statusManager.addToolEvent(toolEvent);
                    },
                    additionalOptions: { canUseTool },
                  }
                );
              } catch (v2Error) {
                // V2 failed — destroy session and fall through to V1
                logger.warn(
                  { sessionId, error: (v2Error as Error).message },
                  'V2 persistent session failed, falling back to V1 query()'
                );
                this.sdkSessionManager.destroySession(sessionId);
              }
            }

            // V1 fallback (or new session without resume)
            return await this.sdkQueryManager.executeQuery(
              sessionId,
              finalPrompt,
              agent,
              {
                cwd: agent.path,
                systemPrompt,
                // Only set maxTurns if explicitly configured in agent settings
                // Otherwise let SDK use its default (unlimited turns)
                ...(agent.config.settings?.maxTurns !== undefined
                  ? { maxTurns: agent.config.settings.maxTurns }
                  : {}),
                // Custom MCP tools (agent-call, tts, etc.)
                ...(Object.keys(mcpServers).length > 0
                  ? { mcpServers, allowedTools }
                  : {}),
                resume: resumeId,
                onIntermediateMessage: async (text: string): Promise<void> => {
                  // Filter noise responses (SDK placeholders, stop-hook outputs)
                  if (isNoiseResponse(text)) {
                    logger.debug({ chatId, agentId, text: text.substring(0, 80) }, 'Suppressed noise intermediate message');
                    return;
                  }

                  // Finalize current status message before sending assistant message
                  await statusManager?.finalizeCurrentBatch();

                  await adapter.sendTypingIndicator(chatId);

                  // Build send options (include replyToMessageId for group chats)
                  const sendOpts: SendOptions = {};
                  if (options?.isGroupChat && options?.replyToMessageId) {
                    sendOpts.replyToMessageId = options.replyToMessageId;
                  }

                  // Try MarkdownV2 first, fallback to Markdown on failure
                  if (isNoiseResponse(text)) {
                    intermediateMessages.push(text);
                    return;
                  }

                  // Prepend agent call tag to the first visible message
                  let textToSend = text;
                  if (options?.agentCallFrom && !agentCallPrefixApplied) {
                    textToSend = `🔗 _回覆 ${options.agentCallFrom} 的協作請求_\n\n${text}`;
                    agentCallPrefixApplied = true;
                  }

                  const sendResult = await sendWithMarkdownFallback(
                    adapter, chatId, textToSend, sendOpts
                  );

                  if (!sendResult.success) {
                    logger.warn(
                      { error: sendResult.error, chatId },
                      'Failed to send intermediate message'
                    );
                  } else if (sendResult.messageId) {
                    // Track the last sent message ID for bot:replied event
                    lastSentMessageId = sendResult.messageId;
                  }
                  intermediateMessages.push(text);

                  // Stream reply to Web UI in real-time (not just at the end)
                  this.activityService?.emitReply(agentId, text);

                  // Mark that next tool event should create new status message
                  statusManager?.markNeedNewMessage();
                },
                onToolEvent: async (event) => {
                  // v2.0: Status change only for tool_use (no Haiku, just update phase)
                  if (event.type === 'tool_use' && !toolUseReacted) {
                    toolUseReacted = true;
                    this.activityService?.emitStatusChange(agentId, 'tool_use', 'focused');
                  }

                  if (statusManager === null) return;

                  // Build tool event entry for status display
                  let statusLine: string;
                  let detail: string | undefined;

                  if (event.type === 'tool_use') {
                    statusLine = `🔧 ${event.toolName}`;
                    if (event.summary) {
                      detail = event.summary.substring(0, 80);
                    }
                  } else if (event.type === 'tool_result') {
                    statusLine = `✓ ${event.toolName} 完成`;
                    if (event.summary) {
                      const cleanSummary = event.summary
                        .replace(/\n/g, ' ')
                        .substring(0, 60);
                      detail = cleanSummary;
                    }
                  } else if (event.type === 'tool_progress') {
                    statusLine = `⏳ ${event.toolName}`;
                    if (event.elapsedSeconds !== undefined) {
                      statusLine += ` (${Math.round(event.elapsedSeconds)}s)`;
                    }
                  } else {
                    statusLine = `• ${event.toolName}`;
                  }

                  const toolEvent: ToolEventEntry = {
                    toolName: event.toolName,
                    status: statusLine,
                  };
                  if (detail !== undefined) {
                    toolEvent.detail = detail;
                  }
                  await statusManager.addToolEvent(toolEvent);
                },
                additionalOptions: {
                  canUseTool,
                  // [DISABLED]                   hooks: {
                  // [DISABLED]                     UserPromptSubmit: [
                  // [DISABLED]                       {
                  // [DISABLED]                         hooks: [
                  // [DISABLED]                           async () => ({
                  // [DISABLED]                             continue: true,
                  // [DISABLED]                             hookSpecificOutput: {
                  // [DISABLED]                               hookEventName: 'UserPromptSubmit' as const,
                  // [DISABLED]                               additionalContext: buildPromptContext(
                  // [DISABLED]                                 chatId,
                  // [DISABLED]                                 isNewSession,
                  // [DISABLED]                                 groupChatIdForContext
                  // [DISABLED]                               ),
                  // [DISABLED]                             },
                  // [DISABLED]                           }),
                  // [DISABLED]                         ],
                  // [DISABLED]                       },
                  // [DISABLED]                     ],
                  // [DISABLED]                     // Memory stop checkpoint — only for interactive sessions
                  // [DISABLED]                     // Schedules don't have this hook, so they stop cleanly
                  // [DISABLED]                     Stop: [
                  // [DISABLED]                       {
                  // [DISABLED]                         hooks: [
                  // [DISABLED]                           async (input) => {
                  // [DISABLED]                             if ('stop_hook_active' in input && input.stop_hook_active) {
                  // [DISABLED]                               return {};
                  // [DISABLED]                             }
                  // [DISABLED]                             return {
                  // [DISABLED]                               decision: 'block' as const,
                  // [DISABLED]                               reason: MEMORY_STOP_CHECKPOINT,
                  // [DISABLED]                             };
                  // [DISABLED]                           },
                  // [DISABLED]                         ],
                  // [DISABLED]                       },
                  // [DISABLED]                     ],
                  // [DISABLED]                   },
                },
              }
            );
          },
          {
            ...API_RETRY_OPTIONS,
            isRetryable: (err) =>
              isRateLimitError(err) || isTransientError(err),
            onRetry: (attempt, err, delayMs) => {
              intermediateMessages.length = 0;
              logger.warn(
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

      // Execute query — if resume fails due to session issues, retry without resume (new conversation)
      // Note: Only retry without resume for actual session/resume errors, not for other SDK errors
      let result;
      try {
        result = await executeWithRetry(internalSession.sdkSessionId);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Check if this is a resume-specific error (session not found, expired, corrupted, etc.)
        // vs other SDK errors (max_turns, max_budget, etc.) that should not trigger new session
        const isResumeError =
          errorMsg.includes('session') ||
          errorMsg.includes('resume') ||
          errorMsg.includes('not found') ||
          errorMsg.includes('expired') ||
          errorMsg.includes('tool_use ids must be unique');

        if (internalSession.sdkSessionId !== undefined && isResumeError) {
          logger.warn(
            {
              sessionId,
              sdkSessionId: internalSession.sdkSessionId,
              error: errorMsg,
            },
            'SDK resume failed, retrying without resume (new conversation)'
          );
          this.sessionManager.setSdkSessionId(
            platform,
            agentId,
            userId,
            undefined
          );
          result = await executeWithRetry(undefined);
        } else {
          // For non-resume errors (max_turns, etc.), don't clear session, just throw
          throw error;
        }
      }

      // --- Post-query handling ---
      this.saveSDKSessionId(result, internalSession, platform, agentId, userId, sessionId);
      this.recordQueryMetrics(result, agentId, platform, chatId, userId);

      // Execution audit log: record this query
      this.recordExecutionAudit(result, agentId, 'chat', userId, chatId);

      // Budget post-check: may pause agent for next query
      if (this.budgetService !== undefined) {
        const budgetStatus = this.budgetService.postQueryCheck(agentId);
        if (budgetStatus !== null && budgetStatus.exceeded) {
          logger.warn(
            { agentId, reason: budgetStatus.exceededReason, monthCents: budgetStatus.monthCents },
            'Agent budget exceeded after query — will be paused for next query'
          );
          // Push to Discord #alerts
          void this.activityEventService?.log({
            type: 'budget.exceeded',
            agentId,
            message: `預算超限 (${budgetStatus.exceededReason})，Agent 已暫停`,
            details: `月花費: $${(budgetStatus.monthCents / 100).toFixed(2)} / 上限: $${(budgetStatus.monthlyLimitCents / 100).toFixed(2)}`,
            level: 'error',
          });
        } else if (budgetStatus !== null && budgetStatus.warning) {
          void this.activityEventService?.log({
            type: 'budget.warning',
            agentId,
            message: `預算接近上限 (${Math.round(budgetStatus.monthCents / budgetStatus.monthlyLimitCents * 100)}%)`,
            level: 'warn',
          });
        }
      }

      this.updateInjectionCursor(injectionContext, userId, chatId, agentId, platform);
      this.persistConversation(sessionId, prompt, intermediateMessages, result.response, agentId, options);

      // Build full response from intermediate messages + final response
      const allResponses = [...intermediateMessages];
      if (result.response.length > 0) {
        allResponses.push(result.response);
      }
      const fullResponse = allResponses.join('\n\n');

      // Send final response and track message ID
      // Prepend agent call tag if no intermediate messages carried it
      const finalResponseText = (options?.agentCallFrom && !agentCallPrefixApplied && result.response.length > 0)
        ? `🔗 _回覆 ${options.agentCallFrom} 的協作請求_\n\n${result.response}`
        : result.response;
      const finalMessageId = await sendFinalResponse(
        finalResponseText, adapter, chatId, agentId, options
      );
      if (finalMessageId !== undefined) {
        lastSentMessageId = finalMessageId;
      }

      // Activity event: chat responded
      void this.activityEventService?.log({
        type: 'chat.responded',
        agentId,
        message: `回覆完成（${result.usage?.outputTokens ?? 0} tokens, $${((result.totalCostUsd ?? 0)).toFixed(3)}）`,
      });

      // v2.0: Workflow log (factual, sync)
      this.activityService?.emitWorkflow(agentId, 'completed', '回覆完成');

      // v2.0: Emit reply event for Live backlog
      // Only emit final part here — intermediates were already streamed in real-time
      if (result.response.length > 0) {
        this.activityService?.emitReply(agentId, result.response);
      }

      // v2.0: Status change only for completed (no Haiku)
      this.activityService?.emitStatusChange(agentId, 'completed', 'neutral');

      // Broadcast to other bots and finalize
      this.emitBotRepliedEvent(fullResponse, chatId, agentId, platform, lastSentMessageId, options);
      await statusManager?.finalizeAll();

      // Return fullResponse (intermediate + final) instead of just result.response,
      // because streaming sends content via onIntermediateMessage leaving result.response empty.
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

  // --- Post-query private helpers ---

  /**
   * Save SDK session ID for future conversation resume.
   */
  private saveSDKSessionId(
    result: { sdkSessionId?: string; response: string },
    internalSession: { sdkSessionId?: string },
    platform: string,
    agentId: string,
    userId: string,
    sessionId: string
  ): void {
    if (
      result.sdkSessionId &&
      result.sdkSessionId !== internalSession.sdkSessionId
    ) {
      this.sessionManager.setSdkSessionId(
        platform,
        agentId,
        userId,
        result.sdkSessionId
      );
      logger.debug(
        { sessionId, sdkSessionId: result.sdkSessionId },
        'Updated SDK session ID'
      );
    }
  }

  /**
   * Record query metrics for token usage tracking (ADR-020 Phase 2).
   */
  private recordQueryMetrics(
    result: QueryResult,
    agentId: string,
    platform: string,
    chatId: string,
    userId: string
  ): void {
    if (!this.queryMetricsRepository || !result.usage) return;

    try {
      this.queryMetricsRepository.record({
        agentId,
        platform,
        chatId,
        userId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadInputTokens,
        cacheCreationTokens: result.usage.cacheCreationInputTokens,
        totalCostUsd: result.totalCostUsd ?? result.usage.costUsd,
        numTurns: result.numTurns ?? 0,
        durationMs: result.durationMs ?? 0,
      });
    } catch (error) {
      logger.warn(
        { error, agentId },
        'Failed to record query metrics'
      );
    }
  }

  /**
   * Record execution audit entry for every SDK query.
   */
  private recordExecutionAudit(
    result: QueryResult,
    agentId: string,
    triggerType: 'chat' | 'schedule' | 'agent_call',
    triggerSource: string,
    _chatId?: string
  ): void {
    if (this.executionRecordRepository === undefined || result.usage === undefined) return;

    try {
      const costUsd = result.totalCostUsd ?? result.usage.costUsd ?? 0;
      this.executionRecordRepository.insert({
        agentId,
        triggerType,
        triggerSource,
        // promptSummary omitted — optional field
        responseSummary: result.response?.slice(0, 200),
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costCents: Math.round(costUsd * 100),
        durationMs: result.durationMs ?? 0,
        status: 'success',
      });
    } catch (error) {
      logger.warn({ error, agentId }, 'Failed to record execution audit');
    }
  }

  /**
   * Update injection cursor after successful SDK query (ADR-019).
   * Must happen AFTER the query succeeds to avoid losing messages on failure.
   */
  private updateInjectionCursor(
    injectionContext: { lastMessageId: string | null } | null,
    userId: string,
    chatId: string,
    agentId: string,
    platform: string
  ): void {
    if (injectionContext?.lastMessageId && this.contextInjector) {
      const groupChatId = isGroupUserId(userId)
        ? extractChatIdFromGroupUserId(userId)
        : chatId;
      this.contextInjector.updateCursor(
        agentId,
        groupChatId,
        platform,
        injectionContext.lastMessageId
      );
    }
  }

  /**
   * Persist user and assistant messages to database for WebUI visibility.
   */
  private persistConversation(
    sessionId: string,
    prompt: string,
    intermediateMessages: string[],
    resultResponse: string,
    agentId: string,
    options?: { isGroupChat?: boolean }
  ): void {
    if (this.conversationRepository === undefined) return;

    try {
      this.conversationRepository.appendMessage(sessionId, 'user', prompt);

      const botLabel =
        options?.isGroupChat && this.getBotInfo !== undefined
          ? formatBotLabel(this.getBotInfo(agentId), agentId)
          : null;

      for (const msg of intermediateMessages) {
        const labeledMsg = botLabel !== null ? `${botLabel}: ${msg}` : msg;
        this.conversationRepository.appendMessage(
          sessionId,
          'assistant',
          labeledMsg
        );
      }

      if (resultResponse.length > 0) {
        const labeledResponse =
          botLabel !== null
            ? `${botLabel}: ${resultResponse}`
            : resultResponse;
        this.conversationRepository.appendMessage(
          sessionId,
          'assistant',
          labeledResponse
        );
      }
    } catch (persistError) {
      logger.warn(
        { error: persistError, sessionId },
        'Failed to persist conversation messages'
      );
    }
  }





  /**
   * Emit bot:replied event for group chat context injection (ADR-019).
   * Must happen AFTER sendMessage to capture the replyMessageId.
   */
  private emitBotRepliedEvent(
    fullResponse: string,
    chatId: string,
    agentId: string,
    platform: string,
    lastSentMessageId: string | undefined,
    options?: { isGroupChat?: boolean; delegationDepth?: number; delegationChain?: string[]; isInitiative?: boolean; isSynthesis?: boolean; isSocial?: boolean }
  ): void {
    if (
      !options?.isGroupChat ||
      this.eventBus === undefined ||
      fullResponse.length === 0
    ) {
      return;
    }

    const botLabel = formatBotLabel(this.getBotInfo?.(agentId), agentId);

    logger.info(
      {
        chatId,
        agentId,
        botLabel,
        responsePreview: fullResponse.substring(0, 100),
        lastSentMessageId,
      },
      'Emitting bot:replied event'
    );

    this.eventBus.emit('bot:replied', {
      chatId,
      agentId,
      response: `${botLabel}: ${fullResponse}`,
      platform,
      ...(lastSentMessageId !== undefined
        ? { replyMessageId: lastSentMessageId }
        : {}),
      // ADR-021: Pass delegation info for chain tracking
      ...(options?.delegationDepth !== undefined
        ? { delegationDepth: options.delegationDepth }
        : {}),
      ...(options?.delegationChain !== undefined
        ? { delegationChain: options.delegationChain }
        : {}),
      // ADR-023: Pass initiative flag
      ...(options?.isInitiative === true ? { isInitiative: true } : {}),
      // ADR-030: Pass synthesis flag
      ...(options?.isSynthesis === true ? { isSynthesis: true } : {}),
      // ADR-030: Pass social flag
      ...(options?.isSocial === true ? { isSocial: true } : {}),
    });
  }

  /**
   * Get platform, agentId, and userId from sessionId
   */
  private getSessionIdentifiers(sessionId: string): {
    platform: string;
    agentId: string;
    userId: string;
  } {
    // Find session in all sessions
    const allSessions = this.sessionManager.getAllSessions();
    const session = allSessions.find((s) => s.sessionId === sessionId);

    if (session === undefined) {
      throw new ProcessingError('PROCESSING_FAILED', 'Session not found');
    }

    return {
      platform: session.platform,
      agentId: session.agentId,
      userId: session.userId,
    };
  }

  /**
   * Clear conversation for a session.
   * Clears the SDK session ID and persisted conversation records.
   */
  clearConversation(sessionId: string): void {
    const { platform, agentId, userId } = this.getSessionIdentifiers(sessionId);
    this.sessionManager.setSdkSessionId(platform, agentId, userId, undefined);

    if (this.conversationRepository !== undefined) {
      this.conversationRepository.clearConversation(sessionId);
    }

    logger.debug(
      { sessionId },
      'Cleared conversation (SDK session + persisted messages)'
    );
  }

  /**
   * Cancel an active query for the given session.
   * Returns true if a query was cancelled, false if no active query was found.
   */
  cancelQuery(sessionId: string): boolean {
    const hasActive = this.sdkQueryManager.hasActiveQuery(sessionId);
    if (hasActive) {
      this.sdkQueryManager.cancelQuery(sessionId);
      logger.info({ sessionId }, 'Cancelled active query');
      return true;
    }
    return false;
  }

  /**
   * Cancel an active query for a user by platform/agent/user identifiers.
   * Returns true if a query was cancelled, false if no active query was found.
   */
  cancelQueryForUser(
    platform: string,
    agentId: string,
    userId: string
  ): boolean {
    const session = this.sessionManager.getInternalSession(
      platform,
      agentId,
      userId
    );
    if (session === undefined) {
      return false;
    }
    return this.cancelQuery(session.sessionId);
  }

  /**
   * Check if there's an active query for a user.
   */
  hasActiveQueryForUser(
    platform: string,
    agentId: string,
    userId: string
  ): boolean {
    const session = this.sessionManager.getInternalSession(
      platform,
      agentId,
      userId
    );
    if (session === undefined) {
      return false;
    }
    return this.sdkQueryManager.hasActiveQuery(session.sessionId);
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.sdkQueryManager.dispose();
    void this.sdkSessionManager.dispose();
  }
}
