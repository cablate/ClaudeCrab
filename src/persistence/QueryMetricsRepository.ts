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
  KeepaliveStats,
  WeeklyUsageStats,
  WeekOverWeekQueryGrowth,
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
    turnType?: string;
    sdkSessionId?: string;
    contextTotalTokens?: number;
    contextMaxTokens?: number;
    contextPercentage?: number;
    contextModel?: string;
  }): number {
    const now = dateToString(new Date());
    const costCents = Math.round(params.totalCostUsd * 100);
    const stmt = this.db.prepare(`
      INSERT INTO query_metrics (
        agent_id, platform, chat_id, user_id,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        total_cost_usd, total_cost_cents, num_turns, duration_ms, created_at,
        turn_type, sdk_session_id,
        context_total_tokens, context_max_tokens, context_percentage, context_model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
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
      now,
      params.turnType ?? 'query',
      params.sdkSessionId ?? null,
      params.contextTotalTokens ?? null,
      params.contextMaxTokens ?? null,
      params.contextPercentage ?? null,
      params.contextModel ?? null
    );
    this.log.debug(
      {
        agentId: params.agentId,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        costUsd: params.totalCostUsd,
        turnType: params.turnType ?? 'query',
        contextTotalTokens: params.contextTotalTokens,
      },
      'Query metrics recorded'
    );
    return Number(result.lastInsertRowid);
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
      WHERE agent_id = ? AND (turn_type IS NULL OR turn_type = 'query')
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
      WHERE (turn_type IS NULL OR turn_type = 'query')
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
      WHERE created_at >= ? AND (turn_type IS NULL OR turn_type = 'query')
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
        AND (turn_type IS NULL OR turn_type = 'query')
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

  getRecentQueries(limit: number, offset = 0, agentId?: string, since?: string): QueryMetricRow[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (agentId !== undefined) { conditions.push('agent_id = ?'); params.push(agentId); }
    if (since !== undefined) { conditions.push('created_at >= ?'); params.push(since); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM query_metrics ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as RawQueryRow[];
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
      ...(row.turn_type !== null ? { turnType: row.turn_type } : {}),
      ...(row.sdk_session_id !== null ? { sdkSessionId: row.sdk_session_id } : {}),
      ...(row.context_total_tokens !== null ? { contextTotalTokens: row.context_total_tokens } : {}),
      ...(row.context_max_tokens !== null ? { contextMaxTokens: row.context_max_tokens } : {}),
      ...(row.context_percentage !== null ? { contextPercentage: row.context_percentage } : {}),
      ...(row.context_model !== null ? { contextModel: row.context_model } : {}),
    }));
  }

  /**
   * Get recent queries for a specific channel, filtered in SQL.
   * Avoids pulling unneeded rows and filtering in JS.
   */
  getRecentChannelQueries(channelId: string, agentId?: string, since?: string, limit = 100): QueryMetricRow[] {
    const conditions: string[] = ['chat_id = ?'];
    const params: (string | number)[] = [channelId];
    if (agentId !== undefined) { conditions.push('agent_id = ?'); params.push(agentId); }
    if (since !== undefined) { conditions.push('created_at >= ?'); params.push(since); }
    const sql = `SELECT * FROM query_metrics WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as RawQueryRow[];
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
      ...(row.turn_type !== null ? { turnType: row.turn_type } : {}),
      ...(row.sdk_session_id !== null ? { sdkSessionId: row.sdk_session_id } : {}),
      ...(row.context_total_tokens !== null ? { contextTotalTokens: row.context_total_tokens } : {}),
      ...(row.context_max_tokens !== null ? { contextMaxTokens: row.context_max_tokens } : {}),
      ...(row.context_percentage !== null ? { contextPercentage: row.context_percentage } : {}),
      ...(row.context_model !== null ? { contextModel: row.context_model } : {}),
    }));
  }

  /**
   * Get keepalive ping stats, optionally filtered by SDK session ID.
   */
  getKeepaliveStats(sdkSessionId?: string): KeepaliveStats {
    const sql = sdkSessionId
      ? `SELECT
           COUNT(*) as total_pings,
           SUM(input_tokens) as total_input_tokens,
           SUM(cache_read_tokens) as total_cache_read_tokens,
           SUM(cache_creation_tokens) as total_cache_creation_tokens,
           SUM(total_cost_usd) as total_cost_usd
         FROM query_metrics
         WHERE turn_type = 'keepalive' AND sdk_session_id = ?`
      : `SELECT
           COUNT(*) as total_pings,
           SUM(input_tokens) as total_input_tokens,
           SUM(cache_read_tokens) as total_cache_read_tokens,
           SUM(cache_creation_tokens) as total_cache_creation_tokens,
           SUM(total_cost_usd) as total_cost_usd
         FROM query_metrics
         WHERE turn_type = 'keepalive'`;
    const stmt = this.db.prepare(sql);
    const row = (sdkSessionId ? stmt.get(sdkSessionId) : stmt.get()) as RawKeepaliveRow | undefined;
    return {
      totalPings: row?.total_pings ?? 0,
      totalInputTokens: row?.total_input_tokens ?? 0,
      totalCacheReadTokens: row?.total_cache_read_tokens ?? 0,
      totalCacheCreationTokens: row?.total_cache_creation_tokens ?? 0,
      totalCostUsd: row?.total_cost_usd ?? 0,
    };
  }

  /**
   * Get weekly aggregated stats for all query turns over N weeks.
   */
  getWeeklyStats(weeks: number): WeeklyUsageStats[] {
    const stmt = this.db.prepare(`
      SELECT
        STRFTIME('%Y-W%W', created_at) as week,
        COUNT(*) as queries,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_cost_usd) as cost_usd
      FROM query_metrics
      WHERE created_at >= DATE('now', ?) AND (turn_type IS NULL OR turn_type = 'query')
      GROUP BY STRFTIME('%Y-W%W', created_at)
      ORDER BY week ASC
    `);
    const rows = stmt.all(`-${weeks * 7} days`) as RawWeeklyRow[];
    return rows.map((row) => ({
      week: row.week,
      queries: row.queries,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
    }));
  }

  /**
   * Compare max total_cost_usd per week: this week vs last week.
   */
  getWeekOverWeekGrowth(): WeekOverWeekQueryGrowth {
    const stmt = this.db.prepare(`
      SELECT
        SUM(CASE WHEN created_at >= DATE('now', '-7 days') THEN total_cost_usd ELSE 0 END) as this_week_cost,
        SUM(CASE WHEN created_at >= DATE('now', '-14 days') AND created_at < DATE('now', '-7 days') THEN total_cost_usd ELSE 0 END) as last_week_cost
      FROM query_metrics
      WHERE turn_type IS NULL OR turn_type = 'query'
    `);
    const row = stmt.get() as { this_week_cost: number | null; last_week_cost: number | null };
    const thisWeekCost = row.this_week_cost ?? 0;
    const lastWeekCost = row.last_week_cost ?? 0;
    let growthPct: number | null = null;
    if (lastWeekCost > 0) {
      growthPct = Math.round(((thisWeekCost - lastWeekCost) / lastWeekCost) * 100);
    }
    return { thisWeekCost, lastWeekCost, growthPct };
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
  turn_type: string | null;
  sdk_session_id: string | null;
  context_total_tokens: number | null;
  context_max_tokens: number | null;
  context_percentage: number | null;
  context_model: string | null;
}

/** Raw row from keepalive aggregation */
interface RawKeepaliveRow {
  total_pings: number;
  total_input_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  total_cost_usd: number;
}

/** Raw row from weekly aggregation */
interface RawWeeklyRow {
  week: string;
  queries: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

