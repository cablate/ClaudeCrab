/**
 * PlatformOrchestrator — manages adapter lifecycle for all agents across all platforms.
 *
 * Scans loaded agents for platform-specific bot tokens and creates/manages
 * the appropriate adapters. Currently supports Telegram; designed for future
 * platform expansion (Slack, Discord, etc.).
 */

import { TelegramAdapter } from '../adapters/TelegramAdapter.js';
import type {
  TelegramAdapterConfig,
  AdapterSecurityConfig,
} from '../adapters/types.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import type { CommandDependencies } from '../adapters/commands/index.js';
import type { ScheduleManager } from '../schedule/ScheduleManager.js';
import { AdapterRegistry } from './AdapterRegistry.js';
import { AgentLoader } from './AgentLoader.js';
import { GroupBroadcaster } from './GroupBroadcaster.js';
import { SessionManager } from './SessionManager.js';
import { MessageProcessor } from './MessageProcessor.js';
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
}

/**
 * Orchestrates platform adapters for all agents.
 * Each agent with a platform bot token gets its own adapter instance.
 */
export class PlatformOrchestrator {
  private readonly registry: AdapterRegistry = new AdapterRegistry();
  private readonly agentLoader: AgentLoader;
  private readonly sessionManager: SessionManager;
  private readonly messageProcessor: MessageProcessor;
  private readonly securityConfig: AdapterSecurityConfig | undefined;
  private readonly scheduleManager: ScheduleManager | undefined;
  private readonly groupBroadcaster: GroupBroadcaster;

  constructor(options: PlatformOrchestratorOptions) {
    this.agentLoader = options.agentLoader;
    this.sessionManager = options.sessionManager;
    this.messageProcessor = options.messageProcessor;
    this.securityConfig = options.securityConfig;
    this.scheduleManager = options.scheduleManager;

    // Initialize GroupBroadcaster for multi-bot group message handling
    this.groupBroadcaster = new GroupBroadcaster({
      messageProcessor: this.messageProcessor,
      getBotInfo: (agentId: string) => {
        // Get adapter from registry and retrieve bot info
        const adapter = this.registry.get('telegram', agentId);
        if (adapter !== undefined && adapter instanceof TelegramAdapter) {
          return adapter.getBotInfo();
        }
        return null;
      },
    });
  }

  /**
   * Scan all agents and start adapters for those with platform tokens.
   * A single agent failing does NOT prevent other agents from starting.
   */
  async startAll(): Promise<void> {
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
      agentsWithTokens.map(async ({ agentId, agent, telegramBotToken }) => {
        if (telegramBotToken !== undefined) {
          await this.startTelegramAdapter(agentId, telegramBotToken);
        }
        // Future: if (slackBotToken) await this.startSlackAdapter(...)
      })
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      for (const result of failed) {
        if (result.status === 'rejected') {
          logger.error({ error: result.reason }, 'Failed to start adapter');
        }
      }
      logger.warn(
        { failedCount: failed.length, totalCount: agentsWithTokens.length },
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
   * Get the adapter registry (for lookups by platform + agentId).
   */
  getRegistry(): AdapterRegistry {
    return this.registry;
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
}
