/**
 * Repository for group message persistence operations
 * Used for multi-bot context injection in group chats
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { IGroupMessageRepository, GroupMessageRow } from './types.js';
import { dateToString } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * SQLite implementation of group message repository
 */
export class GroupMessageRepository implements IGroupMessageRepository {
  private readonly db: DatabaseType;
  private readonly log = logger.child({ module: 'GroupMessageRepository' });

  constructor(db: DatabaseType) {
    this.db = db;
  }

  /**
   * Record a group message (user or bot)
   * Uses INSERT OR IGNORE to handle duplicate message IDs gracefully
   */
  recordMessage(
    platform: string,
    chatId: string,
    platformMsgId: string,
    senderType: 'user' | 'bot',
    senderId: string,
    senderLabel: string,
    content: string
  ): void {
    this.log.debug(
      { platform, chatId, platformMsgId, senderType, senderId, senderLabel, contentLength: content.length },
      'recordMessage: attempting to insert'
    );

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO group_messages
        (platform, chat_id, platform_msg_id, sender_type, sender_id, sender_label, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      platform,
      chatId,
      platformMsgId,
      senderType,
      senderId,
      senderLabel,
      content,
      dateToString(new Date())
    );

    if (result.changes > 0) {
      this.log.debug(
        { platform, chatId, platformMsgId, senderType, senderId },
        'recordMessage: SUCCESS - message inserted'
      );
    } else {
      this.log.debug(
        { platform, chatId, platformMsgId, senderType, senderId },
        'recordMessage: SKIPPED - duplicate or constraint violation (INSERT OR IGNORE)'
      );
    }
  }

  /**
   * Get messages after a specific autoincrement ID for context injection.
   * Uses group_messages.id (autoincrement) for cursor instead of platform_msg_id,
   * because grouped Discord context can be observed through different adapter views.
   */
  getMessagesAfter(
    platform: string,
    chatId: string,
    afterId: string | null,
    excludeAgentId: string,
    limit: number = 50
  ): GroupMessageRow[] {
    if (afterId === null) {
      // No cursor - return empty (new bot, no history to inject)
      return [];
    }

    // Query messages after the cursor (using autoincrement id for ordering),
    // excluding the bot's own messages
    const stmt = this.db.prepare(`
      SELECT * FROM group_messages
      WHERE platform = ?
        AND chat_id = ?
        AND id > ?
        AND NOT (sender_type = 'bot' AND sender_id = ?)
      ORDER BY id ASC
      LIMIT ?
    `);

    const results = stmt.all(platform, chatId, Number(afterId), excludeAgentId, limit) as GroupMessageRow[];

    this.log.debug(
      { platform, chatId, afterId, excludeAgentId, limit, resultCount: results.length },
      'getMessagesAfter query executed'
    );

    return results;
  }

  /**
   * Get the latest autoincrement ID for a group
   */
  getLatestId(platform: string, chatId: string): number | null {
    const stmt = this.db.prepare(`
      SELECT id FROM group_messages
      WHERE platform = ? AND chat_id = ?
      ORDER BY id DESC
      LIMIT 1
    `);

    const result = stmt.get(platform, chatId) as { id: number } | undefined;
    return result?.id ?? null;
  }
}
