/**
 * DiscordTaskSync — Discord Forum integration for TaskService.
 *
 * Implements TaskThreadNotifier to handle Discord-specific operations:
 * - Creating Forum posts for new tasks
 * - Posting status updates to threads
 * - Archiving completed task threads
 * - Listening for user-created Forum posts and syncing to SQLite
 */

import { ChannelType, type ThreadChannel } from 'discord.js';
import type { DiscordAdapter } from '../../DiscordAdapter.js';
import type { TaskThreadNotifier } from '../../../services/TaskService.js';
import type { TaskRecordRepository, CreateTaskInput, TaskPriority } from '../../../persistence/TaskRecordRepository.js';
import { logger } from '../../../utils/logger.js';

const log = logger.child({ module: 'DiscordTaskSync' });

export interface DiscordTaskSyncOptions {
  discordAdapter: DiscordAdapter;
  forumChannelId: string;
  taskRecordRepository: TaskRecordRepository;
}

export class DiscordTaskSync implements TaskThreadNotifier {
  private readonly adapter: DiscordAdapter;
  private readonly forumChannelId: string;
  private readonly repo: TaskRecordRepository;

  constructor(options: DiscordTaskSyncOptions) {
    this.adapter = options.discordAdapter;
    this.forumChannelId = options.forumChannelId;
    this.repo = options.taskRecordRepository;
  }

  /**
   * Create a Forum post for a new task.
   */
  async createForumPost(
    _input: CreateTaskInput,
    formattedTitle: string,
    formattedContent: string,
  ): Promise<{ threadId: string } | undefined> {
    const result = await this.adapter.createForumPost(
      this.forumChannelId,
      formattedTitle,
      formattedContent,
    );

    if (result.success && result.threadId !== undefined) {
      return { threadId: result.threadId };
    }
    return undefined;
  }

  /**
   * Post a status update to a task's Discord thread.
   */
  async postToThread(threadId: string, content: string): Promise<void> {
    await this.adapter.replyToThread(threadId, content);
  }

  /**
   * Archive a task's Discord thread.
   */
  async archiveThread(threadId: string): Promise<void> {
    await this.adapter.archiveThread(threadId);
  }

  /**
   * Start listening for Forum post creation by humans.
   * When a user creates a post directly in the task board forum, sync it to SQLite.
   */
  startForumListener(): void {
    const client = this.adapter.getClient();
    if (client === null) return;

    const forumId = this.forumChannelId;

    client.on('threadCreate', (thread) => {
      // Only care about threads in our task board forum
      if (thread.parentId !== forumId) return;
      // Skip if already tracked (created by our code)
      if (this.repo.getByDiscordThreadId(thread.id) !== undefined) return;

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

    log.info({ forumId }, 'Forum listener started \u2014 user posts will sync to SQLite');
  }

  /**
   * Parse priority from Forum thread applied tags.
   */
  private parsePriorityFromThread(thread: ThreadChannel): TaskPriority {
    const tagNames = this.getAppliedTagNames(thread);
    if (tagNames.some(t => t.includes('urgent') || t.includes('\u{1F534}'))) return 'urgent';
    if (tagNames.some(t => t.includes('low') || t.includes('\u{1F7E2}'))) return 'low';
    return 'medium';
  }

  /**
   * Parse assignee agent from Forum thread applied tags.
   */
  private parseAssigneeFromThread(thread: ThreadChannel): string | undefined {
    const tagNames = this.getAppliedTagNames(thread);
    const agentTags: Record<string, string> = {
      'coder': 'coder', '\u5DE5\u7A0B\u5E2B': 'coder',
      'writer': 'writer', '\u5BEB\u624B': 'writer',
      'admin': 'admin', '\u7BA1\u7406\u54E1': 'admin',
      'seo': 'seo',
      'transcriber': 'transcriber', '\u8F49\u5BEB\u54E1': 'transcriber',
      'media': 'media', '\u5A92\u9AD4\u88FD\u4F5C': 'media',
      'oss-coder': 'oss-coder', '\u958B\u6E90\u5DE5\u7A0B\u5E2B': 'oss-coder',
    };

    for (const tagName of tagNames) {
      const lower = tagName.toLowerCase().replace(/[\u{1F916}\u{1F4DD}\u{1F527}\u{1F310}\u{1F399}\u{1F3A8}\u{1F4BB}\s]/gu, '');
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
}
