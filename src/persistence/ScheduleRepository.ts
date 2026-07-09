/**
 * Schedule Repository
 *
 * Stores schedule execution records.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export interface ScheduleExecutionRecord {
  id: string;
  scheduleId: string;
  startedAt: string;
  completedAt: string | null;
  success: number | null;
}

export class ScheduleRepository {
  constructor(private db: DatabaseType) {}

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

  listExecutions(scheduleId: string, fromIso: string, toIso: string): ScheduleExecutionRecord[] {
    const stmt = this.db.prepare(`
      SELECT
        id,
        schedule_id AS scheduleId,
        started_at AS startedAt,
        completed_at AS completedAt,
        success
      FROM schedule_executions
      WHERE schedule_id = ?
        AND started_at >= ?
        AND started_at < ?
      ORDER BY started_at DESC
    `);
    return stmt.all(scheduleId, fromIso, toIso) as ScheduleExecutionRecord[];
  }
}
