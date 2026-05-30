/**
 * Discord service bootstrap — extracts Discord-specific initialization from AppBootstrap.
 *
 * Creates and configures:
 * - System-level Discord adapter (main bot, not per-agent)
 * - Slash command registration
 * - InteractionHandler for button/command routing
 * - DiscordDashboard
 * - DiscordCostReport (daily cron)
 * - DiscordCacheAnomalyReport (daily cron)
 */

import { DiscordAdapter } from '../DiscordAdapter.js';
import { DiscordInteractionHandler } from './DiscordInteractionHandler.js';
import { registerSlashCommands } from './DiscordSlashCommands.js';
import { DiscordDashboard } from './services/DiscordDashboard.js';
import { DiscordCostReport } from './services/DiscordCostReport.js';
import { DiscordCacheAnomalyReport } from './services/DiscordCacheAnomalyReport.js';
import { logger } from '../../utils/logger.js';

import type { AgentLoader } from '../../core/orchestrator/AgentLoader.js';
import type { MessageProcessor } from '../../core/orchestrator/MessageProcessor.js';
import type { SessionManager } from '../../core/session/SessionManager.js';
import type { PlatformOrchestrator } from '../../core/orchestrator/PlatformOrchestrator.js';
import type { QueryMetricsRepository } from '../../persistence/QueryMetricsRepository.js';
import type { RateLimitRepository } from '../../persistence/RateLimitRepository.js';

/** Dependencies required by Discord bootstrap */
export interface DiscordBootstrapDeps {
  agentLoader: AgentLoader;
  messageProcessor: MessageProcessor;
  sessionManager: SessionManager;
  orchestrator: PlatformOrchestrator | null;
  discordConfig: {
    mainBotToken: string;
    mainBotClientId?: string | undefined;
    guildId?: string | undefined;
    ownerUserId?: string | undefined;
    channels: {
      dashboard?: string | undefined;
      systemLog?: string | undefined;
      alerts?: string | undefined;
      costReport?: string | undefined;
    };
    dashboardUpdateMinutes?: number | undefined;
  };
  persistence: {
    queryMetricsRepository?: QueryMetricsRepository;
    rateLimitRepository?: RateLimitRepository;
  } | null;
}

/** Services created by Discord bootstrap (returned to AppBootstrap for lifecycle management) */
export interface DiscordServices {
  systemAdapter: DiscordAdapter;
  dashboardService?: DiscordDashboard;
  costReportTimer?: ReturnType<typeof setInterval>;
  cacheAnomalyReportTimer?: ReturnType<typeof setInterval>;
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
    discordConfig, persistence,
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

  // === INTERACTION HANDLER ===
  // Must be set up before parallel tasks so that lazy getters on `result` are
  // wired correctly before any service (e.g. taskService) populates `result`.
  const systemClient = discordAdapter.getClient();
  if (systemClient !== null) {
    const interactionHandler = new DiscordInteractionHandler({
      client: systemClient,
      adapters: new Map(),
      slashCommandDeps: {
        agentLoader,
        sessionManager,
        messageProcessor,
        ...(persistence?.queryMetricsRepository !== undefined
          ? { queryMetricsRepository: persistence.queryMetricsRepository }
          : {}),
        get sdkSessionManager() { return messageProcessor.sdkSession; },
        ...(orchestrator !== null ? {
          getBotStatus: (agentId: string) =>
            orchestrator!.getBotStatusForAgent(agentId),
        } : {}),
        ...(orchestrator !== null ? {
          reloadAgent: (agentId: string) => orchestrator!.reloadAgent(agentId),
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

  // === PARALLEL: SLASH COMMANDS + DASHBOARD ===
  // These two are independent of each other and only depend on the already-
  // authenticated discordAdapter, so they can be started concurrently.
  // Promise.allSettled ensures one failure does not abort the other.
  {
    const slashCommandsTask = (discordConfig.mainBotClientId && discordConfig.guildId)
      ? registerSlashCommands(mainBotToken, discordConfig.mainBotClientId, discordConfig.guildId)
      : Promise.resolve();

    let pendingDashboard: DiscordDashboard | undefined;
    const dashboardTask = channels.dashboard
      ? (() => {
          pendingDashboard = new DiscordDashboard({
            adapter: discordAdapter,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by outer if check
            channelId: channels.dashboard!,
            agentLoader,
            ...(persistence?.queryMetricsRepository !== undefined
              ? { queryMetricsRepository: persistence.queryMetricsRepository }
              : {}),
            ...(persistence?.rateLimitRepository !== undefined
              ? { rateLimitRepository: persistence.rateLimitRepository }
              : {}),
            ...(dashboardUpdateMinutes !== undefined
              ? { updateIntervalMinutes: dashboardUpdateMinutes }
              : {}),
          });
          return pendingDashboard.start();
        })()
      : Promise.resolve();

    const [slashResult, dashResult] = await Promise.allSettled([slashCommandsTask, dashboardTask]);

    if (slashResult.status === 'rejected') {
      logger.error({ error: slashResult.reason }, 'Slash command registration failed');
    }

    if (dashResult.status === 'rejected') {
      logger.error({ error: dashResult.reason }, 'Dashboard service failed to start');
    } else if (pendingDashboard !== undefined) {
      result.dashboardService = pendingDashboard;
      logger.info({ channelId: channels.dashboard }, 'Dashboard service started');
    }
  }

  // === COST REPORT (daily cron) ===
  if (channels.costReport && persistence?.queryMetricsRepository !== undefined) {
    const costReportService = new DiscordCostReport({
      adapter: discordAdapter,
      channelId: channels.costReport,
      agentLoader,
      queryMetricsRepository: persistence.queryMetricsRepository,
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

  // === CACHE ANOMALY REPORT (daily, runs at 23:50) ===
  const cacheAnomalyChannelId = channels.alerts ?? channels.costReport;
  if (cacheAnomalyChannelId) {
    const cacheAnomalyService = new DiscordCacheAnomalyReport({
      adapter: discordAdapter,
      channelId: cacheAnomalyChannelId,
    });

    let lastCacheAnomalyReportDate = '';
    const cacheTimer = setInterval(() => {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      if (now.getHours() === 23 && now.getMinutes() >= 50 && now.getMinutes() < 55 && dateStr !== lastCacheAnomalyReportDate) {
        lastCacheAnomalyReportDate = dateStr;
        void cacheAnomalyService.sendDailyReport().catch((err) => {
          logger.error({ err }, 'Failed to send cache anomaly report');
        });
      }
    }, 5 * 60 * 1000);
    cacheTimer.unref();
    result.cacheAnomalyReportTimer = cacheTimer;
    logger.info({ channelId: cacheAnomalyChannelId }, 'CacheAnomalyReport daily cron started');
  }

  logger.info('Discord services initialized');
  return result;
}

/**
 * Check for a crash marker left by a previous process and notify via Discord.
 */
export async function notifyCrashRecovery(
  adapter: DiscordAdapter,
  channels: { systemLog?: string; alerts?: string; dashboard?: string }
): Promise<void> {
  const { readFileSync, unlinkSync } = await import('node:fs');
  const { CRASH_MARKER_PATH } = await import('../../constants.js');

  let raw: string;
  try {
    raw = readFileSync(CRASH_MARKER_PATH, 'utf-8');
  } catch {
    return;
  }

  try {
    const info = JSON.parse(raw) as { time: string; error: string };
    unlinkSync(CRASH_MARKER_PATH);
    logger.warn({ crashInfo: info }, 'Crash recovery: previous process crashed');

    const channelId = channels.systemLog || channels.alerts || channels.dashboard;
    if (!channelId) return;

    const timeStr = new Date(info.time).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    await adapter.sendToChannel(
      channelId,
      [`ClaudeCab recovered from a previous crash.`, `Time: ${timeStr}`, `Error: ${info.error}`].join('\n')
    );
  } catch (err) {
    logger.error({ err }, 'Failed to send crash recovery notification');
  }
}
