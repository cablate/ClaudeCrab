import type { AgentLoader } from '../core/AgentLoader.js';
import type { PlatformOrchestrator } from '../core/PlatformOrchestrator.js';
import type { IQueryMetricsRepository, ISessionRepository } from '../persistence/types.js';
import type { ExecutionRecordRepository } from '../persistence/ExecutionRecordRepository.js';
import type { BudgetService } from '../services/BudgetService.js';
import type { DatabaseManager } from '../persistence/DatabaseManager.js';
import { ScheduleLoader } from './ScheduleLoader.js';
import { ScheduleNotifier } from './ScheduleNotifier.js';
import { ScheduleExecutor } from './ScheduleExecutor.js';
import { CronScheduler } from './CronScheduler.js';
import { ScheduleManager } from './ScheduleManager.js';
import { ScheduleThreadMap } from './ScheduleThreadMap.js';
import { ScheduleRepository } from '../persistence/ScheduleRepository.js';
import { SDKQueryManager } from '../core/SDKQueryManager.js';
import { getEventBus } from '../core/EventBus.js';
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
  executionRecordRepository: ExecutionRecordRepository | undefined;
  budgetService: BudgetService | undefined;
  sessionRepository: ISessionRepository | undefined;
}): Promise<ScheduleBootstrapResult> {
  logger.info('Initializing Schedule System...');

  const scheduleRepository = opts.databaseManager !== null
    ? new ScheduleRepository(opts.databaseManager.getDatabase())
    : undefined;

  const scheduleLoader = new ScheduleLoader(opts.agentLoader.getAgentsDir());
  const sdkManager = new SDKQueryManager();
  const scheduleNotifier = new ScheduleNotifier(new Map());
  const scheduleThreadMap = opts.scheduleThreadMap ?? new ScheduleThreadMap();

  const scheduleExecutor = new ScheduleExecutor(
    opts.agentLoader,
    sdkManager,
    scheduleNotifier,
    scheduleRepository,
    opts.queryMetricsRepository,
    opts.executionRecordRepository,
    opts.budgetService,
    undefined, // activityEventService — injected via wirePostInit
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
    scheduleRepository
  );

  await scheduleManager.initialize();

  for (const adapter of opts.orchestrator.getRegistry().getAll()) {
    scheduleNotifier.addAdapter(adapter.agentId, adapter);
  }

  getEventBus().on('message:sent', (payload) => {
    if (payload.agentId) {
      void scheduleManager.syncSchedulesForAgent(payload.agentId);
    }
  });

  logger.info('Schedule System initialized');

  return { scheduleManager, scheduleExecutor, scheduleThreadMap };
}
