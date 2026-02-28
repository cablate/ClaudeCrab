/**
 * McpToolSetup — builds MCP server instances and the matching allowedTools
 * list for an SDK query.
 *
 * Extracted from MessageProcessor to isolate pure MCP-config logic.
 */

import {
  createAgentCallMcpServer,
  getAgentCallToolNames,
} from '../tools/notifyAgentTool.js';
import {
  createTTSMcpServer,
  getTTSToolNames,
} from '../tools/ttsTool.js';
import {
  createSendFileMcpServer,
  getSendFileToolNames,
} from '../tools/sendFileTool.js';
import type { AgentCallService } from '../services/AgentCallService.js';
import type { TTSService } from '../services/TTSService.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';

export interface McpSetupContext {
  agentId: string;
  chatId: string;
}

export interface McpSetupResult {
  mcpServers: Record<string, ReturnType<typeof createAgentCallMcpServer>>;
  allowedTools: string[];
}

/**
 * Build MCP server map and allowed tool names from available services.
 */
export function buildMcpSetup(
  agentCallService: AgentCallService | undefined,
  ttsService: TTSService | undefined,
  adapter: BaseAdapter,
  ctx: McpSetupContext,
): McpSetupResult {
  const mcpServers: Record<string, ReturnType<typeof createAgentCallMcpServer>> = {};
  const allowedTools: string[] = [];

  if (agentCallService) {
    const server = createAgentCallMcpServer(agentCallService, ctx);
    mcpServers['agent-call'] = server;
    allowedTools.push(...getAgentCallToolNames());
  }

  if (ttsService) {
    const server = createTTSMcpServer(ttsService, ctx);
    mcpServers['tts'] = server;
    allowedTools.push(...getTTSToolNames());
  }

  // File sending (always available — no optional service needed)
  const sendFileServer = createSendFileMcpServer(adapter, ctx.chatId);
  mcpServers['file-send'] = sendFileServer;
  allowedTools.push(...getSendFileToolNames());

  return { mcpServers, allowedTools };
}
