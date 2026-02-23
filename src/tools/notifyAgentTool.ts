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
import type { AgentCallService } from '../services/AgentCallService.js';
import { logger } from '../utils/logger.js';

export interface AgentCallMcpContext {
  /** 當前 Agent ID */
  agentId: string;
  /** 原始聊天室 ID（用於讓目標 agent 回覆） */
  chatId: string;
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
        '呼叫其他 Agent 執行任務（fire-and-forget）。使用時機：需要其他 Agent 協助處理任務、通知其他 Agent 有新工作、請求審閱或回饋。呼叫後立即返回，不等待對方完成。',
        {
          targetAgent: z.string().describe('目標 Agent 的 ID（例如: admin, coder, general）'),
          message: z.string().describe('要傳送的訊息或指令，清楚說明需要對方做什麼'),
          priority: z
            .enum(['low', 'normal', 'high'])
            .optional()
            .describe('優先級：low=不急、normal=一般、high=緊急'),
        },
        async (args) => {
          logger.info(
            { from: context.agentId, to: args.targetAgent, priority: args.priority },
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

          // 觸發跨 agent 呼叫，傳入 chatId 讓目標 agent 可以回覆到原聊天室
          const result = await agentCallService.callAgent(
            context.agentId,
            args.targetAgent,
            args.message,
            {
              ...(args.priority !== undefined ? { priority: args.priority } : {}),
              chatId: context.chatId,
            }
          );

          if (result.success) {
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
