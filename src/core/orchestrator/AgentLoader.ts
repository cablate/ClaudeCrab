import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import {
  AgentConfigSchema,
  type AgentConfig,
  type LoadedAgent,
  type IAgentRepository,
} from '../../types/agent.js';
import { AgentLoadError, AgentConfigError } from '../../types/errors.js';
import { logger } from '../../utils/logger.js';
import { loadAgentHooks } from './AgentHooksLoader.js';
import { loadAgentMcpConfig } from './AgentMcpConfigLoader.js';

/**
 * Default agent configuration file name
 */
const AGENT_CONFIG_FILE = 'agent.json';

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
    // System directories to skip.
    const SKIP_DIRS = new Set(['node_modules', '.git']);

    try {
      const entries = await fs.readdir(this.agentsDir, { withFileTypes: true });
      const agentIds: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Skip system directories
          if (SKIP_DIRS.has(entry.name)) {
            logger.debug(
              { dir: entry.name },
              'Skipping system directory'
            );
            continue;
          }

          // Skip directories starting with underscore (disabled agents)
          if (entry.name.startsWith('_')) {
            logger.debug(
              { dir: entry.name },
              'Skipping disabled agent directory (starts with _)'
            );
            continue;
          }

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

      // Validate agent setup
      this.validateAgentSetup(agentPath, agentId, config);

      // Keep SDK systemPrompt append empty. Claude Code reads CLAUDE.md via project settings.
      const systemPrompt = await this.loadSystemPrompt(agentPath, config);

      // Load hooks (optional)
      const hooks = await loadAgentHooks(agentPath, agentId);

      // Load MCP servers (optional)
      const mcpServers = await loadAgentMcpConfig(agentPath, config);

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
   * Validate agent setup and warn about common issues.
   */
  private validateAgentSetup(
    agentPath: string,
    agentId: string,
    config: AgentConfig
  ): void {
    // Check CLAUDE.md exists (not fatal, but important for agent behavior)
    const claudeMdPath = path.join(agentPath, 'CLAUDE.md');
    try {
      fsSync.accessSync(claudeMdPath);
    } catch {
      logger.warn(
        { agentId },
        'Agent has no CLAUDE.md; the agent will run without project instructions. ' +
        'Create CLAUDE.md to define agent behavior.'
      );
    }

    // Check name is meaningful (not empty or placeholder)
    if (!config.name || config.name.trim() === '') {
      throw new AgentConfigError(agentId, [
        'name is empty. Please set a display name in agent.json.'
      ]);
    }

    // Warn about missing Discord config.
    if (!config.discordBotToken || !config.discordChannelId) {
      logger.debug(
        { agentId },
        'No Discord bot token/channel configured - agent will not connect to Discord.'
      );
    }
  }

  private loadSystemPrompt(
    _agentPath: string,
    _config: AgentConfig
  ): string {
    // CLAUDE.md is not read here; the SDK project memory loader handles it
    // automatically via settingSources: ['project']. Manual reading would
    // duplicate the content AND add the file to readFileState, triggering
    // diff injection in system-reminder on every turn.
    return '';
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
   * Reload a specific agent (clear cache and reload)
   */
  async reloadAgent(agentId: string): Promise<LoadedAgent> {
    this.clearCache(agentId);
    const agent = await this.loadAgent(agentId);
    return agent;
  }

  /**
   * Preserve the getSystemPrompt callback contract without duplicating CLAUDE.md.
   * Claude Code loads project instructions directly from the agent cwd.
   */
  readSystemPrompt(agentId: string): string {
    const agent = this.cache.get(agentId);
    if (agent === undefined) {
      throw new AgentLoadError(agentId, new Error('Agent not loaded'));
    }
    return this.loadSystemPrompt(agent.path, agent.config);
  }

  /**
   * Get agent path by ID
   */
  getAgentPath(agentId: string): string {
    return path.join(this.agentsDir, agentId);
  }

  /**
   * Get all loaded agents that have Discord bot tokens configured.
   * Validates that no two agents share the same Discord token.
   */
  getAgentsWithPlatformTokens(): Array<{
    agentId: string;
    agent: LoadedAgent;
    discordBotToken?: string;
    discordChannelId?: string;
  }> {
    const results: Array<{
      agentId: string;
      agent: LoadedAgent;
      discordBotToken?: string;
      discordChannelId?: string;
    }> = [];

    const seenDiscordTokens = new Map<string, string>(); // token -> agentId
    const seenDiscordChannels = new Map<string, string>(); // channelId -> agentId

    for (const [agentId, agent] of this.cache) {
      const discordBotToken = agent.config.discordBotToken;
      const discordChannelId = agent.config.discordChannelId;

      if (discordBotToken === undefined) {
        continue;
      }

      // Validate Discord config
      if (discordBotToken !== undefined) {
        // Duplicate token check
        const existingAgent = seenDiscordTokens.get(discordBotToken);
        if (existingAgent !== undefined) {
          throw new AgentConfigError(agentId, [
            `Duplicate Discord bot token: already used by agent "${existingAgent}"`,
          ]);
        }
        seenDiscordTokens.set(discordBotToken, agentId);

        // channelId is required when discordBotToken is set
        if (discordChannelId === undefined) {
          throw new AgentConfigError(agentId, [
            'discordChannelId is required when discordBotToken is configured',
          ]);
        }

        // Duplicate channel check
        const existingChannelAgent = seenDiscordChannels.get(discordChannelId);
        if (existingChannelAgent !== undefined) {
          throw new AgentConfigError(agentId, [
            `Duplicate Discord channel ID: already used by agent "${existingChannelAgent}"`,
          ]);
        }
        seenDiscordChannels.set(discordChannelId, agentId);
      }

      results.push({
        agentId,
        agent,
        ...(discordBotToken !== undefined ? { discordBotToken } : {}),
        ...(discordChannelId !== undefined ? { discordChannelId } : {}),
      });
    }

    return results;
  }
}
