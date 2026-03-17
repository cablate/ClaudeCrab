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
import type { ITaskService, IActivityEventService } from '../types/interfaces.js';
import type { AgentCallService } from './AgentCallService.js';
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
  /** Send a review embed to the task's thread (optional — Discord-only) */
  sendReviewEmbed?(threadId: string, taskId: string, summary: string, deliverables: string[], reviewCount: number): Promise<void>;
  /** Archive all threads (main + agent) for a task (optional) */
  archiveAllThreads?(taskId: string): Promise<void>;
  /** Notify an agent's Discord channel with a message (optional) */
  notifyAgentChannel?(agentId: string, message: string): Promise<void>;
}

export interface TaskServiceOptions {
  taskRecordRepository: TaskRecordRepository;
  /** Optional platform-specific notifier for thread operations */
  threadNotifier?: TaskThreadNotifier;
}

export class TaskService implements ITaskService {
  private readonly repo: TaskRecordRepository;
  private readonly threadNotifier: TaskThreadNotifier | undefined;

  /** Optional dependency: activity event logging */
  private activityEventService?: IActivityEventService;
  /** Optional dependency: cross-agent call service */
  private agentCallService?: AgentCallService;

  /** Rate-limiting state for postToThread */
  private lastPostTime = new Map<string, number>();
  private postQueue = new Map<string, string[]>();
  private postTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: TaskServiceOptions) {
    this.repo = options.taskRecordRepository;
    this.threadNotifier = options.threadNotifier;
  }

  /** Wire optional dependencies after construction (avoids circular deps). */
  wirePostInit(deps: {
    activityEventService?: IActivityEventService;
    agentCallService?: AgentCallService;
  }): void {
    if (deps.activityEventService !== undefined) this.activityEventService = deps.activityEventService;
    if (deps.agentCallService !== undefined) this.agentCallService = deps.agentCallService;
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
          // Check if Forum listener already created a record for this thread (race condition)
          const existingByThread = this.repo.getByDiscordThreadId(result.threadId);
          if (existingByThread && existingByThread.id !== taskId) {
            // Forum listener beat us — null out the duplicate's thread ID so ours can take it
            this.repo.clearDiscordThreadId(existingByThread.id);
            log.info({ taskId, duplicateId: existingByThread.id }, 'Resolved Forum listener race condition');
          }
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
   * Pushes system messages, logs activity events, and handles archival on completion.
   */
  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    const task = this.repo.getById(taskId);
    if (!task) return;

    const oldStatus = task.status;
    this.repo.update(taskId, { status });

    // Push status change to main thread
    if (task.discord_thread_id) {
      await this.threadNotifier?.postToThread(
        task.discord_thread_id,
        `[系統] \u{1F4CC} 狀態變更：${oldStatus} → ${status}`
      );
    }

    // Log activity event
    const eventType = status === 'done' ? 'task.completed' : 'task.created';
    await this.activityEventService?.log({
      type: eventType as 'task.completed' | 'task.created',
      agentId: task.assignee_agent_id ?? 'system',
      message: `任務「${task.title}」狀態：${oldStatus} → ${status}`,
    });

    // Completion: cost summary + archival
    if (status === 'done' || status === 'cancelled') {
      if (task.discord_thread_id) {
        const costDisplay = (task.cost_cents / 100).toFixed(2);
        await this.threadNotifier?.postToThread(
          task.discord_thread_id,
          `[系統] \u{1F4B0} 累計花費：$${costDisplay}`
        );
      }

      // Archive all threads
      await this.threadNotifier?.archiveAllThreads?.(taskId);
    }

    log.info({ taskId, oldStatus, status }, 'Task status updated');
  }

  /**
   * Assign task to an agent.
   * Supports options.autoCall: automatically invoke the target agent via AgentCallService.
   */
  async assignTask(taskId: string, agentId: string, options?: { autoCall?: boolean }): Promise<void> {
    this.repo.update(taskId, { assigneeAgentId: agentId });

    const task = this.repo.getById(taskId);

    // Notify main thread
    if (task?.discord_thread_id) {
      await this.threadNotifier?.postToThread(task.discord_thread_id, `[系統] \u{1F464} 已指派給 ${agentId}`);
    }

    // Auto-call if requested
    if (options?.autoCall && this.agentCallService && task) {
      this.repo.update(taskId, { status: 'in_progress' });

      try {
        await this.agentCallService.callAgent(
          task.created_by_agent_id ?? 'general',
          agentId,
          `你被指派了一個任務：${task.title}\n\n${task.description ?? ''}`,
          {
            taskId,
            platform: 'discord',
          }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ taskId, agentId, err: msg }, 'autoCall failed');
        await this.threadNotifier?.postToThread(task.discord_thread_id ?? '', `[系統] \u274C 自動呼叫 ${agentId} 失敗：${msg}`);
      }
    }

    log.info({ taskId, agentId, autoCall: options?.autoCall }, 'Task assigned');
  }

  /**
   * Complete a task.
   */
  async completeTask(taskId: string): Promise<void> {
    await this.updateStatus(taskId, 'done');

    // Archive the thread (legacy fallback if archiveAllThreads not available)
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
   * Post a formatted message to the task's main thread (summary board).
   * Rate-limited: same task within 5 seconds -> queue and merge.
   */
  async postToThread(taskId: string, content: string, type: 'progress' | 'deliverable' | 'note' = 'progress'): Promise<void> {
    const task = this.repo.getById(taskId);
    if (!task) {
      log.warn({ taskId }, 'postToThread: task not found');
      return;
    }

    const prefix = { progress: '\u{1F4DD}', deliverable: '\u{1F4E6}', note: '\u{1F4AC}' }[type];
    const formatted = `[${task.assignee_agent_id ?? 'system'}] ${prefix} ${content}`;

    // Rate limiting: merge if posted within 5 seconds
    const now = Date.now();
    const lastPost = this.lastPostTime.get(taskId);
    if (lastPost && now - lastPost < 5000) {
      // Queue for merge
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

  /**
   * Request quality review for a task.
   * Updates status to in_review, sends review Embed to main thread.
   */
  async requestReview(taskId: string, summary: string, deliverables?: string[]): Promise<void> {
    const task = this.repo.getById(taskId);
    if (!task) {
      log.warn({ taskId }, 'requestReview: task not found');
      return;
    }

    if (task.status === 'in_review') {
      log.info({ taskId }, 'requestReview: task already in review');
      return;
    }

    // Update status + increment review count
    this.repo.update(taskId, { status: 'in_review' });
    this.repo.incrementReviewCount(taskId);

    const updatedTask = this.repo.getById(taskId);
    const reviewCount = updatedTask?.review_count ?? 1;

    // Send review Embed to main thread (if notifier supports it)
    await this.threadNotifier?.sendReviewEmbed?.(
      task.discord_thread_id ?? '',
      taskId,
      summary,
      deliverables ?? [],
      reviewCount
    );

    // Log activity event
    await this.activityEventService?.log({
      type: 'task.created',
      agentId: task.assignee_agent_id ?? 'system',
      message: `請求審核：${task.title}`,
      level: reviewCount >= 3 ? 'warn' : 'info',
    });

    // Escalation: log warning when review count reaches threshold
    if (reviewCount >= 3) {
      await this.activityEventService?.log({
        type: 'error.occurred',
        agentId: task.assignee_agent_id ?? 'system',
        message: `任務「${task.title}」已審核 ${reviewCount} 次仍未通過，升級處理`,
        level: 'warn',
      });
    }

    log.info({ taskId, reviewCount }, 'Review requested');
  }

  /**
   * Get the underlying repository (for platform-specific code that needs direct access).
   */
  getRepository(): TaskRecordRepository {
    return this.repo;
  }

  /**
   * Flush queued post messages for a task (rate-limit merge).
   */
  private async flushPostQueue(taskId: string): Promise<void> {
    const queue = this.postQueue.get(taskId);
    this.postQueue.delete(taskId);
    this.postTimers.delete(taskId);
    if (!queue || queue.length === 0) return;

    const task = this.repo.getById(taskId);
    if (!task?.discord_thread_id) return;

    const merged = queue.join('\n');
    this.lastPostTime.set(taskId, Date.now());
    await this.threadNotifier?.postToThread(task.discord_thread_id, merged);
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
