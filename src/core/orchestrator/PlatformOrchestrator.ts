/**
 * Starts and manages Discord adapters for loaded agents.
 */

import type {
  AdapterSecurityConfig,
  DiscordAdapterFactory,
  PlatformAdapter,
} from '../../types/platform.js';
import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import type { ScheduleManager } from '../../schedule/ScheduleManager.js';
import type { ConversationRequest } from '../../conversation/types.js';
import { AdapterRegistry } from './AdapterRegistry.js';
import { AgentLoader } from './AgentLoader.js';
import { SessionManager } from '../session/SessionManager.js';
import { MessageProcessor } from './MessageProcessor.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';

export interface RunningAdapterInfo {
  agentId: string;
  platform: 'discord';
  status: string;
  agentName: string;
}

export interface PlatformOrchestratorOptions {
  agentLoader: AgentLoader;
  sessionManager: SessionManager;
  messageProcessor: MessageProcessor;
  securityConfig?: AdapterSecurityConfig;
  scheduleManager?: ScheduleManager;
  sttProvider?: import('../stt/index.js').STTProvider;
  scheduleThreadMap?: import('../../schedule/ScheduleThreadMap.js').ScheduleThreadMap;
  sessionRepository?: import('../../persistence/types.js').ISessionRepository;
  createDiscordAdapter?: DiscordAdapterFactory;
}

export class PlatformOrchestrator {
  private readonly registry: AdapterRegistry = new AdapterRegistry();
  private readonly agentLoader: AgentLoader;
  private readonly sessionManager: SessionManager;
  private readonly messageProcessor: MessageProcessor;
  private readonly securityConfig: AdapterSecurityConfig | undefined;
  private readonly scheduleManager: ScheduleManager | undefined;
  private readonly scheduleThreadMap: import('../../schedule/ScheduleThreadMap.js').ScheduleThreadMap | undefined;
  private readonly sessionRepository: import('../../persistence/types.js').ISessionRepository | undefined;
  private readonly discordFactory: DiscordAdapterFactory | undefined;
  private readonly sttProvider: import('../stt/index.js').STTProvider | undefined;

  constructor(options: PlatformOrchestratorOptions) {
    this.agentLoader = options.agentLoader;
    this.sessionManager = options.sessionManager;
    this.messageProcessor = options.messageProcessor;
    this.securityConfig = options.securityConfig;
    this.scheduleManager = options.scheduleManager;
    this.scheduleThreadMap = options.scheduleThreadMap;
    this.sessionRepository = options.sessionRepository;
    this.discordFactory = options.createDiscordAdapter;
    this.sttProvider = options.sttProvider;
  }

  async startAll(): Promise<void> {
    const agentsWithDiscord = this.agentLoader
      .getAgentsWithPlatformTokens()
      .filter(({ discordBotToken, discordChannelId }) =>
        discordBotToken !== undefined && discordChannelId !== undefined
      );

    if (agentsWithDiscord.length === 0) {
      logger.warn(
        { event_type: EventType.ORCHESTRATOR_NO_ADAPTER },
        'No agents with Discord bot tokens found. No adapters will start.'
      );
      return;
    }

    logger.info(
      { event_type: EventType.ORCHESTRATOR_ADAPTER_START, count: agentsWithDiscord.length },
      'Starting Discord adapters for agents'
    );

    const results = await Promise.allSettled(
      agentsWithDiscord.map(({ agentId, discordBotToken, discordChannelId }) =>
        this.startDiscordAdapter(agentId, discordBotToken!, discordChannelId!)
      )
    );

    const failed = results.filter((r) => r.status === 'rejected');
    for (const result of failed) {
      if (result.status === 'rejected') {
        logger.error({ event_type: EventType.ORCHESTRATOR_ADAPTER_FAILED, err: result.reason }, 'Failed to start Discord adapter');
      }
    }

    logger.info(
      {
        event_type: EventType.ORCHESTRATOR_START_ALL_COMPLETE,
        running: results.length - failed.length,
        failed: failed.length,
      },
      'Discord adapter startup complete'
    );
  }

  async stopAll(): Promise<void> {
    logger.info({ event_type: EventType.ORCHESTRATOR_ADAPTER_STOP }, 'Stopping all Discord adapters');
    await this.registry.stopAll();
    await this.registry.disposeAll();
    logger.info({ event_type: EventType.ORCHESTRATOR_STOP_ALL_COMPLETE }, 'All Discord adapters stopped');
  }

  async reloadAgent(agentId: string): Promise<void> {
    logger.info({ event_type: EventType.ORCHESTRATOR_ADAPTER_START, agentId }, 'Reloading Discord adapter for agent');

    await this.stopBotForAgent(agentId);
    const agent = await this.agentLoader.reloadAgent(agentId);

    if (agent.config.discordBotToken !== undefined && agent.config.discordChannelId !== undefined) {
      await this.startDiscordAdapter(agentId, agent.config.discordBotToken, agent.config.discordChannelId);
    }

    logger.info({ event_type: EventType.ORCHESTRATOR_ADAPTER_START, agentId }, 'Agent Discord adapter reloaded');
  }

  getRunningAdapters(): RunningAdapterInfo[] {
    return this.registry.getAll().map((adapter) => {
      const agent = this.agentLoader.get(adapter.agentId);
      return {
        agentId: adapter.agentId,
        platform: 'discord',
        status: adapter.state,
        agentName: agent?.config.name ?? adapter.agentId,
      };
    });
  }

  getLoadedAgentIds(): string[] {
    return this.getRunningAdapters().map((a) => a.agentId);
  }

  async syncAgents(): Promise<{ added: string[]; removed: string[] }> {
    const diskIds = await this.agentLoader.scanAgents();
    const memoryIds = this.getLoadedAgentIds();

    const toAdd = diskIds.filter((id) => !memoryIds.includes(id));
    const toRemove = memoryIds.filter((id) => !diskIds.includes(id));

    for (const id of toAdd) {
      logger.info({ event_type: EventType.ORCHESTRATOR_ADAPTER_START, agentId: id }, '[Hot Add] Loading new agent');
      try {
        await this.startBotForAgent(id);
      } catch (error) {
        logger.error({ event_type: EventType.ORCHESTRATOR_ADAPTER_FAILED, agentId: id, err: error }, '[Hot Add] Failed to load agent');
      }
    }

    for (const id of toRemove) {
      logger.info({ event_type: EventType.ORCHESTRATOR_ADAPTER_STOP, agentId: id }, '[Hot Remove] Stopping agent');
      try {
        await this.stopBotForAgent(id);
      } catch (error) {
        logger.error({ event_type: EventType.ORCHESTRATOR_ADAPTER_FAILED, agentId: id, err: error }, '[Hot Remove] Failed to stop agent');
      }
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      logger.info(
        { event_type: EventType.ORCHESTRATOR_START_ALL_COMPLETE, added: toAdd, removed: toRemove },
        '[Sync] Agent sync completed'
      );
    }

    return { added: toAdd, removed: toRemove };
  }

  getRegistry(): AdapterRegistry {
    return this.registry;
  }

  getBotStatusForAgent(agentId: string): 'running' | 'stopped' | 'error' | 'no-token' {
    const agent = this.agentLoader.get(agentId);
    if (
      agent === undefined ||
      agent.config.discordBotToken === undefined ||
      agent.config.discordChannelId === undefined
    ) {
      return 'no-token';
    }

    const adapter = this.registry.get(agentId);
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

  async startBotForAgent(agentId: string): Promise<void> {
    const agent = this.agentLoader.get(agentId);
    if (agent === undefined) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    if (agent.config.discordBotToken === undefined || agent.config.discordChannelId === undefined) {
      throw new Error(`Agent "${agentId}" has no Discord bot token/channel configured`);
    }

    const existingAdapter = this.registry.get(agentId);
    if (existingAdapter !== undefined && existingAdapter.state === 'running') {
      logger.info({ event_type: EventType.ORCHESTRATOR_ADAPTER_START, agentId, platform: 'discord' }, 'Bot already running, skipping start');
      return;
    }

    if (existingAdapter !== undefined) {
      try {
        await existingAdapter.stop();
        await existingAdapter.dispose();
      } catch (error) {
        logger.warn({ event_type: EventType.ORCHESTRATOR_ADAPTER_FAILED, err: error, agentId, platform: 'discord' }, 'Error stopping existing adapter');
      }
      this.registry.unregister(agentId);
    }

    await this.startDiscordAdapter(agentId, agent.config.discordBotToken, agent.config.discordChannelId);
    logger.info({ event_type: EventType.ORCHESTRATOR_ADAPTER_START, agentId, platform: 'discord' }, 'Discord bot started for agent');
  }

  async stopBotForAgent(agentId: string): Promise<void> {
    const adapter = this.registry.get(agentId);
    if (adapter === undefined) {
      logger.info({ event_type: EventType.ORCHESTRATOR_ADAPTER_STOP, agentId, platform: 'discord' }, 'No running Discord bot found, skipping stop');
      return;
    }

    try {
      await adapter.stop();
      await adapter.dispose();
      this.registry.unregister(agentId);
      logger.info({ event_type: EventType.ORCHESTRATOR_ADAPTER_STOP, agentId, platform: 'discord' }, 'Discord bot stopped for agent');
    } catch (error) {
      logger.error({ event_type: EventType.ORCHESTRATOR_ADAPTER_FAILED, err: error, agentId, platform: 'discord' }, 'Error stopping Discord bot');
      throw error;
    }
  }

  private buildDiscordAdapter(config: Parameters<DiscordAdapterFactory>[0]): PlatformAdapter {
    if (!this.discordFactory) throw new Error('DiscordAdapterFactory not injected');
    return this.discordFactory(config);
  }

  private async startDiscordAdapter(
    agentId: string,
    token: string,
    channelId: string
  ): Promise<void> {
    logger.info({ event_type: EventType.ORCHESTRATOR_ADAPTER_START, agentId, channelId }, 'Starting Discord adapter');

    const adapter = this.buildDiscordAdapter({
      platform: 'discord',
      agentId,
      agentsDir: this.agentLoader.getAgentsDir(),
      token,
      channelId,
      ...(this.securityConfig !== undefined ? { securityConfig: this.securityConfig } : {}),
      ...(this.sttProvider !== undefined ? { sttProvider: this.sttProvider } : {}),
    });

    adapter.onMessage(async (message) => {
      const meta = message.metadata ?? {};
      const request: ConversationRequest = {
        source: 'discord_message',
        agentId,
        chatId: message.chatId,
        userId: message.userId,
        text: message.text,
        ...(typeof meta.sessionUserId === 'string' ? { sessionUserId: meta.sessionUserId } : {}),
        ...(typeof meta.parentConversationId === 'string' ? { parentConversationId: meta.parentConversationId } : {}),
        ...(typeof meta.taskId === 'string' ? { taskId: meta.taskId } : {}),
        ...(typeof meta.inheritedSdkSessionId === 'string' ? { inheritedSdkSessionId: meta.inheritedSdkSessionId } : {}),
        metadata: meta,
      };
      await this.messageProcessor.processConversationRequest(request);
    });

    const discordAdapter = adapter as PlatformAdapter & {
      setScheduleThreadResolver?: (resolver: (threadId: string) => { sdkSessionId: string; agentId: string } | undefined) => void;
    };

    if (discordAdapter.setScheduleThreadResolver) {
      const threadMap = this.scheduleThreadMap;
      const sessionRepo = this.sessionRepository;
      discordAdapter.setScheduleThreadResolver((threadId: string) => {
        // Fast path: in-memory cache
        if (threadMap) {
          const mapping = threadMap.get('discord', threadId);
          if (mapping) {
            return { sdkSessionId: mapping.sdkSessionId, agentId: mapping.agentId };
          }
        }
        // Slow path: DB lookup (survives restart)
        if (sessionRepo) {
          const row = sessionRepo.findByScheduleThread(threadId);
          if (row?.sdk_session_id) {
            return { sdkSessionId: row.sdk_session_id, agentId: row.agent_id };
          }
        }
        return undefined;
      });
    }

    await adapter.initialize();
    await adapter.start();
    this.registry.register(adapter as unknown as BaseAdapter);

    void this.scheduleManager?.syncSchedulesForAgent(agentId);

    logger.info({ event_type: EventType.ORCHESTRATOR_ADAPTER_START, agentId, channelId }, 'Discord adapter started');
  }
}
