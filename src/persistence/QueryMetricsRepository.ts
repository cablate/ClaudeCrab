/**
 * Repository for query metrics tracking (ADR-020 Phase 2).
 * Records token usage, cost, and performance data per SDK query.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type {
  IQueryMetricsRepository,
  AgentUsageStats,
  DailyUsageStats,
  QueryMetricRow,
} from './types.js';
import { dateToString } from './types.js';
import { logger } from '../utils/logger.js';

export class QueryMetricsRepository implements IQueryMetricsRepository {
  private readonly db: DatabaseType;
  private readonly log = logger.child({ module: 'QueryMetricsRepository' });

  constructor(db: DatabaseType) {
    this.db = db;
  }

  record(params: {
    agentId: string;
    platform: string;
    chatId: string;
    userId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalCostUsd: number;
    numTurns: number;
    durationMs: number;
  }): void {
    const now = dateToString(new Date());
    const costCents = Math.round(params.totalCostUsd * 100);
    const stmt = this.db.prepare(`
      INSERT INTO query_metrics (
        agent_id, platform, chat_id, user_id,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        total_cost_usd, total_cost_cents, num_turns, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      params.agentId,
      params.platform,
      params.chatId,
      params.userId,
      params.inputTokens,
      params.outputTokens,
      params.cacheReadTokens,
      params.cacheCreationTokens,
      params.totalCostUsd,
      costCents,
      params.numTurns,
      params.durationMs,
      now
    );
    this.log.debug(
      {
        agentId: params.agentId,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        costUsd: params.totalCostUsd,
      },
      'Query metrics recorded'
    );
  }

  getAgentStats(agentId: string): AgentUsageStats | null {
    const stmt = this.db.prepare(`
      SELECT
        agent_id,
        COUNT(*) as total_queries,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cache_read_tokens) as total_cache_read_tokens,
        SUM(cache_creation_tokens) as total_cache_creation_tokens,
        SUM(total_cost_usd) as total_cost_usd,
        AVG(duration_ms) as avg_duration_ms
      FROM query_metrics
      WHERE agent_id = ?
      GROUP BY agent_id
    `);
    const row = stmt.get(agentId) as RawStatsRow | undefined;
    return row ? this.mapStatsRow(row) : null;
  }

  getAgentStatsSince(agentId: string, since: string): AgentUsageStats | null {
    const stmt = this.db.prepare(`
      SELECT
        agent_id,
        COUNT(*) as total_queries,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cache_read_tokens) as total_cache_read_tokens,
        SUM(cache_creation_tokens) as total_cache_creation_tokens,
        SUM(total_cost_usd) as total_cost_usd,
        AVG(duration_ms) as avg_duration_ms
      FROM query_metrics
      WHERE agent_id = ? AND created_at >= ?
      GROUP BY agent_id
    `);
    const row = stmt.get(agentId, since) as RawStatsRow | undefined;
    return row ? this.mapStatsRow(row) : null;
  }

  getAllAgentStats(): AgentUsageStats[] {
    const stmt = this.db.prepare(`
      SELECT
        agent_id,
        COUNT(*) as total_queries,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cache_read_tokens) as total_cache_read_tokens,
        SUM(cache_creation_tokens) as total_cache_creation_tokens,
        SUM(total_cost_usd) as total_cost_usd,
        AVG(duration_ms) as avg_duration_ms
      FROM query_metrics
      GROUP BY agent_id
    `);
    const rows = stmt.all() as RawStatsRow[];
    return rows.map((row) => this.mapStatsRow(row));
  }

  getAllAgentStatsSince(since: string): AgentUsageStats[] {
    const stmt = this.db.prepare(`
      SELECT
        agent_id,
        COUNT(*) as total_queries,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cache_read_tokens) as total_cache_read_tokens,
        SUM(cache_creation_tokens) as total_cache_creation_tokens,
        SUM(total_cost_usd) as total_cost_usd,
        AVG(duration_ms) as avg_duration_ms
      FROM query_metrics
      WHERE created_at >= ?
      GROUP BY agent_id
    `);
    const rows = stmt.all(since) as RawStatsRow[];
    return rows.map((row) => this.mapStatsRow(row));
  }

  getDailyStats(agentId: string, days: number): DailyUsageStats[] {
    const stmt = this.db.prepare(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as queries,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_cost_usd) as cost_usd
      FROM query_metrics
      WHERE agent_id = ? AND created_at >= DATE('now', ?)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);
    const rows = stmt.all(agentId, `-${days} days`) as RawDailyRow[];
    return rows.map((row) => ({
      date: row.date,
      queries: row.queries,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
    }));
  }

  getDailyStatsAll(days: number): DailyUsageStats[] {
    const stmt = this.db.prepare(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as queries,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_cost_usd) as cost_usd
      FROM query_metrics
      WHERE created_at >= DATE('now', ?)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);
    const rows = stmt.all(`-${days} days`) as RawDailyRow[];
    return rows.map((row) => ({
      date: row.date,
      queries: row.queries,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
    }));
  }

  getRecentQueries(limit: number, offset = 0, agentId?: string): QueryMetricRow[] {
    const sql = agentId
      ? `SELECT * FROM query_metrics WHERE agent_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
      : `SELECT * FROM query_metrics ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const stmt = this.db.prepare(sql);
    const rows = agentId
      ? (stmt.all(agentId, limit, offset) as RawQueryRow[])
      : (stmt.all(limit, offset) as RawQueryRow[]);
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      platform: row.platform,
      chatId: row.chat_id,
      userId: row.user_id,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      totalCostUsd: row.total_cost_usd,
      numTurns: row.num_turns,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    }));
  }

  private mapStatsRow(row: RawStatsRow): AgentUsageStats {
    return {
      agentId: row.agent_id,
      totalQueries: row.total_queries,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalCacheReadTokens: row.total_cache_read_tokens,
      totalCacheCreationTokens: row.total_cache_creation_tokens,
      totalCostUsd: row.total_cost_usd,
      avgDurationMs: Math.round(row.avg_duration_ms),
    };
  }
}

/** Raw row from aggregation query */
interface RawStatsRow {
  agent_id: string;
  total_queries: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  total_cost_usd: number;
  avg_duration_ms: number;
}

/** Raw row from daily aggregation query */
interface RawDailyRow {
  date: string;
  queries: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/** Raw row from individual query record */
interface RawQueryRow {
  id: number;
  agent_id: string;
  platform: string;
  chat_id: string;
  user_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_cost_usd: number;
  num_turns: number;
  duration_ms: number;
  created_at: string;
}
