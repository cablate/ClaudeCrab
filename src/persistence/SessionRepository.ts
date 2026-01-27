/**
 * Repository for session persistence operations
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { SessionState } from '../types/session.js';
import type { ISessionRepository, SessionRow } from './types.js';
import { serializeMessageIds, dateToString } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * SQLite implementation of session repository
 */
export class SessionRepository implements ISessionRepository {
  private readonly db: DatabaseType;

  constructor(db: DatabaseType) {
    this.db = db;
  }

  /**
   * Find session by platform and user ID
   */
  findByPlatformAndUser(platform: string, userId: string): SessionRow | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE platform = ? AND user_id = ?
    `);
    return stmt.get(platform, userId) as SessionRow | undefined;
  }

  /**
   * Find session by session ID
   */
  findBySessionId(sessionId: string): SessionRow | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE session_id = ?
    `);
    return stmt.get(sessionId) as SessionRow | undefined;
  }

  /**
   * Save or update a session (upsert)
   */
  save(session: SessionRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        session_id, agent_id, platform, user_id, state,
        created_at, last_active_at, sdk_session_id, processed_message_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        platform = excluded.platform,
        user_id = excluded.user_id,
        state = excluded.state,
        last_active_at = excluded.last_active_at,
        sdk_session_id = excluded.sdk_session_id,
        processed_message_ids = excluded.processed_message_ids
    `);

    stmt.run(
      session.session_id,
      session.agent_id,
      session.platform,
      session.user_id,
      session.state,
      session.created_at,
      session.last_active_at,
      session.sdk_session_id,
      session.processed_message_ids
    );

    logger.debug({ sessionId: session.session_id }, 'Session saved to database');
  }

  /**
   * Delete a session by ID
   */
  delete(sessionId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM sessions WHERE session_id = ?
    `);
    const result = stmt.run(sessionId);

    if (result.changes > 0) {
      logger.debug({ sessionId }, 'Session deleted from database');
      return true;
    }
    return false;
  }

  /**
   * Find all expired sessions based on timeout
   */
  findExpired(timeoutMs: number): SessionRow[] {
    const cutoffTime = new Date(Date.now() - timeoutMs).toISOString();
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE last_active_at < ?
    `);
    return stmt.all(cutoffTime) as SessionRow[];
  }

  /**
   * Find all sessions
   */
  findAll(): SessionRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions ORDER BY last_active_at DESC
    `);
    return stmt.all() as SessionRow[];
  }

  /**
   * Update session state
   */
  updateState(sessionId: string, state: SessionState): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET state = ?, last_active_at = ? WHERE session_id = ?
    `);
    stmt.run(state, dateToString(new Date()), sessionId);
    logger.debug({ sessionId, state }, 'Session state updated in database');
  }

  /**
   * Update last active timestamp
   */
  updateLastActive(sessionId: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET last_active_at = ? WHERE session_id = ?
    `);
    stmt.run(dateToString(new Date()), sessionId);
  }

  /**
   * Update SDK session ID.
   * Pass null to clear the SDK session ID.
   */
  updateSdkSessionId(sessionId: string, sdkSessionId: string | null): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET sdk_session_id = ?, last_active_at = ? WHERE session_id = ?
    `);
    stmt.run(sdkSessionId, dateToString(new Date()), sessionId);
    logger.debug({ sessionId, sdkSessionId }, 'SDK session ID updated in database');
  }

  /**
   * Update processed message IDs
   */
  updateProcessedMessageIds(sessionId: string, messageIds: Set<string>): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET processed_message_ids = ?, last_active_at = ? WHERE session_id = ?
    `);
    stmt.run(serializeMessageIds(messageIds), dateToString(new Date()), sessionId);
  }

  /**
   * Update agent ID (for agent switching)
   */
  updateAgentId(sessionId: string, agentId: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET agent_id = ?, sdk_session_id = NULL, last_active_at = ? WHERE session_id = ?
    `);
    stmt.run(agentId, dateToString(new Date()), sessionId);
    logger.debug({ sessionId, agentId }, 'Agent ID updated in database');
  }

  /**
   * Count total sessions
   */
  count(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM sessions`);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Count sessions by platform
   */
  countByPlatform(platform: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sessions WHERE platform = ?
    `);
    const result = stmt.get(platform) as { count: number };
    return result.count;
  }

  /**
   * Delete expired sessions
   */
  deleteExpired(timeoutMs: number): number {
    const cutoffTime = new Date(Date.now() - timeoutMs).toISOString();
    const stmt = this.db.prepare(`
      DELETE FROM sessions WHERE last_active_at < ?
    `);
    const result = stmt.run(cutoffTime);

    if (result.changes > 0) {
      logger.debug({ count: result.changes }, 'Expired sessions deleted from database');
    }
    return result.changes;
  }
}
