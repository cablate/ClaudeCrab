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
    if (spec.trigger.type !== 'cron' || !spec.trigger.cron) {
      logger.warn(`[CronScheduler] Cannot register non-cron schedule: ${spec.id}`);
      return;
    }

    // Validate cron expression
    if (!cron.validate(spec.trigger.cron)) {
      logger.error(`[CronScheduler] Invalid cron expression for ${spec.id}: ${spec.trigger.cron}`);
      return;
    }

    // Unregister existing job if any
    if (this.jobs.has(spec.id)) {
      this.unregister(spec.id);
    }

    // Create new scheduled task
    const task = cron.schedule(
      spec.trigger.cron,
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
    logger.info(`[CronScheduler] Registered schedule: ${spec.id} (${spec.trigger.cron})`);
  }

  /**
   * Execute a schedule immediately
   */
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
