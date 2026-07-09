import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentConfig, McpServerConfig } from '../../types/agent.js';
import { logger } from '../../utils/logger.js';

const MCP_CONFIG_FILE = '.mcp.json';

export async function loadAgentMcpConfig(
  agentPath: string,
  config: AgentConfig
): Promise<Record<string, McpServerConfig> | undefined> {
  const mcpConfigPath = resolveMcpConfigPath(agentPath, config);

  try {
    await fs.access(mcpConfigPath);
  } catch {
    logger.debug({ agentPath }, 'No MCP config file found');
    return undefined;
  }

  try {
    const content = await fs.readFile(mcpConfigPath, 'utf-8');
    const data = JSON.parse(content) as Record<string, unknown>;
    const serversData =
      (data['mcpServers'] as Record<string, unknown> | undefined) ?? data;
    const mcpServers = parseMcpServers(serversData);

    if (Object.keys(mcpServers).length === 0) {
      return undefined;
    }

    logger.info(
      { serverCount: Object.keys(mcpServers).length },
      'MCP config loaded'
    );

    return mcpServers;
  } catch (error) {
    if (error instanceof SyntaxError) {
      logger.error({ mcpConfigPath, error }, 'Invalid JSON in MCP config');
    } else {
      logger.error({ mcpConfigPath, error }, 'Failed to load MCP config');
    }
    return undefined;
  }
}

function resolveMcpConfigPath(agentPath: string, config: AgentConfig): string {
  if (config.mcpConfigFile === undefined) {
    return path.join(agentPath, MCP_CONFIG_FILE);
  }

  return path.isAbsolute(config.mcpConfigFile)
    ? config.mcpConfigFile
    : path.join(agentPath, config.mcpConfigFile);
}

function parseMcpServers(serversData: Record<string, unknown>): Record<string, McpServerConfig> {
  const mcpServers: Record<string, McpServerConfig> = {};

  for (const [serverName, serverConfig] of Object.entries(serversData)) {
    if (serverName === 'mcpServers') continue;

    if (typeof serverConfig !== 'object' || serverConfig === null) {
      logger.warn(
        { serverName },
        'Invalid MCP server config, skipping'
      );
      continue;
    }

    const cfg = serverConfig as Record<string, unknown>;
    mcpServers[serverName] = {
      ...(typeof cfg['command'] === 'string'
        ? { command: cfg['command'] }
        : {}),
      ...(Array.isArray(cfg['args'])
        ? { args: cfg['args'] as string[] }
        : {}),
      ...(typeof cfg['env'] === 'object' && cfg['env'] !== null
        ? { env: cfg['env'] as Record<string, string> }
        : {}),
      ...(typeof cfg['url'] === 'string' ? { url: cfg['url'] } : {}),
      ...(cfg['transport'] === 'stdio' ||
      cfg['transport'] === 'sse' ||
      cfg['transport'] === 'http'
        ? { transport: cfg['transport'] }
        : {}),
    };
  }

  return mcpServers;
}
