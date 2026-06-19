/**
 * Schedule Repository
 *
 * Stores schedule execution records.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '../utils/logger.js';

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
}
