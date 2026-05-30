/**
 * MessageProcessor ??Unified message processing pipeline.
 *
 * Receives UnifiedMessage ??manages session ??executes SDK query ??routes response.
 * Supports V1 (stateless query via SDKQueryManager) and V2 (cached session via SDKSessionManager).
 *
 * Key dependencies:
 * - SessionManager: conversation session lifecycle
 * - SDKQueryManager / SDKSessionManager: Claude SDK query execution
 * - ResponseSender: routes replies to the correct platform adapter
 *
 * Main flow: processMessage() ??getOrCreateSession() ??executeQueryWithSDK() ??sendResponse()
 */

import type { UnifiedMessage } from '../../types/message.js';
import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import type { IConversationRepository, IQueryMetricsRepository } from '../../persistence/types.js';
import type { RateLimitRepository } from '../../persistence/RateLimitRepository.js';
import { SessionManager } from '../session/SessionManager.js';
import { SDKQueryManager } from '../query/SDKQueryManager.js';
import { SDKSessionManager } from '../session/SDKSessionManager.js';
import { logger } from '../../utils/logger.js';
import { logContext, newCorrelationId, type LogContext } from '../../utils/logContext.js';
import { ProcessingError } from '../../types/errors.js';
import type { CacheKeepaliveConfig } from '../../config.js';
import type { ConversationRequest, ConversationResult } from '../../conversation/types.js';
import {
  ConversationPipeline,
  type ProcessingResult,
  type ProcessMessageOptions,
} from '../../conversation/ConversationPipeline.js';

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
   * Query metrics repository for token usage tracking (ADR-020 Phase 2).
   */
  queryMetricsRepository?: IQueryMetricsRepository;

  /**
   * Rate limit repository for persisting rate_limit_event snapshots.
   * When provided, quota utilization is tracked per SDK session.
   */
  rateLimitRepository?: RateLimitRepository;

  /** Cache keepalive runtime configuration loaded once from AppConfig. */
  cacheKeepaliveConfig?: CacheKeepaliveConfig;

  /**
   * When true, the SDK CLI process is destroyed after each query (~150MB RAM freed).
   * Resume data stays on disk so the next query restores context via JSONL.
   * Intended for resource-constrained or Q&A-bot deployments.
   */
  ephemeral?: boolean;

  /**
   * When false, hides in-chat tool status messages.
   * Set IN_CHAT_USAGE_SUMMARY_ENABLED=false in env.
   */

  /**
   * When false, hides the per-turn usage summary card at the end of each query.
   * Set USAGE_CARD_ENABLED=false in env.
   */
  usageCardEnabled?: boolean;

}

export type { ProcessingResult };

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
  private readonly queryMetricsRepository: IQueryMetricsRepository | undefined;
  private readonly usageCardEnabled: boolean;

  constructor(options: MessageProcessorOptions) {
    this.sessionManager = options.sessionManager;
    this.getAdapter = options.getAdapter;
    this.sendTypingIndicators = options.sendTypingIndicators ?? true;
    this.typingIndicatorIntervalMs = options.typingIndicatorIntervalMs ?? 5000;
    this.sdkQueryManager = new SDKQueryManager();
    this.sdkSessionManager = new SDKSessionManager({
      ...(options.rateLimitRepository !== undefined ? { rateLimitRepository: options.rateLimitRepository } : {}),
      ...(options.queryMetricsRepository !== undefined ? { queryMetricsRepository: options.queryMetricsRepository } : {}),
      ...(options.cacheKeepaliveConfig !== undefined ? { keepaliveConfig: options.cacheKeepaliveConfig } : {}),
      ephemeral: options.ephemeral ?? false,
    });
    this.conversationRepository = options.conversationRepository;
    this.getSystemPrompt = options.getSystemPrompt;
    this.queryMetricsRepository = options.queryMetricsRepository;
    this.usageCardEnabled = options.usageCardEnabled ?? true;

    logger.info('MessageProcessor initialized');
  }

  /**
   * Late dependency injection for services that depend on Discord adapters.
   * Called by AppBootstrap after Discord initialization completes.
   */
  wirePostInit(_deps: Record<string, never>): void {
    // no-op: all late-injected services removed
  }

  /** Expose SDKSessionManager for operational consumers. */
  get sdkSession(): SDKSessionManager {
    return this.sdkSessionManager;
  }

  async processConversationRequest(request: ConversationRequest): Promise<ConversationResult> {
    const metadata: Record<string, unknown> = { source: request.source };
    if (request.sessionUserId !== undefined) metadata.sessionUserId = request.sessionUserId;
    if (request.replyToMessageId !== undefined) metadata.originalMessageId = request.replyToMessageId;
    if (request.parentConversationId !== undefined) metadata.parentConversationId = request.parentConversationId;
    if (request.taskId !== undefined) metadata.taskId = request.taskId;
    if (request.inheritedSdkSessionId !== undefined) metadata.inheritedSdkSessionId = request.inheritedSdkSessionId;
    if (request.metadata !== undefined) Object.assign(metadata, request.metadata);

    const result = await this.processMessage(
      {
        id: `${request.source}:${request.agentId}:${request.chatId}:${Date.now()}`,
        platform: 'discord',
        userId: request.userId,
        chatId: request.chatId,
        text: request.text,
        timestamp: new Date(),
        metadata,
      },
      request.agentId,
      request.replyToMessageId !== undefined
        ? { replyToMessageId: request.replyToMessageId }
        : undefined
    );

    const internalSession = result.sessionId !== undefined
      ? this.sessionManager.getAllSessions().find((session) => session.sessionId === result.sessionId)
      : undefined;

    return {
      success: result.success,
      ...(result.sessionId !== undefined ? { sessionId: result.sessionId } : {}),
      ...(internalSession?.sdkSessionId !== undefined ? { sdkSessionId: internalSession.sdkSessionId } : {}),
      ...(result.response !== undefined ? { responseText: result.response } : {}),
      ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    };
  }

  /**
   * Process an incoming message
   */
  async processMessage(
    message: UnifiedMessage,
    agentId: string,
    options?: ProcessMessageOptions
  ): Promise<ProcessingResult> {
    // Establish a per-message log context. Child task-notification work can
    // reuse the parent correlation id so the trace can be reconstructed.
    const parent = logContext.get();
    const ctx: LogContext = {
      correlation_id: newCorrelationId(),
      message_id: message.id,
      platform: message.platform,
      agent_id: agentId,
      user_id: message.userId,
      chat_id: message.chatId,
    };
    if (parent?.correlation_id) ctx.parent_correlation_id = parent.correlation_id;
    return logContext.run(ctx, () => this._processMessageImpl(message, agentId, options));
  }

  private async _processMessageImpl(
    message: UnifiedMessage,
    agentId: string,
    options?: ProcessMessageOptions
  ): Promise<ProcessingResult> {
    return new ConversationPipeline({
      sessionManager: this.sessionManager,
      sdkSessionManager: this.sdkSessionManager,
      getAdapter: (platform, requestedAgentId) => this.getAdapter(platform, requestedAgentId),
      buildQueryExecutorDeps: () => this._buildQueryExecutorDeps(),
      getAgentCwd: (id) => this.sessionManager.getAgentPath(id),
    }).run(message, agentId, options);
  }

  /**
   * Build the QueryExecutorDeps object for QueryExecutor.
   */
  private _buildQueryExecutorDeps(): import('../query/QueryExecutor.js').QueryExecutorDeps {
    const deps: import('../query/QueryExecutor.js').QueryExecutorDeps = {
      sessionManager: this.sessionManager,
      sdkQueryManager: this.sdkQueryManager,
      sdkSessionManager: this.sdkSessionManager,
      sendTypingIndicators: this.sendTypingIndicators,
      typingIndicatorIntervalMs: this.typingIndicatorIntervalMs,
      usageCardEnabled: this.usageCardEnabled,
    };
    if (this.queryMetricsRepository !== undefined) deps.queryMetricsRepository = this.queryMetricsRepository;
    if (this.conversationRepository !== undefined) deps.conversationRepository = this.conversationRepository;
    if (this.getSystemPrompt !== undefined) deps.getSystemPrompt = this.getSystemPrompt;
    return deps;
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
    this.clearConversationFor(platform, agentId, userId);
  }

  /**
   * Clear conversation by logical identity.
   * Handles DB-only sessions whose SessionManager entry expired while the
   * SDKSessionManager still has a live managed session under the same sessionId.
   */
  clearConversationFor(platform: string, agentId: string, userId: string): boolean {
    const sessionId = this.sessionManager.getSessionId(platform, agentId, userId);
    if (sessionId === undefined) {
      return false;
    }

    // Destroy V2 persistent session (kills cli.js process) before clearing session key.
    // IMPORTANT: SDKSessionManager.sessions is keyed by ClaudeCab sessionId, NOT sdkSessionId.
    this.sdkSessionManager.destroySession(sessionId);

    // Soft-delete session in memory + DB (survives restart).
    const softDeleted = this.sessionManager.softDeleteSession(platform, agentId, userId);

    if (this.conversationRepository !== undefined) {
      this.conversationRepository.clearConversation(sessionId);
    }

    logger.debug(
      { sessionId, platform, agentId, userId, softDeleted },
      'Cleared conversation (V2 session destroyed + session soft-deleted in memory/DB)'
    );

    return true;
  }

  /**
   * Close the V2 persistent session (kill cli.js process) without clearing conversation history.
   * Used by /close command ??releases resources while keeping context for future resume.
   * Returns true if a V2 session was active and destroyed.
   */
  closeSession(sessionId: string): boolean {
    const { platform, agentId, userId } = this.getSessionIdentifiers(sessionId);
    const internalSession = this.sessionManager.getInternalSession(platform, agentId, userId);

    if (internalSession?.sdkSessionId !== undefined) {
      // Only destroy V2 process ??keep sdkSessionId so next message can resume.
      // IMPORTANT: SDKSessionManager.sessions is keyed by ClaudeCab sessionId, NOT sdkSessionId.
      this.sdkSessionManager.destroySession(sessionId);
      // sdkSessionId is preserved ??next query will use resume: sdkSessionId ??conversation continues
      logger.info({ sessionId, sdkSessionId: internalSession.sdkSessionId }, 'V2 process closed (sdkSessionId preserved for resume)');
      return true;
    }
    return false;
  }

  /**
   * Plan G /sync: manually drain the V2 session queryIterator buffer and route
   * any late sub-agent task_notification events back to their chat messages
   * (Edit in place). Use when user wants to see trailing sub-agent completion
   * without sending a new prompt (pure status poll, no model call).
   *
   * Returns:
   *   null   ??no V2 session for this sessionId
   *   object ??{ routed, drained, active }
   *     routed  : sub-agent events successfully handled
   *     drained : total messages drained from buffer
   *     active  : sub-agent records still in started/progress lifecycle
   */
  async syncSubAgentUpdates(sessionId: string): Promise<{ routed: number; drained: number; active: number } | null> {
    return this.sdkSessionManager.syncSubAgentUpdates(sessionId);
  }

  /**
   * Cancel an active query for the given session.
   * Returns true if a query was cancelled, false if no active query was found.
   */
  cancelQuery(sessionId: string): boolean {
    // Try V1 (SDKQueryManager) first
    if (this.sdkQueryManager.hasActiveQuery(sessionId)) {
      this.sdkQueryManager.cancelQuery(sessionId);
      logger.info({ sessionId }, 'Cancelled active V1 query');
      return true;
    }
    // Try V2 (SDKSessionManager) ??only if a query is actually running
    if (this.sdkSessionManager.hasActiveQuery(sessionId)) {
      this.sdkSessionManager.cancelActiveQuery(sessionId);
      logger.info({ sessionId }, 'Cancelled active V2 query');
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
    return this.sdkQueryManager.hasActiveQuery(session.sessionId) ||
      this.sdkSessionManager.hasActiveQuery(session.sessionId);
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    this.sdkQueryManager.dispose();
    await this.sdkSessionManager.dispose();
  }
}
