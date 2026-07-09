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
