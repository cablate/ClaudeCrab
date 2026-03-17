/**
 * PlatformOrchestrator — manages adapter lifecycle for all agents across all platforms.
 *
 * Scans loaded agents for platform-specific bot tokens and creates/manages
 * the appropriate adapters. Currently supports Telegram; designed for future
 * platform expansion (Slack, Discord, etc.).
 */

import { TelegramAdapter } from '../adapters/TelegramAdapter.js';
import { DiscordAdapter } from '../adapters/DiscordAdapter.js';
import type {
  TelegramAdapterConfig,
  DiscordAdapterConfig,
  AdapterSecurityConfig,
} from '../adapters/types.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import type { CommandDependencies } from '../adapters/commands/index.js';
import type { ScheduleManager } from '../schedule/ScheduleManager.js';
import type {
  IConversationRepository,
  IGroupMessageRepository,
  IInjectionStateRepository,
  IGroupMemberRepository,
  IQueryMetricsRepository,
} from '../persistence/types.js';
import { AdapterRegistry } from './AdapterRegistry.js';
import { AgentLoader } from './AgentLoader.js';
import { GroupBroadcaster } from './GroupBroadcaster.js';
import { LLMInitiativeEvaluator } from './InitiativeEvaluator.js';
import { LLMSocialEvaluator } from './SocialEvaluator.js';
import { SessionManager } from './SessionManager.js';
import { MessageProcessor } from './MessageProcessor.js';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Running adapter info (for WebUI / monitoring)
 */
export interface RunningAdapterInfo {
  agentId: string;
  platform: string;
  status: string;
  agentName: string;
}

/**
 * PlatformOrchestrator options
 */
export interface PlatformOrchestratorOptions {
  agentLoader: AgentLoader;
  sessionManager: SessionManager;
  messageProcessor: MessageProcessor;
  securityConfig?: AdapterSecurityConfig;
  scheduleManager?: ScheduleManager;
  /** Conversation repository (retained for non-group operations) */
  conversationRepository?: IConversationRepository;
  /** Group message repository for context injection (ADR-019) */
  groupMessageRepository?: IGroupMessageRepository;
  /** Injection state repository for context injection (ADR-019) */
  injectionStateRepository?: IInjectionStateRepository;
  /** Group member repository for persistent membership (ADR-020) */
  groupMemberRepository?: IGroupMemberRepository;
  /** Query metrics repository for recording usage (ADR-020/023) */
  queryMetricsRepository?: IQueryMetricsRepository;
  /** Optional GroupBroadcaster instance for dependency injection (testing) */
  groupBroadcaster?: GroupBroadcaster;
  /** v2.0: ActivityService for workflow visibility in delegation */
  activityService?: import('./ActivityService.js').ActivityService;
  /** Speech-to-text provider for voice message transcription */
  sttProvider?: import('./stt/index.js').STTProvider;
  /** Text-to-speech provider for voice message synthesis */
  ttsProvider?: import('./tts/index.js').TTSProvider;
}

/**
 * Orchestrates platform adapters for all agents.
 * Each agent with a platform bot token gets its own adapter instance.
 */
export class PlatformOrchestrator {
  private readonly registry: AdapterRegistry = new AdapterRegistry();
  private readonly agentLoader: AgentLoader;
  /** Cache soul.md content per agent to avoid repeated file reads */
  private readonly personalityCache = new Map<string, string | undefined>();
  private readonly sessionManager: SessionManager;
  private readonly messageProcessor: MessageProcessor;
  private readonly securityConfig: AdapterSecurityConfig | undefined;
  private readonly scheduleManager: ScheduleManager | undefined;
  private readonly groupBroadcaster: GroupBroadcaster;
  private readonly sttProvider: import('./stt/index.js').STTProvider | undefined;
  private readonly ttsProvider: import('./tts/index.js').TTSProvider | undefined;
  constructor(options: PlatformOrchestratorOptions) {
    this.agentLoader = options.agentLoader;
    this.sessionManager = options.sessionManager;
    this.messageProcessor = options.messageProcessor;
    this.securityConfig = options.securityConfig;
    this.scheduleManager = options.scheduleManager;
    this.sttProvider = options.sttProvider;
    this.ttsProvider = options.ttsProvider;

    // Initialize GroupBroadcaster for multi-bot group message handling (ADR-019)
    // Supports dependency injection for testing
    this.groupBroadcaster = options.groupBroadcaster ?? new GroupBroadcaster({
      messageProcessor: this.messageProcessor,
      getBotInfo: (agentId: string) => {
        // Get bot info from any registered adapter (platform-agnostic)
        for (const adapter of this.registry.getAll()) {
          if (adapter.agentId === agentId) {
            const info = adapter.getBotInfo();
            if (info !== null) return info;
          }
        }
        return null;
      },
      ...(options.groupMessageRepository !== undefined
        ? { groupMessageRepository: options.groupMessageRepository }
        : {}),
      ...(options.injectionStateRepository !== undefined
        ? { injectionStateRepository: options.injectionStateRepository }
        : {}),
      ...(options.groupMemberRepository !== undefined
        ? { groupMemberRepository: options.groupMemberRepository }
        : {}),
      // ADR-022: Provide delegation settings lookup from agent config
      getDelegationSettings: (agentId: string) => {
        const delegation = this.agentLoader.get(agentId)?.config.settings?.delegation;
        if (delegation === undefined) return undefined;
        const result: { inbound?: boolean; outbound?: boolean } = {};
        if (delegation.inbound !== undefined) result.inbound = delegation.inbound;
        if (delegation.outbound !== undefined) result.outbound = delegation.outbound;
        return result;
      },
      // ADR-023: Initiative settings and evaluator
      getInitiativeSettings: (agentId: string) => {
        return this.agentLoader.get(agentId)?.config.settings?.initiative;
      },
      getAgentDescription: (agentId: string) => {
        const agent = this.agentLoader.get(agentId);
        if (!agent) return undefined;
        // Read personality from soul.md (persona skill), fall back to agent.json description
        let personality: string | undefined;
        if (this.personalityCache.has(agentId)) {
          personality = this.personalityCache.get(agentId);
        } else {
          const personaDir = path.join(agent.path, '.claude', 'skills', 'persona', 'references');
          const soulPath = path.join(personaDir, 'soul.md');
          const identityPath = path.join(personaDir, 'identity.md');
          let combined = '';
          try { combined += readFileSync(identityPath, 'utf-8').trim() + '\n\n'; } catch { /* optional */ }
          try {
            combined += readFileSync(soulPath, 'utf-8').trim();
          } catch {
            if (!combined) { personality = agent.config.description; }
          }
          if (!personality) { personality = combined.trim() || agent.config.description; }
          this.personalityCache.set(agentId, personality);
        }
        return {
          name: agent.config.name,
          ...(personality !== undefined ? { description: personality } : {}),
        };
      },
      initiativeEvaluator: new LLMInitiativeEvaluator(),
      // ADR-030: Social settings and evaluator
      getSocialSettings: (agentId: string) => {
        return this.agentLoader.get(agentId)?.config.settings?.social;
      },
      socialEvaluator: new LLMSocialEvaluator(),
      ...(options.queryMetricsRepository !== undefined
        ? { queryMetricsRepository: options.queryMetricsRepository }
        : {}),
      // v2.0: Activity workflow visibility for delegation
      ...(options.activityService !== undefined
        ? { activityService: options.activityService }
        : {}),
      getAgentName: (agentId: string) => this.agentLoader.get(agentId)?.config.name ?? agentId,
    });
  }

  /**
   * Scan all agents and start adapters for those with platform tokens.
   * A single agent failing does NOT prevent other agents from starting.
   */
  async startAll(): Promise<void> {
    // Restore persistent group memberships (ADR-020)
    this.groupBroadcaster.restoreMemberships();

    const agentsWithTokens = this.agentLoader.getAgentsWithPlatformTokens();

    if (agentsWithTokens.length === 0) {
      logger.warn(
        'No agents with platform bot tokens found. No adapters will start.'
      );
      return;
    }

    logger.info(
      { count: agentsWithTokens.length },
      'Starting adapters for agents with platform tokens'
    );

    const results = await Promise.allSettled(
      agentsWithTokens.flatMap(
        ({ agentId, telegramBotToken, discordBotToken, discordChannelId }) => {
          const tasks: Promise<void>[] = [];
          if (telegramBotToken !== undefined) {
            tasks.push(this.startTelegramAdapter(agentId, telegramBotToken));
          }
          if (discordBotToken !== undefined && discordChannelId !== undefined) {
            tasks.push(this.startDiscordAdapter(agentId, discordBotToken, discordChannelId));
          }
          return tasks;
        }
      )
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      for (const result of failed) {
        if (result.status === 'rejected') {
          logger.error({ error: result.reason }, 'Failed to start adapter');
        }
      }
      logger.warn(
        { failedCount: failed.length, totalCount: results.length },
        'Some adapters failed to start'
      );
    }

    const succeeded = results.length - failed.length;
    logger.info(
      { running: succeeded, failed: failed.length },
      'Adapter startup complete'
    );
  }

  /**
   * Stop all running adapters gracefully.
   */
  async stopAll(): Promise<void> {
    logger.info('Stopping all platform adapters');
    await this.registry.stopAll();
    await this.registry.disposeAll();
    this.groupBroadcaster.dispose();
    logger.info('All platform adapters stopped');
  }

  /**
   * Reload adapters for a specific agent.
   * Stops existing adapters, reloads agent config, and starts new adapters.
   */
  async reloadAgent(agentId: string): Promise<void> {
    logger.info({ agentId }, 'Reloading adapters for agent');

    // Stop existing adapters for this agent
    const adapters = this.registry
      .getAll()
      .filter((a) => a.agentId === agentId);
    for (const adapter of adapters) {
      try {
        await adapter.stop();
        await adapter.dispose();
      } catch (error) {
        logger.error(
          { error, agentId, platform: adapter.platform },
          'Error stopping adapter'
        );
      }
      this.registry.unregister(adapter.platform, adapter.agentId);
    }

    // Reload agent config
    const agent = await this.agentLoader.reloadAgent(agentId);

    // Start new adapters
    if (agent.config.telegramBotToken !== undefined) {
      await this.startTelegramAdapter(agentId, agent.config.telegramBotToken);
    }
    if (agent.config.discordBotToken !== undefined && agent.config.discordChannelId !== undefined) {
      await this.startDiscordAdapter(agentId, agent.config.discordBotToken, agent.config.discordChannelId);
    }

    logger.info({ agentId }, 'Agent adapters reloaded');
  }

  /**
   * Get info about all running adapters (for WebUI/monitoring).
   */
  getRunningAdapters(): RunningAdapterInfo[] {
    return this.registry.getAll().map((adapter) => {
      const agent = this.agentLoader.get(adapter.agentId);
      return {
        agentId: adapter.agentId,
        platform: adapter.platform,
        status: adapter.state,
        agentName: agent?.config.name ?? adapter.agentId,
      };
    });
  }

  /**
   * Get unique agent IDs that are currently loaded and running
   */
  getLoadedAgentIds(): string[] {
    const adapters = this.getRunningAdapters();
    // Get unique agentIds (one agent may have multiple platform adapters)
    return [...new Set(adapters.map((a) => a.agentId))];
  }

  /**
   * Sync agents: load new agents and stop removed agents
   * Delta-based sync similar to ScheduleManager.syncSchedulesForAgent()
   */
  async syncAgents(): Promise<{ added: string[]; removed: string[] }> {
    const diskIds = await this.agentLoader.scanAgents();
    const memoryIds = this.getLoadedAgentIds();

    const toAdd = diskIds.filter((id) => !memoryIds.includes(id));
    const toRemove = memoryIds.filter((id) => !diskIds.includes(id));

    // Load new agents
    for (const id of toAdd) {
      logger.info({ agentId: id }, '[Hot Add] Loading new agent');
      try {
        await this.startBotForAgent(id);
      } catch (error) {
        logger.error(
          { agentId: id, error },
          '[Hot Add] Failed to load agent'
        );
      }
    }

    // Stop removed agents
    for (const id of toRemove) {
      logger.info({ agentId: id }, '[Hot Remove] Stopping agent');
      try {
        await this.stopBotForAgent(id);
      } catch (error) {
        logger.error(
          { agentId: id, error },
          '[Hot Remove] Failed to stop agent'
        );
      }
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      logger.info(
        { added: toAdd, removed: toRemove },
        '[Sync] Agent sync completed'
      );
    }

    return { added: toAdd, removed: toRemove };
  }

  /**
   * Get the adapter registry (for lookups by platform + agentId).
   */
  getRegistry(): AdapterRegistry {
    return this.registry;
  }

  /**
   * Get the bot status for a specific agent.
   * Returns 'running', 'stopped', 'error', or 'no-token' based on the adapter state.
   */
  getBotStatusForAgent(
    agentId: string,
    platform: 'telegram' | 'discord' = 'telegram'
  ): 'running' | 'stopped' | 'error' | 'no-token' {
    const agent = this.agentLoader.get(agentId);
    if (agent === undefined) return 'no-token';

    if (platform === 'telegram' && agent.config.telegramBotToken === undefined) {
      return 'no-token';
    }
    if (platform === 'discord' && (agent.config.discordBotToken === undefined || agent.config.discordChannelId === undefined)) {
      return 'no-token';
    }

    const adapter = this.registry.get(platform, agentId);
    if (adapter === undefined) {
      return 'stopped';
    }

    switch (adapter.state) {
      case 'running':
        return 'running';
      case 'error':
        return 'error';
      default:
        return 'stopped';
    }
  }

  /**
   * Start the bot for a specific agent.
   * Does nothing if the bot is already running or the agent has no token.
   */
  async startBotForAgent(agentId: string, platform: 'telegram' | 'discord' = 'telegram'): Promise<void> {
    const agent = this.agentLoader.get(agentId);
    if (agent === undefined) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    if (platform === 'telegram') {
      if (agent.config.telegramBotToken === undefined) {
        throw new Error(`Agent "${agentId}" has no Telegram bot token configured`);
      }
    } else if (platform === 'discord') {
      if (agent.config.discordBotToken === undefined || agent.config.discordChannelId === undefined) {
        throw new Error(`Agent "${agentId}" has no Discord bot token/channel configured`);
      }
    }

    // Check if already running
    const existingAdapter = this.registry.get(platform, agentId);
    if (existingAdapter !== undefined && existingAdapter.state === 'running') {
      logger.info({ agentId, platform }, 'Bot already running, skipping start');
      return;
    }

    // If adapter exists but not running, stop and remove it first
    if (existingAdapter !== undefined) {
      try {
        await existingAdapter.stop();
        await existingAdapter.dispose();
      } catch (error) {
        logger.warn({ error, agentId, platform }, 'Error stopping existing adapter');
      }
      this.registry.unregister(platform, agentId);
    }

    // Start new adapter
    if (platform === 'telegram') {
      await this.startTelegramAdapter(agentId, agent.config.telegramBotToken!);
    } else if (platform === 'discord') {
      await this.startDiscordAdapter(agentId, agent.config.discordBotToken!, agent.config.discordChannelId!);
    }
    logger.info({ agentId, platform }, 'Bot started for agent');
  }

  /**
   * Stop the bot for a specific agent.
   * Does nothing if the bot is not running.
   */
  async stopBotForAgent(agentId: string, platform: 'telegram' | 'discord' = 'telegram'): Promise<void> {
    const adapter = this.registry.get(platform, agentId);
    if (adapter === undefined) {
      logger.info({ agentId, platform }, 'No running bot found, skipping stop');
      return;
    }

    try {
      await adapter.stop();
      await adapter.dispose();
      this.registry.unregister(platform, agentId);
      logger.info({ agentId, platform }, 'Bot stopped for agent');
    } catch (error) {
      logger.error({ error, agentId, platform }, 'Error stopping bot');
      throw error;
    }
  }

  /**
   * Create and start a Telegram adapter for a specific agent.
   */
  private async startTelegramAdapter(
    agentId: string,
    token: string
  ): Promise<void> {
    logger.info({ agentId }, 'Starting Telegram adapter');

    const config: TelegramAdapterConfig = {
      platform: 'telegram',
      agentId,
      token,
      ...(this.securityConfig !== undefined
        ? { securityConfig: this.securityConfig }
        : {}),
      ...(this.sttProvider !== undefined
        ? { sttProvider: this.sttProvider }
        : {}),
      ...(this.ttsProvider !== undefined
        ? { ttsProvider: this.ttsProvider }
        : {}),
    };

    const adapter = new TelegramAdapter(config);

    // Set up command dependencies
    const commandDeps: CommandDependencies = {
      agentLoader: this.agentLoader,
      sessionManager: this.sessionManager,
      messageProcessor: this.messageProcessor,
      agentId,
      ...(this.scheduleManager !== undefined
        ? { scheduleManager: this.scheduleManager }
        : {}),
      ...(this.securityConfig !== undefined
        ? {
            securityConfig: {
              allowedUsers: this.securityConfig.allowedUsers,
              whitelistEnabled: this.securityConfig.whitelistEnabled,
            },
          }
        : {}),
      // ADR-024: Group command support
      getGroupBotMembers: (chatId: string) => {
        const memberAgentIds = this.groupBroadcaster.getGroupMembers(chatId);
        return memberAgentIds.map((id) => {
          const agent = this.agentLoader.get(id);
          // Platform-agnostic: search all adapters for bot info
          let botInfo: { username: string; id: number } | null = null;
          for (const adapter of this.registry.getAll()) {
            if (adapter.agentId === id) {
              botInfo = adapter.getBotInfo();
              if (botInfo !== null) break;
            }
          }
          const result: {
            agentId: string;
            name: string;
            username?: string;
            description?: string;
          } = {
            agentId: id,
            name: agent?.config.name ?? id,
          };
          if (botInfo?.username !== undefined) {
            result.username = botInfo.username;
          }
          if (agent?.config.description !== undefined) {
            result.description = agent.config.description;
          }
          return result;
        });
      },
      getBotStatus: (aid: string) => this.getBotStatusForAgent(aid),
      syncAgents: () => this.syncAgents(),
    };
    adapter.setCommandDependencies(commandDeps);

    // Register message handler — passes agentId to MessageProcessor
    adapter.onMessage(async (message) => {
      await this.messageProcessor.processMessage(message, agentId);
    });

    // Initialize and start
    await adapter.initialize();
    await adapter.start();

    // Register in adapter registry
    this.registry.register(adapter);

    logger.info({ agentId }, 'Telegram adapter started');
  }

  /**
   * Start a Discord adapter for a specific agent (each agent has its own bot)
   */
  private async startDiscordAdapter(
    agentId: string,
    token: string,
    channelId: string
  ): Promise<void> {
    logger.info({ agentId, channelId }, 'Starting Discord adapter');

    const config: DiscordAdapterConfig = {
      platform: 'discord',
      agentId,
      token,
      channelId,
      ...(this.securityConfig !== undefined
        ? { securityConfig: this.securityConfig }
        : {}),
    };

    const adapter = new DiscordAdapter(config);

    // Register message handler — passes agentId to MessageProcessor
    adapter.onMessage(async (message) => {
      await this.messageProcessor.processMessage(message, agentId);
    });

    // Initialize and start
    await adapter.initialize();
    await adapter.start();

    // Register in adapter registry
    this.registry.register(adapter);

    logger.info({ agentId, channelId }, 'Discord adapter started');
  }
}
