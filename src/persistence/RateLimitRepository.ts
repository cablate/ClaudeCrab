/**
 * Repository for rate limit snapshot tracking (token-lifecycle-management).
 * Records rate_limit_event data from SDK stream for quota trend analysis.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { dateToString } from './types.js';
import { logger } from '../utils/logger.js';

export interface RateLimitSnapshotRow {
  id: number;
  sdk_session_id: string | null;
  agent_id: string | null;
  rate_limit_type: string;
  utilization_pct: number;
  status: string;
  resets_at: number | null;
  is_using_overage: number;
  created_at: string;
}

export interface RateLimitRecordParams {
  sdkSessionId?: string;
  agentId?: string;
  rateLimitType: string;
  utilizationPct: number;
  status: string;
  resetsAt?: number;
  isUsingOverage?: number;
}

export interface RateLimitSessionDelta {
  firstUtilization: number;
  lastUtilization: number;
  delta: number;
}

export interface WeekOverWeekGrowth {
  thisWeekMax: number;
  lastWeekMax: number;
  growthPct: number | null;
}

export class RateLimitRepository {
  private readonly db: DatabaseType;
  private readonly log = logger.child({ module: 'RateLimitRepository' });

  constructor(db: DatabaseType) {
    this.db = db;
  }

  /**
   * Insert a rate limit snapshot record.
   */
  record(params: RateLimitRecordParams): void {
    const now = dateToString(new Date());
    const stmt = this.db.prepare(`
      INSERT INTO rate_limit_snapshots (
        sdk_session_id, agent_id, rate_limit_type, utilization_pct,
        status, resets_at, is_using_overage, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      params.sdkSessionId ?? null,
      params.agentId ?? null,
      params.rateLimitType,
      params.utilizationPct,
      params.status,
      params.resetsAt ?? null,
      params.isUsingOverage ?? 0,
      now
    );
    this.log.debug(
      {
        sdkSessionId: params.sdkSessionId ?? null,
        rateLimitType: params.rateLimitType,
        utilizationPct: params.utilizationPct,
        status: params.status,
      },
      'Rate limit snapshot recorded'
    );
  }

  /**
   * Get rate limit trend for a given type since a timestamp, ordered ASC.
   */
  getTrend(rateLimitType: string, since: string): RateLimitSnapshotRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM rate_limit_snapshots
      WHERE rate_limit_type = ? AND created_at >= ?
      ORDER BY created_at ASC
    `);
    return stmt.all(rateLimitType, since) as RateLimitSnapshotRow[];
  }

  /**
   * Get first and last utilization_pct for a session and rate limit type.
   * Returns null if fewer than 2 records exist.
   */
  getSessionDelta(sdkSessionId: string, rateLimitType: string): RateLimitSessionDelta | null {
    const stmt = this.db.prepare(`
      SELECT utilization_pct FROM rate_limit_snapshots
      WHERE sdk_session_id = ? AND rate_limit_type = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(sdkSessionId, rateLimitType) as { utilization_pct: number }[];
    if (rows.length < 2) return null;
    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    if (firstRow === undefined || lastRow === undefined) return null;
    const first = firstRow.utilization_pct;
    const last = lastRow.utilization_pct;
    return {
      firstUtilization: first,
      lastUtilization: last,
      delta: last - first,
    };
  }

  /**
   * Compare max utilization this week vs last week for each rate limit type.
   * Returns the aggregate across all types.
   */
  getWeekOverWeekGrowth(): WeekOverWeekGrowth {
    const stmt = this.db.prepare(`
      SELECT
        MAX(CASE WHEN created_at >= DATE('now', '-7 days') THEN utilization_pct ELSE NULL END) as this_week_max,
        MAX(CASE WHEN created_at >= DATE('now', '-14 days') AND created_at < DATE('now', '-7 days') THEN utilization_pct ELSE NULL END) as last_week_max
      FROM rate_limit_snapshots
    `);
    const row = stmt.get() as { this_week_max: number | null; last_week_max: number | null };
    const thisWeekMax = row.this_week_max ?? 0;
    const lastWeekMax = row.last_week_max ?? 0;
    let growthPct: number | null = null;
    if (lastWeekMax > 0) {
      growthPct = Math.round(((thisWeekMax - lastWeekMax) / lastWeekMax) * 100);
    }
    return { thisWeekMax, lastWeekMax, growthPct };
  }

  /**
   * Get the most recent rate limit snapshot for a given type.
   */
  getLatest(rateLimitType: string): RateLimitSnapshotRow | null {
    const stmt = this.db.prepare(`
      SELECT * FROM rate_limit_snapshots
      WHERE rate_limit_type = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = stmt.get(rateLimitType) as RateLimitSnapshotRow | undefined;
    return row ?? null;
  }
}
