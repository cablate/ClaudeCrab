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
import { initializeDiscordOpsServices, type DiscordOpsServices } from './services/DiscordOpsServices.js';
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
  ops: DiscordOpsServices;
}

/**
 * Initialize all Discord-specific services.
 *
 * Creates a system-level Discord adapter and wires up dashboard, cost reports,
 * cache anomaly reports, and interaction handling.
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
    ...(discordConfig.ownerUserId !== undefined ? { ownerUserId: discordConfig.ownerUserId } : {}),
  };

  const discordAdapter = new DiscordAdapter(systemAdapterConfig);
  try {
    await discordAdapter.initialize();
    logger.info('Discord system bot authenticated');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Discord system bot — skipping Discord services');
    return null;
  }

  const result: DiscordServices = { systemAdapter: discordAdapter, ops: {} };

  logger.info('Initializing Discord services...');

  // === INTERACTION HANDLER ===
  // Must be set up before parallel tasks so that lazy getters on `result` are
  // wired correctly before any service (e.g. taskService) populates `result`.
  const systemClient = discordAdapter.getClient();
  if (systemClient !== null) {
    const orchestratorCommandDeps = orchestrator !== null
      ? {
          getBotStatus: (agentId: string) => orchestrator.getBotStatusForAgent(agentId),
          reloadAgent: (agentId: string) => orchestrator.reloadAgent(agentId),
        }
      : {};

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
        ...(discordConfig.ownerUserId !== undefined ? { ownerUserId: discordConfig.ownerUserId } : {}),
        ...(discordConfig.guildId !== undefined ? { guildId: discordConfig.guildId } : {}),
        get sdkSessionManager() { return messageProcessor.sdkSession; },
        ...orchestratorCommandDeps,
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

  if (discordConfig.mainBotClientId && discordConfig.guildId) {
    await registerSlashCommands(mainBotToken, discordConfig.mainBotClientId, discordConfig.guildId)
      .catch((error) => logger.error({ error }, 'Slash command registration failed'));
  }

  result.ops = await initializeDiscordOpsServices({
    adapter: discordAdapter,
    agentLoader,
    channels,
    ...(dashboardUpdateMinutes !== undefined ? { dashboardUpdateMinutes } : {}),
    persistence,
  });

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
