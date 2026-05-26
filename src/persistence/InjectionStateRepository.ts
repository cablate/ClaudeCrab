/**
 * Repository for group injection state persistence operations
 * Tracks the injection cursor for each bot in each group chat
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { IInjectionStateRepository, InjectionStateRow } from './types.js';
import { dateToString } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * SQLite implementation of injection state repository
 */
export class InjectionStateRepository implements IInjectionStateRepository {
  private readonly db: DatabaseType;
  private readonly log = logger.child({ module: 'InjectionStateRepository' });

  constructor(db: DatabaseType) {
    this.db = db;
  }

  /**
   * Ensure injection state exists for a bot in a group.
   * Creates new state if not exists (recording when bot first sees this group).
   * Returns existing state if it already exists.
   */
  ensureState(
    agentId: string,
    chatId: string,
    platform: string,
    currentMsgId: string
  ): InjectionStateRow {
    // Try to get existing state first
    const existing = this.getState(agentId, chatId, platform);
    if (existing) {
      return existing;
    }

    // Create new state - this is when the bot "joins" the group
    const now = dateToString(new Date());
    const stmt = this.db.prepare(`
      INSERT INTO group_injection_state
        (agent_id, chat_id, platform, joined_at, joined_msg_id, last_injected_msg_id, last_injected_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `);

    stmt.run(agentId, chatId, platform, now, currentMsgId, now, now);

    this.log.info(
      { agentId, chatId, platform, joinedMsgId: currentMsgId },
      'Bot joined group - injection state created'
    );

    // Return the newly created state
    return this.getState(agentId, chatId, platform)!;
  }

  /**
   * Get injection state for a bot in a group
   */
  getState(
    agentId: string,
    chatId: string,
    platform: string
  ): InjectionStateRow | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM group_injection_state
      WHERE agent_id = ? AND chat_id = ? AND platform = ?
    `);

    return stmt.get(agentId, chatId, platform) as InjectionStateRow | undefined;
  }

  /**
   * Update the injection cursor after successful SDK query
   */
  updateCursor(
    agentId: string,
    chatId: string,
    platform: string,
    lastMsgId: string
  ): void {
    const now = dateToString(new Date());
    const stmt = this.db.prepare(`
      UPDATE group_injection_state
      SET last_injected_msg_id = ?, last_injected_at = ?, updated_at = ?
      WHERE agent_id = ? AND chat_id = ? AND platform = ?
    `);

    const result = stmt.run(lastMsgId, now, now, agentId, chatId, platform);

    if (result.changes > 0) {
      this.log.debug(
        { agentId, chatId, platform, lastMsgId },
        'Injection cursor updated'
      );
    }
  }
}
