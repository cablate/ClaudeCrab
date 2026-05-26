/**
 * Repository for persistent group membership tracking (ADR-020).
 * Tracks which bots belong to which groups, surviving restarts.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { IGroupMemberRepository, GroupMemberRow } from './types.js';
import { dateToString } from './types.js';
import { logger } from '../utils/logger.js';

export class GroupMemberRepository implements IGroupMemberRepository {
  private readonly db: DatabaseType;
  private readonly log = logger.child({ module: 'GroupMemberRepository' });

  constructor(db: DatabaseType) {
    this.db = db;
  }

  registerMember(platform: string, chatId: string, agentId: string): void {
    const now = dateToString(new Date());
    const stmt = this.db.prepare(`
      INSERT INTO group_members (platform, chat_id, agent_id, joined_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, chat_id, agent_id) DO UPDATE SET updated_at = ?
    `);
    stmt.run(platform, chatId, agentId, now, now, now, now);
    this.log.debug({ platform, chatId, agentId }, 'Member registered');
  }

  getMembers(platform: string, chatId: string): GroupMemberRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM group_members
      WHERE platform = ? AND chat_id = ?
      ORDER BY joined_at ASC
    `);
    return stmt.all(platform, chatId) as GroupMemberRow[];
  }

  getAllMembers(): GroupMemberRow[] {
    const stmt = this.db.prepare(
      'SELECT * FROM group_members ORDER BY chat_id, joined_at'
    );
    return stmt.all() as GroupMemberRow[];
  }

  removeMember(platform: string, chatId: string, agentId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM group_members
      WHERE platform = ? AND chat_id = ? AND agent_id = ?
    `);
    stmt.run(platform, chatId, agentId);
    this.log.debug({ platform, chatId, agentId }, 'Member removed');
  }
}
