/**
 * notifyAgentTool - 跨 Agent 呼叫的 Custom Tool
 *
 * 讓 Agent 在執行過程中可以 fire-and-forget 觸發其他 Agent
 *
 * 使用方式：
 * 1. 建立 MCP server：createAgentCallMcpServer(agentCallService, currentAgentId)
 * 2. 傳入 SDKQueryManager 的 mcpServers 選項
 * 3. Agent 可透過 mcp__agent-call__call_agent 調用
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { AgentCallService, AgentCallOptions } from '../services/AgentCallService.js';
import { logger } from '../utils/logger.js';

export interface AgentCallMcpContext {
  /** 當前 Agent ID */
  agentId: string;
  /** 原始聊天室 ID（用於讓目標 agent 回覆） */
  chatId: string;
  /** 原始使用者 ID（用於共用使用者 session，降低割裂感） */
  userId: string;
  /** Platform (for correct adapter routing) */
  platform?: string;
  /** Sub-conversation ID (e.g., thread). Platform-agnostic. */
  subConversationId?: string;
  /** Parent conversation ID (e.g., main channel). Platform-agnostic. */
  parentConversationId?: string;
}

/**
 * 建立跨 Agent 呼叫的 MCP Server
 */
export function createAgentCallMcpServer(
  agentCallService: AgentCallService,
  context: AgentCallMcpContext
) {
  return createSdkMcpServer({
    name: 'agent-call',
    version: '1.0.0',
    tools: [
      tool(
        'call_agent',
        '呼叫其他 Agent 協作。訊息會直接進入使用者與目標 Agent 的現有對話，使用者可即時看到並介入。支援 fire-and-forget（預設）和 await 兩種模式。',
        {
          targetAgent: z.string().describe('目標 Agent 的 ID（例如: admin, coder, general）'),
          message: z.string().describe('要傳送的訊息或指令，清楚說明需要對方做什麼'),
          priority: z
            .enum(['low', 'normal', 'high'])
            .optional()
            .describe('優先級：low=不急、normal=一般、high=緊急'),
          awaitResult: z
            .boolean()
            .optional()
            .describe('是否等待目標 agent 回覆（預設 false = fire-and-forget）。設為 true 時會阻塞直到對方完成'),
          startNewConversation: z
            .boolean()
            .optional()
            .describe('強制建立新對話，不延續先前的對話 context（預設 false = 自動 resume）'),
          taskId: z
            .string()
            .optional()
            .describe('任務 ID（如果是任務相關的呼叫，帶上 taskId 讓目標 agent 在專屬 thread 工作並追蹤花費）'),
        },
        async (args) => {
          logger.info(
            {
              from: context.agentId,
              to: args.targetAgent,
              priority: args.priority,
              awaitResult: args.awaitResult,
              startNewConversation: args.startNewConversation,
              taskId: args.taskId,
            },
            'Agent call tool invoked'
          );

          // 檢查目標 agent 是否存在
          if (!agentCallService.agentExists(args.targetAgent)) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `錯誤：Agent "${args.targetAgent}" 不存在。請確認 Agent ID 正確。`,
                },
              ],
            };
          }

          // 不能呼叫自己
          if (args.targetAgent === context.agentId) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: '錯誤：不能呼叫自己。',
                },
              ],
            };
          }

          // 觸發跨 agent 呼叫
          try {
          const callOptions: AgentCallOptions = {
            platform: context.platform ?? 'telegram',
          };

          if (args.priority !== undefined) callOptions.priority = args.priority;
          if (args.awaitResult !== undefined) callOptions.awaitResult = args.awaitResult;
          if (args.startNewConversation !== undefined) callOptions.startNewConversation = args.startNewConversation;

          if (args.taskId !== undefined) {
            // Task-bound call: let AgentCallService handle userId/chatId via task binding
            callOptions.taskId = args.taskId;
            callOptions.chatId = context.chatId; // fallback if task thread creation fails
          } else {
            // Direct call: use caller's context (backward compatible)
            callOptions.chatId = context.chatId;
            callOptions.userId = context.userId;
          }

          // Cross-channel notification (only for non-task calls — task system has its own notification routing)
          if (args.taskId === undefined && context.subConversationId !== undefined && context.parentConversationId !== undefined) {
            callOptions.crossChannelNotify = {
              targetChannelId: context.parentConversationId,
              sourceConversationId: context.subConversationId,
            };
          }

          const result = await agentCallService.callAgent(
            context.agentId,
            args.targetAgent,
            args.message,
            callOptions,
          );

          if (result.success) {
            // await 模式：回傳 agent 回覆內容
            if (args.awaitResult && result.response !== undefined) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `✅ ${args.targetAgent} 已回覆（Call ID: ${result.callId}）：\n\n${result.response}`,
                  },
                ],
              };
            }

            // fire-and-forget 模式
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `✅ 已觸發 ${args.targetAgent} 執行任務（Call ID: ${result.callId}）。呼叫為 fire-and-forget 模式，不會等待對方回覆。`,
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `❌ 呼叫失敗：${result.error}`,
                },
              ],
            };
          }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger.error({ from: context.agentId, to: args.targetAgent, taskId: args.taskId, error: errorMsg }, 'Agent call tool error');
            return {
              content: [{ type: 'text' as const, text: `❌ 呼叫異常：${errorMsg}` }],
            };
          }
        }
      ),
    ],
  });
}

/**
 * 取得 agent call tools 的允許列表
 */
export function getAgentCallToolNames(): string[] {
  return [
    'mcp__agent-call__call_agent',
  ];
}
