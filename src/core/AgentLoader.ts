import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AgentConfigSchema,
  type AgentConfig,
  type LoadedAgent,
  type IAgentRepository,
  type McpServerConfig,
} from '../types/agent.js';
import { type AgentHooks, HOOK_EVENT_NAMES } from '../types/hooks.js';
import { AgentLoadError, AgentConfigError } from '../types/errors.js';
import { logger } from '../utils/logger.js';
import { getEventBus } from './EventBus.js';

/**
 * Default agent configuration file name
 */
const AGENT_CONFIG_FILE = 'agent.json';

/**
 * Default system prompt file name
 * Uses CLAUDE.md to align with Claude Code conventions
 */
const DEFAULT_SYSTEM_PROMPT_FILE = 'CLAUDE.md';

/**
 * Default hooks file name
 */
const HOOKS_FILE = 'hooks.ts';

/**
 * Compiled hooks file name (for production)
 */
const HOOKS_FILE_JS = 'hooks.js';

/**
 * MCP config file name
 */
const MCP_CONFIG_FILE = 'mcp.json';

/**
 * AgentLoader options
 */
export interface AgentLoaderOptions {
  /** Base directory for agents (default: ./agents) */
  agentsDir?: string;
}

/**
 * Loads and manages agent configurations from the filesystem
 */
export class AgentLoader implements IAgentRepository {
  private readonly agentsDir: string;
  private readonly cache: Map<string, LoadedAgent> = new Map();

  constructor(options: AgentLoaderOptions = {}) {
    this.agentsDir = options.agentsDir ?? path.resolve(process.cwd(), 'agents');
  }

  /**
   * Get the agents directory path
   */
  getAgentsDir(): string {
    return this.agentsDir;
  }

  /**
   * Scan the agents directory and return all agent IDs
   */
  async scanAgents(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.agentsDir, { withFileTypes: true });
      const agentIds: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Check if directory contains agent.json
          const configPath = path.join(
            this.agentsDir,
            entry.name,
            AGENT_CONFIG_FILE
          );
          try {
            await fs.access(configPath);
            agentIds.push(entry.name);
          } catch {
            // No agent.json, skip this directory
            logger.debug(
              { dir: entry.name },
              'Skipping directory without agent.json'
            );
          }
        }
      }

      logger.info({ count: agentIds.length }, 'Agents scanned');
      return agentIds;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        logger.warn({ dir: this.agentsDir }, 'Agents directory does not exist');
        return [];
      }
      throw error;
    }
  }

  /**
   * Load a single agent by ID
   * @param agentId The agent directory name
   */
  async loadAgent(agentId: string): Promise<LoadedAgent> {
    const agentPath = path.join(this.agentsDir, agentId);

    try {
      // Check if agent directory exists
      const stat = await fs.stat(agentPath);
      if (!stat.isDirectory()) {
        throw new Error(`${agentId} is not a directory`);
      }

      // Load and parse agent.json
      const config = await this.loadConfig(agentPath, agentId);

      // Load system prompt
      const systemPrompt = await this.loadSystemPrompt(agentPath, config);

      // Load hooks (optional)
      const hooks = await this.loadHooks(agentPath, agentId);

      // Load MCP servers (optional)
      const mcpServers = await this.loadMcpConfig(agentPath, config);

      const loadedAgent: LoadedAgent = {
        id: agentId,
        path: agentPath,
        config,
        systemPrompt,
        ...(hooks !== undefined ? { hooks } : {}),
        ...(mcpServers !== undefined ? { mcpServers } : {}),
      };

      // Cache the loaded agent
      this.cache.set(agentId, loadedAgent);

      logger.info({ agentId, name: config.name }, 'Agent loaded');

      // Emit event
      getEventBus().emitSync('agent:loaded', loadedAgent);

      return loadedAgent;
    } catch (error) {
      if (error instanceof AgentLoadError || error instanceof AgentConfigError) {
        throw error;
      }
      throw new AgentLoadError(
        agentId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }


  /**
   * Load and validate agent.json
   */
  private async loadConfig(
    agentPath: string,
    agentId: string
  ): Promise<AgentConfig> {
    const configPath = path.join(agentPath, AGENT_CONFIG_FILE);

    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const data: unknown = JSON.parse(content);

      const result = AgentConfigSchema.safeParse(data);
      if (!result.success) {
        const errors = result.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`
        );
        throw new AgentConfigError(agentId, errors);
      }

      return result.data;
    } catch (error) {
      if (error instanceof AgentConfigError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new AgentConfigError(agentId, [`Invalid JSON: ${error.message}`]);
      }
      throw new AgentLoadError(
        agentId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Load system prompt from file or config
   */
  private async loadSystemPrompt(
    agentPath: string,
    config: AgentConfig
  ): Promise<string> {
    // Priority 1: systemPrompt directly in config
    if (config.systemPrompt !== undefined) {
      return config.systemPrompt;
    }

    // Priority 2: systemPromptFile specified in config
    if (config.systemPromptFile !== undefined) {
      const promptPath = path.isAbsolute(config.systemPromptFile)
        ? config.systemPromptFile
        : path.join(agentPath, config.systemPromptFile);
      return this.readSystemPromptFile(promptPath);
    }

    // Priority 3: Default system-prompt.md file
    const defaultPath = path.join(agentPath, DEFAULT_SYSTEM_PROMPT_FILE);
    try {
      return await this.readSystemPromptFile(defaultPath);
    } catch {
      // No system prompt file, return empty string
      logger.debug({ agentPath }, 'No system prompt found, using empty string');
      return '';
    }
  }

  /**
   * Read system prompt file content
   */
  private async readSystemPromptFile(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content.trim();
    } catch (error) {
      throw new Error(
        `Failed to read system prompt file: ${filePath} - ${(error as Error).message}`
      );
    }
  }

  /**
   * Load hooks from hooks.ts or hooks.js
   * Uses pathToFileURL for Windows compatibility
   */
  private async loadHooks(
    agentPath: string,
    agentId: string
  ): Promise<AgentHooks | undefined> {
    // Try .js first (compiled), then .ts (with tsx)
    const jsPath = path.join(agentPath, HOOKS_FILE_JS);
    const tsPath = path.join(agentPath, HOOKS_FILE);

    let hooksPath: string | undefined;

    try {
      await fs.access(jsPath);
      hooksPath = jsPath;
    } catch {
      try {
        await fs.access(tsPath);
        hooksPath = tsPath;
      } catch {
        // No hooks file found, which is fine
        logger.debug({ agentId }, 'No hooks file found');
        return undefined;
      }
    }

    try {
      // Use pathToFileURL for Windows compatibility
      const fileUrl = pathToFileURL(hooksPath).href;

      // Add cache busting for hot reload support
      const urlWithCacheBust = `${fileUrl}?t=${Date.now()}`;

      const module = (await import(urlWithCacheBust)) as Record<string, unknown>;

      // Validate and extract hooks
      const hooks = this.validateHooksExport(module, agentId);

      logger.info(
        { agentId, hookCount: Object.keys(hooks).length },
        'Hooks loaded'
      );

      return hooks;
    } catch (error) {
      throw new AgentLoadError(
        agentId,
        new Error(
          `Failed to load hooks: ${(error as Error).message}`
        )
      );
    }
  }

  /**
   * Validate hooks module export
   */
  private validateHooksExport(
    module: Record<string, unknown>,
    agentId: string
  ): AgentHooks {
    const hooks: AgentHooks = {};
    const validHookNames = new Set<string>(HOOK_EVENT_NAMES);

    for (const [key, value] of Object.entries(module)) {
      // Skip default export if it's not a function
      if (key === 'default') {
        if (typeof value === 'object' && value !== null) {
          // Handle default export as an object containing hooks
          return this.validateHooksExport(
            value as Record<string, unknown>,
            agentId
          );
        }
        continue;
      }

      // Check if this is a valid hook name
      if (validHookNames.has(key)) {
        if (typeof value !== 'function') {
          throw new AgentConfigError(agentId, [
            `Hook "${key}" must be a function, got ${typeof value}`,
          ]);
        }
        // Use Object.assign to avoid exactOptionalPropertyTypes issues
        Object.assign(hooks, { [key]: value });
      } else {
        logger.warn(
          { agentId, hookName: key },
          'Unknown hook name in hooks file, ignoring'
        );
      }
    }

    return hooks;
  }

  /**
   * Load MCP server configuration
   * Supports both mcpConfigFile in agent.json and default mcp.json
   */
  private async loadMcpConfig(
    agentPath: string,
    config: AgentConfig
  ): Promise<Record<string, McpServerConfig> | undefined> {
    // Determine MCP config file path
    let mcpConfigPath: string;

    if (config.mcpConfigFile !== undefined) {
      mcpConfigPath = path.isAbsolute(config.mcpConfigFile)
        ? config.mcpConfigFile
        : path.join(agentPath, config.mcpConfigFile);
    } else {
      mcpConfigPath = path.join(agentPath, MCP_CONFIG_FILE);
    }

    // Check if file exists
    try {
      await fs.access(mcpConfigPath);
    } catch {
      logger.debug({ agentPath }, 'No MCP config file found');
      return undefined;
    }

    try {
      const content = await fs.readFile(mcpConfigPath, 'utf-8');
      const data = JSON.parse(content) as Record<string, unknown>;

      // Validate and transform MCP config
      // The MCP config can have a 'mcpServers' key or be the servers directly
      const serversData =
        (data['mcpServers'] as Record<string, unknown> | undefined) ?? data;

      const mcpServers: Record<string, McpServerConfig> = {};

      for (const [serverName, serverConfig] of Object.entries(serversData)) {
        if (serverName === 'mcpServers') continue; // Skip if we already extracted

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

  /**
   * Load all agents from the agents directory
   */
  async loadAllAgents(): Promise<LoadedAgent[]> {
    const agentIds = await this.scanAgents();
    const agents: LoadedAgent[] = [];
    const errors: Array<{ agentId: string; error: Error }> = [];

    for (const agentId of agentIds) {
      try {
        const agent = await this.loadAgent(agentId);
        agents.push(agent);
      } catch (error) {
        errors.push({
          agentId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        logger.error({ agentId, error }, 'Failed to load agent');
      }
    }

    if (errors.length > 0) {
      logger.warn(
        { failedCount: errors.length, totalCount: agentIds.length },
        'Some agents failed to load'
      );
    }

    return agents;
  }

  /**
   * Get a loaded agent from cache
   * @param agentId Agent ID
   */
  get(agentId: string): LoadedAgent | undefined {
    return this.cache.get(agentId);
  }

  /**
   * List all cached agent IDs
   */
  list(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Check if an agent is cached
   */
  has(agentId: string): boolean {
    return this.cache.has(agentId);
  }

  /**
   * Clear cache for a specific agent
   */
  clearCache(agentId: string): void {
    this.cache.delete(agentId);
    logger.debug({ agentId }, 'Agent cache cleared');
  }

  /**
   * Clear all cached agents
   */
  clearAllCache(): void {
    this.cache.clear();
    logger.debug('All agent caches cleared');
  }

  /**
   * Reload a specific agent (clear cache and reload)
   */
  async reloadAgent(agentId: string): Promise<LoadedAgent> {
    this.clearCache(agentId);
    const agent = await this.loadAgent(agentId);
    getEventBus().emitSync('agent:reloaded', agent);
    return agent;
  }

  /**
   * Get agent path by ID
   */
  getAgentPath(agentId: string): string {
    return path.join(this.agentsDir, agentId);
  }

  /**
   * Get all loaded agents that have platform bot tokens configured.
   * Returns a map of agentId → { telegramBotToken, ... }
   * Validates that no two agents share the same token on the same platform.
   */
  getAgentsWithPlatformTokens(): Array<{
    agentId: string;
    agent: LoadedAgent;
    telegramBotToken?: string;
  }> {
    const results: Array<{
      agentId: string;
      agent: LoadedAgent;
      telegramBotToken?: string;
    }> = [];

    const seenTelegramTokens = new Map<string, string>(); // token → agentId

    for (const [agentId, agent] of this.cache) {
      const telegramBotToken = agent.config.telegramBotToken;

      // Skip agents without any platform tokens
      if (telegramBotToken === undefined) {
        continue;
      }

      // Validate no duplicate Telegram tokens
      if (telegramBotToken !== undefined) {
        const existingAgent = seenTelegramTokens.get(telegramBotToken);
        if (existingAgent !== undefined) {
          throw new AgentConfigError(agentId, [
            `Duplicate Telegram bot token: already used by agent "${existingAgent}"`,
          ]);
        }
        seenTelegramTokens.set(telegramBotToken, agentId);
      }

      results.push({ agentId, agent, telegramBotToken });
    }

    return results;
  }
}
