/**
 * TaskService — structured task management (Discord Forum + SQLite dual-layer).
 *
 * Wraps TaskRecordRepository with Discord Forum operations.
 * When a Discord adapter is available, tasks are created as Forum posts
 * and kept in sync with SQLite records.
 */

import { ChannelType, type Client, type ThreadChannel } from 'discord.js';
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
   * Start listening for Forum post creation by humans.
   * When a user creates a post directly in #任務看板, sync it to SQLite.
   */
  startForumListener(): void {
    if (this.adapter === undefined || this.forumChannelId === undefined) return;

    const client = this.adapter.getClient();
    if (client === null) return;

    const forumId = this.forumChannelId;

    client.on('threadCreate', (thread) => {
      // Only care about threads in our task board forum
      if (thread.parentId !== forumId) return;
      // Skip if already tracked (created by our code)
      const existing = this.repo.listByStatus(undefined, 1000);
      if (existing.some(t => t.discord_thread_id === thread.id)) return;

      // Parse priority from Forum tags
      const priority = this.parsePriorityFromThread(thread as ThreadChannel);
      const assignee = this.parseAssigneeFromThread(thread as ThreadChannel);

      const taskId = this.repo.insert({
        title: thread.name,
        priority,
        discordThreadId: thread.id,
        createdByUserId: thread.ownerId ?? 'unknown',
        ...(assignee !== undefined ? { assigneeAgentId: assignee } : {}),
      });

      log.info(
        { taskId, threadId: thread.id, title: thread.name },
        'Forum post synced to SQLite (user-created)'
      );
    });

    log.info({ forumId }, 'Forum listener started — user posts will sync to SQLite');
  }

  /**
   * Parse priority from Forum thread applied tags.
   */
  private parsePriorityFromThread(thread: ThreadChannel): TaskPriority {
    const tagNames = this.getAppliedTagNames(thread);
    if (tagNames.some(t => t.includes('urgent') || t.includes('🔴'))) return 'urgent';
    if (tagNames.some(t => t.includes('low') || t.includes('🟢'))) return 'low';
    return 'medium';
  }

  /**
   * Parse assignee agent from Forum thread applied tags.
   */
  private parseAssigneeFromThread(thread: ThreadChannel): string | undefined {
    const tagNames = this.getAppliedTagNames(thread);
    const agentTags: Record<string, string> = {
      'coder': 'coder', '工程師': 'coder',
      'writer': 'writer', '寫手': 'writer',
      'admin': 'admin', '管理員': 'admin',
      'seo': 'seo',
      'transcriber': 'transcriber', '轉寫員': 'transcriber',
      'media': 'media', '媒體製作': 'media',
      'oss-coder': 'oss-coder', '開源工程師': 'oss-coder',
    };

    for (const tagName of tagNames) {
      const lower = tagName.toLowerCase().replace(/[🤖📝🔧🌐🎙🎨💻\s]/g, '');
      for (const [key, agentId] of Object.entries(agentTags)) {
        if (lower.includes(key)) return agentId;
      }
    }
    return undefined;
  }

  /**
   * Get applied tag names from a Forum thread.
   */
  private getAppliedTagNames(thread: ThreadChannel): string[] {
    if (thread.parent === null || thread.parent.type !== ChannelType.GuildForum) return [];
    const forum = thread.parent;
    const appliedIds = thread.appliedTags;
    return forum.availableTags
      .filter(t => appliedIds.includes(t.id))
      .map(t => t.name);
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
