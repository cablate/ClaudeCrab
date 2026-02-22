/**
 * Schedule Manager
 *
 * Unified interface for managing scheduled tasks.
 * Coordinates between ScheduleLoader, CronScheduler, ScheduleRepository.
 */

import type { ScheduleSpec } from './schemas.js';
import type { ScheduleInfo, ScheduleExecution, CreateScheduleOptions } from './types.js';
import type { ScheduleLoader } from './ScheduleLoader.js';
import type { CronScheduler } from './CronScheduler.js';
import type { ScheduleRepository } from '../persistence/ScheduleRepository.js';
import { logger } from '../utils/logger.js';

export class ScheduleManager {
  constructor(
    private loader: ScheduleLoader,
    private scheduler: CronScheduler,
    private repository?: ScheduleRepository
  ) {}

  /**
   * Initialize the scheduler by loading all schedules
   */
  async initialize(): Promise<void> {
    logger.info('[ScheduleManager] Initializing...');

    // Load all schedules from YAML files
    const allSchedules = await this.loader.loadAll();

    // Register each schedule with the cron scheduler
    let count = 0;
    for (const [agentId, schedules] of allSchedules) {
      for (const spec of schedules) {
        if (spec.metadata.enabled) {
          this.scheduler.register(agentId, spec);
          count++;
        }
      }
    }

    logger.info(`[ScheduleManager] Loaded and registered ${count} schedules`);
  }

  /**
   * Get all schedules with their info
   */
  async getAllSchedules(): Promise<ScheduleInfo[]> {
    const allSchedules = await this.loader.loadAll();
    const result: ScheduleInfo[] = [];

    for (const [agentId, schedules] of allSchedules) {
      for (const spec of schedules) {
        const lastExecution = this.repository
          ? this.repository.getLastExecution(spec.id)
          : undefined;

        result.push({
          spec,
          agentId,
          isRunning: this.scheduler.isRunning(spec.id),
          lastExecution: lastExecution ?? undefined,
        });
      }
    }

    return result;
  }

  /**
   * Get schedules for a specific agent
   */
  async getSchedulesForAgent(agentId: string): Promise<ScheduleInfo[]> {
    const schedules = await this.loader.loadForAgent(agentId);
    const result: ScheduleInfo[] = [];

    for (const spec of schedules) {
      const lastExecution = this.repository
        ? this.repository.getLastExecution(spec.id)
        : undefined;

      result.push({
        spec,
        agentId,
        isRunning: this.scheduler.isRunning(spec.id),
        lastExecution: lastExecution ?? undefined,
      });
    }

    return result;
  }

  /**
   * Get info for a specific schedule
   */
  async getScheduleInfo(scheduleId: string): Promise<ScheduleInfo | null> {
    // Search for the schedule across all agents
    const allSchedules = await this.loader.loadAll();

    for (const [agentId, schedules] of allSchedules) {
      const spec = schedules.find(s => s.id === scheduleId);
      if (spec) {
        const lastExecution = this.repository
          ? this.repository.getLastExecution(spec.id)
          : undefined;

        return {
          spec,
          agentId,
          isRunning: this.scheduler.isRunning(spec.id),
          lastExecution: lastExecution ?? undefined,
        };
      }
    }

    return null;
  }

  /**
   * Create a new schedule
   */
  async createSchedule(options: CreateScheduleOptions): Promise<ScheduleSpec> {
    const now = new Date().toISOString();

    const spec: ScheduleSpec = {
      id: this.generateId(options.name),
      name: options.name,
      description: options.description,
      trigger: {
        type: 'cron',
        cron: options.cronExpression,
        timezone: options.timezone ?? 'Asia/Taipei',
      },
      execution: {
        agent: options.agentId,
        prompt: options.prompt,
        maxTurns: options.maxTurns,
        timeout: options.timeout,
      },
      notification: {
        onComplete: options.notifyOnComplete,
        onError: options.notifyOnError,
        platform: 'telegram',
        chatId: options.notifyChatId,
      },
      metadata: {
        createdAt: now,
        createdBy: 'conversation',
        enabled: true,
        tags: options.tags,
      },
    };

    // Save to YAML file
    await this.loader.save(options.agentId, spec);

    // Register with scheduler
    this.scheduler.register(options.agentId, spec);

    logger.info(`[ScheduleManager] Created schedule: ${spec.id}`);
    return spec;
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(scheduleId: string): Promise<boolean> {
    // Find the schedule
    const info = await this.getScheduleInfo(scheduleId);
    if (!info) {
      return false;
    }

    // Unregister from scheduler
    this.scheduler.unregister(scheduleId);

    // Delete from YAML
    await this.loader.delete(info.agentId, scheduleId);

    // Delete from database if available
    if (this.repository) {
      this.repository.delete(scheduleId);
    }

    logger.info(`[ScheduleManager] Deleted schedule: ${scheduleId}`);
    return true;
  }

  /**
   * Pause a schedule
   */
  async pauseSchedule(scheduleId: string): Promise<boolean> {
    const info = await this.getScheduleInfo(scheduleId);
    if (!info) {
      return false;
    }

    // Update spec
    info.spec.metadata.enabled = false;
    await this.loader.save(info.agentId, info.spec);

    // Pause in scheduler
    this.scheduler.pause(scheduleId);

    logger.info(`[ScheduleManager] Paused schedule: ${scheduleId}`);
    return true;
  }

  /**
   * Resume a paused schedule
   */
  async resumeSchedule(scheduleId: string): Promise<boolean> {
    const info = await this.getScheduleInfo(scheduleId);
    if (!info) {
      return false;
    }

    // Update spec
    info.spec.metadata.enabled = true;
    await this.loader.save(info.agentId, info.spec);

    // Resume in scheduler
    this.scheduler.resume(scheduleId);

    logger.info(`[ScheduleManager] Resumed schedule: ${scheduleId}`);
    return true;
  }

  /**
   * Run a schedule immediately
   */
  async runNow(scheduleId: string): Promise<boolean> {
    return this.scheduler.runNow(scheduleId);
  }

  /**
   * Get execution history for a schedule
   */
  getExecutionHistory(scheduleId: string, limit = 10): ScheduleExecution[] {
    if (!this.repository) {
      return [];
    }
    return this.repository.getExecutionHistory(scheduleId, limit);
  }

  /**
   * Get recent executions across all schedules
   */
  getRecentExecutions(limit = 20): ScheduleExecution[] {
    if (!this.repository) {
      return [];
    }
    return this.repository.getRecentExecutions(limit);
  }

  /**
   * Reload a schedule from YAML
   */
  async reloadSchedule(agentId: string, scheduleId: string): Promise<boolean> {
    const spec = await this.loader.loadById(agentId, scheduleId);
    if (!spec) {
      return false;
    }

    // Unregister old version
    this.scheduler.unregister(scheduleId);

    // Register new version
    if (spec.metadata.enabled) {
      this.scheduler.register(agentId, spec);
    }

    logger.info(`[ScheduleManager] Reloaded schedule: ${scheduleId}`);
    return true;
  }

  /**
   * Sync schedules for an agent: load from disk and register any not yet registered.
   * Used after agent queries complete (agent may have created schedule files via Write tool).
   */
  async syncSchedulesForAgent(agentId: string): Promise<{ added: number; updated: number; removed: number }> {
    const specs = await this.loader.loadForAgent(agentId);
    const result = { added: 0, updated: 0, removed: 0 };

    // Build a set of current spec IDs for this agent
    const currentSpecIds = new Set(specs.map(s => s.id));

    // Get all registered schedules for this agent
    const registeredIds = this.scheduler.getRegisteredIds();
    const agentRegisteredIds = registeredIds.filter(id => {
      const info = this.scheduler.getScheduleInfo(id);
      return info?.agentId === agentId;
    });

    // 1. Remove schedules that no longer exist in YAML files
    for (const registeredId of agentRegisteredIds) {
      if (!currentSpecIds.has(registeredId)) {
        this.scheduler.unregister(registeredId);
        result.removed++;
        logger.info(`[ScheduleManager] Auto-unregistered removed schedule: ${registeredId}`);
      }
    }

    // 2. Add new schedules and update existing ones
    for (const spec of specs) {
      const isRegistered = this.scheduler.isRegistered(spec.id);
      const existingInfo = isRegistered ? this.scheduler.getScheduleInfo(spec.id) : null;

      if (spec.metadata.enabled) {
        if (!isRegistered) {
          // New schedule
          this.scheduler.register(agentId, spec);
          result.added++;
          logger.info(`[ScheduleManager] Auto-registered new schedule: ${spec.id}`);
        } else if (existingInfo) {
          // Check if spec has changed (compare JSON representation)
          const existingJson = JSON.stringify(existingInfo.spec);
          const newJson = JSON.stringify(spec);
          if (existingJson !== newJson) {
            // Re-register with updated spec
            this.scheduler.unregister(spec.id);
            this.scheduler.register(agentId, spec);
            result.updated++;
            logger.info(`[ScheduleManager] Auto-updated schedule: ${spec.id}`);
          }
        }
      } else if (isRegistered) {
        // Schedule was disabled, unregister it
        this.scheduler.unregister(spec.id);
        result.removed++;
        logger.info(`[ScheduleManager] Auto-unregistered disabled schedule: ${spec.id}`);
      }
    }

    return result;
  }

  /**
   * Dispose and clean up
   */
  dispose(): void {
    this.scheduler.dispose();
    logger.info('[ScheduleManager] Disposed');
  }

  /**
   * Generate a slug ID from a name
   */
  private generateId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }
}
