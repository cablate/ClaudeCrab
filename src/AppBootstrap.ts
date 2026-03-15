/**
 * Application bootstrap — orchestrates initialization and shutdown of all subsystems.
 * Extracted from index.ts to improve testability and readability.
 */

import { logger } from './utils/logger.js';
import { AgentLoader } from './core/AgentLoader.js';
import { SessionManager } from './core/SessionManager.js';
import { MessageProcessor } from './core/MessageProcessor.js';
import { SDKQueryManager } from './core/SDKQueryManager.js';
import { PlatformOrchestrator } from './core/PlatformOrchestrator.js';
import { getEventBus } from './core/EventBus.js';
import { CRASH_MARKER_PATH } from './constants.js';
import { ContextInjector, type GroupMemberInfo } from './core/ContextInjector.js';
import { TelegramAdapter } from './adapters/TelegramAdapter.js';
import { loadSecurityConfig } from './utils/security.js';
import { DatabaseManager } from './persistence/DatabaseManager.js';
import { SessionRepository } from './persistence/SessionRepository.js';
import { ConversationRepository } from './persistence/ConversationRepository.js';
import { GroupMessageRepository } from './persistence/GroupMessageRepository.js';
import { InjectionStateRepository } from './persistence/InjectionStateRepository.js';
import { GroupMemberRepository } from './persistence/GroupMemberRepository.js';
import { QueryMetricsRepository } from './persistence/QueryMetricsRepository.js';
import { ScheduleRepository } from './persistence/ScheduleRepository.js';
import { WebUIServer } from './webui/index.js';
import {
  ScheduleLoader,
  CronScheduler,
  ScheduleExecutor,
  ScheduleNotifier,
  ScheduleManager,
} from './schedule/index.js';
import { ActivityService } from './core/ActivityService.js';
import { IdleMutterScheduler } from './core/IdleMutterScheduler.js';
import { ReactionGenerator } from './core/ReactionGenerator.js';
import { ActivityRepository } from './persistence/ActivityRepository.js';
import { SSEBroadcaster } from './webui/services/SSEBroadcaster.js';
import { readFileSync, unlinkSync } from 'node:fs';
import * as path from 'node:path';
import type { AppConfig } from './config.js';
import { createSTTProvider, type STTProvider } from './core/stt/index.js';
import { createTTSProvider, type TTSProvider } from './core/tts/index.js';
import { TTSService } from './services/TTSService.js';
import type { IQueryMetricsRepository } from './persistence/types.js';
import { AgentCallService } from './services/AgentCallService.js';
import { ExecutionRecordRepository } from './persistence/ExecutionRecordRepository.js';
import { TaskRecordRepository } from './persistence/TaskRecordRepository.js';
import { BudgetService } from './services/BudgetService.js';
import { DashboardService } from './services/DashboardService.js';
import { CostReportService } from './services/CostReportService.js';
import { TaskService } from './services/TaskService.js';
import { ActivityEventService } from './services/ActivityEventService.js';
import { DiscordAdapter } from './adapters/DiscordAdapter.js';
import { DiscordInteractionHandler } from './adapters/discord/DiscordInteractionHandler.js';

/** Interval for sending typing indicators to Telegram (ms) */
const TYPING_INDICATOR_INTERVAL_MS = 5000;
/** Size of the in-memory activity event ring buffer */
const ACTIVITY_BUFFER_SIZE = 200;

/**
 * Manages the full lifecycle of the ClaudeCab application.
 *
 * Usage:
 * ```
 * const app = new AppBootstrap(config);
 * await app.start();
 * // ... on shutdown signal:
 * await app.shutdown('SIGINT');
 * ```
 */
export class AppBootstrap {
  private readonly config: AppConfig;

  // Subsystem references (populated during start, used during shutdown)
  private orchestrator: PlatformOrchestrator | null = null;
  private sessionManager: SessionManager | null = null;
  private databaseManager: DatabaseManager | null = null;
  private webUIServer: WebUIServer | null = null;
  private scheduleManager: ScheduleManager | null = null;
  private idleMutterScheduler: IdleMutterScheduler | null = null;
  private _reactionGenerator: ReactionGenerator | null = null;
  private activityService: ActivityService | null = null;
  private sseBroadcaster: SSEBroadcaster | null = null;
  private dashboardService: DashboardService | null = null;
  private budgetService: BudgetService | null = null;
  private activityEventService: ActivityEventService | null = null;
  private taskService: TaskService | null = null;
  private costReportTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Initialize and start all subsystems.
   */
  async start(): Promise<void> {
    logger.info('ClaudeCab v1.0.0 starting...');
    logger.info({ nodeVersion: process.version }, 'Environment info');

    const securityConfig = loadSecurityConfig();
    const agentLoader = await this.initializeAgents();
    const persistence = this.initializePersistence(agentLoader);
    const sessionManager = this.initializeSessionManager(agentLoader, persistence);

    // Restore sessions from database
    if (persistence && persistence.sessionRepository) {
      const restoredSessions = await sessionManager.restoreSessions();
      logger.info({ restoredSessions }, 'Session restoration complete');
    }

        // v2.0: Create ActivityService for personality-driven lifecycle reactions
    this.activityService = this.createActivityService(agentLoader, persistence);
    const activityService = this.activityService;

    // Create STT provider (optional — voice input disabled if no API key)
    const sttProvider = this.config.stt.enabled && this.config.stt.apiKey
      ? createSTTProvider(this.config.stt)
      : undefined;

    // Create TTS provider (optional — voice output disabled if no API token)
    const ttsProvider = this.config.tts.enabled && this.config.tts.apiToken
      ? createTTSProvider(this.config.tts)
      : undefined;

    // Create BudgetService (uses agentLoader + repos for cost checking)
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
    );

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

    await this.initializeScheduleSystem(
      agentLoader,
      persistence?.databaseManager ?? null,
      persistence?.queryMetricsRepository,
      persistence?.executionRecordRepository,
      this.budgetService ?? undefined,
    );

    await this.initializeWebUI(
      agentLoader,
      sessionManager,
      persistence,
      activityService,
      messageProcessor
    );

    // v2.0: Idle mutter scheduler disabled by default — Haiku mutter generation
    // consumes API credits with limited value. Enable by uncommenting below.
    // this.initializeIdleMutterScheduler(activityService, agentLoader);

    // v2.0: Track all agents for activity (so idle detection works from startup)
    for (const agentId of agentLoader.list()) {
      activityService.trackActivity(agentId);
    }

    // Discord services initialization (Dashboard, CostReport, InteractionHandler, ActivityEvent, TaskService)
    await this.initializeDiscordServices(agentLoader, persistence);

    // Post-Discord: wire TaskService + ActivityEventService into MessageProcessor
    // (These are created during initializeDiscordServices, which runs after MessageProcessor)
    if (this.taskService !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (messageProcessor as any).taskService = this.taskService;
    }
    if (this.activityEventService !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (messageProcessor as any).activityEventService = this.activityEventService;
    }

    this.logStartupSummary(agentLoader);

    // Signal PM2 that startup is complete (required by wait_ready: true)
    if (typeof process.send === 'function') {
      process.send('ready');
      logger.info('PM2 ready signal sent');
    }

    // Crash recovery: notify owner if restarting after a crash
    void this.notifyCrashRecovery(securityConfig.allowedUsers[0]);
  }

  /**
   * Gracefully shut down all subsystems in reverse order.
   */
  async shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Received shutdown signal, cleaning up...');

    try {
      if (this.webUIServer !== null) {
        await this.webUIServer.stop();
      }

      if (this.costReportTimer !== null) {
        clearInterval(this.costReportTimer);
        this.costReportTimer = null;
      }

      if (this.activityEventService !== null) {
        this.activityEventService.dispose();
      }

      if (this.dashboardService !== null) {
        this.dashboardService.stop();
        logger.info('Dashboard service stopped');
      }

      if (this.idleMutterScheduler !== null) {
        this.idleMutterScheduler.stop();
      }

      if (this.scheduleManager !== null) {
        this.scheduleManager.dispose();
        logger.info('Schedule manager disposed');
      }

      if (this.orchestrator !== null) {
        await this.orchestrator.stopAll();
      }

      if (this.sessionManager !== null) {
        this.sessionManager.dispose();
      }

      if (this.sseBroadcaster !== null) {
        this.sseBroadcaster.dispose();
      }

      if (this.activityService !== null) {
        this.activityService.dispose();
      }

      if (this.databaseManager !== null) {
        this.databaseManager.close();
        logger.info('Database connection closed');
      }

      // Clean up all EventBus listeners to prevent orphans
      getEventBus().removeAllListeners();

      logger.info('Cleanup complete, exiting');
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
    }

    process.exit(0);
  }

  // --- Private initialization methods ---

  private async initializeAgents(): Promise<AgentLoader> {
    logger.info('Initializing AgentLoader...');
    const agentLoader = new AgentLoader();

    const agentIds = await agentLoader.scanAgents();
    if (agentIds.length === 0) {
      throw new Error(
        'No agents found in agents/ directory. Please create at least one agent.'
      );
    }

    logger.info({ agentCount: agentIds.length, agentIds }, 'Available agents');

    await agentLoader.loadAllAgents();
    logger.info({ loadedCount: agentLoader.list().length }, 'Agents loaded');

    const agentsWithTokens = agentLoader.getAgentsWithPlatformTokens();
    if (agentsWithTokens.length === 0) {
      logger.warn(
        'No agents have platform bot tokens configured. Add telegramBotToken to agent.json files.'
      );
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
    const executionRecordRepository = new ExecutionRecordRepository(db);
    const taskRecordRepository = new TaskRecordRepository(db);

    // ADR-020: Build group member info callback for ContextInjector
    // Uses lazy reference to this.orchestrator (populated after persistence init)
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
        // Get Telegram @username from running adapter
        const adapter = this.orchestrator?.getRegistry().get(platform, row.agent_id);
        if (adapter instanceof TelegramAdapter) {
          const botInfo = adapter.getBotInfo();
          if (botInfo) {
            info.username = botInfo.username;
          }
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
  ): MessageProcessor {
    // Create agent call service for cross-agent communication
    // Uses MessageProcessor.processMessage() to ensure full processing flow (typing, formatting, etc.)
    // Note: Uses lazy getter since MessageProcessor isn't created yet (circular dependency)
    let messageProcessorRef: MessageProcessor | undefined;
    const agentCallService = new AgentCallService(
      agentLoader,
      () => messageProcessorRef,
      () => sessionManager
    );

    // Create TTS service if provider is available
    const ttsService = ttsProvider
      ? new TTSService({
          provider: ttsProvider,
          defaultVoiceId: this.config.tts.defaultVoiceId,
          defaultLanguage: 'Chinese',
        })
      : undefined;

    // Note: getAdapter and getBotInfo reference orchestrator via closure (lazy resolution)
    const messageProcessor = new MessageProcessor({
      sessionManager,
      getAdapter: (platform, agentId) =>
        this.orchestrator?.getRegistry().get(platform, agentId),
      getSystemPrompt: (agentId) => agentLoader.readSystemPrompt(agentId),
      sendTypingIndicators: true,
      typingIndicatorIntervalMs: TYPING_INDICATOR_INTERVAL_MS,
      ...(conversationRepository !== undefined
        ? { conversationRepository }
        : {}),
      ...(queryMetricsRepository !== undefined
        ? { queryMetricsRepository }
        : {}),
      getBotInfo: (agentId) => {
        const adapter = this.orchestrator
          ?.getRegistry()
          .get('telegram', agentId);
        if (adapter !== undefined && adapter instanceof TelegramAdapter) {
          return adapter.getBotInfo();
        }
        return null;
      },
      eventBus: getEventBus(),
      ...(contextInjector !== undefined ? { contextInjector } : {}),
      ...(activityService !== undefined ? { activityService } : {}),
      agentCallService,
      ...(ttsService !== undefined ? { ttsService } : {}),
      ...(budgetService !== undefined ? { budgetService } : {}),
      ...(executionRecordRepository !== undefined ? { executionRecordRepository } : {}),
    });

    // Complete the circular reference: AgentCallService needs MessageProcessor
    messageProcessorRef = messageProcessor;

    return messageProcessor;
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
      ...(this.scheduleManager !== null
        ? { scheduleManager: this.scheduleManager }
        : {}),
      ...(persistence?.conversationRepository !== undefined
        ? { conversationRepository: persistence.conversationRepository }
        : {}),
      ...(persistence?.groupMessageRepository !== undefined
        ? { groupMessageRepository: persistence.groupMessageRepository }
        : {}),
      ...(persistence?.injectionStateRepository !== undefined
        ? { injectionStateRepository: persistence.injectionStateRepository }
        : {}),
      ...(persistence?.groupMemberRepository !== undefined
        ? { groupMemberRepository: persistence.groupMemberRepository }
        : {}),
      ...(persistence?.queryMetricsRepository !== undefined
        ? { queryMetricsRepository: persistence.queryMetricsRepository }
        : {}),
      ...(sttProvider !== undefined ? { sttProvider } : {}),
      ...(ttsProvider !== undefined ? { ttsProvider } : {}),
    });
  }

  private async initializeScheduleSystem(
    agentLoader: AgentLoader,
    databaseManager: DatabaseManager | null,
    queryMetricsRepository?: IQueryMetricsRepository,
    executionRecordRepository?: ExecutionRecordRepository,
    budgetService?: BudgetService,
  ): Promise<void> {
    if (!this.config.schedule.enabled || this.orchestrator === null) {
      return;
    }

    logger.info('Initializing Schedule System...');

    let scheduleRepository: ScheduleRepository | undefined;
    if (databaseManager !== null) {
      scheduleRepository = new ScheduleRepository(databaseManager.getDatabase());
    }

    const scheduleLoader = new ScheduleLoader(agentLoader.getAgentsDir());
    const sdkManager = new SDKQueryManager();
    const scheduleNotifier = new ScheduleNotifier(new Map());
    const scheduleExecutor = new ScheduleExecutor(
      agentLoader,
      sdkManager,
      scheduleNotifier,
      scheduleRepository,
      queryMetricsRepository,
      executionRecordRepository,
      budgetService,
    );
    const cronScheduler = new CronScheduler(
      scheduleExecutor,
      async (scheduleId, agentId, spec, failureCount) => {
        // Auto-pause: update YAML and notify
        if (this.scheduleManager) {
          await this.scheduleManager.pauseSchedule(scheduleId);
        }
        await scheduleNotifier.notifyAutoPaused(spec, failureCount);
        logger.warn({ scheduleId, agentId, failureCount },
          '[Schedule] Auto-paused schedule after consecutive failures');
      }
    );

    this.scheduleManager = new ScheduleManager(
      scheduleLoader,
      cronScheduler,
      scheduleRepository
    );

    await this.scheduleManager.initialize();

    // Populate notifier with running adapters
    for (const adapter of this.orchestrator.getRegistry().getAll()) {
      scheduleNotifier.addAdapter(adapter.agentId, adapter);
    }

    // Auto-sync schedules after agent queries (agent may create schedule files via Write tool)
    const scheduleManager = this.scheduleManager;
    getEventBus().on('message:sent', (payload) => {
      if (payload.agentId) {
        void scheduleManager.syncSchedulesForAgent(payload.agentId);
      }
    });

    logger.info('Schedule System initialized');
  }

  private async initializeWebUI(
    agentLoader: AgentLoader,
    sessionManager: SessionManager,
    persistence: PersistenceLayer | null,
    activityService?: ActivityService,
    messageProcessor?: MessageProcessor,
  ): Promise<void> {
    if (!this.config.webui.enabled) {
      return;
    }

    // P0 security: Validate required auth env vars before starting WebUI
    if (!process.env.WEBUI_PASSWORD) {
      throw new Error(
        'WEBUI_PASSWORD environment variable is not set. ' +
        'WebUI requires a password for authentication. Please set it in .env.'
      );
    }
    if (!process.env.WEBUI_JWT_SECRET) {
      throw new Error(
        'WEBUI_JWT_SECRET environment variable is not set. ' +
        'Please set it in .env to a random string (e.g. openssl rand -hex 32).'
      );
    }

    const { port } = this.config.webui;
    logger.info({ port }, 'Initializing WebUI...');

    this.webUIServer = new WebUIServer({
      port,
      agentLoader,
      sessionManager,
      platformOrchestrator: this.orchestrator ?? undefined,
      databaseManager: this.databaseManager ?? undefined,
      sessionRepository: persistence?.sessionRepository,
      conversationRepository: persistence?.conversationRepository,
      scheduleManager: this.scheduleManager ?? undefined,
      queryMetricsRepository: persistence?.queryMetricsRepository,
    });

    // v2.0: Register activity API + SSE (before auth, publicly accessible for live display)
    if (activityService) {
      const { SSEBroadcaster: SSEBroadcasterClass } = await import('./webui/services/SSEBroadcaster.js');
      const { createActivityApiRouter } = await import('./webui/api/activity.api.js');
      this.sseBroadcaster = new SSEBroadcasterClass();
      const activityRouter = createActivityApiRouter(this.sseBroadcaster, activityService, agentLoader);
      this.webUIServer.getApp().use('/api/activity', activityRouter);
      logger.info('Activity API + SSE broadcaster registered');
    }

    // v3.0: Register messages API for Web UI → Agent communication (shares Telegram session)
    if (messageProcessor) {
      const { createMessagesApiRouter } = await import('./webui/api/messages.api.js');
      const messagesRouter = createMessagesApiRouter(messageProcessor, agentLoader);
      this.webUIServer!.getApp().use('/api/messages', messagesRouter);
      logger.info('Messages API registered (Web UI → Agent)');
    }

    await this.webUIServer.start();
    logger.info({ port, url: `http://localhost:${port}` }, 'WebUI started');
  }

  /**
   * Initialize Discord-specific services (Dashboard, CostReport, InteractionHandler).
   * Only runs if DISCORD_ENABLED=true and a main bot adapter exists.
   */
  private async initializeDiscordServices(
    agentLoader: AgentLoader,
    persistence: PersistenceLayer | null,
  ): Promise<void> {
    if (!this.config.discord.enabled || this.orchestrator === null) {
      return;
    }

    const { channels, dashboardUpdateMinutes } = this.config.discord;

    // Find any running Discord adapter to use for system channel operations
    let discordAdapter: DiscordAdapter | undefined;
    for (const adapter of this.orchestrator.getRegistry().getAll()) {
      if (adapter instanceof DiscordAdapter) {
        discordAdapter = adapter;
        break;
      }
    }

    if (discordAdapter === undefined) {
      logger.info('No Discord adapters running — skipping Discord services');
      return;
    }

    logger.info('Initializing Discord services...');

    // Register InteractionHandler for button routing
    const interactionHandler = new DiscordInteractionHandler({
      client: discordAdapter.getClient()!,
      adapters: new Map(),
    });

    // Register all Discord adapters for button routing
    for (const adapter of this.orchestrator.getRegistry().getAll()) {
      if (adapter instanceof DiscordAdapter) {
        interactionHandler.registerAdapter(adapter.agentId, adapter);
      }
    }

    // Dashboard Service
    if (channels.dashboard) {
      this.dashboardService = new DashboardService({
        adapter: discordAdapter,
        channelId: channels.dashboard,
        agentLoader,
        ...(persistence?.queryMetricsRepository !== undefined
          ? { queryMetricsRepository: persistence.queryMetricsRepository }
          : {}),
        ...(persistence?.taskRecordRepository !== undefined
          ? { taskRecordRepository: persistence.taskRecordRepository }
          : {}),
        ...(persistence?.executionRecordRepository !== undefined
          ? { executionRecordRepository: persistence.executionRecordRepository }
          : {}),
        ...(this.budgetService !== null
          ? { budgetService: this.budgetService }
          : {}),
        updateIntervalMinutes: dashboardUpdateMinutes,
      });
      await this.dashboardService.start();
      logger.info({ channelId: channels.dashboard }, 'Dashboard service started');
    }

    // ActivityEventService (dual-write: SQLite + Discord #system-log/#alerts)
    if (channels.systemLog || channels.alerts) {
      const ownerUserId = process.env.DISCORD_OWNER_USER_ID;
      this.activityEventService = new ActivityEventService({
        discordAdapter: discordAdapter,
        ...(channels.systemLog ? { systemLogChannelId: channels.systemLog } : {}),
        ...(channels.alerts ? { alertsChannelId: channels.alerts } : {}),
        ...(ownerUserId ? { ownerUserId } : {}),
      });
      logger.info('ActivityEventService started (dual-write)');
    }

    // TaskService (SQLite + Discord Forum dual-layer)
    if (persistence?.taskRecordRepository !== undefined) {
      this.taskService = new TaskService({
        taskRecordRepository: persistence.taskRecordRepository,
        ...(channels.taskBoard ? { discordAdapter: discordAdapter, forumChannelId: channels.taskBoard } : {}),
      });
      logger.info('TaskService started');
    }

    // CostReportService — daily cron (send at 23:55 local time)
    if (channels.costReport && persistence?.queryMetricsRepository !== undefined) {
      const costReportService = new CostReportService({
        adapter: discordAdapter,
        channelId: channels.costReport,
        agentLoader,
        queryMetricsRepository: persistence.queryMetricsRepository,
        ...(this.budgetService !== null ? { budgetService: this.budgetService } : {}),
      });

      // Schedule daily: check every 5 minutes, fire at 23:55
      this.costReportTimer = setInterval(() => {
        const now = new Date();
        if (now.getHours() === 23 && now.getMinutes() >= 55 && now.getMinutes() < 60) {
          void costReportService.sendDailyReport().catch((err) => {
            logger.error({ err }, 'Failed to send daily cost report');
          });
        }
      }, 5 * 60 * 1000);
      this.costReportTimer.unref();
      logger.info({ channelId: channels.costReport }, 'CostReport daily cron started');
    }

    logger.info('Discord services initialized');
  }

  private logStartupSummary(agentLoader: AgentLoader): void {
    const runningAdapters = this.orchestrator?.getRunningAdapters() ?? [];
    logger.info(
      {
        agentCount: agentLoader.list().length,
        runningAdapters: runningAdapters.length,
        adapters: runningAdapters.map((a) => `${a.platform}::${a.agentId}`),
        persistenceEnabled: this.config.persistence.enabled,
        webUIEnabled: this.config.webui.enabled,
        scheduleEnabled: this.config.schedule.enabled,
      },
      'ClaudeCab initialized successfully'
    );
    logger.info('Bot is now running. Press Ctrl+C to stop.');
  }

  /**
   * Check for crash marker file and notify owner via Telegram if found.
   * Best-effort: failures are logged but never block startup.
   */
  private async notifyCrashRecovery(ownerChatId: string | undefined): Promise<void> {
    try {
      let raw: string;
      try {
        raw = readFileSync(CRASH_MARKER_PATH, 'utf-8');
      } catch {
        return; // no marker — clean startup
      }

      const info = JSON.parse(raw) as { time: string; error: string };
      unlinkSync(CRASH_MARKER_PATH);
      logger.warn({ crashInfo: info }, 'Crash recovery: previous process crashed');

      if (!ownerChatId) return;

      // Use 'general' bot to send crash notification (consistent sender)
      const adapter = this.orchestrator?.getRegistry().get('telegram', 'general');
      if (!adapter) return;

      const timeStr = new Date(info.time).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      await adapter.sendMessage(ownerChatId, [
        `🔄 服務已自動重啟`,
        `上次崩潰時間：${timeStr}`,
        `錯誤：${info.error}`,
      ].join('\n'));
    } catch (err) {
      logger.error({ err }, 'Failed to send crash recovery notification');
    }
  }

  // --- v2.0: Activity system helpers ---

  /**
   * Create ActivityService with agent name/personality resolvers.
   */
  private createActivityService(agentLoader: AgentLoader, persistence: PersistenceLayer | null): ActivityService {
    const getAgentName = (agentId: string) => agentLoader.get(agentId)?.config.name ?? agentId;
    const readPersonality = this.buildPersonalityReader(agentLoader);

    const reactionGenerator = new ReactionGenerator({
      getAgentName,
      getAgentPersonality: readPersonality,
    });

    // Store for IdleMutterScheduler to reuse
    this._reactionGenerator = reactionGenerator;

    // Create ActivityRepository if persistence is available
    let activityRepository: ActivityRepository | undefined;
    if (persistence) {
      activityRepository = new ActivityRepository(persistence.databaseManager.getDatabase());
      logger.info('ActivityRepository enabled (events will be persisted)');
    }

    return new ActivityService({
      getAgentName,
      // ReactionGenerator disabled by default — Haiku reactions/mood generation
      // consume API credits with limited value. Enable by uncommenting below.
      // reactionGenerator,
      activityRepository,
      bufferSize: ACTIVITY_BUFFER_SIZE,
    });
  }

  /**
   * Build a cached personality reader (shared by ReactionGenerator).
   */
  private buildPersonalityReader(agentLoader: AgentLoader): (agentId: string) => string | undefined {
    const personalityCache = new Map<string, string | undefined>();

    return (agentId: string): string | undefined => {
      if (personalityCache.has(agentId)) return personalityCache.get(agentId);

      const agent = agentLoader.get(agentId);
      if (!agent) return undefined;

      const personaDir = path.join(agent.path, '.claude', 'skills', 'persona', 'references');
      const soulPath = path.join(personaDir, 'soul.md');
      const identityPath = path.join(personaDir, 'identity.md');

      let combined = '';

      // Read identity.md first (name, role, appearance — brief context)
      try {
        combined += readFileSync(identityPath, 'utf-8').trim() + '\n\n';
      } catch {
        // identity.md is optional
      }

      // Read soul.md (personality, tone, quirks — core content)
      try {
        combined += readFileSync(soulPath, 'utf-8').trim();
      } catch {
        // Fall back to agent.json description if no soul.md
        if (!combined) {
          const desc = agent.config.description;
          personalityCache.set(agentId, desc);
          return desc;
        }
      }

      const result = combined.trim() || undefined;
      personalityCache.set(agentId, result);
      return result;
    };
  }

  /**
   * Initialize idle mutter scheduler.
   */
  private initializeIdleMutterScheduler(
    activityService: ActivityService,
    agentLoader: AgentLoader,
  ): void {
    if (!this._reactionGenerator) {
      logger.warn('ReactionGenerator not available, skipping IdleMutterScheduler');
      return;
    }

    const broadcaster = this.sseBroadcaster;
    this.idleMutterScheduler = new IdleMutterScheduler({
      activityService,
      reactionGenerator: this._reactionGenerator,
      agentLoader,
      hasActiveViewers: () => (broadcaster?.clientCount ?? 0) > 0,
    });
    this.idleMutterScheduler.start();
  }
}

/**
 * Internal type grouping all persistence-related instances.
 */
interface PersistenceLayer {
  databaseManager: DatabaseManager;
  sessionRepository: SessionRepository;
  conversationRepository: ConversationRepository;
  groupMessageRepository: GroupMessageRepository;
  injectionStateRepository: InjectionStateRepository;
  groupMemberRepository: GroupMemberRepository;
  queryMetricsRepository: QueryMetricsRepository;
  contextInjector: ContextInjector;
  executionRecordRepository: ExecutionRecordRepository;
  taskRecordRepository: TaskRecordRepository;
}
