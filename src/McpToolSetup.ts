/**
 * McpToolSetup — builds MCP server instances and the matching allowedTools
 * list for an SDK query.
 *
 * Extracted from MessageProcessor to isolate pure MCP-config logic.
 */

import {
  createTTSMcpServer,
  getTTSToolNames,
} from './tools/ttsTool.js';
import {
  createSendFileMcpServer,
  getSendFileToolNames,
} from './tools/sendFileTool.js';
import {
  createTaskMcpServer,
  getTaskToolNames,
} from './tools/taskTool.js';
import {
  createValidatorMcpServer,
  getValidatorToolNames,
} from './tools/validatorTool.js';
import type { TTSService } from './services/TTSService.js';
import type { TaskService } from './services/TaskService.js';
import type { BaseAdapter } from './adapters/BaseAdapter.js';

export interface McpSetupContext {
  agentId: string;
  chatId: string;
  userId: string;
  platform?: string;
  /** Sub-conversation ID (e.g., thread). Platform-agnostic. */
  subConversationId?: string;
  /** Parent conversation ID (e.g., main channel). Platform-agnostic. */
  parentConversationId?: string;
  /** Task ID for agent-call tracking. */
  taskId?: string;
}

export interface McpSetupResult {
  mcpServers: Record<
    string,
    | ReturnType<typeof createTTSMcpServer>
    | ReturnType<typeof createSendFileMcpServer>
    | ReturnType<typeof createTaskMcpServer>
    | ReturnType<typeof createValidatorMcpServer>
  >;
  allowedTools: string[];
}

/**
 * Build MCP server map and allowed tool names from available services.
 */
export function buildMcpSetup(
  ttsService: TTSService | undefined,
  adapter: BaseAdapter,
  ctx: McpSetupContext,
  taskService?: TaskService,
): McpSetupResult {
  const mcpServers: McpSetupResult['mcpServers'] = {};
  const allowedTools: string[] = [];

  if (ttsService) {
    const server = createTTSMcpServer(ttsService, ctx);
    mcpServers['tts'] = server;
    allowedTools.push(...getTTSToolNames());
  }

  // File sending (always available — no optional service needed)
  const sendFileServer = createSendFileMcpServer(adapter, ctx.chatId);
  mcpServers['file-send'] = sendFileServer;
  allowedTools.push(...getSendFileToolNames());

  // Workspace validation (always available; read-only governance tool)
  const validatorServer = createValidatorMcpServer();
  mcpServers['validator'] = validatorServer;
  allowedTools.push(...getValidatorToolNames());

  // Task management (available when TaskService is provided)
  if (taskService) {
    const server = createTaskMcpServer(taskService, { agentId: ctx.agentId });
    mcpServers['task-mgmt'] = server;
    allowedTools.push(...getTaskToolNames());
  }

  return { mcpServers, allowedTools };
}
