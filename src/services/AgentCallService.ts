/**
 * AgentCallService - 跨 Agent 呼叫服務
 *
 * 支援兩種模式：
 * - fire-and-forget（預設）：觸發後立即返回，不等待回覆
 * - await：等待目標 agent 回覆，返回回覆內容
 *
 * Session Resume：同一對 agent 間的重複呼叫會自動延續對話 context，
 * 除非明確指定 startNewConversation=true。
 */

import { AgentLoader } from '../core/AgentLoader.js';
import { logger as rootLogger } from '../utils/logger.js';

const logger = rootLogger.child({ module: 'AgentCallService' });
import { randomUUID } from 'node:crypto';
import type { MessageProcessor } from '../core/MessageProcessor.js';
import type { SessionManager } from '../core/SessionManager.js';
import type { UnifiedMessage } from '../adapters/types.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import type { TaskRecordRepository } from '../persistence/TaskRecordRepository.js';

/** Maximum nested agent-call depth to prevent infinite loops (A→B→C→A) */
const MAX_CALL_DEPTH = 5;

export interface AgentCallOptions {
  /** 優先級（僅供 log 參考，不影響執行順序） */
  priority?: 'low' | 'normal' | 'high';
  /** 額外 metadata */
  metadata?: Record<string, unknown>;
  /** 原始聊天室 ID（用於讓目標 agent 回覆到這個聊天室） */
  chatId?: string;
  /** 真實使用者 ID（共用使用者與目標 Agent 的現有 session，降低割裂感） */
  userId?: string;
  /** 等待回覆結果（預設 false = fire-and-forget） */
  awaitResult?: boolean;
  /** 強制建立新對話（清除先前的 session context） */
  startNewConversation?: boolean;
  /** Current call depth (incremented automatically on nested calls) */
  depth?: number;
  /** Platform of the original message (for correct adapter routing) */
  platform?: string;
  /** Cross-channel notification (platform-agnostic): post summary in another channel after call */
  crossChannelNotify?: {
    targetChannelId: string;
    sourceConversationId: string;
  };
  /** Task ID for two-layer thread architecture: binds this call to a task */
  taskId?: string;
}

export interface AgentCallResult {
  success: boolean;
  /** 呼叫 ID，用於追蹤 */
  callId: string;
  /** 錯誤訊息（如果失敗） */
  error?: string;
  /** 目標 agent 的回覆內容（僅在 awaitResult=true 時有值） */
  response?: string;
}

export class AgentCallService {
  /** Optional: get adapter for cross-channel summary posting */
  private getAdapter?: (platform: string, agentId: string) => BaseAdapter | undefined;
  /** Optional: task record repository for two-layer thread architecture */
  private taskRecordRepo?: TaskRecordRepository;

  constructor(
    private readonly agentLoader: AgentLoader,
    private readonly getMessageProcessor: () => MessageProcessor | undefined,
    private readonly getSessionManager?: () => SessionManager | undefined
  ) {}

  /** Set adapter getter (called after PlatformOrchestrator is ready) */
  setAdapterGetter(fn: (platform: string, agentId: string) => BaseAdapter | undefined): void {
    this.getAdapter = fn;
  }

  /** Set task record repository (called after persistence is ready) */
  setTaskRecordRepository(repo: TaskRecordRepository): void {
    this.taskRecordRepo = repo;
  }

  /**
   * 觸發另一個 Agent 執行 query
   *
   * 透過 MessageProcessor.processMessage() 執行，確保完整流程：
   * - typing 狀態推送
   * - session 管理（自動延續先前對話 context）
   * - 回覆格式化（帶【agent 回覆】前綴）
   *
   * @param fromAgent - 發起呼叫的 Agent ID
   * @param toAgent - 目標 Agent ID
   * @param message - 要傳送的訊息/指令
   * @param options - 額外選項
   * @returns 呼叫結果（awaitResult=true 時包含回覆內容）
   */
  async callAgent(
    fromAgent: string,
    toAgent: string,
    message: string,
    options?: AgentCallOptions
  ): Promise<AgentCallResult> {
    const callId = randomUUID();
    const depth = options?.depth ?? 0;

    try {
    return await this._callAgentImpl(callId, fromAgent, toAgent, message, options, depth);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        { callId, from: fromAgent, to: toAgent, taskId: options?.taskId, error: errorMsg, stack: error instanceof Error ? error.stack : undefined },
        '[AgentCallService] Unexpected error in callAgent'
      );
      return { success: false, callId, error: errorMsg };
    }
  }

  private async _callAgentImpl(
    callId: string,
    fromAgent: string,
    toAgent: string,
    message: string,
    options: AgentCallOptions | undefined,
    depth: number,
  ): Promise<AgentCallResult> {

    logger.info(
      {
        callId,
        from: fromAgent,
        to: toAgent,
        depth,
        priority: options?.priority,
        hasChatId: !!options?.chatId,
        hasUserId: !!options?.userId,
        awaitResult: options?.awaitResult ?? false,
        startNewConversation: options?.startNewConversation ?? false,
      },
      '[AgentCallService] Triggering cross-agent call'
    );

    // Depth check: prevent infinite loops (A→B→C→A)
    if (depth >= MAX_CALL_DEPTH) {
      logger.warn(
        { callId, from: fromAgent, to: toAgent, depth, maxDepth: MAX_CALL_DEPTH },
        '[AgentCallService] Call depth limit exceeded — rejecting call'
      );
      return {
        success: false,
        callId,
        error: `Agent call depth limit exceeded (max: ${MAX_CALL_DEPTH}). This prevents infinite call loops.`,
      };
    }

    // Directionality check: log if calling across categories without going through manager
    const fromConfig = this.agentLoader.get(fromAgent);
    const toConfig = this.agentLoader.get(toAgent);
    // NOTE: Directionality check uses discord.reportsTo config. This is a platform-specific
    // concept that should eventually move to a platform-agnostic org hierarchy service.
    if (fromConfig?.config.discord?.reportsTo !== undefined && toConfig?.config.discord?.reportsTo !== undefined) {
      const fromReportsTo = fromConfig.config.discord.reportsTo;
      const toReportsTo = toConfig.config.discord.reportsTo;
      // Cross-category peer call (neither reports to the other, and they have different managers)
      if (fromReportsTo !== toAgent && toReportsTo !== fromAgent && fromReportsTo !== toReportsTo) {
        logger.info(
          { from: fromAgent, to: toAgent, fromManager: fromReportsTo, toManager: toReportsTo },
          '[AgentCallService] Cross-category peer call detected (logged, not blocked)'
        );
      }
    }

    // 檢查目標 agent 是否存在
    if (!this.agentLoader.has(toAgent)) {
      logger.warn({ callId, toAgent }, '[AgentCallService] Target agent not found');
      return {
        success: false,
        callId,
        error: `Agent "${toAgent}" not found`,
      };
    }

    // 取得 MessageProcessor
    const messageProcessor = this.getMessageProcessor();
    if (!messageProcessor) {
      logger.warn({ callId }, '[AgentCallService] MessageProcessor not available');
      return {
        success: false,
        callId,
        error: 'MessageProcessor not available',
      };
    }

    // Determine platform for correct adapter routing (Discord threads vs Telegram)
    const effectivePlatform = options?.platform ?? 'telegram';
    if (options?.platform === undefined) {
      logger.warn({ callId, from: fromAgent, to: toAgent }, '[AgentCallService] No platform specified — falling back to telegram');
    }

    // 使用真實使用者 session（降低割裂感，讓使用者能在 Telegram 看到並介入）
    let effectiveUserId = options?.userId ?? `agent:${fromAgent}`;
    const useUserSession = !!options?.userId;
    let effectiveChatId = options?.chatId;

    // Task binding: when taskId is provided, override userId and chatId for two-layer thread
    let taskContext = '';
    logger.info({ callId, taskId: options?.taskId, hasTaskRecordRepo: !!this.taskRecordRepo }, '[AgentCallService] Task binding check');
    if (options?.taskId && this.taskRecordRepo) {
      const task = this.taskRecordRepo.getById(options.taskId);
      if (task) {
        // (a) Override userId for session isolation per task
        effectiveUserId = `task:${options.taskId}`;

        // (b) Find or create per-task thread in agent's channel
        if (effectivePlatform === 'discord' && this.getAdapter) {
          const adapter = this.getAdapter(effectivePlatform, toAgent);
          if (adapter) {
            const existingThreadId = this.taskRecordRepo.getAgentThreadId(options.taskId, toAgent);
            if (existingThreadId) {
              // Reuse existing thread
              effectiveChatId = existingThreadId;
            } else {
              // Create new per-task thread — call on the adapter object to preserve `this` binding
              const discordAdapter = adapter as unknown as { createThreadInChannel?: (channelId: string, title: string, msg: string) => Promise<{ success: boolean; threadId?: string }> };
              if (typeof discordAdapter.createThreadInChannel === 'function') {
                const toConfig = this.agentLoader.get(toAgent);
                const channelId = toConfig?.config.discordChannelId;
                if (channelId) {
                  const result = await discordAdapter.createThreadInChannel(
                    channelId,
                    `📋 任務：${task.title}`,
                    `**任務指派**\n標題：${task.title}\n描述：${task.description ?? '無'}\n優先級：${task.priority}\n指派給：${toAgent}`
                  );
                  if (result.success && result.threadId) {
                    this.taskRecordRepo.setAgentThreadId(options.taskId, toAgent, result.threadId);
                    effectiveChatId = result.threadId;
                  }
                }
              }
            }
          }
        }

        // (c) Build task context for enrichedMessage
        taskContext = `【任務上下文】
任務 ID: ${task.id.slice(0, 8)}
標題: ${task.title}
描述: ${task.description ?? '無'}
狀態: ${task.status}
優先級: ${task.priority}
審核次數: ${task.review_count ?? 0}
---
`;
      } else {
        logger.warn({ taskId: options.taskId }, '[AgentCallService] Task not found, proceeding without task context');
      }
    }

    // Discord non-task calls: route to target agent's own channel instead of using caller's chatId.
    // Without this, the target agent's response pollutes the caller's thread.
    if (effectivePlatform === 'discord' && !options?.taskId && this.getAdapter) {
      const toConfig = this.agentLoader.get(toAgent);
      const channelId = toConfig?.config.discordChannelId;
      if (channelId) {
        const adapter = this.getAdapter(effectivePlatform, toAgent);
        if (adapter) {
          const discordAdapter = adapter as unknown as { createThreadInChannel?: (channelId: string, title: string, msg: string) => Promise<{ success: boolean; threadId?: string }> };
          if (typeof discordAdapter.createThreadInChannel === 'function') {
            const fromName = fromConfig?.config.name ?? fromAgent;
            const threadTitle = `💬 ${fromName} → ${toConfig?.config.name ?? toAgent}`;
            const preview = message.length > 200 ? message.slice(0, 197) + '...' : message;
            try {
              const result = await discordAdapter.createThreadInChannel(channelId, threadTitle, preview);
              if (result.success && result.threadId) {
                effectiveChatId = result.threadId;
                logger.info(
                  { callId, threadId: result.threadId, channelId },
                  '[AgentCallService] Created thread in target agent channel for non-task Discord call'
                );
              }
            } catch (err) {
              logger.warn(
                { callId, err: err instanceof Error ? err.message : String(err) },
                '[AgentCallService] Failed to create thread in target agent channel, falling back to caller chatId'
              );
            }
          }
        }
      }
    }

    // chatId is required after task binding (task binding may have derived it from per-task thread)
    if (!effectiveChatId) {
      logger.warn({ callId }, '[AgentCallService] chatId is required (and could not be derived from taskId)');
      return {
        success: false,
        callId,
        error: 'chatId is required for cross-agent call',
      };
    }

    // 強制新對話：僅在獨立通道模式下清除 session（不應影響使用者的現有 session）
    if (options?.startNewConversation && !useUserSession) {
      this.clearAgentCallSession(fromAgent, toAgent, effectivePlatform);
    }

    // 建構帶有來源資訊的 prompt
    const callModeNote = options?.awaitResult
      ? '模式: await（對方正在等待你的回覆）\n⚠️ 直接回覆即可，不要使用 call_agent。你的回覆會自動傳達給對方。'
      : '模式: fire-and-forget（對方不等待回覆）\n📝 直接回覆即可，回覆會顯示在聊天室。僅在必要時才使用 call_agent 聯繫對方。';
    const enrichedMessage = `${taskContext}【跨 Agent 呼叫】
來自: ${fromAgent}
優先級: ${options?.priority ?? 'normal'}
${callModeNote}
---
${message}`;

    // 構造 UnifiedMessage — use original platform for correct adapter routing
    const metadata: Record<string, unknown> = {
      isAgentCall: true,
      fromAgent,
    };
    if (options?.taskId !== undefined) {
      metadata.taskId = options.taskId;
    }
    const unifiedMessage: UnifiedMessage = {
      id: callId,
      platform: effectivePlatform,
      userId: effectiveUserId,
      chatId: effectiveChatId,
      text: enrichedMessage,
      timestamp: new Date(),
      metadata,
    };

    // awaitResult 模式：等待回覆
    if (options?.awaitResult) {
      return this.executeAndAwait(messageProcessor, unifiedMessage, toAgent, callId, fromAgent);
    }

    // Fire-and-forget: 不 await 完成，只確保觸發
    this.executeInBackground(messageProcessor, unifiedMessage, toAgent, callId, fromAgent, options);

    logger.info(
      { callId, from: fromAgent, to: toAgent },
      '[AgentCallService] Call triggered successfully (fire-and-forget)'
    );

    return {
      success: true,
      callId,
    };
  }

  /**
   * 等待目標 agent 回覆並返回結果
   */
  private async executeAndAwait(
    messageProcessor: MessageProcessor,
    message: UnifiedMessage,
    toAgent: string,
    callId: string,
    fromAgent: string
  ): Promise<AgentCallResult> {
    try {
      const result = await messageProcessor.processMessage(message, toAgent);

      if (result.success) {
        logger.info(
          { callId, from: fromAgent, to: toAgent, responseLength: result.response?.length ?? 0 },
          '[AgentCallService] Await call completed successfully'
        );
        return {
          success: true,
          callId,
          response: result.response ?? '',
        };
      } else {
        logger.warn(
          { callId, from: fromAgent, to: toAgent, error: result.error },
          '[AgentCallService] Await call failed'
        );
        return {
          success: false,
          callId,
          error: result.error ?? 'Unknown error',
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        { callId, from: fromAgent, to: toAgent, error: errorMsg },
        '[AgentCallService] Await call error'
      );
      return {
        success: false,
        callId,
        error: errorMsg,
      };
    }
  }

  /**
   * 在背景執行（不阻塞呼叫者）
   * 透過 MessageProcessor.processMessage() 走完整流程
   */
  private async executeInBackground(
    messageProcessor: MessageProcessor,
    message: UnifiedMessage,
    toAgent: string,
    callId: string,
    fromAgent: string,
    options?: AgentCallOptions
  ): Promise<void> {
    try {
      const result = await messageProcessor.processMessage(message, toAgent);

      if (result.success) {
        logger.info(
          { callId, from: fromAgent, to: toAgent },
          '[AgentCallService] Background execution completed via MessageProcessor'
        );

        // Quality gate callback: notify task creator when agent completes work
        if (options?.taskId && this.taskRecordRepo) {
          const task = this.taskRecordRepo.getById(options.taskId);
          if (task) {
            const creatorAgent = task.created_by_agent_id ?? 'general';
            if (creatorAgent !== toAgent) { // Don't callback self
              const summaryText = result.response ? result.response.slice(0, 500) : '(執行完成，無文字回覆)';

              // Fire-and-forget callback to secretary
              const callbackOpts: AgentCallOptions = {
                taskId: options.taskId,
                depth: (options.depth ?? 0) + 1,
              };
              if (options.chatId !== undefined) callbackOpts.chatId = options.chatId;
              if (options.platform !== undefined) callbackOpts.platform = options.platform;
              void this.callAgent(toAgent, creatorAgent,
                `【品管 Callback】\n${toAgent} 已完成任務「${task.title}」\n\n以下是回覆摘要：\n${summaryText}\n\n請進行品管審核。通過後用 request_review 推到主 thread。`,
                callbackOpts
              ).catch(err => {
                logger.warn({ err: err instanceof Error ? err.message : String(err), taskId: options.taskId },
                  '[AgentCallService] Quality gate callback failed');
              });
            }
          }
        }

        // Discord thread: post summary link in target agent's own channel
        this.postCrossChannelSummary(fromAgent, toAgent, options);
      } else {
        logger.warn(
          { callId, from: fromAgent, to: toAgent, error: result.error },
          '[AgentCallService] Background execution failed'
        );
      }
    } catch (error) {
      logger.error(
        { callId, from: fromAgent, to: toAgent, error: error instanceof Error ? error.message : String(error) },
        '[AgentCallService] Background execution error'
      );
    }
  }

  /**
   * 清除特定 agent 間的 session（用於 startNewConversation）
   */
  private clearAgentCallSession(fromAgent: string, toAgent: string, platform: string): void {
    const sessionManager = this.getSessionManager?.();
    if (!sessionManager) {
      logger.debug('[AgentCallService] SessionManager not available, skip clearing session');
      return;
    }

    const userId = `agent:${fromAgent}`;
    sessionManager.setSdkSessionId(platform, toAgent, userId, undefined);
    logger.info(
      { from: fromAgent, to: toAgent },
      '[AgentCallService] Cleared agent call session for new conversation'
    );
  }

  /**
   * 檢查 agent 是否存在
   */
  agentExists(agentId: string): boolean {
    return this.agentLoader.has(agentId);
  }

  /**
   * Post a cross-channel notification after agent-call completes.
   * Platform-agnostic: uses adapter to send to the specified target channel.
   */
  private postCrossChannelSummary(
    fromAgent: string,
    toAgent: string,
    options?: AgentCallOptions
  ): void {
    const notify = options?.crossChannelNotify;
    if (notify === undefined) return;
    if (options?.platform === undefined || this.getAdapter === undefined) return;

    const targetAdapter = this.getAdapter(options.platform, toAgent);
    if (targetAdapter === undefined) return;

    const fromName = this.agentLoader.get(fromAgent)?.config.name ?? fromAgent;

    void targetAdapter.sendMessage(
      notify.targetChannelId,
      `📎 正在協助 **${fromName}** 處理任務`
    ).catch(() => {
      // Best effort — don't block
    });
  }
}
