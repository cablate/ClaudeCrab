/**
 * Persistence layer type definitions
 */

import type { SessionState } from '../types/session.js';

/**
 * Database row type for sessions table
 */
export interface SessionRow {
  session_id: string;
  agent_id: string;
  platform: string;
  user_id: string;
  state: string;
  created_at: string;
  last_active_at: string;
  sdk_session_id: string | null;
  processed_message_ids: string; // JSON array string
  is_active: number; // SQLite boolean: 1 = active, 0 = soft-deleted (reset)
  continuation_source: string | null; // 'schedule' = pre-created by schedule thread, NULL = normal
  continuation_state: string | null; // 'pending' = awaiting first handoff, 'active' = handoff done, NULL = normal
}

/**
 * Database row type for conversations table
 */
export interface ConversationRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  sequence_number: number;
}

/**
 * Session repository interface
 */
export interface ISessionRepository {
  /**
   * Find session by platform, agent ID, and user ID
   */
  findByPlatformAgentAndUser(platform: string, agentId: string, userId: string): SessionRow | undefined;

  /**
   * Find session by session ID
   */
  findBySessionId(sessionId: string): SessionRow | undefined;

  /**
   * Save or update a session
   */
  save(session: SessionRow): void;

  /**
   * Delete a session by ID
   */
  delete(sessionId: string): boolean;

  /**
   * Find all expired sessions based on timeout
   */
  findExpired(timeoutMs: number): SessionRow[];

  /**
   * Find all sessions
   */
  findAll(): SessionRow[];

  /**
   * Update session state
   */
  updateState(sessionId: string, state: SessionState): void;

  /**
   * Update last active timestamp
   */
  updateLastActive(sessionId: string): void;

  /**
   * Update SDK session ID.
   * Pass null to clear the SDK session ID.
   */
  updateSdkSessionId(sessionId: string, sdkSessionId: string | null): void;

  /**
   * Update processed message IDs
   */
  updateProcessedMessageIds(sessionId: string, messageIds: Set<string>): void;

  /**
   * Soft-delete or reactivate a session (persists across restart).
   */
  updateIsActive(sessionId: string, isActive: boolean): void;

  /**
   * Soft-delete by platform/agent/user lookup (for sessions not in memory).
   * Also clears sdk_session_id. Returns true if a row was updated.
   */
  deactivateByPlatformAgentAndUser(platform: string, agentId: string, userId: string): boolean;

  /**
   * Find a schedule-thread session by threadId.
   * Looks up userId = 'schedule:thread:{threadId}' with continuation_source = 'schedule'.
   */
  findByScheduleThread(threadId: string): SessionRow | undefined;

  /**
   * Mark schedule handoff as active (keep continuation_source, set state to 'active').
   */
  activateScheduleHandoff(sessionId: string): void;

  /**
   * Clear continuation_source and continuation_state (set to NULL) for a session.
   */
  clearContinuationSource(sessionId: string): void;
}

/**
 * Raw database row type for query_metrics table (ADR-020 Phase 2)
 */
export interface QueryMetricRawRow {
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
  context_usage_json: string | null;
}

/**
 * Aggregated usage stats per agent (ADR-020 Phase 2)
 */
export interface AgentUsageStats {
  agentId: string;
  totalQueries: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  avgDurationMs: number;
}

/**
 * Daily usage stats (ADR-020 Phase 2)
 */
export interface DailyUsageStats {
  date: string;
  queries: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Keepalive stats result
 */
export interface KeepaliveStats {
  totalPings: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
}

/**
 * Weekly usage stats
 */
export interface WeeklyUsageStats {
  week: string;
  queries: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Week-over-week growth for query costs
 */
export interface WeekOverWeekQueryGrowth {
  thisWeekCost: number;
  lastWeekCost: number;
  growthPct: number | null;
}

/**
 * Query metrics repository interface (ADR-020 Phase 2)
 */
export interface IQueryMetricsRepository {
  /** Record a query's metrics */
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
    contextUsageJson?: string;
  }): number;

  /** Get aggregated stats for a specific agent (all time) */
  getAgentStats(agentId: string): AgentUsageStats | null;

  /** Get aggregated stats for a specific agent since a given ISO timestamp */
  getAgentStatsSince(agentId: string, since: string): AgentUsageStats | null;

  /** Get aggregated stats for all agents (all time) */
  getAllAgentStats(): AgentUsageStats[];

  /** Get aggregated stats for all agents since a given ISO timestamp */
  getAllAgentStatsSince(since: string): AgentUsageStats[];

  /** Get daily stats for an agent over N days */
  getDailyStats(agentId: string, days: number): DailyUsageStats[];

  /** Get daily stats across all agents over N days */
  getDailyStatsAll(days: number): DailyUsageStats[];

  /** Get recent individual query records */
  getRecentQueries(limit: number, offset?: number, agentId?: string): QueryMetricRow[];

  /** Get keepalive ping stats, optionally filtered by SDK session ID */
  getKeepaliveStats(sdkSessionId?: string): KeepaliveStats;

  /** Get weekly aggregated stats for all query turns over N weeks */
  getWeeklyStats(weeks: number): WeeklyUsageStats[];

  /** Compare query costs this week vs last week */
  getWeekOverWeekGrowth(): WeekOverWeekQueryGrowth;
}

/**
 * Individual query metric row
 */
export interface QueryMetricRow {
  id: number;
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
  createdAt: string;
  turnType?: string;
  sdkSessionId?: string;
  contextTotalTokens?: number;
  contextMaxTokens?: number;
  contextPercentage?: number;
  contextModel?: string;
  contextUsageJson?: string;
}

/**
 * Conversation repository interface
 */
export interface IConversationRepository {
  /**
   * Find all messages for a session
   */
  findBySessionId(sessionId: string): ConversationRow[];

  /**
   * Get last N messages for a session (ordered by sequence_number DESC)
   */
  getLastMessages(sessionId: string, count: number): ConversationRow[];

  /**
   * Append a message to a session's conversation
   */
  appendMessage(sessionId: string, role: 'user' | 'assistant', content: string): void;

  /**
   * Clear all messages for a session
   */
  clearConversation(sessionId: string): void;

  /**
   * Get message count for a session
   */
  getMessageCount(sessionId: string): number;
}

/**
 * Persistence configuration
 */
export interface PersistenceConfig {
  /** Enable persistence (default: false) */
  enabled: boolean;

  /** Path to SQLite database file */
  dbPath: string;

  /** Enable WAL mode for better concurrency (default: true) */
  walMode: boolean;
}

/**
 * Default persistence configuration
 */
export const DEFAULT_PERSISTENCE_CONFIG: PersistenceConfig = {
  enabled: false,
  dbPath: './data/claudecab.db',
  walMode: true,
};

/**
 * Helper: Convert Set<string> to JSON string
 */
export function serializeMessageIds(ids: Set<string>): string {
  return JSON.stringify(Array.from(ids));
}

/**
 * Helper: Convert JSON string to Set<string>
 */
export function deserializeMessageIds(json: string): Set<string> {
  try {
    const arr = JSON.parse(json) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

/**
 * Helper: Convert Date to ISO string
 */
export function dateToString(date: Date): string {
  return date.toISOString();
}

/**
 * Helper: Convert ISO string to Date
 */
export function stringToDate(str: string): Date {
  return new Date(str);
}
