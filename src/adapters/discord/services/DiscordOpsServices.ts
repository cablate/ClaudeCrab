import { DiscordAdapter } from '../../DiscordAdapter.js';
import { DiscordDashboard } from './DiscordDashboard.js';
import { DiscordCostReport } from './DiscordCostReport.js';
import { DiscordCacheAnomalyReport } from './DiscordCacheAnomalyReport.js';
import { logger } from '../../../utils/logger.js';

import type { AgentLoader } from '../../../core/orchestrator/AgentLoader.js';
import type { QueryMetricsRepository } from '../../../persistence/QueryMetricsRepository.js';
import type { RateLimitRepository } from '../../../persistence/RateLimitRepository.js';

export interface DiscordOpsDeps {
  adapter: DiscordAdapter;
  agentLoader: AgentLoader;
  channels: {
    dashboard?: string | undefined;
    alerts?: string | undefined;
    costReport?: string | undefined;
  };
  dashboardUpdateMinutes?: number | undefined;
  persistence: {
    queryMetricsRepository?: QueryMetricsRepository;
    rateLimitRepository?: RateLimitRepository;
  } | null;
}

export interface DiscordOpsServices {
  dashboardService?: DiscordDashboard;
  costReportTimer?: ReturnType<typeof setInterval>;
  cacheAnomalyReportTimer?: ReturnType<typeof setInterval>;
}

export async function initializeDiscordOpsServices(deps: DiscordOpsDeps): Promise<DiscordOpsServices> {
  const result: DiscordOpsServices = {};

  const dashboard = await startDashboard(deps).catch((error) => {
    logger.error({ error }, 'Dashboard service failed to start');
    return undefined;
  });
  if (dashboard !== undefined) {
    result.dashboardService = dashboard;
  }

  const costReportTimer = startCostReportTimer(deps);
  if (costReportTimer !== undefined) {
    result.costReportTimer = costReportTimer;
  }

  const cacheAnomalyReportTimer = startCacheAnomalyReportTimer(deps);
  if (cacheAnomalyReportTimer !== undefined) {
    result.cacheAnomalyReportTimer = cacheAnomalyReportTimer;
  }

  return result;
}

async function startDashboard(deps: DiscordOpsDeps): Promise<DiscordDashboard | undefined> {
  const { adapter, agentLoader, channels, dashboardUpdateMinutes, persistence } = deps;
  if (!channels.dashboard) return undefined;

  const dashboard = new DiscordDashboard({
    adapter,
    channelId: channels.dashboard,
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

  await dashboard.start();
  logger.info({ channelId: channels.dashboard }, 'Dashboard service started');
  return dashboard;
}

function startCostReportTimer(deps: DiscordOpsDeps): ReturnType<typeof setInterval> | undefined {
  const { adapter, agentLoader, channels, persistence } = deps;
  if (!channels.costReport || persistence?.queryMetricsRepository === undefined) return undefined;

  const costReportService = new DiscordCostReport({
    adapter,
    channelId: channels.costReport,
    agentLoader,
    queryMetricsRepository: persistence.queryMetricsRepository,
  });

  const timer = startDailyWindowTimer({
    label: 'daily cost report',
    hour: 23,
    minuteFrom: 55,
    send: () => costReportService.sendDailyReport(),
  });
  logger.info({ channelId: channels.costReport }, 'CostReport daily cron started');
  return timer;
}

function startCacheAnomalyReportTimer(deps: DiscordOpsDeps): ReturnType<typeof setInterval> | undefined {
  const { adapter, channels } = deps;
  const channelId = channels.alerts ?? channels.costReport;
  if (!channelId) return undefined;

  const cacheAnomalyService = new DiscordCacheAnomalyReport({
    adapter,
    channelId,
  });

  const timer = startDailyWindowTimer({
    label: 'cache anomaly report',
    hour: 23,
    minuteFrom: 50,
    minuteTo: 55,
    send: () => cacheAnomalyService.sendDailyReport(),
  });
  logger.info({ channelId }, 'CacheAnomalyReport daily cron started');
  return timer;
}

function startDailyWindowTimer(options: {
  label: string;
  hour: number;
  minuteFrom: number;
  minuteTo?: number;
  send: () => Promise<void>;
}): ReturnType<typeof setInterval> {
  let lastReportDate = '';
  const timer = setInterval(() => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const inWindow =
      now.getHours() === options.hour &&
      now.getMinutes() >= options.minuteFrom &&
      (options.minuteTo === undefined || now.getMinutes() < options.minuteTo);
    if (!inWindow || dateStr === lastReportDate) return;

    lastReportDate = dateStr;
    void options.send().catch((err) => {
      logger.error({ err }, `Failed to send ${options.label}`);
    });
  }, 5 * 60 * 1000);
  timer.unref();
  return timer;
}
