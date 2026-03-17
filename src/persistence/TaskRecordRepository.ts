/**
 * TaskRecordRepository — structured task management (Discord Forum + SQLite dual-layer).
 *
 * Tasks are created both as Discord Forum posts and SQLite records.
 * SQLite provides fast queries; Discord Forum provides visual UI.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type TaskStatus = 'backlog' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type TaskPriority = 'urgent' | 'medium' | 'low';

export interface TaskRecordRow {
  id: string;
  discord_thread_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_agent_id: string | null;
  created_by_agent_id: string | null;
  created_by_user_id: string | null;
  parent_task_id: string | null;
  cost_cents: number;
  review_count: number;
  agent_thread_ids: string; // JSON: { [agentId]: threadId }
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assigneeAgentId?: string;
  createdByAgentId?: string;
  createdByUserId?: string;
  parentTaskId?: string;
  discordThreadId?: string;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeAgentId?: string;
  discordThreadId?: string;
  costCents?: number;
}

export class TaskRecordRepository {
  private readonly db: DatabaseType;

  constructor(db: DatabaseType) {
    this.db = db;
  }

  /**
   * Create a new task
   */
  insert(input: CreateTaskInput): string {
    const id = randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO task_records
        (id, discord_thread_id, title, description, status, priority,
         assignee_agent_id, created_by_agent_id, created_by_user_id,
         parent_task_id, cost_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'backlog', ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    stmt.run(
      id,
      input.discordThreadId ?? null,
      input.title,
      input.description ?? null,
      input.priority ?? 'medium',
      input.assigneeAgentId ?? null,
      input.createdByAgentId ?? null,
      input.createdByUserId ?? null,
      input.parentTaskId ?? null,
      now,
      now,
    );

    return id;
  }

  /**
   * Get a task by ID
   */
  getById(id: string): TaskRecordRow | undefined {
    const stmt = this.db.prepare('SELECT * FROM task_records WHERE id = ?');
    return stmt.get(id) as TaskRecordRow | undefined;
  }

  /**
   * Update task fields
   */
  update(id: string, input: UpdateTaskInput): void {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (input.status !== undefined) {
      sets.push('status = ?');
      params.push(input.status);
      if (input.status === 'done' || input.status === 'cancelled') {
        sets.push('completed_at = ?');
        params.push(now);
      }
    }
    if (input.priority !== undefined) {
      sets.push('priority = ?');
      params.push(input.priority);
    }
    if (input.assigneeAgentId !== undefined) {
      sets.push('assignee_agent_id = ?');
      params.push(input.assigneeAgentId);
    }
    if (input.discordThreadId !== undefined) {
      sets.push('discord_thread_id = ?');
      params.push(input.discordThreadId);
    }
    if (input.costCents !== undefined) {
      sets.push('cost_cents = ?');
      params.push(input.costCents);
    }

    params.push(id);
    const stmt = this.db.prepare(
      `UPDATE task_records SET ${sets.join(', ')} WHERE id = ?`
    );
    stmt.run(...params);
  }

  /**
   * List tasks by status
   */
  listByStatus(status?: TaskStatus, limit = 50): TaskRecordRow[] {
    if (status !== undefined) {
      const stmt = this.db.prepare(
        'SELECT * FROM task_records WHERE status = ? ORDER BY created_at DESC LIMIT ?'
      );
      return stmt.all(status, limit) as TaskRecordRow[];
    }
    const stmt = this.db.prepare(
      'SELECT * FROM task_records ORDER BY created_at DESC LIMIT ?'
    );
    return stmt.all(limit) as TaskRecordRow[];
  }

  /**
   * List tasks assigned to an agent
   */
  listByAgent(agentId: string, status?: TaskStatus): TaskRecordRow[] {
    if (status !== undefined) {
      const stmt = this.db.prepare(
        'SELECT * FROM task_records WHERE assignee_agent_id = ? AND status = ? ORDER BY created_at DESC'
      );
      return stmt.all(agentId, status) as TaskRecordRow[];
    }
    const stmt = this.db.prepare(
      'SELECT * FROM task_records WHERE assignee_agent_id = ? ORDER BY created_at DESC'
    );
    return stmt.all(agentId) as TaskRecordRow[];
  }

  /**
   * Get a task by Discord thread ID (for dedup check in Forum listener)
   */
  getByDiscordThreadId(threadId: string): TaskRecordRow | undefined {
    const stmt = this.db.prepare('SELECT * FROM task_records WHERE discord_thread_id = ? LIMIT 1');
    return stmt.get(threadId) as TaskRecordRow | undefined;
  }

  /**
   * Get task summary counts by status
   */
  getSummary(): Record<TaskStatus, number> {
    const stmt = this.db.prepare(
      'SELECT status, COUNT(*) as count FROM task_records GROUP BY status'
    );
    const rows = stmt.all() as Array<{ status: TaskStatus; count: number }>;
    const result: Record<TaskStatus, number> = {
      backlog: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
      cancelled: 0,
    };
    for (const row of rows) {
      result[row.status] = row.count;
    }
    return result;
  }

  /**
   * Clear discord_thread_id (used to resolve Forum listener race condition)
   */
  clearDiscordThreadId(id: string): void {
    this.db.prepare('UPDATE task_records SET discord_thread_id = NULL, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  /**
   * Add cost to a task (accumulate)
   */
  addCost(taskId: string, costCents: number): void {
    const stmt = this.db.prepare(
      'UPDATE task_records SET cost_cents = cost_cents + ?, updated_at = ? WHERE id = ?'
    );
    stmt.run(costCents, new Date().toISOString(), taskId);
  }

  /**
   * Increment the review_count by 1
   */
  incrementReviewCount(taskId: string): void {
    this.db.prepare('UPDATE task_records SET review_count = review_count + 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), taskId);
  }

  /**
   * Reset review_count to 0
   */
  resetReviewCount(taskId: string): void {
    this.db.prepare('UPDATE task_records SET review_count = 0, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), taskId);
  }

  /**
   * Get the thread ID for a specific agent on this task
   */
  getAgentThreadId(taskId: string, agentId: string): string | undefined {
    const task = this.getById(taskId);
    if (!task) return undefined;
    const map = JSON.parse(task.agent_thread_ids) as Record<string, string>;
    return map[agentId];
  }

  /**
   * Set the thread ID for a specific agent on this task
   */
  setAgentThreadId(taskId: string, agentId: string, threadId: string): void {
    const task = this.getById(taskId);
    if (!task) return;
    const map = JSON.parse(task.agent_thread_ids) as Record<string, string>;
    map[agentId] = threadId;
    this.db.prepare('UPDATE task_records SET agent_thread_ids = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(map), new Date().toISOString(), taskId);
  }
}
