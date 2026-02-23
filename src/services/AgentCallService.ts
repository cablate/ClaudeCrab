/**
 * AgentCallService - 跨 Agent 呼叫服務
 *
 * 提供 fire-and-forget 模式觸發其他 Agent 執行 query。
 * 呼叫者不需要等待回覆，只需確認觸發成功。
 */

import { AgentLoader } from '../core/AgentLoader.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';
import type { MessageProcessor } from '../core/MessageProcessor.js';
import type { UnifiedMessage } from '../adapters/types.js';

export interface AgentCallOptions {
  /** 優先級（僅供 log 參考，不影響執行順序） */
  priority?: 'low' | 'normal' | 'high';
  /** 額外 metadata */
  metadata?: Record<string, unknown>;
  /** 原始聊天室 ID（用於讓目標 agent 回覆到這個聊天室） */
  chatId?: string;
}

export interface AgentCallResult {
  success: boolean;
  /** 呼叫 ID，用於追蹤 */
  callId: string;
  /** 錯誤訊息（如果失敗） */
  error?: string;
}

export class AgentCallService {
  constructor(
    private readonly agentLoader: AgentLoader,
    private readonly getMessageProcessor: () => MessageProcessor | undefined
  ) {}

  /**
   * Fire-and-forget 觸發另一個 Agent 執行 query
   * 
   * 透過 MessageProcessor.processMessage() 執行，確保完整流程：
   * - typing 狀態推送
   * - session 管理
   * - 回覆格式化（帶【agent 回覆】前綴）
   * 
   * @param fromAgent - 發起呼叫的 Agent ID
   * @param toAgent - 目標 Agent ID
   * @param message - 要傳送的訊息/指令
   * @param options - 額外選項（包含 chatId 用於回覆）
   * @returns 呼叫結果（成功只表示已觸發，不保證執行完成）
   */
  async callAgent(
    fromAgent: string,
    toAgent: string,
    message: string,
    options?: AgentCallOptions
  ): Promise<AgentCallResult> {
    const callId = randomUUID();

    logger.info(
      { callId, from: fromAgent, to: toAgent, priority: options?.priority, hasChatId: !!options?.chatId },
      '[AgentCallService] Triggering cross-agent call'
    );

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

    // 建構帶有來源資訊的 prompt
    const enrichedMessage = `【跨 Agent 呼叫】
來自: ${fromAgent}
優先級: ${options?.priority ?? 'normal'}
---
${message}`;

    // 構造 UnifiedMessage
    const unifiedMessage: UnifiedMessage = {
      id: callId,
      platform: 'telegram',
      userId: `agent:${fromAgent}`, // 標記為來自另一個 agent
      chatId: options.chatId,
      text: enrichedMessage,
      timestamp: new Date(),
      metadata: {
        isAgentCall: true,
        fromAgent,
      },
    };

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
   * 檢查 agent 是否存在
   */
  agentExists(agentId: string): boolean {
    return this.agentLoader.has(agentId);
  }
}
