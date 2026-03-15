/**
 * taskTool — MCP tool for agents to create/manage tasks.
 *
 * Agents can create tasks via mcp__task-mgmt__create_task.
 * Tasks are stored in SQLite and optionally synced to Discord Forum.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { TaskService } from '../services/TaskService.js';
import { logger } from '../utils/logger.js';

export interface TaskMcpContext {
  agentId: string;
}

/**
 * Create the task management MCP server.
 */
export function createTaskMcpServer(
  taskService: TaskService,
  context: TaskMcpContext
) {
  return createSdkMcpServer({
    name: 'task-mgmt',
    version: '1.0.0',
    tools: [
      tool(
        'create_task',
        '建立結構化任務。任務會記錄在 SQLite 並同步到 Discord Task Board（如果已設定）。適用於：發現需要追蹤的工作、拆分子任務、指派給其他 Agent。',
        {
          title: z.string().describe('任務標題'),
          description: z.string().optional().describe('任務描述（選填）'),
          priority: z.enum(['urgent', 'medium', 'low']).optional().describe('優先級（預設 medium）'),
          assigneeAgentId: z.string().optional().describe('指派給哪個 Agent（例如: coder, writer）'),
        },
        async (args) => {
          logger.info(
            { from: context.agentId, title: args.title, assignee: args.assigneeAgentId },
            'Task creation tool invoked'
          );

          try {
            const taskId = await taskService.createTask({
              title: args.title,
              ...(args.description !== undefined ? { description: args.description } : {}),
              ...(args.priority !== undefined ? { priority: args.priority } : {}),
              ...(args.assigneeAgentId !== undefined ? { assigneeAgentId: args.assigneeAgentId } : {}),
              createdByAgentId: context.agentId,
            });

            return {
              content: [{
                type: 'text' as const,
                text: `✅ 任務已建立（ID: ${taskId}）\n標題：${args.title}\n優先級：${args.priority ?? 'medium'}\n指派：${args.assigneeAgentId ?? '未指派'}`,
              }],
            };
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
              content: [{
                type: 'text' as const,
                text: `❌ 建立任務失敗：${msg}`,
              }],
            };
          }
        }
      ),

      tool(
        'list_tasks',
        '列出目前的任務清單。可以按狀態篩選。',
        {
          status: z.enum(['backlog', 'in_progress', 'in_review', 'done', 'cancelled']).optional()
            .describe('篩選狀態（選填，不填列出所有）'),
          limit: z.number().optional().describe('最多幾筆（預設 10）'),
        },
        async (args) => {
          try {
            const tasks = taskService.list(args.status, args.limit ?? 10);
            if (tasks.length === 0) {
              return {
                content: [{ type: 'text' as const, text: '目前沒有任務。' }],
              };
            }

            const lines = tasks.map((t) => {
              const status = { backlog: '📋', in_progress: '🔄', in_review: '👀', done: '✅', cancelled: '❌' }[t.status] ?? '?';
              const assignee = t.assignee_agent_id ? ` → ${t.assignee_agent_id}` : '';
              return `${status} [${t.priority}] ${t.title}${assignee} (${t.id.slice(0, 8)})`;
            });

            return {
              content: [{ type: 'text' as const, text: lines.join('\n') }],
            };
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: 'text' as const, text: `❌ 查詢失敗：${msg}` }],
            };
          }
        }
      ),

      tool(
        'update_task',
        '更新任務狀態或指派。',
        {
          taskId: z.string().describe('任務 ID（前 8 碼即可，會模糊匹配）'),
          status: z.enum(['backlog', 'in_progress', 'in_review', 'done', 'cancelled']).optional()
            .describe('新狀態'),
          assigneeAgentId: z.string().optional().describe('重新指派給誰'),
        },
        async (args) => {
          try {
            if (args.status !== undefined) {
              await taskService.updateStatus(args.taskId, args.status);
            }
            if (args.assigneeAgentId !== undefined) {
              await taskService.assignTask(args.taskId, args.assigneeAgentId);
            }

            return {
              content: [{
                type: 'text' as const,
                text: `✅ 任務 ${args.taskId.slice(0, 8)} 已更新`,
              }],
            };
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: 'text' as const, text: `❌ 更新失敗：${msg}` }],
            };
          }
        }
      ),
    ],
  });
}

export function getTaskToolNames(): string[] {
  return [
    'mcp__task-mgmt__create_task',
    'mcp__task-mgmt__list_tasks',
    'mcp__task-mgmt__update_task',
  ];
}
