import type { UnifiedMessage } from '../types/message.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import type { UserSession } from '../types/session.js';
import type { ActivityService } from '../core/ActivityService.js';
import type { BudgetService } from '../services/BudgetService.js';
import type { ActivityEventService } from '../services/ActivityEventService.js';
import type { SessionManager } from '../core/SessionManager.js';
import type { SDKSessionManager } from '../core/SDKSessionManager.js';
import type { QueryExecutorDeps, QueryExecuteOptions } from '../core/QueryExecutor.js';
import { EventType } from '../utils/events.js';
import { logger } from '../utils/logger.js';
import { buildGroupUserId } from '../utils/groupSession.js';
import { playSound } from '../utils/localSound.js';
import { sendErrorToUser } from '../core/ResponseSender.js';
import { executeQueryWithSDK, type QueryRequest } from '../core/QueryExecutor.js';
import { loadAppConfig } from '../config.js';
import { checkSessionGuard } from '../core/SessionGuard.js';

export interface ProcessMessageOptions {
  isGroupChat?: boolean;
  replyToMessageId?: string;
}

export interface ProcessingResult {
  success: boolean;
  response?: string;
  error?: string;
  skipped?: boolean;
  sessionId?: string;
}

export interface ConversationPipelineDeps {
  sessionManager: SessionManager;
  sdkSessionManager: SDKSessionManager;
  getAdapter: (platform: 'discord', agentId: string) => BaseAdapter | undefined;
  buildQueryExecutorDeps: () => QueryExecutorDeps;
  getAgentCwd?: (agentId: string) => string | undefined;
  activityService?: ActivityService;
  activityEventService?: ActivityEventService;
  budgetService?: BudgetService;
}

/**
 * Orchestrates the Discord conversation path:
 * dedup -> budget -> session resolve -> guard -> runtime -> delivery -> finalize.
 */
export class ConversationPipeline {
  constructor(private readonly deps: ConversationPipelineDeps) {}

  async run(
    message: UnifiedMessage,
    agentId: string,
    options?: ProcessMessageOptions
  ): Promise<ProcessingResult> {
    const platform = message.platform === 'discord' ? 'discord' : undefined;
    if (platform === undefined) {
      return { success: false, error: `Unsupported platform: ${message.platform}` };
    }

    const { userId, chatId, text, id: messageId } = message;
    const isGroupChat = message.metadata?.isGroupChat === true;
    const effectiveUserId = isGroupChat
      ? buildGroupUserId(chatId)
      : message.metadata?.sessionUserId ?? userId;

    logger.info(
      { event_type: EventType.MESSAGE_PROCESSING_START, isGroupChat, effectiveUserId, text_len: text.length },
      'Processing message'
    );

    if (this.deps.sessionManager.isMessageProcessed(platform, agentId, effectiveUserId, messageId)) {
      logger.debug({ event_type: EventType.MESSAGE_DUPLICATE_SKIPPED, messageId }, 'Skipping duplicate message');
      return { success: true, skipped: true };
    }

    void this.deps.activityEventService?.log({
      type: 'chat.received',
      agentId,
      message: `收到訊息「${text.slice(0, 50)}${text.length > 50 ? '...' : ''}」`,
    });

    if (this.deps.budgetService !== undefined && !this.deps.budgetService.canQuery(agentId)) {
      logger.warn({ agentId }, 'Agent paused due to budget — rejecting message');
      const adapter = this.deps.getAdapter(platform, agentId);
      if (adapter !== undefined) {
        await adapter.sendMessage(chatId, '⚠️ 預算已超限，此 Agent 已暫停。請調整預算後再試。');
      }
      return { success: false, error: 'Agent paused: budget exceeded' };
    }

    const taskPreview = text.length > 40 ? text.substring(0, 40) + '...' : text;
    this.deps.activityService?.emitWorkflow(agentId, 'task_received', `收到訊息「${taskPreview}」`, { taskContent: text });
    this.deps.activityService?.emitReaction(agentId, 'task_received', { taskContent: text });

    let session: UserSession;
    try {
      const inheritedSdkSessionId = message.metadata?.inheritedSdkSessionId as string | undefined;
      session = await this.deps.sessionManager.getOrCreateSession({
        platform,
        userId: effectiveUserId,
        agentId,
        ...(inheritedSdkSessionId !== undefined ? { inheritedSdkSessionId } : {}),
      });
    } catch (error) {
      logger.error({ error, platform, userId, agentId }, 'Failed to get/create session');
      return {
        success: false,
        error: `Failed to create session: ${(error as Error).message}`,
      };
    }

    const adapter = this.deps.getAdapter(platform, agentId);
    if (adapter === undefined) {
      logger.error({ platform, agentId }, 'No adapter found for platform and agent');
      return {
        success: false,
        error: `No adapter for platform: ${platform}, agent: ${agentId}`,
      };
    }

    try {
      const result = await this.deps.sessionManager.withLock(
        platform,
        agentId,
        effectiveUserId,
        async () => {
          const lockedArgs: {
            message: UnifiedMessage;
            agentId: string;
            effectiveUserId: string;
            session: UserSession;
            adapter: BaseAdapter;
            options?: ProcessMessageOptions;
          } = { message, agentId, effectiveUserId, session, adapter };
          if (options !== undefined) lockedArgs.options = options;
          return this.runLocked(lockedArgs);
        }
      );

      logger.info(
        { event_type: EventType.MESSAGE_PROCESSING_COMPLETE, skipped: result.skipped === true, success: result.success },
        'Message processing complete'
      );
      return result;
    } catch (error) {
      return await this.handleFailure(error, message, agentId, effectiveUserId, session, adapter);
    }
  }

  private async runLocked(args: {
    message: UnifiedMessage;
    agentId: string;
    effectiveUserId: string;
    session: UserSession;
    adapter: BaseAdapter;
    options?: ProcessMessageOptions;
  }): Promise<ProcessingResult> {
    const { message, agentId, effectiveUserId, session, adapter, options } = args;
    const platform = 'discord';
    const { chatId, text, id: messageId } = message;
    const isGroupChat = message.metadata?.isGroupChat === true;

    if (this.deps.sessionManager.isMessageProcessed(platform, agentId, effectiveUserId, messageId)) {
      logger.warn(
        { event_type: EventType.MESSAGE_RACE_PREVENTED, messageId, platform, agentId, effectiveUserId },
        'Skipping duplicate message (caught inside lock — race condition prevented)'
      );
      return { success: true, skipped: true, response: '' };
    }

    this.deps.sessionManager.markMessageProcessed(platform, agentId, effectiveUserId, messageId);

    const appConfig = loadAppConfig();
    if (appConfig.sessionGuard.enabled) {
      const agentCwd = this.deps.getAgentCwd?.(agentId);
      const guardResult = await checkSessionGuard(
        { sdkSessionManager: this.deps.sdkSessionManager, adapter, chatId: message.chatId, agentCwd },
        session,
        appConfig.sessionGuard
      );
      if (guardResult === 'switch') {
        void this.deps.activityEventService?.log({
          type: 'session.guard_switch',
          agentId,
          message: `使用者選擇切換 session (user: ${effectiveUserId})`,
          level: 'warn',
        });
        this.deps.sdkSessionManager.destroySession(session.sessionId);
        this.deps.sessionManager.setSdkSessionId(platform, agentId, effectiveUserId, undefined);
        await adapter.sendFormattedMessage(
          message.chatId,
          '🔄 Session destroyed. Send your message again to start a fresh conversation.'
        );
        return { success: true, skipped: true, response: '' };
      }
      if (guardResult === 'timeout') {
        void this.deps.activityEventService?.log({
          type: 'session.guard_timeout',
          agentId,
          message: `Guard 問答逾時，訊息未處理 (user: ${effectiveUserId})`,
          level: 'warn',
        });
        return { success: true, skipped: true, response: '' };
      }
    }

    this.deps.sessionManager.updateState(platform, agentId, effectiveUserId, 'processing');

    try {
      const queryOptions = this.buildQueryOptions(message, options, isGroupChat);
      const queryRequest: QueryRequest = {
        sessionId: session.sessionId,
        prompt: text,
        adapter,
        chatId,
        platform,
        agentId,
        userId: effectiveUserId,
        ...(queryOptions !== undefined && Object.keys(queryOptions).length > 0
          ? { options: queryOptions }
          : {}),
      };
      const response = await executeQueryWithSDK(
        this.deps.buildQueryExecutorDeps(),
        queryRequest
      );

      this.deps.sessionManager.updateState(platform, agentId, effectiveUserId, 'idle');
      playSound('C:\\Windows\\Media\\Ring01.wav').catch(() => {});

      return {
        success: true,
        response,
        sessionId: session.sessionId,
      };
    } catch (error) {
      this.deps.sessionManager.updateState(platform, agentId, effectiveUserId, 'error');
      throw error;
    }
  }

  private buildQueryOptions(
    message: UnifiedMessage,
    options: ProcessMessageOptions | undefined,
    isGroupChat: boolean
  ): QueryExecuteOptions {
    const queryOptions: QueryExecuteOptions = {};
    if (options?.isGroupChat === true) {
      queryOptions.isGroupChat = true;
    }
    if (message.metadata?.parentConversationId !== undefined) {
      queryOptions.parentConversationId = message.metadata.parentConversationId;
    }
    if (typeof message.metadata?.sourceMessageChannelId === 'string') {
      queryOptions.sourceMessageChannelId = message.metadata.sourceMessageChannelId;
    }
    if (typeof message.metadata?.taskId === 'string') {
      queryOptions.taskId = message.metadata.taskId;
    }
    if (options?.replyToMessageId) {
      queryOptions.replyToMessageId = options.replyToMessageId;
    } else if (!isGroupChat && message.metadata?.originalMessageId) {
      queryOptions.replyToMessageId = message.metadata.originalMessageId;
    }
    return queryOptions;
  }

  private async handleFailure(
    error: unknown,
    message: UnifiedMessage,
    agentId: string,
    effectiveUserId: string,
    session: UserSession,
    adapter: BaseAdapter
  ): Promise<ProcessingResult> {
    const err = error instanceof Error ? error : new Error(String(error));
    const errorDetails = {
      message: err.message,
      name: err.name,
      stack: err.stack,
      ...(typeof error === 'object' && error !== null && 'status' in error
        ? { status: (error as { status: number }).status }
        : {}),
      ...(typeof error === 'object' && error !== null && 'error' in error
        ? { apiError: (error as { error: unknown }).error }
        : {}),
    };

    logger.error(
      { event_type: EventType.MESSAGE_ERROR, err: errorDetails, platform: 'discord', userId: effectiveUserId, agentId },
      'Failed to process message'
    );
    void this.deps.activityEventService?.log({
      type: 'system.message_error',
      agentId,
      message: `訊息處理失敗: ${err.message.slice(0, 200)}`,
      level: 'error',
    });

    const errorPreview = err.message.length > 60 ? err.message.substring(0, 60) + '...' : err.message;
    this.deps.activityService?.emitWorkflow(agentId, 'error', `發生錯誤: ${errorPreview}`, { error: err.message });
    this.deps.activityService?.emitReaction(agentId, 'error', { error: err.message });

    await sendErrorToUser(adapter, message.chatId, err);

    return {
      success: false,
      error: err.message,
      sessionId: session.sessionId,
    };
  }
}
