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
import { logger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';
import type { MessageProcessor } from '../core/MessageProcessor.js';
import type { SessionManager } from '../core/SessionManager.js';
import type { UnifiedMessage } from '../adapters/types.js';

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
  constructor(
    private readonly agentLoader: AgentLoader,
    private readonly getMessageProcessor: () => MessageProcessor | undefined,
    private readonly getSessionManager?: () => SessionManager | undefined
  ) {}

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

    // 需要 chatId 才能處理（因為要透過正常流程發送回覆）
    if (!options?.chatId) {
      logger.warn({ callId }, '[AgentCallService] chatId is required for cross-agent call');
      return {
        success: false,
        callId,
        error: 'chatId is required for cross-agent call',
      };
    }

    // 使用真實使用者 session（降低割裂感，讓使用者能在 Telegram 看到並介入）
    // 舊做法（獨立通道）：userId = `agent:${fromAgent}`，建立 agent 間的獨立 session
    const effectiveUserId = options?.userId ?? `agent:${fromAgent}`;
    const useUserSession = !!options?.userId;

    // 強制新對話：僅在獨立通道模式下清除 session（不應影響使用者的現有 session）
    if (options.startNewConversation && !useUserSession) {
      this.clearAgentCallSession(fromAgent, toAgent);
    }

    // 建構帶有來源資訊的 prompt
    const callModeNote = options.awaitResult
      ? '模式: await（對方正在等待你的回覆）\n⚠️ 直接回覆即可，不要使用 call_agent。你的回覆會自動傳達給對方。'
      : '模式: fire-and-forget（對方不等待回覆）\n📝 直接回覆即可，回覆會顯示在聊天室。僅在必要時才使用 call_agent 聯繫對方。';
    const enrichedMessage = `【跨 Agent 呼叫】
來自: ${fromAgent}
優先級: ${options?.priority ?? 'normal'}
${callModeNote}
---
${message}`;

    // 構造 UnifiedMessage
    const unifiedMessage: UnifiedMessage = {
      id: callId,
      platform: 'telegram',
      userId: effectiveUserId,
      chatId: options.chatId,
      text: enrichedMessage,
      timestamp: new Date(),
      metadata: {
        isAgentCall: true,
        fromAgent,
      },
    };

    // awaitResult 模式：等待回覆
    if (options.awaitResult) {
      return this.executeAndAwait(messageProcessor, unifiedMessage, toAgent, callId, fromAgent);
    }

    // Fire-and-forget: 不 await 完成，只確保觸發
    this.executeInBackground(messageProcessor, unifiedMessage, toAgent, callId, fromAgent);

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
    fromAgent: string
  ): Promise<void> {
    try {
      const result = await messageProcessor.processMessage(message, toAgent);

      if (result.success) {
        logger.info(
          { callId, from: fromAgent, to: toAgent },
          '[AgentCallService] Background execution completed via MessageProcessor'
        );
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
  private clearAgentCallSession(fromAgent: string, toAgent: string): void {
    const sessionManager = this.getSessionManager?.();
    if (!sessionManager) {
      logger.debug('[AgentCallService] SessionManager not available, skip clearing session');
      return;
    }

    const userId = `agent:${fromAgent}`;
    sessionManager.setSdkSessionId('telegram', toAgent, userId, undefined);
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
}
