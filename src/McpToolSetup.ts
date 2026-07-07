/**
 * McpToolSetup — builds MCP server instances and the matching allowedTools
 * list for an SDK query.
 *
 * Extracted from MessageProcessor to isolate pure MCP-config logic.
 */

import {
  createSendFileMcpServer,
  getSendFileToolNames,
} from './tools/sendFileTool.js';
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
    ReturnType<typeof createSendFileMcpServer>
  >;
  allowedTools: string[];
}

/**
 * Build MCP server map and allowed tool names from available services.
 */
export function buildMcpSetup(
  adapter: BaseAdapter,
  ctx: McpSetupContext,
): McpSetupResult {
  const mcpServers: McpSetupResult['mcpServers'] = {};
  const allowedTools: string[] = [];

  // File sending (always available — no optional service needed)
  const sendFileServer = createSendFileMcpServer(adapter, ctx.chatId);
  mcpServers['file-send'] = sendFileServer;
  allowedTools.push(...getSendFileToolNames());

  return { mcpServers, allowedTools };
}
