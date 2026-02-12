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
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { AppConfig } from './config.js';
import type { IQueryMetricsRepository } from './persistence/types.js';

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

    const messageProcessor = this.createMessageProcessor(
      sessionManager,
      agentLoader,
      persistence?.conversationRepository,
      persistence?.contextInjector,
      persistence?.queryMetricsRepository,
      activityService
    );

    this.orchestrator = this.createOrchestrator(
      agentLoader,
      sessionManager,
      messageProcessor,
      securityConfig,
      persistence,
      activityService
    );

    await this.orchestrator.startAll();

    await this.initializeScheduleSystem(
      agentLoader,
      persistence?.databaseManager ?? null,
      persistence?.queryMetricsRepository
    );

    await this.initializeWebUI(
      agentLoader,
      sessionManager,
      persistence,
      activityService
    );

    // v2.0: Start idle mutter scheduler (cost-optimized: 5min interval, 30% chance, 3/hr cap, viewers-only)
    this.initializeIdleMutterScheduler(activityService);

    // v2.0: Track all agents for activity (so idle detection works from startup)
    for (const agentId of agentLoader.list()) {
      activityService.trackActivity(agentId);
    }

    this.logStartupSummary(agentLoader);
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
  ): MessageProcessor {
    // Note: getAdapter and getBotInfo reference orchestrator via closure (lazy resolution)
    return new MessageProcessor({
      sessionManager,
      getAdapter: (platform, agentId) =>
        this.orchestrator?.getRegistry().get(platform, agentId),
      getSystemPrompt: (agentId) => agentLoader.readSystemPrompt(agentId),
      sendTypingIndicators: true,
      typingIndicatorIntervalMs: 5000,
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
    });
  }

  private createOrchestrator(
    agentLoader: AgentLoader,
    sessionManager: SessionManager,
    messageProcessor: MessageProcessor,
    securityConfig: ReturnType<typeof loadSecurityConfig>,
    persistence: PersistenceLayer | null,
    activityService?: ActivityService
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
    });
  }

  private async initializeScheduleSystem(
    agentLoader: AgentLoader,
    databaseManager: DatabaseManager | null,
    queryMetricsRepository?: IQueryMetricsRepository
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
      queryMetricsRepository
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

    await this.webUIServer.start();
    logger.info({ port, url: `http://localhost:${port}` }, 'WebUI started');
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
      reactionGenerator,
      activityRepository,
      bufferSize: 200,
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

      const soulPath = path.join(agent.path, '.claude', 'skills', 'persona', 'references', 'soul.md');
      try {
        const content = readFileSync(soulPath, 'utf-8');
        personalityCache.set(agentId, content);
        return content;
      } catch {
        const desc = agent.config.description;
        personalityCache.set(agentId, desc);
        return desc;
      }
    };
  }

  /**
   * Initialize idle mutter scheduler.
   */
  private initializeIdleMutterScheduler(
    activityService: ActivityService,
  ): void {
    if (!this._reactionGenerator) {
      logger.warn('ReactionGenerator not available, skipping IdleMutterScheduler');
      return;
    }

    const broadcaster = this.sseBroadcaster;
    this.idleMutterScheduler = new IdleMutterScheduler({
      activityService,
      reactionGenerator: this._reactionGenerator,
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
}
