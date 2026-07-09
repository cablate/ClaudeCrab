/**
 * Application bootstrap: dependency wiring and lifecycle management.
 */

import { hostname } from 'node:os';
import { logger, INSTANCE_ID, INSTANCE_STARTED_AT } from './utils/logger.js';
import { AgentLoader } from './core/orchestrator/AgentLoader.js';
import { SessionManager } from './core/session/SessionManager.js';
import { MessageProcessor } from './core/orchestrator/MessageProcessor.js';
import { PlatformOrchestrator } from './core/orchestrator/PlatformOrchestrator.js';
import { loadSecurityConfig } from './utils/security.js';
import { auditLogger } from './utils/audit.js';
import { DatabaseManager } from './persistence/DatabaseManager.js';
import { SessionRepository } from './persistence/SessionRepository.js';
import { ConversationRepository } from './persistence/ConversationRepository.js';
import { QueryMetricsRepository } from './persistence/QueryMetricsRepository.js';
import { RateLimitRepository } from './persistence/RateLimitRepository.js';
import { ScheduleThreadMap } from './schedule/ScheduleThreadMap.js';
import type { ScheduleManager } from './schedule/ScheduleManager.js';
import type { ScheduleExecutor } from './schedule/ScheduleExecutor.js';
import { initializeScheduleSystem } from './schedule/ScheduleBootstrap.js';
import type { AppConfig } from './config.js';
import { createSTTProvider, type STTProvider } from './core/stt/index.js';
import { DiscordAdapter } from './adapters/DiscordAdapter.js';
import { initializeDiscordServices, notifyCrashRecovery } from './adapters/discord/DiscordBootstrap.js';
import type { DiscordOpsServices } from './adapters/discord/services/DiscordOpsServices.js';
import { configureAgentPaths } from './core/agentPaths.js';
import { AdminServer } from './admin/AdminServer.js';

const TYPING_INDICATOR_INTERVAL_MS = 5000;

export class AppBootstrap {
  private readonly config: AppConfig;

  private orchestrator: PlatformOrchestrator | null = null;
  private sessionManager: SessionManager | null = null;
  private messageProcessor: MessageProcessor | null = null;
  private databaseManager: DatabaseManager | null = null;
  private scheduleManager: ScheduleManager | null = null;
  private discordOpsServices: DiscordOpsServices | null = null;
  private discordSystemAdapter: DiscordAdapter | null = null;
  private scheduleExecutor: ScheduleExecutor | null = null;
  private scheduleThreadMap: ScheduleThreadMap | null = null;
  private adminServer: AdminServer | null = null;

  constructor(config: AppConfig) {
    this.config = config;
    configureAgentPaths(config.agentsDir);
  }

  async start(): Promise<void> {
    logger.info(
      {
        event_type: 'lifecycle.startup_banner',
        instance_id: INSTANCE_ID,
        pid: process.pid,
        hostname: hostname(),
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
        env: process.env['NODE_ENV'] ?? 'development',
        log_level: process.env['LOG_LEVEL'] ?? 'info',
        app_version: '1.2.0',
        cwd: process.cwd(),
      },
      `ClaudeCab starting - instance ${INSTANCE_ID}`
    );

    const securityConfig = loadSecurityConfig(this.config.security);
    auditLogger.configure(this.config.audit?.enabled ?? true);

    const agentLoader = await this.initializeAgents();
    const persistence = this.initializePersistence();
    const sessionManager = this.initializeSessionManager(agentLoader, persistence);

    if (persistence?.sessionRepository !== undefined) {
      const restoredSessions = await sessionManager.restoreSessions();
      logger.info({ restoredSessions }, 'Session restoration complete');
    }

    const sttProvider = this.config.stt.enabled && this.config.stt.apiKey
      ? createSTTProvider(this.config.stt)
      : undefined;

    const messageProcessor = this.createMessageProcessor(
      sessionManager,
      agentLoader,
      persistence?.conversationRepository,
      persistence?.queryMetricsRepository,
      persistence?.rateLimitRepository,
    );
    this.messageProcessor = messageProcessor;

    if (this.config.schedule.enabled) {
      this.scheduleThreadMap = new ScheduleThreadMap();
    }

    this.orchestrator = this.createOrchestrator(
      agentLoader,
      sessionManager,
      messageProcessor,
      securityConfig,
      persistence,
      sttProvider
    );

    if (this.config.discord.enabled) {
      await this.orchestrator.startAll();
    } else {
      logger.info('Discord disabled - skipping agent Discord adapters');
    }

    if (this.config.schedule.enabled && this.orchestrator !== null) {
      const schedule = await initializeScheduleSystem({
        agentLoader,
        orchestrator: this.orchestrator,
        databaseManager: persistence?.databaseManager ?? null,
        scheduleThreadMap: this.scheduleThreadMap,
        queryMetricsRepository: persistence?.queryMetricsRepository,
        sessionRepository: persistence?.sessionRepository,
        scheduleConfig: this.config.schedule,
        ...(this.config.discord.ownerUserId !== undefined ? { ownerUserId: this.config.discord.ownerUserId } : {}),
      });
      this.scheduleManager = schedule.scheduleManager;
      this.scheduleExecutor = schedule.scheduleExecutor;
      this.scheduleThreadMap = schedule.scheduleThreadMap;
    }

    await this.initializeDiscordServices(agentLoader, persistence, messageProcessor, sessionManager);
    await this.initializeAdminServer(agentLoader);

    if (this.scheduleExecutor !== null) {
      this.scheduleExecutor.wirePostInit({
        ...(this.scheduleThreadMap !== null ? { threadMap: this.scheduleThreadMap } : {}),
      });
    }

    this.logStartupSummary(agentLoader);

    if (this.discordSystemAdapter !== null) {
      void notifyCrashRecovery(this.discordSystemAdapter, this.config.discord.channels);
    }
  }

  async shutdown(signal: string): Promise<void> {
    const uptime_s = Math.floor((Date.now() - INSTANCE_STARTED_AT) / 1000);
    logger.info(
      { event_type: 'lifecycle.shutdown_begin', signal, uptime_s },
      `Received shutdown signal (${signal}) after ${uptime_s}s, cleaning up...`
    );

    try {
      if (this.discordOpsServices !== null) {
        this.discordOpsServices.stop();
        this.discordOpsServices = null;
        logger.info('Discord ops services stopped');
      }

      if (this.scheduleManager !== null) {
        this.scheduleManager.dispose();
        logger.info('Schedule manager disposed');
      }

      if (this.adminServer !== null) {
        await this.adminServer.stop();
        this.adminServer = null;
      }

      if (this.orchestrator !== null) {
        await this.orchestrator.stopAll();
      }

      if (this.discordSystemAdapter !== null) {
        await this.discordSystemAdapter.dispose();
        this.discordSystemAdapter = null;
        logger.info('Discord system bot disposed');
      }

      if (this.messageProcessor !== null) {
        await this.messageProcessor.dispose();
      }

      this.sessionManager?.dispose();

      if (this.databaseManager !== null) {
        this.databaseManager.close();
        logger.info('Database connection closed');
      }

      logger.info(
        { event_type: 'lifecycle.shutdown_complete', signal, uptime_s: Math.floor((Date.now() - INSTANCE_STARTED_AT) / 1000) },
        'Cleanup complete, exiting'
      );
    } catch (error) {
      logger.error({ event_type: 'lifecycle.shutdown_error', err: error }, 'Error during shutdown');
    }

    process.exit(0);
  }

  private async initializeAgents(): Promise<AgentLoader> {
    logger.info('Initializing AgentLoader...');
    const agentLoader = new AgentLoader({ agentsDir: this.config.agentsDir });

    const agentIds = await agentLoader.scanAgents();
    if (agentIds.length === 0) {
      throw new Error('No agents found in agents/ directory. Please create at least one agent.');
    }

    logger.info({ agentCount: agentIds.length, agentIds }, 'Available agents');

    await agentLoader.loadAllAgents();
    logger.info({ loadedCount: agentLoader.list().length }, 'Agents loaded');

    const agentsWithTokens = agentLoader.getAgentsWithPlatformTokens();
    if (agentsWithTokens.length === 0) {
      logger.warn('No agents have Discord bot tokens configured. Add discordBotToken and discordChannelId to agent.json files.');
    }

    return agentLoader;
  }

  private initializePersistence(): PersistenceLayer | null {
    if (!this.config.persistence.enabled) {
      return null;
    }

    const { dbPath } = this.config.persistence;
    logger.info({ dbPath }, 'Initializing persistence...');

    const databaseManager = new DatabaseManager({ dbPath });
    databaseManager.initialize();
    this.databaseManager = databaseManager;

    const db = databaseManager.getDatabase();
    const sessionRepository = new SessionRepository(db);
    const conversationRepository = new ConversationRepository(db);
    const queryMetricsRepository = new QueryMetricsRepository(db);
    const rateLimitRepository = new RateLimitRepository(db);

    import('./services/OAuthUsageService.js').then(({ setOAuthUsagePersist }) => {
      setOAuthUsagePersist((data) => {
        if (data.five_hour) {
          rateLimitRepository.record({ rateLimitType: 'five_hour', utilizationPct: data.five_hour.utilization, status: 'oauth' });
        }
        if (data.seven_day) {
          rateLimitRepository.record({ rateLimitType: 'seven_day', utilizationPct: data.seven_day.utilization, status: 'oauth' });
        }
      });
    }).catch((err) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'OAuthUsageService dynamic import failed — rate limit persist disabled'
      );
    });

    logger.info('Persistence enabled');

    return {
      databaseManager,
      sessionRepository,
      conversationRepository,
      queryMetricsRepository,
      rateLimitRepository,
    };
  }

  private initializeSessionManager(
    agentLoader: AgentLoader,
    persistence: PersistenceLayer | null
  ): SessionManager {
    logger.info('Initializing SessionManager...');

    const sm = new SessionManager({
      agentLoader,
      config: this.config.session,
      ...(persistence?.sessionRepository !== undefined
        ? { sessionRepository: persistence.sessionRepository }
        : {}),
    });
    sm.start();
    this.sessionManager = sm;

    return sm;
  }

  private createMessageProcessor(
    sessionManager: SessionManager,
    agentLoader: AgentLoader,
    conversationRepository: ConversationRepository | undefined,
    queryMetricsRepository: QueryMetricsRepository | undefined,
    rateLimitRepository?: RateLimitRepository,
  ): MessageProcessor {
    return new MessageProcessor({
      sessionManager,
      getAdapter: (platform, agentId) =>
        platform === 'discord' ? this.orchestrator?.getRegistry().get(agentId) : undefined,
      getSystemPrompt: (agentId) => agentLoader.readSystemPrompt(agentId),
      sendTypingIndicators: true,
      typingIndicatorIntervalMs: TYPING_INDICATOR_INTERVAL_MS,
      ...(conversationRepository !== undefined ? { conversationRepository } : {}),
      ...(queryMetricsRepository !== undefined ? { queryMetricsRepository } : {}),
      ...(rateLimitRepository !== undefined ? { rateLimitRepository } : {}),
      cacheKeepaliveConfig: this.config.cacheKeepalive,
      sessionGuardConfig: this.config.sessionGuard,
      ephemeral: this.config.session.ephemeral,
      idleCloseMs: this.config.session.idleCloseMs,
      queryHardTimeoutMs: this.config.session.queryHardTimeoutMs,
      queryHardTimeoutGraceMs: this.config.session.queryHardTimeoutGraceMs,
      usageCardEnabled: this.config.discord.usageCardEnabled,
      inChatUsageSummary: this.config.discord.inChatUsageSummary,
      ...(this.config.discord.guildId !== '' ? { guildId: this.config.discord.guildId } : {}),
    });
  }

  private createOrchestrator(
    agentLoader: AgentLoader,
    sessionManager: SessionManager,
    messageProcessor: MessageProcessor,
    securityConfig: ReturnType<typeof loadSecurityConfig>,
    persistence: PersistenceLayer | null,
    sttProvider?: STTProvider
  ): PlatformOrchestrator {
    logger.info('Initializing PlatformOrchestrator...');

    return new PlatformOrchestrator({
      agentLoader,
      sessionManager,
      messageProcessor,
      securityConfig,
      ...(this.scheduleManager !== null ? { scheduleManager: this.scheduleManager } : {}),
      ...(sttProvider !== undefined ? { sttProvider } : {}),
      ...(this.scheduleThreadMap !== null ? { scheduleThreadMap: this.scheduleThreadMap } : {}),
      ...(persistence?.sessionRepository !== undefined ? { sessionRepository: persistence.sessionRepository } : {}),
      ...(this.config.discord.ownerUserId !== undefined ? { ownerUserId: this.config.discord.ownerUserId } : {}),
      createDiscordAdapter: (config) => new DiscordAdapter(config),
    });
  }

  private async initializeDiscordServices(
    agentLoader: AgentLoader,
    persistence: PersistenceLayer | null,
    messageProcessor: MessageProcessor,
    sessionManager: SessionManager,
  ): Promise<void> {
    if (!this.config.discord.enabled) {
      return;
    }

    const { mainBotToken } = this.config.discord;
    if (!mainBotToken) {
      logger.info('DISCORD_MAIN_BOT_TOKEN not set - skipping Discord services');
      return;
    }

    const services = await initializeDiscordServices({
      agentLoader,
      messageProcessor,
      sessionManager,
      orchestrator: this.orchestrator,
      discordConfig: {
        mainBotToken,
        mainBotClientId: this.config.discord.mainBotClientId,
        guildId: this.config.discord.guildId,
        ownerUserId: this.config.discord.ownerUserId,
        channels: this.config.discord.channels,
        dashboardUpdateMinutes: this.config.discord.dashboardUpdateMinutes,
      },
      persistence: persistence !== null ? {
        queryMetricsRepository: persistence.queryMetricsRepository,
        rateLimitRepository: persistence.rateLimitRepository,
      } : null,
    });

    if (services === null) {
      return;
    }

    this.discordSystemAdapter = services.systemAdapter;
    this.discordOpsServices = services.ops;
  }

  private async initializeAdminServer(agentLoader: AgentLoader): Promise<void> {
    if (!this.config.admin.enabled) return;

    const adminServer = new AdminServer({
      config: this.config,
      agentLoader,
      getBotStatus: (agentId) => this.orchestrator?.getBotStatusForAgent(agentId) ?? 'no-token',
    });
    await adminServer.start();
    this.adminServer = adminServer;
  }

  private logStartupSummary(agentLoader: AgentLoader): void {
    const runningAdapters = this.orchestrator?.getRunningAdapters() ?? [];
    logger.info(
      {
        agentCount: agentLoader.list().length,
        runningAdapters: runningAdapters.length,
        adapters: runningAdapters.map((a) => `${a.platform}::${a.agentId}`),
        persistenceEnabled: this.config.persistence.enabled,
        scheduleEnabled: this.config.schedule.enabled,
        adminConsoleEnabled: this.config.admin.enabled,
      },
      'ClaudeCab initialized successfully'
    );
    logger.info('Bot is now running. Press Ctrl+C to stop.');
  }

}

interface PersistenceLayer {
  databaseManager: DatabaseManager;
  sessionRepository: SessionRepository;
  conversationRepository: ConversationRepository;
  queryMetricsRepository: QueryMetricsRepository;
  rateLimitRepository: RateLimitRepository;
}
