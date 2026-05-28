/**
 * Schedule Manager
 *
 * Unified interface for managing scheduled tasks.
 * Coordinates between ScheduleLoader, CronScheduler, ScheduleRepository.
 */

import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import type { ScheduleSpec } from './schemas.js';
import type { ScheduleInfo, ScheduleExecution, CreateScheduleOptions } from './types.js';
import type { ScheduleLoader } from './ScheduleLoader.js';
import type { CronScheduler } from './CronScheduler.js';
import type { ScheduleRepository } from '../persistence/ScheduleRepository.js';
import { logger } from '../utils/logger.js';
import { EventType } from '../utils/events.js';

const FILE_WATCHER_DEBOUNCE_MS = 300;

export class ScheduleManager {
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private loader: ScheduleLoader,
    private scheduler: CronScheduler,
    private repository?: ScheduleRepository
  ) {}

  /**
   * Initialize the scheduler by loading all schedules
   */
  async initialize(): Promise<void> {
    logger.info({ event_type: EventType.SCHEDULE_MANAGER_STARTED }, '[ScheduleManager] Initializing...');

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

    logger.info({ event_type: EventType.SCHEDULE_LOADED, count }, `[ScheduleManager] Loaded and registered ${count} schedules`);

    // Start watching YAML files for changes
    this.startFileWatcher();
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
        platform: options.notifyPlatform ?? 'discord',
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

    logger.info({ event_type: EventType.SCHEDULE_CREATED }, `[ScheduleManager] Created schedule: ${spec.id}`);
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

    logger.info({ event_type: EventType.SCHEDULE_DELETED }, `[ScheduleManager] Deleted schedule: ${scheduleId}`);
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

    logger.info({ event_type: EventType.SCHEDULE_PAUSED }, `[ScheduleManager] Paused schedule: ${scheduleId}`);
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

    logger.info({ event_type: EventType.SCHEDULE_RESUMED }, `[ScheduleManager] Resumed schedule: ${scheduleId}`);
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

    // Unregister old version using canonical ID from spec
    this.scheduler.unregister(spec.id);

    // Register new version
    if (spec.metadata.enabled) {
      this.scheduler.register(agentId, spec);
    }

    logger.info({ event_type: EventType.SCHEDULE_RELOADED }, `[ScheduleManager] Reloaded schedule: ${spec.id}`);
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
        logger.info({ event_type: EventType.SCHEDULE_UNREGISTERED }, `[ScheduleManager] Auto-unregistered removed schedule: ${registeredId}`);
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
          logger.info({ event_type: EventType.SCHEDULE_REGISTERED }, `[ScheduleManager] Auto-registered new schedule: ${spec.id}`);
        } else if (existingInfo) {
          // Check if spec has changed (compare JSON representation)
          const existingJson = JSON.stringify(existingInfo.spec);
          const newJson = JSON.stringify(spec);
          if (existingJson !== newJson) {
            // Re-register with updated spec
            this.scheduler.unregister(spec.id);
            this.scheduler.register(agentId, spec);
            result.updated++;
            logger.info({ event_type: EventType.SCHEDULE_RELOADED }, `[ScheduleManager] Auto-updated schedule: ${spec.id}`);
          }
        }
      } else if (isRegistered) {
        // Schedule was disabled, unregister it
        this.scheduler.unregister(spec.id);
        result.removed++;
        logger.info({ event_type: EventType.SCHEDULE_UNREGISTERED }, `[ScheduleManager] Auto-unregistered disabled schedule: ${spec.id}`);
      }
    }

    return result;
  }

  /**
   * Dispose and clean up
   */
  dispose(): void {
    this.stopFileWatcher();
    this.scheduler.dispose();
    logger.info({ event_type: EventType.SCHEDULE_MANAGER_DISPOSED }, '[ScheduleManager] Disposed');
  }

  /**
   * Generate a slug ID from a name
   */
  /**
   * Start watching schedule YAML files for changes.
   * Automatically triggers syncSchedulesForAgent when files are added, changed, or deleted.
   */
  private startFileWatcher(): void {
    const agentsDir = this.loader.getAgentsDir();

    try {
      // Dynamic import to avoid blocking if chokidar is not available
      import('chokidar').then(({ watch }) => {
        // chokidar v5 removed glob support — watch the agents directory
        // and filter to only schedules/*.yaml via `ignored`
        this.watcher = watch(agentsDir, {
          ignoreInitial: true,
          depth: 2, // agents/{id}/schedules/ = depth 2
          ignored: (filePath: string, stats) => {
            // Allow directories to be traversed
            if (!stats?.isFile()) return false;
            // Only watch .yaml files inside a schedules/ directory
            const normalized = filePath.replace(/\\/g, '/');
            return !(/\/schedules\/[^/]+\.yaml$/.test(normalized));
          },
          awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
        });

        this.watcher.on('all', (event: string, filePath: string) => {
          if (event !== 'add' && event !== 'change' && event !== 'unlink') return;

          // Extract agentId from path: .../agents/{agentId}/schedules/xxx.yaml
          const normalizedPath = filePath.replace(/\\/g, '/');
          const normalizedAgentsDir = agentsDir.replace(/\\/g, '/');
          const relativePath = normalizedPath.replace(normalizedAgentsDir + '/', '');
          const agentId = relativePath.split('/')[0];

          if (!agentId) return;

          // Per-agent debounce
          const existing = this.debounceTimers.get(agentId);
          if (existing) clearTimeout(existing);

          this.debounceTimers.set(agentId, setTimeout(() => {
            this.debounceTimers.delete(agentId);
            logger.info({ event_type: EventType.SCHEDULE_FILE_CHANGE }, `[ScheduleManager] File ${event} detected for agent: ${agentId}, syncing schedules`);
            void this.syncSchedulesForAgent(agentId);
          }, FILE_WATCHER_DEBOUNCE_MS));
        });

        logger.info({ event_type: EventType.SCHEDULE_WATCHER_STARTED }, `[ScheduleManager] File watcher started on: ${agentsDir}`);
      }).catch((err: unknown) => {
        logger.warn({ event_type: EventType.SCHEDULE_WATCHER_ERROR, err }, '[ScheduleManager] Failed to start file watcher (chokidar not available); schedules will only sync on adapter start');
      });
    } catch (err) {
      logger.warn({ event_type: EventType.SCHEDULE_WATCHER_ERROR, err }, '[ScheduleManager] Failed to start file watcher; schedules will only sync on adapter start');
    }
  }

  /**
   * Stop the file watcher and clean up debounce timers.
   */
  private stopFileWatcher(): void {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private generateId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }
}
