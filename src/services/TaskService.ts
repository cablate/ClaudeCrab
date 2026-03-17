/**
 * TaskService — pure SQLite task management.
 *
 * Wraps TaskRecordRepository with business logic.
 * Discord Forum operations are handled by DiscordTaskSync (adapters/discord/services/).
 * Uses an optional threadNotifier to delegate platform-specific operations.
 */

import {
  TaskRecordRepository,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskStatus,
  type TaskPriority,
  type TaskRecordRow,
} from '../persistence/TaskRecordRepository.js';
import type { ITaskService } from '../types/interfaces.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'TaskService' });

/**
 * Platform-agnostic thread notifier interface.
 * Discord implementation: DiscordTaskSync
 */
export interface TaskThreadNotifier {
  /** Create a forum/thread post for a new task. Returns the thread ID. */
  createForumPost(input: CreateTaskInput, formattedTitle: string, formattedContent: string): Promise<{ threadId: string } | undefined>;
  /** Post a status update to the task's thread */
  postToThread(threadId: string, content: string): Promise<void>;
  /** Archive a task's thread */
  archiveThread(threadId: string): Promise<void>;
}

export interface TaskServiceOptions {
  taskRecordRepository: TaskRecordRepository;
  /** Optional platform-specific notifier for thread operations */
  threadNotifier?: TaskThreadNotifier;
}

export class TaskService implements ITaskService {
  private readonly repo: TaskRecordRepository;
  private readonly threadNotifier: TaskThreadNotifier | undefined;

  constructor(options: TaskServiceOptions) {
    this.repo = options.taskRecordRepository;
    this.threadNotifier = options.threadNotifier;
  }

  /**
   * Create a new task (SQLite + optionally platform thread).
   */
  async createTask(input: CreateTaskInput): Promise<string> {
    // Create in SQLite first
    const taskId = this.repo.insert(input);
    log.info({ taskId, title: input.title }, 'Task created in SQLite');

    // Create platform thread if notifier available
    if (this.threadNotifier !== undefined) {
      try {
        const title = this.formatForumTitle(input);
        const content = this.formatTaskContent(input);
        const result = await this.threadNotifier.createForumPost(input, title, content);

        if (result !== undefined && result.threadId !== undefined) {
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

    // Notify platform thread
    const task = this.repo.getById(taskId);
    if (task !== undefined && task.discord_thread_id !== null && this.threadNotifier !== undefined) {
      try {
        await this.threadNotifier.postToThread(
          task.discord_thread_id,
          `\u{1F4CC} Status: **${status}**`
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
    if (task !== undefined && task.discord_thread_id !== null && this.threadNotifier !== undefined) {
      try {
        await this.threadNotifier.postToThread(
          task.discord_thread_id,
          `\u{1F464} Assigned to **${agentId}**`
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

    // Archive the thread
    const task = this.repo.getById(taskId);
    if (task !== undefined && task.discord_thread_id !== null && this.threadNotifier !== undefined) {
      try {
        await this.threadNotifier.archiveThread(task.discord_thread_id);
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

  /**
   * Get the underlying repository (for platform-specific code that needs direct access).
   */
  getRepository(): TaskRecordRepository {
    return this.repo;
  }

  private formatForumTitle(input: CreateTaskInput): string {
    const priorityEmoji = input.priority === 'urgent' ? '\u{1F534}' : input.priority === 'low' ? '\u{1F7E2}' : '\u{1F7E1}';
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
