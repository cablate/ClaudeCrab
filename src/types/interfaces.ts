/**
 * Service interfaces for dependency inversion.
 * Core/schedule modules depend on these interfaces, not concrete service classes.
 *
 * This enables the services layer to remain platform-agnostic:
 * - Core modules import interfaces from types/
 * - Concrete implementations live in services/ (pure) and adapters/discord/services/ (Discord-specific)
 * - AppBootstrap wires concrete classes together
 */

import type { OperationalEvent } from '../services/ActivityEventService.js';

export interface IActivityEventService {
  log(event: OperationalEvent): Promise<void>;
  dispose(): Promise<void>;
}

export interface IBudgetService {
  checkBudget(agentId: string): {
    agentId: string;
    todayCents: number;
    monthCents: number;
    dailyLimitCents: number;
    monthlyLimitCents: number;
    exceeded: boolean;
    warning: boolean;
    exceededReason: 'daily' | 'monthly' | undefined;
  } | null;
  isAgentPaused(agentId: string): boolean;
  canQuery(agentId: string): boolean;
  postQueryCheck(agentId: string): {
    agentId: string;
    todayCents: number;
    monthCents: number;
    dailyLimitCents: number;
    monthlyLimitCents: number;
    exceeded: boolean;
    warning: boolean;
    exceededReason: 'daily' | 'monthly' | undefined;
  } | null;
}

export interface ITaskService {
  getById(taskId: string): {
    id: string;
    title: string;
    description: string | null;
    status: string;
    assignee_agent_id: string | null;
    discord_thread_id: string | null;
    priority: string;
    created_by_agent_id: string | null;
    created_by_user_id: string | null;
    parent_task_id: string | null;
    cost_cents: number;
    review_count: number;
    agent_thread_ids: string;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  } | undefined;
  createTask(input: {
    title: string;
    description?: string;
    priority?: string;
    assigneeAgentId?: string;
    createdByAgentId?: string;
  }): Promise<string>;
  updateStatus(taskId: string, status: string): Promise<void>;
  assignTask(taskId: string, agentId: string, options?: { autoCall?: boolean }): Promise<void>;
  completeTask(taskId: string): Promise<void>;
  addCost(taskId: string, costCents: number): void;
  getSummary(): Record<string, number>;
  list(status?: string, limit?: number): Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    assignee_agent_id: string | null;
    discord_thread_id: string | null;
    priority: string;
    created_by_agent_id: string | null;
    created_by_user_id: string | null;
    parent_task_id: string | null;
    cost_cents: number;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  }>;
  postToThread(taskId: string, content: string, type?: 'progress' | 'deliverable' | 'note'): Promise<void>;
  requestReview(taskId: string, summary: string, deliverables?: string[]): Promise<void>;
}
