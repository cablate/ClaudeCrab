import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { ScheduleSpec } from './schemas.js';
import type { CronScheduler } from './CronScheduler.js';
import type { ScheduleExecutionRecord, ScheduleRepository } from '../persistence/ScheduleRepository.js';
import { logger } from '../utils/logger.js';
import { EventType } from '../utils/events.js';

export interface ScheduleCatchUpConfig {
  enabled: boolean;
  checkIntervalMs: number;
  graceMs: number;
  windowMs: number;
  staleRunningMs: number;
}

export type CatchUpDecision =
  | { action: 'catch-up'; scheduledAt: Date; windowEnd: Date; reason: 'missing_execution' }
  | { action: 'skip'; scheduledAt?: Date; windowEnd?: Date; reason: string; staleExecutionId?: string };

interface DailyScheduleTime {
  scheduledAt: Date;
  dayStart: Date;
  nextDayStart: Date;
}

const DAILY_CRON_PATTERN = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/;

export class ScheduleCatchUp {
  private timer: NodeJS.Timeout | null = null;
  private checking = false;

  constructor(
    private scheduler: CronScheduler,
    private repository: ScheduleRepository | undefined,
    private config: ScheduleCatchUpConfig,
    private now: () => Date = () => new Date()
  ) {}

  start(): void {
    if (!this.config.enabled || this.repository === undefined) {
      logger.info(
        { event_type: EventType.SCHEDULE_CATCHUP_SKIPPED, enabled: this.config.enabled, hasRepository: this.repository !== undefined },
        '[ScheduleCatchUp] Disabled'
      );
      return;
    }

    void this.check();
    this.timer = setInterval(() => void this.check(), this.config.checkIntervalMs);
    logger.info(
      { event_type: EventType.SCHEDULE_CATCHUP_SKIPPED, intervalMs: this.config.checkIntervalMs },
      '[ScheduleCatchUp] Health check started'
    );
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async check(): Promise<void> {
    if (this.checking || this.repository === undefined) return;
    this.checking = true;
    try {
      const now = this.now();
      for (const scheduleId of this.scheduler.getRegisteredIds()) {
        const info = this.scheduler.getScheduleInfo(scheduleId);
        if (info === null) continue;

        const decision = decideCatchUp(info.spec, this.repository, this.config, now);
        if (decision.action !== 'catch-up') {
          this.logSkip(scheduleId, decision);
          continue;
        }

        logger.warn(
          {
            event_type: EventType.SCHEDULE_CATCHUP_TRIGGERED,
            scheduleId,
            scheduledAt: decision.scheduledAt.toISOString(),
            windowEnd: decision.windowEnd.toISOString(),
          },
          '[ScheduleCatchUp] Missed schedule detected; running catch-up'
        );
        await this.scheduler.executeNow(scheduleId);
      }
    } finally {
      this.checking = false;
    }
  }

  private logSkip(scheduleId: string, decision: CatchUpDecision): void {
    if (decision.reason === 'running_execution') {
      logger.info({ event_type: EventType.SCHEDULE_CATCHUP_SKIPPED, scheduleId, reason: decision.reason }, '[ScheduleCatchUp] Schedule already running');
      return;
    }
    if (decision.reason === 'stale_running_execution') {
      logger.warn(
        { event_type: EventType.SCHEDULE_STALE_RUNNING, scheduleId, executionId: decision.staleExecutionId },
        '[ScheduleCatchUp] Schedule execution appears stale; not starting another run'
      );
      return;
    }
    if (decision.reason === 'outside_catchup_window') {
      logger.warn({ event_type: EventType.SCHEDULE_MISSED, scheduleId }, '[ScheduleCatchUp] Schedule missed catch-up window');
    }
  }
}

export function decideCatchUp(
  spec: ScheduleSpec,
  repository: Pick<ScheduleRepository, 'listExecutions'>,
  config: Pick<ScheduleCatchUpConfig, 'graceMs' | 'windowMs' | 'staleRunningMs'>,
  now: Date
): CatchUpDecision {
  const dailyTime = getTodayScheduledAt(spec, now);
  if (dailyTime === null) return { action: 'skip', reason: 'unsupported_trigger' };

  const { scheduledAt } = dailyTime;
  const graceEnd = new Date(scheduledAt.getTime() + config.graceMs);
  const windowEnd = new Date(scheduledAt.getTime() + config.windowMs);
  if (now.getTime() < graceEnd.getTime()) {
    return { action: 'skip', scheduledAt, windowEnd, reason: 'before_grace' };
  }
  if (now.getTime() > windowEnd.getTime()) {
    return { action: 'skip', scheduledAt, windowEnd, reason: 'outside_catchup_window' };
  }

  const executions = repository.listExecutions(spec.id, dailyTime.dayStart.toISOString(), dailyTime.nextDayStart.toISOString());
  const running = executions.find((record) => record.completedAt === null);
  if (running !== undefined) {
    const ageMs = now.getTime() - Date.parse(running.startedAt);
    if (ageMs > config.staleRunningMs) {
      return { action: 'skip', scheduledAt, windowEnd, reason: 'stale_running_execution', staleExecutionId: running.id };
    }
    return { action: 'skip', scheduledAt, windowEnd, reason: 'running_execution' };
  }
  if (executions.length > 0) {
    return { action: 'skip', scheduledAt, windowEnd, reason: 'already_executed' };
  }

  return { action: 'catch-up', scheduledAt, windowEnd, reason: 'missing_execution' };
}

function getTodayScheduledAt(spec: ScheduleSpec, now: Date): DailyScheduleTime | null {
  if (spec.trigger.type !== 'cron' || spec.trigger.cron === undefined) return null;
  const match = DAILY_CRON_PATTERN.exec(spec.trigger.cron.trim());
  if (match === null) return null;

  const minute = Number.parseInt(match[1] ?? '', 10);
  const hour = Number.parseInt(match[2] ?? '', 10);
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;

  const timezone = spec.trigger.timezone || 'Asia/Taipei';
  const zonedNow = toZonedTime(now, timezone);
  const localScheduleDateTime = new Date(
    zonedNow.getFullYear(),
    zonedNow.getMonth(),
    zonedNow.getDate(),
    hour,
    minute,
    0,
    0
  );
  const localDayStart = new Date(zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate(), 0, 0, 0, 0);
  const localNextDayStart = new Date(zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate() + 1, 0, 0, 0, 0);

  return {
    scheduledAt: fromZonedTime(localScheduleDateTime, timezone),
    dayStart: fromZonedTime(localDayStart, timezone),
    nextDayStart: fromZonedTime(localNextDayStart, timezone),
  };
}
