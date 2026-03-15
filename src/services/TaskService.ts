/**
 * TaskService — structured task management (Discord Forum + SQLite dual-layer).
 *
 * Wraps TaskRecordRepository with Discord Forum operations.
 * When a Discord adapter is available, tasks are created as Forum posts
 * and kept in sync with SQLite records.
 */

import type { DiscordAdapter } from '../adapters/DiscordAdapter.js';
import {
  TaskRecordRepository,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskStatus,
  type TaskPriority,
  type TaskRecordRow,
} from '../persistence/TaskRecordRepository.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'TaskService' });

export interface TaskServiceOptions {
  taskRecordRepository: TaskRecordRepository;
  /** Discord adapter (main bot) for Forum operations. If null, SQLite-only mode. */
  discordAdapter?: DiscordAdapter;
  /** Forum channel ID for task board */
  forumChannelId?: string;
}

export class TaskService {
  private readonly repo: TaskRecordRepository;
  private readonly adapter: DiscordAdapter | undefined;
  private readonly forumChannelId: string | undefined;

  constructor(options: TaskServiceOptions) {
    this.repo = options.taskRecordRepository;
    this.adapter = options.discordAdapter;
    this.forumChannelId = options.forumChannelId;
  }

  /**
   * Create a new task (SQLite + optionally Discord Forum post).
   */
  async createTask(input: CreateTaskInput): Promise<string> {
    // Create in SQLite first
    const taskId = this.repo.insert(input);
    log.info({ taskId, title: input.title }, 'Task created in SQLite');

    // Create Discord Forum post if adapter available
    if (this.adapter !== undefined && this.forumChannelId !== undefined) {
      try {
        const content = this.formatTaskContent(input);
        const result = await this.adapter.createForumPost(
          this.forumChannelId,
          this.formatForumTitle(input),
          content,
        );

        if (result.success && result.threadId !== undefined) {
          this.repo.update(taskId, { discordThreadId: result.threadId });
          log.info({ taskId, threadId: result.threadId }, 'Forum post created');
        }
      } catch (err) {
        log.warn({ err, taskId }, 'Failed to create Forum post (SQLite record exists)');
      }
    }

    return taskId;
  }

  /**
   * Update task status.
   */
  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    this.repo.update(taskId, { status });

    // Update Discord thread
    const task = this.repo.getById(taskId);
    if (task !== undefined && task.discord_thread_id !== null && this.adapter !== undefined) {
      try {
        await this.adapter.replyToThread(
          task.discord_thread_id,
          `📌 Status: **${status}**`
        );
      } catch {
        // Best effort
      }
    }

    log.info({ taskId, status }, 'Task status updated');
  }

  /**
   * Assign task to an agent.
   */
  async assignTask(taskId: string, agentId: string): Promise<void> {
    this.repo.update(taskId, { assigneeAgentId: agentId });

    const task = this.repo.getById(taskId);
    if (task !== undefined && task.discord_thread_id !== null && this.adapter !== undefined) {
      try {
        await this.adapter.replyToThread(
          task.discord_thread_id,
          `👤 Assigned to **${agentId}**`
        );
      } catch {
        // Best effort
      }
    }

    log.info({ taskId, agentId }, 'Task assigned');
  }

  /**
   * Complete a task.
   */
  async completeTask(taskId: string): Promise<void> {
    await this.updateStatus(taskId, 'done');

    // Archive the Discord thread
    const task = this.repo.getById(taskId);
    if (task !== undefined && task.discord_thread_id !== null && this.adapter !== undefined) {
      try {
        await this.adapter.archiveThread(task.discord_thread_id);
      } catch {
        // Best effort
      }
    }
  }

  /**
   * Get task by ID.
   */
  getById(taskId: string): TaskRecordRow | undefined {
    return this.repo.getById(taskId);
  }

  /**
   * List tasks.
   */
  list(status?: TaskStatus, limit?: number): TaskRecordRow[] {
    return this.repo.listByStatus(status, limit);
  }

  /**
   * Get task summary counts.
   */
  getSummary() {
    return this.repo.getSummary();
  }

  /**
   * Add cost to a task.
   */
  addCost(taskId: string, costCents: number): void {
    this.repo.addCost(taskId, costCents);
  }

  private formatForumTitle(input: CreateTaskInput): string {
    const priorityEmoji = input.priority === 'urgent' ? '🔴' : input.priority === 'low' ? '🟢' : '🟡';
    return `${priorityEmoji} ${input.title}`;
  }

  private formatTaskContent(input: CreateTaskInput): string {
    const lines = [];
    if (input.description) lines.push(input.description);
    lines.push('');
    lines.push(`**Priority:** ${input.priority ?? 'medium'}`);
    if (input.assigneeAgentId) lines.push(`**Assignee:** ${input.assigneeAgentId}`);
    if (input.createdByAgentId) lines.push(`**Created by:** ${input.createdByAgentId}`);
    return lines.join('\n');
  }
}

// Re-export types for convenience
export type { TaskStatus, TaskPriority, TaskRecordRow, CreateTaskInput };
