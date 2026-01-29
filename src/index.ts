import 'dotenv/config';
import { logger } from './utils/logger.js';
import { AgentLoader } from './core/AgentLoader.js';
import { SessionManager } from './core/SessionManager.js';
import { MessageProcessor } from './core/MessageProcessor.js';
import { SDKQueryManager } from './core/SDKQueryManager.js';
import { PlatformOrchestrator } from './core/PlatformOrchestrator.js';
import { loadSecurityConfig } from './utils/security.js';
import { DatabaseManager } from './persistence/DatabaseManager.js';
import { SessionRepository } from './persistence/SessionRepository.js';
import { ConversationRepository } from './persistence/ConversationRepository.js';
import { ScheduleRepository } from './persistence/ScheduleRepository.js';
import { WebUIServer } from './webui/index.js';
import {
  ScheduleLoader,
  CronScheduler,
  ScheduleExecutor,
  ScheduleNotifier,
  ScheduleManager,
} from './schedule/index.js';

// Global references for cleanup
let orchestrator: PlatformOrchestrator | null = null;
let sessionManager: SessionManager | null = null;
let databaseManager: DatabaseManager | null = null;
let webUIServer: WebUIServer | null = null;
let scheduleManager: ScheduleManager | null = null;

const main = async (): Promise<void> => {
  logger.info('ClaudeCab v1.0.0 starting...');
  logger.info({ nodeVersion: process.version }, 'Environment info');

  // Load security configuration (from env vars, applies to all adapters)
  const securityConfig = loadSecurityConfig();

  // Initialize AgentLoader
  logger.info('Initializing AgentLoader...');
  const agentLoader = new AgentLoader();

  // Scan and load available agents
  const agentIds = await agentLoader.scanAgents();
  if (agentIds.length === 0) {
    throw new Error('No agents found in agents/ directory. Please create at least one agent.');
  }

  logger.info({ agentCount: agentIds.length, agentIds }, 'Available agents');

  // Pre-load all agents
  await agentLoader.loadAllAgents();
  logger.info({ loadedCount: agentLoader.list().length }, 'Agents loaded');

  // Check for agents with platform tokens
  const agentsWithTokens = agentLoader.getAgentsWithPlatformTokens();
  if (agentsWithTokens.length === 0) {
    logger.warn(
      'No agents have platform bot tokens configured. Add telegramBotToken to agent.json files.'
    );
  }

  // Initialize persistence (if enabled)
  const enablePersistence = process.env.ENABLE_PERSISTENCE === 'true';
  let sessionRepository: SessionRepository | undefined;
  let conversationRepository: ConversationRepository | undefined;

  if (enablePersistence) {
    const dbPath = process.env.DB_PATH ?? './data/claudecab.db';
    logger.info({ dbPath }, 'Initializing persistence...');

    databaseManager = new DatabaseManager({ dbPath });
    databaseManager.initialize();

    sessionRepository = new SessionRepository(databaseManager.getDatabase());
    conversationRepository = new ConversationRepository(databaseManager.getDatabase());

    logger.info('Persistence enabled');
  }

  // Initialize SessionManager
  logger.info('Initializing SessionManager...');
  sessionManager = new SessionManager({
    agentLoader,
    config: {
      sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS ?? '3600000', 10),
      cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS ?? '60000', 10),
      maxSessions: parseInt(process.env.MAX_SESSIONS ?? '1000', 10),
      dbRetentionMs: parseInt(process.env.DB_RETENTION_MS ?? '2592000000', 10), // 30 days
    },
    sessionRepository,
  });
  sessionManager.start();

  // Restore sessions from database (if persistence is enabled)
  if (enablePersistence && sessionRepository !== undefined) {
    const restoredSessions = await sessionManager.restoreSessions();
    logger.info({ restoredSessions }, 'Session restoration complete');
  }

  // Create message processor
  // Note: getAdapter uses orchestrator's registry, resolved lazily via closure
  const messageProcessor = new MessageProcessor({
    sessionManager,
    getAdapter: (platform, agentId) => orchestrator?.getRegistry().get(platform, agentId),
    getSystemPrompt: (agentId) => agentLoader.readSystemPrompt(agentId),
    sendTypingIndicators: true,
    typingIndicatorIntervalMs: 5000,
    ...(conversationRepository !== undefined ? { conversationRepository } : {}),
  });

  // Initialize PlatformOrchestrator
  logger.info('Initializing PlatformOrchestrator...');
  orchestrator = new PlatformOrchestrator({
    agentLoader,
    sessionManager,
    messageProcessor,
    securityConfig,
    ...(scheduleManager !== null ? { scheduleManager } : {}),
  });

  // Start all platform adapters (one per agent with a platform token)
  await orchestrator.startAll();

  // Initialize Schedule System (if persistence is enabled)
  const scheduleEnabled = process.env.SCHEDULE_ENABLED !== 'false'; // Default enabled
  let scheduleRepository: ScheduleRepository | undefined;

  if (scheduleEnabled) {
    logger.info('Initializing Schedule System...');

    // Create schedule repository (if persistence is enabled)
    if (enablePersistence && databaseManager !== null) {
      scheduleRepository = new ScheduleRepository(databaseManager.getDatabase());
    }

    // Create schedule components
    const scheduleLoader = new ScheduleLoader(agentLoader.getAgentsDir());

    // Create SDK query manager for schedule execution
    const sdkManager = new SDKQueryManager();

    // Create notifier with adapters from orchestrator (will be populated after start)
    const scheduleNotifier = new ScheduleNotifier(new Map());

    // Create executor
    const scheduleExecutor = new ScheduleExecutor(
      agentLoader,
      sdkManager,
      scheduleNotifier,
      scheduleRepository
    );

    // Create cron scheduler
    const cronScheduler = new CronScheduler(scheduleExecutor);

    // Create manager
    scheduleManager = new ScheduleManager(
      scheduleLoader,
      cronScheduler,
      scheduleRepository
    );

    // Initialize (load and register schedules)
    await scheduleManager.initialize();

    // Populate notifier with adapters from orchestrator (keyed by agentId)
    for (const adapter of orchestrator.getRegistry().getAll()) {
      scheduleNotifier.addAdapter(adapter.agentId, adapter);
    }

    logger.info('Schedule System initialized');
  }

  // Initialize WebUI (if enabled)
  const webUIEnabled = process.env.WEBUI_ENABLED === 'true';
  if (webUIEnabled) {
    const webUIPort = parseInt(process.env.WEBUI_PORT ?? '3001', 10);
    logger.info({ port: webUIPort }, 'Initializing WebUI...');

    webUIServer = new WebUIServer({
      port: webUIPort,
      agentLoader,
      sessionManager,
      platformOrchestrator: orchestrator ?? undefined,
      databaseManager: databaseManager ?? undefined,
      sessionRepository,
      conversationRepository,
      scheduleManager: scheduleManager ?? undefined,
    });

    await webUIServer.start();
    logger.info({ port: webUIPort, url: `http://localhost:${webUIPort}` }, 'WebUI started');
  }

  const runningAdapters = orchestrator.getRunningAdapters();
  logger.info(
    {
      agentCount: agentIds.length,
      runningAdapters: runningAdapters.length,
      adapters: runningAdapters.map((a) => `${a.platform}::${a.agentId}`),
      persistenceEnabled: enablePersistence,
      webUIEnabled,
      scheduleEnabled,
    },
    'ClaudeCab initialized successfully'
  );
  logger.info('Bot is now running. Press Ctrl+C to stop.');
};

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Received shutdown signal, cleaning up...');

  try {
    // Stop WebUI server
    if (webUIServer !== null) {
      await webUIServer.stop();
    }

    // Stop schedule manager
    if (scheduleManager !== null) {
      scheduleManager.dispose();
      logger.info('Schedule manager disposed');
    }

    // Stop all platform adapters
    if (orchestrator !== null) {
      await orchestrator.stopAll();
    }

    // Dispose session manager
    if (sessionManager !== null) {
      sessionManager.dispose();
    }

    // Close database connection
    if (databaseManager !== null) {
      databaseManager.close();
      logger.info('Database connection closed');
    }

    logger.info('Cleanup complete, exiting');
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
  }

  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

main().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.fatal({ err, message: err.message }, 'Failed to start ClaudeCab');
  console.error('Startup error:', err.message);
  process.exit(1);
});
