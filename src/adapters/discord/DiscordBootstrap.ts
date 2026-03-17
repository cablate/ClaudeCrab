/**
 * Discord service bootstrap — extracts Discord-specific initialization from AppBootstrap.
 *
 * Creates and configures:
 * - System-level Discord adapter (main bot, not per-agent)
 * - Slash command registration
 * - InteractionHandler for button/command routing
 * - DiscordDashboard
 * - DiscordActivityReporter + ActivityEventService
 * - DiscordTaskSync + TaskService
 * - DiscordCostReport (daily cron)
 */

import { DiscordAdapter } from '../DiscordAdapter.js';
import { DiscordInteractionHandler } from './DiscordInteractionHandler.js';
import { registerSlashCommands } from './DiscordSlashCommands.js';
import { DiscordDashboard } from './services/DiscordDashboard.js';
import { DiscordCostReport } from './services/DiscordCostReport.js';
import { DiscordActivityReporter } from './services/DiscordActivityReporter.js';
import { DiscordTaskSync } from './services/DiscordTaskSync.js';
import { ActivityEventService } from '../../services/ActivityEventService.js';
import { TaskService } from '../../services/TaskService.js';
import { logger } from '../../utils/logger.js';

import type { AgentLoader } from '../../core/AgentLoader.js';
import type { MessageProcessor } from '../../core/MessageProcessor.js';
import type { SessionManager } from '../../core/SessionManager.js';
import type { PlatformOrchestrator } from '../../core/PlatformOrchestrator.js';
import type { BudgetService } from '../../services/BudgetService.js';
import type { AgentCallService } from '../../services/AgentCallService.js';
import type { QueryMetricsRepository } from '../../persistence/QueryMetricsRepository.js';
import type { TaskRecordRepository } from '../../persistence/TaskRecordRepository.js';
import type { ExecutionRecordRepository } from '../../persistence/ExecutionRecordRepository.js';

/** Dependencies required by Discord bootstrap */
export interface DiscordBootstrapDeps {
  agentLoader: AgentLoader;
  messageProcessor: MessageProcessor;
  sessionManager: SessionManager;
  orchestrator: PlatformOrchestrator | null;
  budgetService: BudgetService | null;
  agentCallService?: AgentCallService;
  discordConfig: {
    mainBotToken: string;
    mainBotClientId?: string | undefined;
    guildId?: string | undefined;
    ownerUserId?: string | undefined;
    channels: {
      dashboard?: string | undefined;
      systemLog?: string | undefined;
      alerts?: string | undefined;
      taskBoard?: string | undefined;
      costReport?: string | undefined;
    };
    dashboardUpdateMinutes?: number | undefined;
  };
  persistence: {
    queryMetricsRepository?: QueryMetricsRepository;
    taskRecordRepository?: TaskRecordRepository;
    executionRecordRepository?: ExecutionRecordRepository;
  } | null;
}

/** Services created by Discord bootstrap (returned to AppBootstrap for lifecycle management) */
export interface DiscordServices {
  systemAdapter: DiscordAdapter;
  dashboardService?: DiscordDashboard;
  activityEventService?: ActivityEventService;
  taskService?: TaskService;
  costReportTimer?: ReturnType<typeof setInterval>;
}

/**
 * Initialize all Discord-specific services.
 *
 * Creates a system-level Discord adapter and wires up Dashboard, ActivityReporter,
 * TaskSync, CostReport, and InteractionHandler.
 *
 * @returns DiscordServices for lifecycle management, or null if initialization fails
 */
export async function initializeDiscordServices(
  deps: DiscordBootstrapDeps
): Promise<DiscordServices | null> {
  const {
    agentLoader, messageProcessor, sessionManager, orchestrator,
    budgetService, agentCallService, discordConfig, persistence,
  } = deps;
  const { mainBotToken, channels, dashboardUpdateMinutes } = discordConfig;

  // === SYSTEM ADAPTER ===
  logger.info('Creating Discord system bot...');
  const systemAdapterConfig = {
    platform: 'discord' as const,
    agentId: '_system',
    token: mainBotToken,
    channelId: channels.systemLog || channels.dashboard || '',
  };

  const discordAdapter = new DiscordAdapter(systemAdapterConfig);
  try {
    await discordAdapter.initialize();
    logger.info('Discord system bot authenticated');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Discord system bot — skipping Discord services');
    return null;
  }

  const result: DiscordServices = { systemAdapter: discordAdapter };

  logger.info('Initializing Discord services...');

  // === SLASH COMMANDS ===
  if (discordConfig.mainBotClientId && discordConfig.guildId) {
    await registerSlashCommands(mainBotToken, discordConfig.mainBotClientId, discordConfig.guildId);
  }

  // === INTERACTION HANDLER ===
  const systemClient = discordAdapter.getClient();
  if (systemClient !== null) {
    const interactionHandler = new DiscordInteractionHandler({
      client: systemClient,
      adapters: new Map(),
      slashCommandDeps: {
        agentLoader,
        sessionManager,
        messageProcessor,
        ...(budgetService !== null ? { budgetService } : {}),
        // taskService is created later — use getter for lazy resolution
        get taskService() { return result.taskService; },
        ...(persistence?.queryMetricsRepository !== undefined
          ? { queryMetricsRepository: persistence.queryMetricsRepository }
          : {}),
        get sdkSessionManager() { return messageProcessor.sdkSession; },
        ...(orchestrator !== null ? {
          getBotStatus: (agentId: string, platform?: 'telegram' | 'discord') =>
            orchestrator!.getBotStatusForAgent(agentId, platform),
        } : {}),
      },
    });

    // Register agent Discord adapters for button routing
    if (orchestrator !== null) {
      for (const adapter of orchestrator.getRegistry().getAll()) {
        if (adapter.platform === 'discord') {
          interactionHandler.registerAdapter(adapter.agentId, adapter as DiscordAdapter);
        }
      }
    }
  }

  // === DASHBOARD ===
  if (channels.dashboard) {
    const dashboardService = new DiscordDashboard({
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
      ...(budgetService !== null
        ? { budgetService }
        : {}),
      ...(dashboardUpdateMinutes !== undefined
        ? { updateIntervalMinutes: dashboardUpdateMinutes }
        : {}),
    });
    await dashboardService.start();
    result.dashboardService = dashboardService;
    logger.info({ channelId: channels.dashboard }, 'Dashboard service started');
  }

  // === ACTIVITY EVENT SERVICE (pure service + Discord notifier) ===
  if (channels.systemLog || channels.alerts) {
    const discordReporter = new DiscordActivityReporter({
      discordAdapter,
      ...(channels.systemLog ? { systemLogChannelId: channels.systemLog } : {}),
      ...(channels.alerts ? { alertsChannelId: channels.alerts } : {}),
    });
    result.activityEventService = new ActivityEventService({
      notifier: discordReporter,
      ...(discordConfig.ownerUserId ? { ownerUserId: discordConfig.ownerUserId } : {}),
    });
    logger.info('ActivityEventService started (with Discord notifier)');
  }

  // === TASK SERVICE (SQLite + optional Discord Forum sync) ===
  if (persistence?.taskRecordRepository !== undefined) {
    // Wire agentCallService -> taskRecordRepository (two-layer thread architecture)
    if (agentCallService !== undefined) {
      agentCallService.setTaskRecordRepository(persistence.taskRecordRepository);
    }

    let threadNotifier: DiscordTaskSync | undefined;
    if (channels.taskBoard) {
      threadNotifier = new DiscordTaskSync({
        discordAdapter,
        forumChannelId: channels.taskBoard,
        taskRecordRepository: persistence.taskRecordRepository,
        ...(agentCallService !== undefined ? { agentCallService } : {}),
      });
    }

    result.taskService = new TaskService({
      taskRecordRepository: persistence.taskRecordRepository,
      ...(threadNotifier !== undefined ? { threadNotifier } : {}),
    });

    if (threadNotifier !== undefined) {
      // startForumListener also calls startUserMessageListener internally
      threadNotifier.startForumListener();
    }
    logger.info('TaskService started (Forum listener + User message listener active)');
  }

  // === COST REPORT (daily cron) ===
  if (channels.costReport && persistence?.queryMetricsRepository !== undefined) {
    const costReportService = new DiscordCostReport({
      adapter: discordAdapter,
      channelId: channels.costReport,
      agentLoader,
      queryMetricsRepository: persistence.queryMetricsRepository,
      ...(budgetService !== null ? { budgetService } : {}),
    });

    let lastCostReportDate = '';
    const timer = setInterval(() => {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      if (now.getHours() === 23 && now.getMinutes() >= 55 && dateStr !== lastCostReportDate) {
        lastCostReportDate = dateStr;
        void costReportService.sendDailyReport().catch((err) => {
          logger.error({ err }, 'Failed to send daily cost report');
        });
      }
    }, 5 * 60 * 1000);
    timer.unref();
    result.costReportTimer = timer;
    logger.info({ channelId: channels.costReport }, 'CostReport daily cron started');
  }

  logger.info('Discord services initialized');
  return result;
}
