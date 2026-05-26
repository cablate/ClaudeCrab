/**
 * Discord Forum integration for TaskService.
 */

import { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type ThreadChannel } from 'discord.js';
import type { DiscordAdapter } from '../../DiscordAdapter.js';
import type { TaskThreadNotifier } from '../../../services/TaskService.js';
import type { TaskRecordRepository, CreateTaskInput, TaskPriority } from '../../../persistence/TaskRecordRepository.js';
import type { IAgentRepository } from '../../../types/agent.js';
import { logger } from '../../../utils/logger.js';
import { EventType } from '../../../utils/events.js';

const log = logger.child({ module: 'DiscordTaskSync' });

export interface DiscordTaskSyncOptions {
  discordAdapter: DiscordAdapter;
  forumChannelId: string;
  taskRecordRepository: TaskRecordRepository;
  agentLoader?: IAgentRepository;
}

export class DiscordTaskSync implements TaskThreadNotifier {
  private readonly adapter: DiscordAdapter;
  private readonly forumChannelId: string;
  private readonly repo: TaskRecordRepository;
  private readonly agentLoader: IAgentRepository | undefined;

  constructor(options: DiscordTaskSyncOptions) {
    this.adapter = options.discordAdapter;
    this.forumChannelId = options.forumChannelId;
    this.repo = options.taskRecordRepository;
    this.agentLoader = options.agentLoader;
  }

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

  async postToThread(threadId: string, content: string): Promise<void> {
    if (!threadId) return;
    try {
      await this.adapter.replyToThread(threadId, content);
    } catch (err) {
      log.warn({ event_type: EventType.TASK_THREAD_POST_FAILED, err: err instanceof Error ? err.message : String(err), threadId }, 'Failed to post to thread');
    }
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.adapter.archiveThread(threadId);
  }

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
        .setTitle('Review requested')
        .setDescription(summary)
        .setColor(reviewCount >= 3 ? 0xFF0000 : 0x0099FF)
        .setTimestamp();

      if (deliverables.length > 0) {
        embed.addFields({ name: 'Deliverables', value: deliverables.map(d => `- ${d}`).join('\n') });
      }

      if (reviewCount >= 3) {
        embed.addFields({ name: 'Attention', value: `This task has reached ${reviewCount} review attempts.` });
      }

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`review:approve:${taskId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`review:reject:${taskId}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
      );

      await this.adapter.replyToThreadEmbed(threadId, [embed], [row]);
    } catch (err) {
      log.warn({ event_type: EventType.TASK_THREAD_POST_FAILED, err: err instanceof Error ? err.message : String(err), threadId, taskId }, 'Failed to send review embed');
    }
  }

  async archiveAllThreads(taskId: string): Promise<void> {
    const task = this.repo.getById(taskId);
    if (task?.discord_thread_id) {
      await this.adapter.archiveThread(task.discord_thread_id).catch(() => {});
    }

    if (task?.agent_thread_ids) {
      try {
        const threadMap = JSON.parse(task.agent_thread_ids) as Record<string, string>;
        for (const threadId of Object.values(threadMap)) {
          await this.adapter.archiveThread(threadId).catch(() => {});
        }
      } catch {
        // Ignore malformed legacy task metadata.
      }
    }
  }

  async notifyAgentChannel(agentId: string, message: string): Promise<void> {
    const agent = this.agentLoader?.get(agentId);
    const channelId = agent?.config.discordChannelId;
    if (!channelId) return;

    try {
      await this.adapter.sendToChannel(channelId, message);
    } catch (err) {
      log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: err instanceof Error ? err.message : String(err), agentId }, 'Failed to notify agent channel');
    }
  }

  startForumListener(): void {
    const client = this.adapter.getClient();
    if (client === null) return;

    const forumId = this.forumChannelId;

    client.on('threadCreate', (thread) => {
      if (thread.parentId !== forumId) return;
      if (this.repo.getByDiscordThreadId(thread.id) !== undefined) return;

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
        { event_type: EventType.TASK_FORUM_SYNCED, taskId, threadId: thread.id, title: thread.name },
        'Forum post synced to SQLite'
      );
    });

    log.info({ event_type: EventType.ADAPTER_DISCORD_FORUM_LISTENER_STARTED, forumId }, 'Forum listener started');
  }

  private parsePriorityFromThread(thread: ThreadChannel): TaskPriority {
    const tagNames = this.getAppliedTagNames(thread);
    if (tagNames.some(t => t.includes('urgent') || t.includes('\u{1F534}'))) return 'urgent';
    if (tagNames.some(t => t.includes('low') || t.includes('\u{1F7E2}'))) return 'low';
    return 'medium';
  }

  private parseAssigneeFromThread(thread: ThreadChannel): string | undefined {
    const tagNames = this.getAppliedTagNames(thread);
    const agentTags: Record<string, string> = {
      coder: 'coder',
      admin: 'admin',
      writer: 'writer',
      seo: 'seo',
      transcriber: 'transcriber',
      media: 'media',
      'oss-coder': 'oss-coder',
    };

    for (const tagName of tagNames) {
      const lower = tagName.toLowerCase().replace(/[\u{1F916}\u{1F4DD}\u{1F527}\u{1F310}\u{1F399}\u{1F3A8}\u{1F4BB}\s]/gu, '');
      for (const [key, agentId] of Object.entries(agentTags)) {
        if (lower.includes(key)) return agentId;
      }
    }
    return undefined;
  }

  private getAppliedTagNames(thread: ThreadChannel): string[] {
    if (thread.parent === null || thread.parent.type !== ChannelType.GuildForum) return [];
    const forum = thread.parent;
    const appliedIds = thread.appliedTags;
    return forum.availableTags
      .filter(t => appliedIds.includes(t.id))
      .map(t => t.name);
  }
}
