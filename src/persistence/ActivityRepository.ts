import type { Database as DatabaseType } from 'better-sqlite3';
import type { ActivityEvent } from '../types/activity.js';

/**
 * SQLite repository for activity events.
 * Follows the same pattern as SessionRepository, ConversationRepository, etc.
 */
export class ActivityRepository {
  private readonly db: DatabaseType;

  constructor(db: DatabaseType) {
    this.db = db;
  }

  /** Insert a single activity event */
  insert(event: ActivityEvent): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO activity_events
        (id, agent_id, agent_name, type, phase, message, mood, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.agentId,
      event.agentName,
      event.type,
      event.phase ?? null,
      event.message,
      event.mood ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.timestamp,
    );
  }

  /** Batch insert using a single transaction (one disk sync for all events) */
  insertBatch(events: ActivityEvent[]): void {
    if (events.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO activity_events
        (id, agent_id, agent_name, type, phase, message, mood, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const runBatch = this.db.transaction((items: ActivityEvent[]) => {
      for (const event of items) {
        stmt.run(
          event.id,
          event.agentId,
          event.agentName,
          event.type,
          event.phase ?? null,
          event.message,
          event.mood ?? null,
          event.metadata ? JSON.stringify(event.metadata) : null,
          event.timestamp,
        );
      }
    });
    runBatch(events);
  }

  /** Query recent events with optional filters */
  getRecent(limit: number, filters?: {
    agentId?: string;
    type?: string;
    since?: string;
  }): ActivityEvent[] {
    let sql = 'SELECT * FROM activity_events WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filters.agentId);
    }
    if (filters?.type) {
      sql += ' AND type = ?';
      params.push(filters.type);
    }
    if (filters?.since) {
      sql += ' AND created_at >= ?';
      params.push(filters.since);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as ActivityEventRow[];
    return rows.map(rowToEvent);
  }

  /** Get recent reaction messages for a specific agent (for ReactionGenerator continuity) */
  getRecentReactionMessages(agentId: string, limit: number): string[] {
    const rows = this.db.prepare(`
      SELECT message FROM activity_events
      WHERE agent_id = ? AND type = 'reaction'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(agentId, limit) as Array<{ message: string }>;
    return rows.map(r => r.message);
  }

  /** Get the latest mood for each agent (for state restoration on startup) */
  getLatestMoodByAgent(): Array<{ agentId: string; mood: string; phase: string | null }> {
    const rows = this.db.prepare(`
      SELECT e.agent_id, e.mood, e.phase
      FROM activity_events e
      INNER JOIN (
        SELECT agent_id, MAX(created_at) AS max_ts
        FROM activity_events
        WHERE mood IS NOT NULL
        GROUP BY agent_id
      ) latest ON e.agent_id = latest.agent_id AND e.created_at = latest.max_ts
      WHERE e.mood IS NOT NULL
    `).all() as Array<{ agent_id: string; mood: string; phase: string | null }>;
    return rows.map(r => ({ agentId: r.agent_id, mood: r.mood, phase: r.phase }));
  }

  /** Delete events older than given ISO date */
  deleteOlderThan(isoDate: string): number {
    const result = this.db.prepare(
      'DELETE FROM activity_events WHERE created_at < ?'
    ).run(isoDate);
    return result.changes;
  }

  /** Get aggregated stats since a given ISO date */
  getStats(sinceIso: string): { total: number; workflow: number; personality: number; messagesHandled: number; tasksCompleted: number; byAgent: Array<{ agentId: string; agentName: string; count: number }> } {
    const totalRow = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM activity_events WHERE created_at >= ?'
    ).get(sinceIso) as { cnt: number };

    const workflowRow = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM activity_events WHERE created_at >= ? AND type = 'workflow'"
    ).get(sinceIso) as { cnt: number };

    const personalityRow = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM activity_events WHERE created_at >= ? AND type IN ('reaction', 'mutter')"
    ).get(sinceIso) as { cnt: number };

    const byAgent = this.db.prepare(
      'SELECT agent_id as agentId, agent_name as agentName, COUNT(*) as count FROM activity_events WHERE created_at >= ? GROUP BY agent_id ORDER BY count DESC'
    ).all(sinceIso) as Array<{ agentId: string; agentName: string; count: number }>;

    const messagesRow = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM activity_events WHERE created_at >= ? AND type = 'workflow' AND phase = 'task_received'"
    ).get(sinceIso) as { cnt: number };

    const completedRow = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM activity_events WHERE created_at >= ? AND type = 'workflow' AND phase = 'completed'"
    ).get(sinceIso) as { cnt: number };

    return {
      total: totalRow.cnt,
      workflow: workflowRow.cnt,
      personality: personalityRow.cnt,
      messagesHandled: messagesRow.cnt,
      tasksCompleted: completedRow.cnt,
      byAgent,
    };
  }
}

// --- Internal ---

interface ActivityEventRow {
  id: string;
  agent_id: string;
  agent_name: string;
  type: string;
  phase: string | null;
  message: string;
  mood: string | null;
  metadata: string | null;
  created_at: string;
}

function rowToEvent(row: ActivityEventRow): ActivityEvent {
  const event: ActivityEvent = {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    type: row.type as ActivityEvent['type'],
    message: row.message,
    timestamp: row.created_at,
  };
  if (row.phase !== null) event.phase = row.phase as NonNullable<ActivityEvent['phase']>;
  if (row.mood !== null) event.mood = row.mood as NonNullable<ActivityEvent['mood']>;
  if (row.metadata) {
    try {
      event.metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch { /* ignore parse errors */ }
  }
  return event;
}
