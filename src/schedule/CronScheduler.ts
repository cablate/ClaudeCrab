/**
 * Cron Scheduler
 *
 * Manages cron-based schedule triggers using node-cron.
 */

import cron, { type ScheduledTask } from 'node-cron';
import type { ScheduleSpec } from './schemas.js';
import type { ScheduleExecutor } from './ScheduleExecutor.js';
import { logger } from '../utils/logger.js';

interface ScheduledJob {
  task: ScheduledTask;
  spec: ScheduleSpec;
  agentId: string;
}

export class CronScheduler {
  private jobs: Map<string, ScheduledJob> = new Map();
  private runningExecutions: Set<string> = new Set();

  constructor(private executor: ScheduleExecutor) {}

  /**
   * Register a schedule for execution
   */
  register(agentId: string, spec: ScheduleSpec): void {
    // Resolve cron expression from trigger config
    const cronExpr = this.resolveCronExpression(spec);
    if (!cronExpr) {
      return;
    }

    // Validate cron expression
    if (!cron.validate(cronExpr)) {
      logger.error(`[CronScheduler] Invalid cron expression for ${spec.id}: ${cronExpr}`);
      return;
    }

    // Unregister existing job if any
    if (this.jobs.has(spec.id)) {
      this.unregister(spec.id);
    }

    // Create new scheduled task
    const task = cron.schedule(
      cronExpr,
      async () => {
        await this.executeSchedule(spec.id);
      },
      {
        timezone: spec.trigger.timezone || 'Asia/Taipei',
      }
    );

    // If not enabled, stop immediately
    if (!spec.metadata.enabled) {
      task.stop();
    }

    this.jobs.set(spec.id, { task, spec, agentId });
    const typeLabel = spec.trigger.type !== 'cron' ? ` (${spec.trigger.type} → cron)` : '';
    logger.info(`[CronScheduler] Registered schedule: ${spec.id} (${cronExpr})${typeLabel}`);
  }

  /**
   * Execute a schedule immediately
   */

  /**
   * Convert trigger config to a cron expression.
   * - cron: use as-is
   * - once: parse `at` datetime → `min hour day month *`
   * - interval: ms → minutes → `*\/N * * * *` (requires >= 60s)
   */
  private resolveCronExpression(spec: ScheduleSpec): string | null {
    const { trigger } = spec;

    switch (trigger.type) {
      case 'cron': {
        if (!trigger.cron) {
          logger.warn(`[CronScheduler] Missing cron expression for: ${spec.id}`);
          return null;
        }
        return trigger.cron;
      }

      case 'once': {
        if (!trigger.at) {
          logger.warn(`[CronScheduler] Missing 'at' datetime for once schedule: ${spec.id}`);
          return null;
        }
        const date = new Date(trigger.at);
        if (isNaN(date.getTime())) {
          logger.error(`[CronScheduler] Invalid datetime for ${spec.id}: ${trigger.at}`);
          return null;
        }
        if (date.getTime() <= Date.now()) {
          logger.warn(`[CronScheduler] Once schedule ${spec.id} target time already passed: ${trigger.at}`);
          return null;
        }
        // Convert to cron: minute hour dayOfMonth month *
        const cronExpr = `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
        return cronExpr;
      }

      case 'interval': {
        if (!trigger.interval || trigger.interval < 60000) {
          logger.warn(`[CronScheduler] Interval must be >= 60000ms for ${spec.id}, got: ${trigger.interval}`);
          return null;
        }
        const minutes = Math.round(trigger.interval / 60000);
        if (minutes >= 60) {
          const hours = Math.round(minutes / 60);
          return `0 */${hours} * * *`;
        }
        return `*/${minutes} * * * *`;
      }

      default:
        logger.warn(`[CronScheduler] Unsupported trigger type for ${spec.id}: ${(trigger as { type: string }).type}`);
        return null;
    }
  }

  private async executeSchedule(scheduleId: string): Promise<void> {
    const job = this.jobs.get(scheduleId);
    if (!job) {
      logger.warn(`[CronScheduler] Schedule not found: ${scheduleId}`);
      return;
    }

    // Prevent concurrent executions of the same schedule
    if (this.runningExecutions.has(scheduleId)) {
      logger.warn(`[CronScheduler] Schedule ${scheduleId} is already running, skipping`);
      return;
    }

    this.runningExecutions.add(scheduleId);

    try {
      logger.info(`[CronScheduler] Executing schedule: ${scheduleId}`);
      await this.executor.execute(job.agentId, job.spec);
    } catch (error) {
      logger.error({ error, scheduleId }, '[CronScheduler] Execution failed');
    } finally {
      this.runningExecutions.delete(scheduleId);

      // Auto-unregister one-time schedules after execution
      if (job.spec.trigger.type === 'once') {
        this.unregister(scheduleId);
        logger.info(`[CronScheduler] Auto-unregistered once schedule: ${scheduleId}`);
      }
    }
  }

  /**
   * Unregister a schedule
   */
  unregister(scheduleId: string): void {
    const job = this.jobs.get(scheduleId);
    if (job) {
      job.task.stop();
      this.jobs.delete(scheduleId);
      logger.info(`[CronScheduler] Unregistered schedule: ${scheduleId}`);
    }
  }

  /**
   * Pause a schedule
   */
  pause(scheduleId: string): boolean {
    const job = this.jobs.get(scheduleId);
    if (job) {
      job.task.stop();
      logger.info(`[CronScheduler] Paused schedule: ${scheduleId}`);
      return true;
    }
    return false;
  }

  /**
   * Resume a paused schedule
   */
  resume(scheduleId: string): boolean {
    const job = this.jobs.get(scheduleId);
    if (job) {
      job.task.start();
      logger.info(`[CronScheduler] Resumed schedule: ${scheduleId}`);
      return true;
    }
    return false;
  }

  /**
   * Run a schedule immediately (manual trigger)
   */
  async runNow(scheduleId: string): Promise<boolean> {
    const job = this.jobs.get(scheduleId);
    if (!job) {
      return false;
    }

    await this.executeSchedule(scheduleId);
    return true;
  }

  /**
   * Check if a schedule is currently running
   */
  isRunning(scheduleId: string): boolean {
    return this.runningExecutions.has(scheduleId);
  }

  /**
   * Get all registered schedule IDs
   */
  getRegisteredIds(): string[] {
    return Array.from(this.jobs.keys());
  }

  /**
   * Check if a schedule is registered
   */
  isRegistered(scheduleId: string): boolean {
    return this.jobs.has(scheduleId);
  }

  /**
   * Get schedule info
   */
  getScheduleInfo(scheduleId: string): { spec: ScheduleSpec; agentId: string } | null {
    const job = this.jobs.get(scheduleId);
    if (!job) return null;
    return { spec: job.spec, agentId: job.agentId };
  }

  /**
   * Stop all schedules
   */
  stopAll(): void {
    for (const [id, job] of this.jobs) {
      job.task.stop();
      logger.debug(`[CronScheduler] Stopped schedule: ${id}`);
    }
    logger.info(`[CronScheduler] Stopped all ${this.jobs.size} schedules`);
  }

  /**
   * Dispose and clean up
   */
  dispose(): void {
    this.stopAll();
    this.jobs.clear();
    this.runningExecutions.clear();
    logger.info('[CronScheduler] Disposed');
  }
}
