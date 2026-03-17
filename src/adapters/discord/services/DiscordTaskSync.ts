/**
 * DiscordTaskSync — Discord Forum integration for TaskService.
 *
 * Implements TaskThreadNotifier to handle Discord-specific operations:
 * - Creating Forum posts for new tasks
 * - Posting status updates to threads
 * - Archiving completed task threads
 * - Listening for user-created Forum posts and syncing to SQLite
 */

import { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type ThreadChannel } from 'discord.js';
import type { DiscordAdapter } from '../../DiscordAdapter.js';
import type { TaskThreadNotifier } from '../../../services/TaskService.js';
import type { TaskRecordRepository, CreateTaskInput, TaskPriority } from '../../../persistence/TaskRecordRepository.js';
import type { IAgentRepository } from '../../../types/agent.js';
import type { AgentCallService } from '../../../services/AgentCallService.js';
import { logger } from '../../../utils/logger.js';

const log = logger.child({ module: 'DiscordTaskSync' });

export interface DiscordTaskSyncOptions {
  discordAdapter: DiscordAdapter;
  forumChannelId: string;
  taskRecordRepository: TaskRecordRepository;
  agentLoader?: IAgentRepository;
  agentCallService?: AgentCallService;
}

export class DiscordTaskSync implements TaskThreadNotifier {
  private readonly adapter: DiscordAdapter;
  private readonly forumChannelId: string;
  private readonly repo: TaskRecordRepository;
  private readonly agentLoader: IAgentRepository | undefined;
  private readonly agentCallService: AgentCallService | undefined;

  constructor(options: DiscordTaskSyncOptions) {
    this.adapter = options.discordAdapter;
    this.forumChannelId = options.forumChannelId;
    this.repo = options.taskRecordRepository;
    this.agentLoader = options.agentLoader;
    this.agentCallService = options.agentCallService;
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
    if (!threadId) return;
    try {
      await this.adapter.replyToThread(threadId, content);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), threadId }, 'Failed to post to thread');
    }
  }

  /**
   * Archive a task's Discord thread.
   */
  async archiveThread(threadId: string): Promise<void> {
    await this.adapter.archiveThread(threadId);
  }

  /**
   * Send a review embed with Approve/Reject buttons to a task's thread.
   */
  async sendReviewEmbed(
    threadId: string,
    taskId: string,
    summary: string,
    deliverables: string[],
    reviewCount: number
  ): Promise<void> {
    if (!threadId) return;

    try {
      const embed = new EmbedBuilder()
        .setTitle('📋 審核請求')
        .setDescription(summary)
        .setColor(reviewCount >= 3 ? 0xFF0000 : 0x0099FF)
        .setTimestamp();

      if (deliverables.length > 0) {
        embed.addFields({ name: '交付物', value: deliverables.map(d => `• ${d}`).join('\n') });
      }

      if (reviewCount >= 3) {
        embed.addFields({ name: '⚠️ 警告', value: `第 ${reviewCount} 次審核 — 依品管 SOP，秘書介入處理` });
      }

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`review:approve:${taskId}`).setLabel('✅ 通過').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`review:reject:${taskId}`).setLabel('❌ 退回').setStyle(ButtonStyle.Danger),
      );

      await this.adapter.replyToThreadEmbed(threadId, [embed], [row]);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), threadId, taskId }, 'Failed to send review embed');
    }
  }

  /**
   * Archive the main task thread and all agent per-task threads.
   */
  async archiveAllThreads(taskId: string): Promise<void> {
    // Archive main thread
    const task = this.repo.getById(taskId);
    if (task?.discord_thread_id) {
      await this.adapter.archiveThread(task.discord_thread_id).catch(() => {});
    }

    // Archive all agent per-task threads
    if (task?.agent_thread_ids) {
      try {
        const threadMap = JSON.parse(task.agent_thread_ids) as Record<string, string>;
        for (const threadId of Object.values(threadMap)) {
          await this.adapter.archiveThread(threadId).catch(() => {});
        }
      } catch {
        // JSON parse error — ignore
      }
    }
  }

  /**
   * Notify an agent's Discord channel with a message.
   */
  async notifyAgentChannel(agentId: string, message: string): Promise<void> {
    // Find agent's Discord channel
    const agent = this.agentLoader?.get(agentId);
    const channelId = agent?.config.discordChannelId;
    if (!channelId) return;

    try {
      await this.adapter.sendToChannel(channelId, message);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), agentId }, 'Failed to notify agent channel');
    }
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

    // Also start listening for user messages in existing task threads
    this.startUserMessageListener();
  }

  /**
   * Listen for user messages in task main threads.
   * Routes them to the secretary agent for processing.
   */
  startUserMessageListener(): void {
    const client = this.adapter.getClient();
    if (client === null || !this.forumChannelId) return;

    client.on('messageCreate', (message) => {
      // Only care about messages in threads under our forum
      if (message.author.bot) return;
      if (!message.channel.isThread()) return;
      if (message.channel.parentId !== this.forumChannelId) return;

      // Look up the task by thread ID
      const task = this.repo.getByDiscordThreadId(message.channel.id);
      if (!task) return; // Not a tracked task thread

      // Route to secretary
      void this.routeToSecretary(task.id, message.content, message.author.id, message.channel.id).catch(err => {
        log.warn({ err: err instanceof Error ? err.message : String(err), taskId: task.id },
          'Failed to route user message to secretary');
      });
    });

    log.info('User message listener started for task main threads');
  }

  private async routeToSecretary(taskId: string, content: string, userId: string, threadId: string): Promise<void> {
    if (!this.agentCallService) {
      log.warn({ taskId }, 'Cannot route to secretary: AgentCallService not available');
      return;
    }

    const task = this.repo.getById(taskId);
    if (!task) return;

    const enrichedMessage = `【使用者在任務 Thread 留言】
任務：${task.title}（${taskId.slice(0, 8)}）
狀態：${task.status}
使用者訊息：${content}`;

    await this.agentCallService.callAgent(
      'user',
      'general', // secretary agent
      enrichedMessage,
      {
        taskId,
        platform: 'discord',
        userId, // real user ID for session
        chatId: threadId, // route reply back to the task thread
      }
    );
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
