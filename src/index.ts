import 'dotenv/config';
import { logger } from './utils/logger.js';
import { AgentLoader } from './core/AgentLoader.js';
import { SessionManager } from './core/SessionManager.js';
import { MessageProcessor } from './core/MessageProcessor.js';
import { TelegramAdapter } from './adapters/TelegramAdapter.js';
import { AdapterRegistry } from './core/AdapterRegistry.js';
import { loadSecurityConfig } from './utils/security.js';
import { DatabaseManager } from './persistence/DatabaseManager.js';
import { SessionRepository } from './persistence/SessionRepository.js';
import { ConversationRepository } from './persistence/ConversationRepository.js';
import { WebUIServer } from './webui/index.js';

// Global references for cleanup
let adapterRegistry: AdapterRegistry | null = null;
let sessionManager: SessionManager | null = null;
let databaseManager: DatabaseManager | null = null;
let webUIServer: WebUIServer | null = null;

const main = async (): Promise<void> => {
  logger.info('ClaudeCab v1.0.0 starting...');
  logger.info({ nodeVersion: process.version }, 'Environment info');

  // Validate required environment variables
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';

  if (telegramToken === undefined || telegramToken === '') {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
  }

  // Load security configuration
  const securityConfig = loadSecurityConfig();

  // Get default agent from environment or use 'general'
  const defaultAgentIdEnv = process.env.DEFAULT_AGENT ?? 'general';

  // Initialize AgentLoader
  logger.info('Initializing AgentLoader...');
  const agentLoader = new AgentLoader();

  // Scan and load available agents
  const agentIds = await agentLoader.scanAgents();
  if (agentIds.length === 0) {
    throw new Error('No agents found in agents/ directory. Please create at least one agent.');
  }

  logger.info({ agentCount: agentIds.length, agentIds }, 'Available agents');

  // Verify default agent exists
  if (!agentIds.includes(defaultAgentIdEnv)) {
    logger.warn(
      { defaultAgentId: defaultAgentIdEnv, availableAgents: agentIds },
      'Default agent not found, using first available'
    );
  }

  // Ensure we have a valid default agent
  const firstAgent = agentIds[0];
  if (firstAgent === undefined) {
    throw new Error('No agents available');
  }
  const actualDefaultAgent: string = agentIds.includes(defaultAgentIdEnv)
    ? defaultAgentIdEnv
    : firstAgent;

  // Pre-load all agents (so they appear in WebUI and can be switched to)
  await agentLoader.loadAllAgents();
  logger.info({ loadedCount: agentLoader.list().length }, 'Agents loaded');

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
    defaultAgentId: actualDefaultAgent,
    config: {
      sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS ?? '3600000', 10),
      cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS ?? '60000', 10),
      maxSessions: parseInt(process.env.MAX_SESSIONS ?? '1000', 10),
    },
    sessionRepository,
  });
  sessionManager.start();

  // Restore sessions from database (if persistence is enabled)
  if (enablePersistence && sessionRepository !== undefined) {
    const restoredSessions = await sessionManager.restoreSessions();
    logger.info({ restoredSessions }, 'Session restoration complete');
  }

  // Initialize AdapterRegistry
  adapterRegistry = new AdapterRegistry();

  // Initialize TelegramAdapter (without command dependencies - set later)
  logger.info('Initializing TelegramAdapter...');
  const telegramAdapter = new TelegramAdapter({
    platform: 'telegram',
    token: telegramToken,
    securityConfig,
  });

  // Create message processor
  const messageProcessor = new MessageProcessor({
    sessionManager,
    defaultAgentId: actualDefaultAgent,
    getAdapter: () => telegramAdapter,
    sendTypingIndicators: true,
    typingIndicatorIntervalMs: 5000,
    apiKey: anthropicKey,
    conversationRepository,
  });

  // Set command dependencies now that all components are created
  // This is the proper decoupled architecture: pass actual instances directly
  telegramAdapter.setCommandDependencies({
    agentLoader,
    sessionManager,
    messageProcessor,
    defaultAgentId: actualDefaultAgent,
  });

  // Restore conversations for existing sessions (if persistence is enabled)
  if (enablePersistence && conversationRepository !== undefined) {
    const sessionIds = sessionManager.getAllSessions().map((s) => s.sessionId);
    const restoredConversations = messageProcessor.restoreConversations(sessionIds);
    logger.info({ restoredConversations }, 'Conversation restoration complete');
  }

  // Set up message handling
  telegramAdapter.onMessage(async (message) => {
    await messageProcessor.processMessage(message);
  });

  // Register adapter
  adapterRegistry.register(telegramAdapter);

  // Initialize and start all adapters
  logger.info('Starting adapters...');
  await adapterRegistry.initializeAll();
  await adapterRegistry.startAll();

  // Initialize WebUI (if enabled)
  const webUIEnabled = process.env.WEBUI_ENABLED === 'true';
  if (webUIEnabled) {
    const webUIPort = parseInt(process.env.WEBUI_PORT ?? '3001', 10);
    logger.info({ port: webUIPort }, 'Initializing WebUI...');

    webUIServer = new WebUIServer({
      port: webUIPort,
      agentLoader,
      sessionManager,
      databaseManager: databaseManager ?? undefined,
      sessionRepository,
      conversationRepository,
    });

    await webUIServer.start();
    logger.info({ port: webUIPort, url: `http://localhost:${webUIPort}` }, 'WebUI started');
  }

  logger.info(
    {
      defaultAgent: actualDefaultAgent,
      agentCount: agentIds.length,
      platform: 'telegram',
      persistenceEnabled: enablePersistence,
      webUIEnabled,
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

    // Stop all adapters
    if (adapterRegistry !== null) {
      await adapterRegistry.stopAll();
      await adapterRegistry.disposeAll();
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
