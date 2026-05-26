/**
 * Application bootstrap: dependency wiring and lifecycle management.
 */

import { hostname } from 'node:os';
import { logger, INSTANCE_ID, INSTANCE_STARTED_AT } from './utils/logger.js';
import { HeartbeatService } from './services/HeartbeatService.js';
import { AgentLoader } from './core/AgentLoader.js';
import { SessionManager } from './core/SessionManager.js';
import { MessageProcessor } from './core/MessageProcessor.js';
import { PlatformOrchestrator } from './core/PlatformOrchestrator.js';
import { getEventBus } from './core/EventBus.js';
import { ContextInjector, type GroupMemberInfo } from './core/ContextInjector.js';
import { loadSecurityConfig } from './utils/security.js';
import { auditLogger } from './utils/audit.js';
import { DatabaseManager } from './persistence/DatabaseManager.js';
import { SessionRepository } from './persistence/SessionRepository.js';
import { ConversationRepository } from './persistence/ConversationRepository.js';
import { GroupMessageRepository } from './persistence/GroupMessageRepository.js';
import { InjectionStateRepository } from './persistence/InjectionStateRepository.js';
import { GroupMemberRepository } from './persistence/GroupMemberRepository.js';
import { QueryMetricsRepository } from './persistence/QueryMetricsRepository.js';
import { RateLimitRepository } from './persistence/RateLimitRepository.js';
import { ScheduleThreadMap, type ScheduleManager, type ScheduleExecutor } from './schedule/index.js';
import { initializeScheduleSystem } from './schedule/ScheduleBootstrap.js';
import { ActivityService } from './core/ActivityService.js';
import { ActivityRepository } from './persistence/ActivityRepository.js';
import type { AppConfig } from './config.js';
import { createSTTProvider, type STTProvider } from './core/stt/index.js';
import { createTTSProvider, type TTSProvider } from './core/tts/index.js';
import { TTSService } from './services/TTSService.js';
import type { IQueryMetricsRepository } from './persistence/types.js';
import { ExecutionRecordRepository } from './persistence/ExecutionRecordRepository.js';
import { TaskRecordRepository } from './persistence/TaskRecordRepository.js';
import { BudgetService } from './services/BudgetService.js';
import { TaskService } from './services/TaskService.js';
import { ActivityEventService } from './services/ActivityEventService.js';
import { DiscordAdapter } from './adapters/DiscordAdapter.js';
import { DiscordDashboard } from './adapters/discord/services/DiscordDashboard.js';
import { initializeDiscordServices, notifyCrashRecovery } from './adapters/discord/DiscordBootstrap.js';

const TYPING_INDICATOR_INTERVAL_MS = 5000;
const ACTIVITY_BUFFER_SIZE = 200;

export class AppBootstrap {
  private readonly config: AppConfig;

  private orchestrator: PlatformOrchestrator | null = null;
  private sessionManager: SessionManager | null = null;
  private messageProcessor: MessageProcessor | null = null;
  private databaseManager: DatabaseManager | null = null;
  private scheduleManager: ScheduleManager | null = null;
  private activityService: ActivityService | null = null;
  private dashboardService: DiscordDashboard | null = null;
  private budgetService: BudgetService | null = null;
  private activityEventService: ActivityEventService | null = null;
  private taskService: TaskService | null = null;
  private costReportTimer: ReturnType<typeof setInterval> | null = null;
  private discordSystemAdapter: DiscordAdapter | null = null;
  private scheduleExecutor: ScheduleExecutor | null = null;
  private scheduleThreadMap: ScheduleThreadMap | null = null;
  private heartbeatService: HeartbeatService | null = null;

  constructor(config: AppConfig) {
    this.config = config;
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

    this.heartbeatService = new HeartbeatService();
    this.heartbeatService.start();

    const securityConfig = loadSecurityConfig(this.config.security);
    auditLogger.configure(this.config.audit?.enabled ?? true);

    const agentLoader = await this.initializeAgents();
    const persistence = this.initializePersistence(agentLoader);
    const sessionManager = this.initializeSessionManager(agentLoader, persistence);

    if (persistence?.sessionRepository !== undefined) {
      const restoredSessions = await sessionManager.restoreSessions();
      logger.info({ restoredSessions }, 'Session restoration complete');
    }

    this.activityService = this.createActivityService(agentLoader, persistence);
    const activityService = this.activityService;

    const sttProvider = this.config.stt.enabled && this.config.stt.apiKey
      ? createSTTProvider(this.config.stt)
      : undefined;

    const ttsProvider = this.config.tts.enabled && this.config.tts.apiToken
      ? createTTSProvider(this.config.tts)
      : undefined;

    this.budgetService = new BudgetService({
      agentLoader,
      ...(persistence?.executionRecordRepository !== undefined
        ? { executionRecordRepository: persistence.executionRecordRepository }
        : {}),
      ...(persistence?.queryMetricsRepository !== undefined
        ? { queryMetricsRepository: persistence.queryMetricsRepository }
        : {}),
    });

    const messageProcessor = this.createMessageProcessor(
      sessionManager,
      agentLoader,
      persistence?.conversationRepository,
      persistence?.contextInjector,
      persistence?.queryMetricsRepository,
      activityService,
      ttsProvider,
      this.budgetService,
      persistence?.executionRecordRepository,
      persistence?.rateLimitRepository,
    );
    this.messageProcessor = messageProcessor;

    this.heartbeatService.setCacheStatsProvider(() => ({
      ...messageProcessor.sdkSession.getCacheStats(),
      session_manager_count: sessionManager.getSessionCount(),
    }));

    if (this.config.schedule.enabled) {
      this.scheduleThreadMap = new ScheduleThreadMap();
    }

    this.orchestrator = this.createOrchestrator(
      agentLoader,
      sessionManager,
      messageProcessor,
      securityConfig,
      persistence,
      activityService,
      sttProvider,
      ttsProvider
    );

    await this.orchestrator.startAll();

    if (this.config.schedule.enabled && this.orchestrator !== null) {
      const schedule = await initializeScheduleSystem({
        agentLoader,
        orchestrator: this.orchestrator,
        databaseManager: persistence?.databaseManager ?? null,
        scheduleThreadMap: this.scheduleThreadMap,
        queryMetricsRepository: persistence?.queryMetricsRepository,
        executionRecordRepository: persistence?.executionRecordRepository,
        budgetService: this.budgetService ?? undefined,
        sessionRepository: persistence?.sessionRepository,
      });
      this.scheduleManager = schedule.scheduleManager;
      this.scheduleExecutor = schedule.scheduleExecutor;
      this.scheduleThreadMap = schedule.scheduleThreadMap;
    }

    for (const agentId of agentLoader.list()) {
      activityService.trackActivity(agentId);
    }

    await this.initializeDiscordServices(agentLoader, persistence, messageProcessor, sessionManager);

    messageProcessor.wirePostInit({
      ...(this.taskService !== null ? { taskService: this.taskService } : {}),
      ...(this.activityEventService !== null ? { activityEventService: this.activityEventService } : {}),
    });

    if (this.activityEventService !== null && this.scheduleExecutor !== null) {
      this.scheduleExecutor.wirePostInit({
        activityEventService: this.activityEventService,
        ...(this.scheduleThreadMap !== null ? { threadMap: this.scheduleThreadMap } : {}),
      });
    }

    this.logStartupSummary(agentLoader);

    if (typeof process.send === 'function') {
      process.send('ready');
      logger.info('PM2 ready signal sent');
    }

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
      if (this.heartbeatService !== null) {
        this.heartbeatService.stop();
        this.heartbeatService = null;
      }

      if (this.costReportTimer !== null) {
        clearInterval(this.costReportTimer);
        this.costReportTimer = null;
      }

      if (this.activityEventService !== null) {
        await this.activityEventService.dispose();
      }

      if (this.dashboardService !== null) {
        this.dashboardService.stop();
        logger.info('Dashboard service stopped');
      }

      if (this.scheduleManager !== null) {
        this.scheduleManager.dispose();
        logger.info('Schedule manager disposed');
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
      this.activityService?.dispose();

      if (this.databaseManager !== null) {
        this.databaseManager.close();
        logger.info('Database connection closed');
      }

      getEventBus().removeAllListeners();

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

  private initializePersistence(agentLoader: AgentLoader): PersistenceLayer | null {
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
    const groupMessageRepository = new GroupMessageRepository(db);
    const injectionStateRepository = new InjectionStateRepository(db);
    const groupMemberRepository = new GroupMemberRepository(db);
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
    }).catch(() => {});

    const executionRecordRepository = new ExecutionRecordRepository(db);
    const taskRecordRepository = new TaskRecordRepository(db);

    const getGroupMembersInfo = (chatId: string, platform: string) => {
      const memberRows = groupMemberRepository.getMembers(platform, chatId);
      return memberRows.map((row) => {
        const agent = agentLoader.get(row.agent_id);
        const info: GroupMemberInfo = {
          agentId: row.agent_id,
          name: agent?.config.name ?? row.agent_id,
        };
        if (agent?.config.description) {
          info.description = agent.config.description;
        }
        const adapter = this.orchestrator?.getRegistry().get(row.agent_id);
        const botInfo = adapter?.getBotInfo();
        if (botInfo) {
          info.username = botInfo.username;
        }
        return info;
      });
    };

    const contextInjector = new ContextInjector(
      groupMessageRepository,
      injectionStateRepository,
      getGroupMembersInfo
    );

    logger.info('Persistence enabled');

    return {
      databaseManager,
      sessionRepository,
      conversationRepository,
      groupMessageRepository,
      injectionStateRepository,
      groupMemberRepository,
      queryMetricsRepository,
      rateLimitRepository,
      contextInjector,
      executionRecordRepository,
      taskRecordRepository,
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
    contextInjector: ContextInjector | undefined,
    queryMetricsRepository: QueryMetricsRepository | undefined,
    activityService?: ActivityService,
    ttsProvider?: TTSProvider,
    budgetService?: BudgetService,
    executionRecordRepository?: ExecutionRecordRepository,
    rateLimitRepository?: RateLimitRepository,
  ): MessageProcessor {
    const ttsService = ttsProvider
      ? new TTSService({
          provider: ttsProvider,
          defaultVoiceId: this.config.tts.defaultVoiceId,
          defaultLanguage: 'Chinese',
        })
      : undefined;

    return new MessageProcessor({
      sessionManager,
      getAdapter: (platform, agentId) =>
        platform === 'discord' ? this.orchestrator?.getRegistry().get(agentId) : undefined,
      getSystemPrompt: (agentId) => agentLoader.readSystemPrompt(agentId),
      sendTypingIndicators: true,
      typingIndicatorIntervalMs: TYPING_INDICATOR_INTERVAL_MS,
      ...(conversationRepository !== undefined ? { conversationRepository } : {}),
      ...(queryMetricsRepository !== undefined ? { queryMetricsRepository } : {}),
      getBotInfo: (agentId) => {
        const registry = this.orchestrator?.getRegistry();
        if (registry === undefined) return null;
        for (const adapter of registry.getAll()) {
          if (adapter.agentId === agentId) {
            const info = adapter.getBotInfo();
            if (info !== null) return info;
          }
        }
        return null;
      },
      eventBus: getEventBus(),
      ...(contextInjector !== undefined ? { contextInjector } : {}),
      ...(activityService !== undefined ? { activityService } : {}),
      ...(ttsService !== undefined ? { ttsService } : {}),
      ...(budgetService !== undefined ? { budgetService } : {}),
      ...(executionRecordRepository !== undefined ? { executionRecordRepository } : {}),
      ...(rateLimitRepository !== undefined ? { rateLimitRepository } : {}),
      cacheKeepaliveConfig: this.config.cacheKeepalive,
    });
  }

  private createOrchestrator(
    agentLoader: AgentLoader,
    sessionManager: SessionManager,
    messageProcessor: MessageProcessor,
    securityConfig: ReturnType<typeof loadSecurityConfig>,
    persistence: PersistenceLayer | null,
    activityService?: ActivityService,
    sttProvider?: STTProvider,
    ttsProvider?: TTSProvider
  ): PlatformOrchestrator {
    logger.info('Initializing PlatformOrchestrator...');

    return new PlatformOrchestrator({
      agentLoader,
      sessionManager,
      messageProcessor,
      securityConfig,
      ...(activityService !== undefined ? { activityService } : {}),
      ...(this.scheduleManager !== null ? { scheduleManager: this.scheduleManager } : {}),
      ...(sttProvider !== undefined ? { sttProvider } : {}),
      ...(ttsProvider !== undefined ? { ttsProvider } : {}),
      ...(persistence?.taskRecordRepository !== undefined ? { taskRecordRepository: persistence.taskRecordRepository } : {}),
      ...(this.scheduleThreadMap !== null ? { scheduleThreadMap: this.scheduleThreadMap } : {}),
      ...(persistence?.sessionRepository !== undefined ? { sessionRepository: persistence.sessionRepository } : {}),
      createDiscordAdapter: (config) => new DiscordAdapter(config as ConstructorParameters<typeof DiscordAdapter>[0]),
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
      budgetService: this.budgetService,
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
        taskRecordRepository: persistence.taskRecordRepository,
        executionRecordRepository: persistence.executionRecordRepository,
      } : null,
    });

    if (services === null) {
      return;
    }

    this.discordSystemAdapter = services.systemAdapter;
    if (services.dashboardService !== undefined) this.dashboardService = services.dashboardService;
    if (services.activityEventService !== undefined) this.activityEventService = services.activityEventService;
    if (services.taskService !== undefined) this.taskService = services.taskService;
    if (services.costReportTimer !== undefined) this.costReportTimer = services.costReportTimer;
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
      },
      'ClaudeCab initialized successfully'
    );
    logger.info('Bot is now running. Press Ctrl+C to stop.');
  }

  private createActivityService(agentLoader: AgentLoader, persistence: PersistenceLayer | null): ActivityService {
    const getAgentName = (agentId: string) => agentLoader.get(agentId)?.config.name ?? agentId;

    let activityRepository: ActivityRepository | undefined;
    if (persistence) {
      activityRepository = new ActivityRepository(persistence.databaseManager.getDatabase());
      logger.info('ActivityRepository enabled (events will be persisted)');
    }

    return new ActivityService({
      getAgentName,
      activityRepository,
      bufferSize: ACTIVITY_BUFFER_SIZE,
    });
  }
}

interface PersistenceLayer {
  databaseManager: DatabaseManager;
  sessionRepository: SessionRepository;
  conversationRepository: ConversationRepository;
  groupMessageRepository: GroupMessageRepository;
  injectionStateRepository: InjectionStateRepository;
  groupMemberRepository: GroupMemberRepository;
  queryMetricsRepository: QueryMetricsRepository;
  rateLimitRepository: RateLimitRepository;
  contextInjector: ContextInjector;
  executionRecordRepository: ExecutionRecordRepository;
  taskRecordRepository: TaskRecordRepository;
}
