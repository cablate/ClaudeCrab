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
   * Find session by platform and user ID
   */
  findByPlatformAndUser(platform: string, userId: string): SessionRow | undefined;

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
 * Conversation repository interface
 */
export interface IConversationRepository {
  /**
   * Find all messages for a session
   */
  findBySessionId(sessionId: string): ConversationRow[];

  /**
   * Append a message to a session's conversation
   */
  appendMessage(sessionId: string, role: 'user' | 'assistant', content: string): void;

  /**
   * Clear all messages for a session
   */
  clearConversation(sessionId: string): void;

  /**
   * Trim conversation to keep only the last N messages
   */
  trimConversation(sessionId: string, keepCount: number): void;
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
