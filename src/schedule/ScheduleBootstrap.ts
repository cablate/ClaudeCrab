import type { AgentLoader } from '../core/orchestrator/AgentLoader.js';
import type { PlatformOrchestrator } from '../core/orchestrator/PlatformOrchestrator.js';
import type { IQueryMetricsRepository, ISessionRepository } from '../persistence/types.js';
import type { DatabaseManager } from '../persistence/DatabaseManager.js';
import { ScheduleLoader } from './ScheduleLoader.js';
import { ScheduleNotifier } from './ScheduleNotifier.js';
import { ScheduleExecutor } from './ScheduleExecutor.js';
import { CronScheduler } from './CronScheduler.js';
import { ScheduleManager } from './ScheduleManager.js';
import { ScheduleThreadMap } from './ScheduleThreadMap.js';
import { ScheduleRepository } from '../persistence/ScheduleRepository.js';
import { SDKSessionManager } from '../core/session/SDKSessionManager.js';
import { logger } from '../utils/logger.js';

export interface ScheduleBootstrapResult {
  scheduleManager: ScheduleManager;
  scheduleExecutor: ScheduleExecutor;
  scheduleThreadMap: ScheduleThreadMap;
}

export async function initializeScheduleSystem(opts: {
  agentLoader: AgentLoader;
  orchestrator: PlatformOrchestrator;
  databaseManager: DatabaseManager | null;
  scheduleThreadMap: ScheduleThreadMap | null;
  queryMetricsRepository: IQueryMetricsRepository | undefined;
  sessionRepository: ISessionRepository | undefined;
}): Promise<ScheduleBootstrapResult> {
  logger.info('Initializing Schedule System...');

  const scheduleRepository = opts.databaseManager !== null
    ? new ScheduleRepository(opts.databaseManager.getDatabase())
    : undefined;

  const scheduleLoader = new ScheduleLoader(opts.agentLoader.getAgentsDir());
  const sdkSessionManager = new SDKSessionManager({
    // Schedule execution is one-shot. The sdkSessionId is persisted for
    // thread follow-up resume, but the live CLI process should not stay open.
    ephemeral: true,
    ...(opts.queryMetricsRepository !== undefined
      ? { queryMetricsRepository: opts.queryMetricsRepository }
      : {}),
  });
  const scheduleNotifier = new ScheduleNotifier(new Map());
  const scheduleThreadMap = opts.scheduleThreadMap ?? new ScheduleThreadMap();

  const scheduleExecutor = new ScheduleExecutor(
    opts.agentLoader,
    sdkSessionManager,
    scheduleNotifier,
    scheduleRepository,
    opts.queryMetricsRepository,
    opts.sessionRepository,
  );

  const cronScheduler = new CronScheduler(
    scheduleExecutor,
    async (scheduleId, _agentId, spec, failureCount) => {
      if (scheduleManager !== undefined) {
        await scheduleManager.pauseSchedule(scheduleId);
      }
      await scheduleNotifier.notifyAutoPaused(spec, failureCount);
      logger.warn({ scheduleId, failureCount }, '[Schedule] Auto-paused after consecutive failures');
    }
  );

  const scheduleManager = new ScheduleManager(
    scheduleLoader,
    cronScheduler,
    () => scheduleExecutor.dispose()
  );

  await scheduleManager.initialize();

  for (const adapter of opts.orchestrator.getRegistry().getAll()) {
    scheduleNotifier.addAdapter(adapter.agentId, adapter);
  }

  logger.info('Schedule System initialized');

  return { scheduleManager, scheduleExecutor, scheduleThreadMap };
}
