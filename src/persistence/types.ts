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
}

/**
 * Database row type for group_messages table
 */
export interface GroupMessageRow {
  id: number;
  platform: string;
  chat_id: string;
  platform_msg_id: string;
  sender_type: 'user' | 'bot';
  sender_id: string;
  sender_label: string;
  content: string;
  created_at: string;
}

/**
 * Database row type for group_injection_state table
 */
export interface InjectionStateRow {
  id: number;
  agent_id: string;
  chat_id: string;
  platform: string;
  joined_at: string;
  joined_msg_id: string | null;
  last_injected_msg_id: string | null;
  last_injected_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Group message repository interface
 */
export interface IGroupMessageRepository {
  /**
   * Record a group message (user or bot)
   */
  recordMessage(
    platform: string,
    chatId: string,
    platformMsgId: string,
    senderType: 'user' | 'bot',
    senderId: string,
    senderLabel: string,
    content: string
  ): void;

  /**
   * Get messages after a specific autoincrement ID (for context injection).
   * Uses group_messages.id (autoincrement) for cursor, NOT platform_msg_id,
   * because regular Telegram groups give each bot different message_ids.
   * @param afterId - Start from messages after this autoincrement ID (null = from beginning)
   * @param excludeAgentId - Exclude messages from this bot (to avoid self-injection)
   * @param limit - Maximum number of messages to return
   */
  getMessagesAfter(
    platform: string,
    chatId: string,
    afterId: string | null,
    excludeAgentId: string,
    limit?: number
  ): GroupMessageRow[];

  /**
   * Get the latest autoincrement ID for a group
   */
  getLatestId(platform: string, chatId: string): number | null;
}

/**
 * Injection state repository interface
 */
export interface IInjectionStateRepository {
  /**
   * Ensure injection state exists for a bot in a group.
   * Creates new state if not exists, returns existing state if exists.
   * @param currentMsgId - The message ID when bot first sees this group
   */
  ensureState(
    agentId: string,
    chatId: string,
    platform: string,
    currentMsgId: string
  ): InjectionStateRow;

  /**
   * Get injection state for a bot in a group
   */
  getState(
    agentId: string,
    chatId: string,
    platform: string
  ): InjectionStateRow | undefined;

  /**
   * Update the injection cursor after successful SDK query
   */
  updateCursor(
    agentId: string,
    chatId: string,
    platform: string,
    lastMsgId: string
  ): void;
}

/**
 * Database row type for group_members table (ADR-020)
 */
export interface GroupMemberRow {
  id: number;
  platform: string;
  chat_id: string;
  agent_id: string;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Group member repository interface (ADR-020)
 */
export interface IGroupMemberRepository {
  /** Register a bot as a member of a group (upsert) */
  registerMember(platform: string, chatId: string, agentId: string): void;

  /** Get all bot members in a group */
  getMembers(platform: string, chatId: string): GroupMemberRow[];

  /** Get all members across all groups (for startup restoration) */
  getAllMembers(): GroupMemberRow[];

  /** Remove a bot from a group */
  removeMember(platform: string, chatId: string, agentId: string): void;
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
  }): void;

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
