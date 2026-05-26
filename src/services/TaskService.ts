/**
 * TaskService: SQLite-backed task records with optional Discord thread sync.
 */

import {
  TaskRecordRepository,
  type CreateTaskInput,
  type TaskStatus,
  type TaskPriority,
  type TaskRecordRow,
} from '../persistence/TaskRecordRepository.js';
import type { ITaskService, IActivityEventService } from '../types/interfaces.js';
import { logger } from '../utils/logger.js';
import { EventType } from '../utils/events.js';

const log = logger.child({ module: 'TaskService' });

export interface TaskThreadNotifier {
  createForumPost(input: CreateTaskInput, formattedTitle: string, formattedContent: string): Promise<{ threadId: string } | undefined>;
  postToThread(threadId: string, content: string): Promise<void>;
  archiveThread(threadId: string): Promise<void>;
  sendReviewEmbed?(threadId: string, taskId: string, summary: string, deliverables: string[], reviewCount: number): Promise<void>;
  archiveAllThreads?(taskId: string): Promise<void>;
  notifyAgentChannel?(agentId: string, message: string): Promise<void>;
}

export interface TaskServiceOptions {
  taskRecordRepository: TaskRecordRepository;
  threadNotifier?: TaskThreadNotifier;
}

export class TaskService implements ITaskService {
  private readonly repo: TaskRecordRepository;
  private readonly threadNotifier: TaskThreadNotifier | undefined;
  private activityEventService?: IActivityEventService;

  private lastPostTime = new Map<string, number>();
  private postQueue = new Map<string, string[]>();
  private postTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: TaskServiceOptions) {
    this.repo = options.taskRecordRepository;
    this.threadNotifier = options.threadNotifier;
  }

  wirePostInit(deps: { activityEventService?: IActivityEventService }): void {
    if (deps.activityEventService !== undefined) {
      this.activityEventService = deps.activityEventService;
    }
  }

  getTaskByThreadId(threadId: string): { taskId: string } | undefined {
    const row = this.repo.getByDiscordThreadId(threadId);
    return row ? { taskId: row.id } : undefined;
  }

  async createTask(input: CreateTaskInput): Promise<string> {
    const taskId = this.repo.insert(input);
    log.info({ event_type: EventType.TASK_CREATED, taskId, title: input.title }, 'Task created');

    if (this.threadNotifier !== undefined) {
      try {
        const title = this.formatForumTitle(input);
        const content = this.formatTaskContent(input);
        const result = await this.threadNotifier.createForumPost(input, title, content);
        if (result?.threadId !== undefined) {
          const existingByThread = this.repo.getByDiscordThreadId(result.threadId);
          if (existingByThread && existingByThread.id !== taskId) {
            this.repo.clearDiscordThreadId(existingByThread.id);
          }
          this.repo.update(taskId, { discordThreadId: result.threadId });
          log.info({ event_type: EventType.TASK_FORUM_POST_CREATED, taskId, threadId: result.threadId }, 'Task forum post created');
        }
      } catch (err) {
        log.warn({ event_type: EventType.TASK_THREAD_POST_FAILED, err, taskId }, 'Failed to create task forum post');
      }
    }

    return taskId;
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    const task = this.repo.getById(taskId);
    if (!task) return;

    const oldStatus = task.status;
    this.repo.update(taskId, { status });

    if (this.threadNotifier && task.discord_thread_id) {
      await this.threadNotifier.postToThread(task.discord_thread_id, `[task] Status changed: ${oldStatus} -> ${status}`);
    }

    await this.activityEventService?.log({
      type: status === 'done' ? 'task.completed' : 'task.created',
      agentId: task.assignee_agent_id ?? 'system',
      message: `Task "${task.title}" status changed: ${oldStatus} -> ${status}`,
    });

    if (status === 'done' || status === 'cancelled') {
      if (this.threadNotifier && task.discord_thread_id) {
        const costDisplay = (task.cost_cents / 100).toFixed(2);
        await this.threadNotifier.postToThread(task.discord_thread_id, `[task] Total cost: $${costDisplay}`);
      }
      await this.threadNotifier?.archiveAllThreads?.(taskId);
    }

    log.info({ event_type: EventType.TASK_STATUS_UPDATED, taskId, oldStatus, status }, 'Task status updated');
  }

  async assignTask(taskId: string, agentId: string, options?: { autoCall?: boolean; platform?: string }): Promise<void> {
    this.repo.update(taskId, { assigneeAgentId: agentId });

    const task = this.repo.getById(taskId);
    if (this.threadNotifier && task?.discord_thread_id) {
      await this.threadNotifier.postToThread(task.discord_thread_id, `[task] Assigned to ${agentId}`);
    }

    log.info(
      { event_type: EventType.TASK_ASSIGNED, taskId, agentId, autoCallIgnored: options?.autoCall === true },
      'Task assigned'
    );
  }

  async completeTask(taskId: string): Promise<void> {
    await this.updateStatus(taskId, 'done');

    const task = this.repo.getById(taskId);
    if (task?.discord_thread_id !== undefined && task.discord_thread_id !== null && this.threadNotifier !== undefined) {
      await this.threadNotifier.archiveThread(task.discord_thread_id).catch(() => {});
    }
  }

  getById(taskId: string): TaskRecordRow | undefined {
    return this.repo.getById(taskId);
  }

  list(status?: TaskStatus, limit?: number): TaskRecordRow[] {
    return this.repo.listByStatus(status, limit);
  }

  getSummary() {
    return this.repo.getSummary();
  }

  addCost(taskId: string, costCents: number): void {
    this.repo.addCost(taskId, costCents);
  }

  async postToThread(taskId: string, content: string, type: 'progress' | 'deliverable' | 'note' = 'progress'): Promise<void> {
    const task = this.repo.getById(taskId);
    if (!task) {
      log.warn({ event_type: EventType.TASK_THREAD_POST_FAILED, taskId }, 'postToThread: task not found');
      return;
    }

    const prefix = { progress: '[progress]', deliverable: '[deliverable]', note: '[note]' }[type];
    const formatted = `[${task.assignee_agent_id ?? 'system'}] ${prefix} ${content}`;

    const now = Date.now();
    const lastPost = this.lastPostTime.get(taskId);
    if (lastPost !== undefined && now - lastPost < 5000) {
      const queue = this.postQueue.get(taskId) ?? [];
      queue.push(formatted);
      this.postQueue.set(taskId, queue);

      if (!this.postTimers.has(taskId)) {
        this.postTimers.set(taskId, setTimeout(() => {
          void this.flushPostQueue(taskId);
        }, 5000));
      }
      return;
    }

    this.lastPostTime.set(taskId, now);
    await this.threadNotifier?.postToThread(task.discord_thread_id ?? '', formatted);
  }

  async requestReview(taskId: string, summary: string, deliverables?: string[]): Promise<void> {
    const task = this.repo.getById(taskId);
    if (!task) {
      log.warn({ event_type: EventType.TASK_ERROR, taskId }, 'requestReview: task not found');
      return;
    }

    if (task.status === 'in_review') {
      log.info({ event_type: EventType.TASK_REVIEW_REQUESTED, taskId }, 'requestReview: task already in review');
      return;
    }

    this.repo.update(taskId, { status: 'in_review' });
    this.repo.incrementReviewCount(taskId);

    const updatedTask = this.repo.getById(taskId);
    const reviewCount = updatedTask?.review_count ?? 1;

    await this.threadNotifier?.sendReviewEmbed?.(
      task.discord_thread_id ?? '',
      taskId,
      summary,
      deliverables ?? [],
      reviewCount
    );

    await this.activityEventService?.log({
      type: 'task.created',
      agentId: task.assignee_agent_id ?? 'system',
      message: `Review requested for task "${task.title}"`,
      level: reviewCount >= 3 ? 'warn' : 'info',
    });

    if (reviewCount >= 3) {
      await this.activityEventService?.log({
        type: 'error.occurred',
        agentId: task.assignee_agent_id ?? 'system',
        message: `Task "${task.title}" reached ${reviewCount} review attempts`,
        level: 'warn',
      });
    }

    log.info({ event_type: EventType.TASK_REVIEW_REQUESTED, taskId, reviewCount }, 'Review requested');
  }

  getRepository(): TaskRecordRepository {
    return this.repo;
  }

  private async flushPostQueue(taskId: string): Promise<void> {
    const queue = this.postQueue.get(taskId);
    this.postQueue.delete(taskId);
    this.postTimers.delete(taskId);
    if (!queue || queue.length === 0) return;

    const task = this.repo.getById(taskId);
    if (!task?.discord_thread_id) return;

    this.lastPostTime.set(taskId, Date.now());
    await this.threadNotifier?.postToThread(task.discord_thread_id, queue.join('\n'));
  }

  private formatForumTitle(input: CreateTaskInput): string {
    const priorityLabel = input.priority === 'urgent' ? '[urgent]' : input.priority === 'low' ? '[low]' : '[medium]';
    return `${priorityLabel} ${input.title}`;
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

export type { TaskStatus, TaskPriority, TaskRecordRow, CreateTaskInput };
