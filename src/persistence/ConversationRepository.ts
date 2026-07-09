/**
 * Repository for conversation persistence operations
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { IConversationRepository, ConversationRow } from './types.js';
import { dateToString } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * SQLite implementation of conversation repository
 */
export class ConversationRepository implements IConversationRepository {
  private readonly db: DatabaseType;

  constructor(db: DatabaseType) {
    this.db = db;
  }

  /**
   * Find all messages for a session, ordered by sequence number
   */
  findBySessionId(sessionId: string): ConversationRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE session_id = ?
      ORDER BY sequence_number ASC
    `);
    return stmt.all(sessionId) as ConversationRow[];
  }

  /**
   * Append a message to a session's conversation
   */
  appendMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
    // Get the next sequence number
    const seqStmt = this.db.prepare(`
      SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_seq
      FROM conversations
      WHERE session_id = ?
    `);
    const seqResult = seqStmt.get(sessionId) as { next_seq: number };
    const sequenceNumber = seqResult.next_seq;

    // Insert the message
    const insertStmt = this.db.prepare(`
      INSERT INTO conversations (session_id, role, content, created_at, sequence_number)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertStmt.run(sessionId, role, content, dateToString(new Date()), sequenceNumber);

    logger.debug(
      { sessionId, role, sequenceNumber },
      'Message appended to conversation in database'
    );
  }

  /**
   * Clear all messages for a session
   */
  clearConversation(sessionId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM conversations WHERE session_id = ?
    `);
    const result = stmt.run(sessionId);

    if (result.changes > 0) {
      logger.debug(
        { sessionId, deletedCount: result.changes },
        'Conversation cleared from database'
      );
    }
  }

  /**
   * Get message count for a session
   */
  getMessageCount(sessionId: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM conversations WHERE session_id = ?
    `);
    const result = stmt.get(sessionId) as { count: number };
    return result.count;
  }

  /**
   * Get the last N messages for a session
   */
  getLastMessages(sessionId: string, count: number): ConversationRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM conversations
        WHERE session_id = ?
        ORDER BY sequence_number DESC
        LIMIT ?
      ) ORDER BY sequence_number ASC
    `);
    return stmt.all(sessionId, count) as ConversationRow[];
  }

}
