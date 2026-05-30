/**
 * Schedule Repository
 *
 * Manages persistence of scheduled tasks and execution records.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { ScheduledTask, ScheduleExecution } from '../schedule/types.js';
import { logger } from '../utils/logger.js';

export class ScheduleRepository {
  constructor(private db: DatabaseType) {}

  // ==================== Task CRUD ====================

  /**
   * Create a new scheduled task
   */
  create(task: Omit<ScheduledTask, 'createdAt' | 'updatedAt'>): ScheduledTask {
    const now = new Date().toISOString();
    const fullTask: ScheduledTask = {
      ...task,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO scheduled_tasks (
        id, agent_id, name, description, trigger_type, trigger_config,
        execution_config, notification_config, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      fullTask.id,
      fullTask.agentId,
      fullTask.name,
      fullTask.description ?? null,
      fullTask.triggerType,
      fullTask.triggerConfig,
      fullTask.executionConfig,
      fullTask.notificationConfig ?? null,
      fullTask.enabled ? 1 : 0,
      fullTask.createdAt,
      fullTask.updatedAt
    );

    logger.debug(`[ScheduleRepository] Created task: ${fullTask.id}`);
    return fullTask;
  }

  /**
   * Update a scheduled task
   */
  update(id: string, updates: Partial<Omit<ScheduledTask, 'id' | 'createdAt'>>): boolean {
    const existing = this.findById(id);
    if (!existing) {
      return false;
    }

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE scheduled_tasks SET
        agent_id = COALESCE(?, agent_id),
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        trigger_type = COALESCE(?, trigger_type),
        trigger_config = COALESCE(?, trigger_config),
        execution_config = COALESCE(?, execution_config),
        notification_config = COALESCE(?, notification_config),
        enabled = COALESCE(?, enabled),
        updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      updates.agentId ?? null,
      updates.name ?? null,
      updates.description ?? null,
      updates.triggerType ?? null,
      updates.triggerConfig ?? null,
      updates.executionConfig ?? null,
      updates.notificationConfig ?? null,
      updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : null,
      now,
      id
    );

    logger.debug(`[ScheduleRepository] Updated task: ${id}`);
    return result.changes > 0;
  }

  /**
   * Delete a scheduled task
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?');
    const result = stmt.run(id);
    if (result.changes > 0) {
      logger.debug(`[ScheduleRepository] Deleted task: ${id}`);
    }
    return result.changes > 0;
  }

  /**
   * Find a task by ID
   */
  findById(id: string): ScheduledTask | null {
    const stmt = this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?');
    const row = stmt.get(id) as ScheduledTaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  /**
   * Find all tasks for an agent
   */
  findByAgent(agentId: string): ScheduledTask[] {
    const stmt = this.db.prepare('SELECT * FROM scheduled_tasks WHERE agent_id = ?');
    const rows = stmt.all(agentId) as ScheduledTaskRow[];
    return rows.map(row => this.rowToTask(row));
  }

  /**
   * Find all tasks
   */
  findAll(): ScheduledTask[] {
    const stmt = this.db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC');
    const rows = stmt.all() as ScheduledTaskRow[];
    return rows.map(row => this.rowToTask(row));
  }

  /**
   * Find all enabled tasks
   */
  findEnabled(): ScheduledTask[] {
    const stmt = this.db.prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1');
    const rows = stmt.all() as ScheduledTaskRow[];
    return rows.map(row => this.rowToTask(row));
  }

  // ==================== Execution Records ====================

  /**
   * Record the start of an execution
   */
  recordStart(scheduleId: string, executionId: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO schedule_executions (id, schedule_id, started_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(executionId, scheduleId, new Date().toISOString());
    logger.debug(`[ScheduleRepository] Recorded start: ${executionId}`);
  }

  /**
   * Record the completion of an execution
   */
  recordComplete(
    scheduleId: string,
    executionId: string,
    result: { success: boolean; duration: number; resultSummary?: string; error?: string }
  ): void {
    const stmt = this.db.prepare(`
      UPDATE schedule_executions SET
        completed_at = ?,
        success = ?,
        duration_ms = ?,
        result_summary = ?,
        error_message = ?
      WHERE id = ?
    `);
    stmt.run(
      new Date().toISOString(),
      result.success ? 1 : 0,
      result.duration,
      result.resultSummary ?? null,
      result.error ?? null,
      executionId
    );
    logger.debug(`[ScheduleRepository] Recorded complete: ${executionId}`);
  }

  /**
   * Get execution history for a schedule
   */
  getExecutionHistory(scheduleId: string, limit = 10): ScheduleExecution[] {
    const stmt = this.db.prepare(`
      SELECT * FROM schedule_executions
      WHERE schedule_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(scheduleId, limit) as ScheduleExecutionRow[];
    return rows.map(row => this.rowToExecution(row));
  }

  /**
   * Get recent executions across all schedules
   */
  getRecentExecutions(limit = 20): ScheduleExecution[] {
    const stmt = this.db.prepare(`
      SELECT * FROM schedule_executions
      ORDER BY started_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as ScheduleExecutionRow[];
    return rows.map(row => this.rowToExecution(row));
  }

  /**
   * Get the last execution for a schedule
   */
  getLastExecution(scheduleId: string): ScheduleExecution | null {
    const stmt = this.db.prepare(`
      SELECT * FROM schedule_executions
      WHERE schedule_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const row = stmt.get(scheduleId) as ScheduleExecutionRow | undefined;
    return row ? this.rowToExecution(row) : null;
  }

  /**
   * Clean up old execution records
   */
  cleanupOldExecutions(olderThanMs: number): number {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const stmt = this.db.prepare(`
      DELETE FROM schedule_executions
      WHERE started_at < ?
    `);
    const result = stmt.run(cutoff);
    if (result.changes > 0) {
      logger.info(`[ScheduleRepository] Cleaned up ${result.changes} old execution records`);
    }
    return result.changes;
  }

  // ==================== Private Helpers ====================

  private rowToTask(row: ScheduledTaskRow): ScheduledTask {
    return {
      id: row.id,
      agentId: row.agent_id,
      name: row.name,
      description: row.description ?? undefined,
      triggerType: row.trigger_type,
      triggerConfig: row.trigger_config,
      executionConfig: row.execution_config,
      notificationConfig: row.notification_config ?? undefined,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToExecution(row: ScheduleExecutionRow): ScheduleExecution {
    return {
      id: row.id,
      scheduleId: row.schedule_id,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      success: row.success === null ? undefined : row.success === 1,
      durationMs: row.duration_ms ?? undefined,
      resultSummary: row.result_summary ?? undefined,
      errorMessage: row.error_message ?? undefined,
    };
  }
}

// Row types for SQLite results
interface ScheduledTaskRow {
  id: string;
  agent_id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: string;
  execution_config: string;
  notification_config: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface ScheduleExecutionRow {
  id: string;
  schedule_id: string;
  started_at: string;
  completed_at: string | null;
  success: number | null;
  duration_ms: number | null;
  result_summary: string | null;
  error_message: string | null;
}
