/**
 * ExecutionRecordRepository — per SDK query audit trail.
 *
 * Records every SDK query with trigger info, token usage, cost, and status.
 * Used by Phase 1 (Execution Audit Log) and Phase 2 (Cost Report).
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface ExecutionRecordRow {
  id: string;
  agent_id: string;
  trigger_type: 'chat' | 'schedule' | 'agent_call';
  trigger_source: string | null;
  task_id: string | null;
  prompt_summary: string | null;
  response_summary: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
  duration_ms: number;
  status: 'success' | 'error' | 'timeout' | 'budget_exceeded';
  error_message: string | null;
  created_at: string;
}

export interface CreateExecutionRecordInput {
  agentId: string;
  triggerType: 'chat' | 'schedule' | 'agent_call';
  triggerSource?: string;
  taskId?: string;
  promptSummary?: string;
  responseSummary?: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  durationMs: number;
  status: 'success' | 'error' | 'timeout' | 'budget_exceeded';
  errorMessage?: string;
}

export class ExecutionRecordRepository {
  private readonly db: DatabaseType;

  constructor(db: DatabaseType) {
    this.db = db;
  }

  /**
   * Record a new execution
   */
  insert(input: CreateExecutionRecordInput): string {
    const id = randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO execution_records
        (id, agent_id, trigger_type, trigger_source, task_id,
         prompt_summary, response_summary, input_tokens, output_tokens,
         cost_cents, duration_ms, status, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.agentId,
      input.triggerType,
      input.triggerSource ?? null,
      input.taskId ?? null,
      input.promptSummary ?? null,
      input.responseSummary ?? null,
      input.inputTokens,
      input.outputTokens,
      input.costCents,
      input.durationMs,
      input.status,
      input.errorMessage ?? null,
      now,
    );

    return id;
  }

  /**
   * Get execution records for an agent (newest first)
   */
  getByAgent(agentId: string, limit = 50): ExecutionRecordRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM execution_records
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(agentId, limit) as ExecutionRecordRow[];
  }

  /**
   * Get total cost in cents for an agent since a given date
   */
  getCostSince(agentId: string, since: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(cost_cents), 0) as total
      FROM execution_records
      WHERE agent_id = ? AND created_at >= ?
    `);
    const row = stmt.get(agentId, since) as { total: number };
    return row.total;
  }

  /**
   * Get cost breakdown by agent since a given date
   */
  getCostByAgentSince(since: string): Array<{ agent_id: string; total_cents: number; query_count: number }> {
    const stmt = this.db.prepare(`
      SELECT agent_id,
             COALESCE(SUM(cost_cents), 0) as total_cents,
             COUNT(*) as query_count
      FROM execution_records
      WHERE created_at >= ?
      GROUP BY agent_id
      ORDER BY total_cents DESC
    `);
    return stmt.all(since) as Array<{ agent_id: string; total_cents: number; query_count: number }>;
  }

  /**
   * Get executions for a specific task
   */
  getByTask(taskId: string): ExecutionRecordRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM execution_records
      WHERE task_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(taskId) as ExecutionRecordRow[];
  }
}
