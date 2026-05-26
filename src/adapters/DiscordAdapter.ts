/**
 * DiscordAdapter — Discord platform adapter for ClaudeCab.
 *
 * Multi-bot architecture: each agent has its own Discord bot (own token, name, avatar).
 * Each adapter creates and manages its own discord.js Client.
 * The channelId scopes which channel this adapter listens to.
 */

import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  AttachmentBuilder,
  type TextChannel,
  type ForumChannel,
  type ThreadChannel,
  type Message as DiscordMessage,
  type MessageEditOptions,
  type APIEmbed,
  ChannelType,
} from 'discord.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { splitDiscordMessage, generateThreadTitle } from './discord/discordUtils.js';
import { BaseAdapter } from './BaseAdapter.js';
import type {
  DiscordAdapterConfig,
  UnifiedMessage,
  SendOptions,
  SendResult,
  PermissionPromptOptions,
  PermissionPromptResult,
  PermissionResolver,
  QuestionPromptOptions,
  QuestionPromptResult,
  QuestionResolver,
  ExitPlanModePromptOptions,
  ExitPlanModePromptResult,
  ExitPlanModeResolver,
} from './types.js';
import {
  DEFAULT_SECURITY_CONFIG,
  type SecurityConfig,
} from '../utils/security.js';
import { EventType } from '../utils/events.js';
import { handleDiscordMessage } from './discord/DiscordMessageHandler.js';

/** Discord message length limit */
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Discord platform adapter using discord.js (one Client per agent)
 */
export class DiscordAdapter extends BaseAdapter<DiscordAdapterConfig> {
  private client: Client | null = null;
  private channel: TextChannel | null = null;
  private readonly channelId: string;
  private readonly securityConfig: SecurityConfig;
  private readonly sttProvider: import('../core/stt/index.js').STTProvider | undefined;
  private boundMessageHandler: ((message: DiscordMessage) => void) | null =
    null;
  // Task thread resolver: given a threadId, returns taskId if this thread belongs to a task
  private taskThreadResolver?: (threadId: string) => { taskId: string } | undefined;

  /**
   * Set a resolver that maps thread IDs to task IDs.
   * Used to override userId when a user messages in a per-task agent thread,
   * ensuring session continuity with the agent call.
   */
  setTaskThreadResolver(resolver: (threadId: string) => { taskId: string } | undefined): void {
    this.taskThreadResolver = resolver;
  }

  // Schedule thread resolver: given a threadId, returns sdkSessionId + agentId for session bridging
  private scheduleThreadResolver?: (threadId: string) => { sdkSessionId: string; agentId: string } | undefined;

  setScheduleThreadResolver(resolver: (threadId: string) => { sdkSessionId: string; agentId: string } | undefined): void {
    this.scheduleThreadResolver = resolver;
  }

  // Interactive prompt resolvers
  private permissionResolver: PermissionResolver | null = null;
  private questionResolver: QuestionResolver | null = null;
  private exitPlanModeResolver: ExitPlanModeResolver | null = null;

  constructor(config: DiscordAdapterConfig) {
    super(config);
    this.channelId = config.channelId;
    this.sttProvider = config.sttProvider;

    this.securityConfig = config.securityConfig
      ? {
          allowedUsers: config.securityConfig.allowedUsers,
          whitelistEnabled: config.securityConfig.whitelistEnabled,
          maxMessageLength: config.securityConfig.maxMessageLength,
          promptInjectionDetection:
            config.securityConfig.promptInjectionDetection,
        }
      : DEFAULT_SECURITY_CONFIG;
  }

  protected async doInitialize(): Promise<void> {
    // Create own Client
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Login with this agent's bot token
    await this.client.login(this.config.token);
    this.log.info(
      { event_type: EventType.ADAPTER_INIT_COMPLETE, username: this.client.user?.username },
      'Discord bot authenticated'
    );

    // Fetch and validate the channel
    const fetched = await this.client.channels.fetch(this.channelId);

    if (fetched === null) {
      throw new Error(
        `Discord channel ${this.channelId} not found. Check the channel ID and bot permissions.`
      );
    }

    if (fetched.type !== ChannelType.GuildText) {
      throw new Error(
        `Discord channel ${this.channelId} is not a text channel (type: ${ChannelType[fetched.type]})`
      );
    }

    this.channel = fetched as TextChannel;
    this.log.info(
      { event_type: EventType.ADAPTER_INIT_COMPLETE, channelId: this.channelId, channelName: this.channel.name },
      'Discord channel verified'
    );
  }

  protected async doStart(): Promise<void> {
    if (this.client === null) {
      throw new Error('Discord client not initialized');
    }

    // Register messageCreate listener (scoped to this channel)
    this.boundMessageHandler = (message: DiscordMessage) => {
      void this.handleMessage(message).catch((error) => {
        this.log.error({ event_type: EventType.ADAPTER_MESSAGE_ERROR, err: error }, 'Unhandled error in Discord message handler');
      });
    };

    this.client.on('error', (error) => {
      this.log.error({ event_type: EventType.PLATFORM_API_ERROR, error: error.message }, 'Discord client error');
    });

    this.client.on('messageCreate', this.boundMessageHandler);

    // Handle button clicks on prompts sent by THIS agent bot.
    // The system bot's DiscordInteractionHandler only receives events on its
    // own Client — buttons on agent-sent embeds fire on the agent's Client.
    this.client.on('interactionCreate', (interaction) => {
      if (!interaction.isButton()) return;
      const customId = interaction.customId;
      this.log.debug({ customId, userId: interaction.user.id }, 'Agent bot button interaction');
      const handled = this.handleButtonInteraction(customId);
      if (handled) {
        interaction.deferUpdate()
          .then(() => interaction.message.edit({ components: [] }))
          .catch(() => {});
      }
    });

    this.log.info(
      { event_type: EventType.ADAPTER_STARTED, channelId: this.channelId },
      'Discord adapter listening for messages and interactions'
    );
  }

  protected async doStop(): Promise<void> {
    if (this.client !== null) {
      if (this.boundMessageHandler !== null) {
        this.client.removeListener('messageCreate', this.boundMessageHandler);
        this.boundMessageHandler = null;
      }

    }
  }

  protected async doDispose(): Promise<void> {
    // Destroy this agent's own Client
    if (this.client !== null) {
      this.client.destroy();
      this.client = null;
    }
    this.channel = null;
  }

  private async handleMessage(message: DiscordMessage): Promise<void> {
    if (this.client === null) return;
    await handleDiscordMessage(message, {
      channelId: this.channelId,
      agentId: this.agentId,
      agentsDir: this.config.agentsDir ?? path.resolve(process.cwd(), 'agents'),
      securityConfig: this.securityConfig,
      log: this.log,
      client: this.client,
      taskThreadResolver: this.taskThreadResolver,
      scheduleThreadResolver: this.scheduleThreadResolver,
      sttProvider: this.sttProvider,
      generateThreadTitle: (text) => generateThreadTitle(text),
      emitMessage: (msg) => this.emitMessage(msg),
    });
  }


  /**
   * Get bot identity info from Discord client.
   * Returns username and numeric id (snowflake converted to number for interface compat).
   */
  override getBotInfo(): { username: string; id: number } | null {
    const user = this.client?.user;
    if (user === null || user === undefined) return null;
    // Discord snowflake IDs exceed Number.MAX_SAFE_INTEGER; use lower bits for compat
    return { username: user.username, id: Number(BigInt(user.id) & BigInt(0x7FFFFFFF)) };
  }

  async sendMessage(
    chatId: string,
    text: string,
    _options?: SendOptions
  ): Promise<SendResult> {
    if (this.channel === null) {
      return { success: false, error: 'Channel not initialized' };
    }

    try {
      // If chatId is a thread (different from main channelId), send to the thread
      const targetChannel = chatId !== this.channelId
        ? await this.resolveTextOrThread(chatId)
        : this.channel;

      if (targetChannel === null) {
        return { success: false, error: `Channel/thread ${chatId} not found` };
      }

      const chunks = splitDiscordMessage(text);
      let lastMessageId = '';

      for (const chunk of chunks) {
        const sent = await this.rateLimitedSend(() => targetChannel.send(chunk));
        lastMessageId = sent.id;
      }

      this.emitMessageSent(chatId, text, chatId);

      return { success: true, messageId: lastMessageId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, chatId }, 'Failed to send Discord message');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send a status message (for StatusMessageManager support).
   */
  async sendStatusMessage(
    chatId: string,
    initialText: string = '🔄 處理中...'
  ): Promise<string | null> {
    try {
      const targetChannel = chatId !== this.channelId
        ? await this.resolveTextOrThread(chatId)
        : this.channel;

      if (targetChannel === null) return null;

      // Wrap in code block to prevent Discord markdown rendering
      const msg = await this.rateLimitedSend(() => targetChannel.send(`\`\`\`\n${initialText}\n\`\`\``));
      return msg.id;
    } catch (error) {
      this.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, chatId }, 'Failed to send status message');
      return null;
    }
  }

  /**
   * Send a subtitle-style message. Unlike sendStatusMessage, the content is
   * NOT wrapped in a code fence, so markdown markers like `-#` render as
   * Discord subtitles (small grey text) instead of being swallowed.
   */
  async sendSubtitleMessage(
    chatId: string,
    text: string,
  ): Promise<string | null> {
    try {
      const targetChannel = chatId !== this.channelId
        ? await this.resolveTextOrThread(chatId)
        : this.channel;

      if (targetChannel === null) return null;

      const msg = await this.rateLimitedSend(() => targetChannel.send(text));
      return msg.id;
    } catch (error) {
      this.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, chatId }, 'Failed to send subtitle message');
      return null;
    }
  }

  /**
   * Update a status message in-place (for StatusMessageManager support).
   */
  async updateStatusMessage(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<boolean> {
    try {
      const targetChannel = chatId !== this.channelId
        ? await this.resolveTextOrThread(chatId)
        : this.channel;

      if (targetChannel === null) return false;

      const msg = await targetChannel.messages.fetch(messageId);
      // Wrap in code block to prevent Discord markdown rendering
      await this.rateLimitedSend(() => msg.edit(`\`\`\`\n${text}\n\`\`\``));
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes('Unknown Message')) {
        this.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, chatId, messageId }, 'Failed to update status message');
      }
      return false;
    }
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    try {
      // Send typing to thread if chatId is a thread, otherwise main channel
      if (chatId !== this.channelId) {
        const thread = await this.resolveTextOrThread(chatId);
        if (thread !== null) {
          await thread.sendTyping();
          return;
        }
      }
      if (this.channel !== null) {
        await this.channel.sendTyping();
      }
    } catch (error) {
      this.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: error }, 'Failed to send typing indicator');
    }
  }

  // ============================================================
  // Rich Messaging: Embed + Button
  // ============================================================

  /**
   * Send one or more embeds to a channel, optionally with button components.
   * Can target any channel the bot has access to (not just this.channel).
   */
  async sendEmbed(
    channelId: string,
    embeds: EmbedBuilder[],
    components?: ActionRowBuilder<ButtonBuilder>[]
  ): Promise<SendResult> {
    try {
      const channel = await this.resolveTextOrThread(channelId);
      if (channel === null) {
        return { success: false, error: `Channel ${channelId} not found or not text` };
      }

      const payload: { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] } = { embeds };
      if (components !== undefined) {
        payload.components = components;
      }
      const msg = await this.rateLimitedSend(() => channel.send(payload));

      return { success: true, messageId: msg.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, channelId }, 'Failed to send embed');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Edit an existing embed message (for Dashboard-style non-spamming updates).
   */
  async editEmbed(
    channelId: string,
    messageId: string,
    embeds: EmbedBuilder[],
    components?: ActionRowBuilder<ButtonBuilder>[]
  ): Promise<SendResult> {
    try {
      const channel = await this.resolveTextChannel(channelId);
      if (channel === null) {
        return { success: false, error: `Channel ${channelId} not found` };
      }

      const message = await channel.messages.fetch(messageId);
      const editPayload: MessageEditOptions = { embeds };
      if (components !== undefined) {
        editPayload.components = components as ActionRowBuilder<ButtonBuilder>[];
      }
      await this.rateLimitedSend(() => message.edit(editPayload));

      return { success: true, messageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, channelId, messageId }, 'Failed to edit embed');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send a text message to any channel (not just this adapter's bound channel).
   */
  async sendToChannel(channelId: string, content: string): Promise<SendResult> {
    try {
      const channel = await this.resolveTextChannel(channelId);
      if (channel === null) {
        return { success: false, error: `Channel ${channelId} not found` };
      }

      const chunks = splitDiscordMessage(content);
      let lastMessageId = '';
      for (const chunk of chunks) {
        const sent = await this.rateLimitedSend(() => channel.send(chunk));
        lastMessageId = sent.id;
      }

      return { success: true, messageId: lastMessageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, channelId }, 'Failed to send to channel');
      return { success: false, error: errorMessage };
    }
  }

  // ============================================================
  // Forum Channel Operations
  // ============================================================

  /**
   * Create a new Forum post (thread) in a Forum channel.
   * Each post = a task/ticket in the task board.
   */
  async createForumPost(
    forumChannelId: string,
    title: string,
    content: string,
    tagIds?: string[]
  ): Promise<{ success: boolean; threadId?: string; error?: string }> {
    try {
      const channel = await this.resolveChannel(forumChannelId);
      if (channel === null || channel.type !== ChannelType.GuildForum) {
        return { success: false, error: `Channel ${forumChannelId} is not a Forum channel` };
      }

      const forumChannel = channel as ForumChannel;
      const createOptions: { name: string; message: { content: string }; appliedTags?: string[] } = {
        name: title.slice(0, 100), // Discord thread name limit
        message: { content: content.slice(0, MAX_MESSAGE_LENGTH) },
      };
      if (tagIds !== undefined) {
        createOptions.appliedTags = tagIds;
      }
      const thread = await forumChannel.threads.create(createOptions);

      return { success: true, threadId: thread.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, forumChannelId, title }, 'Failed to create forum post');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update tags on a Forum thread (for status/priority changes).
   */
  async updateForumPostTags(
    threadId: string,
    tagIds: string[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.client === null) {
        return { success: false, error: 'Client not initialized' };
      }
      const thread = await this.client.channels.fetch(threadId);
      if (thread === null || !thread.isThread()) {
        return { success: false, error: `Thread ${threadId} not found` };
      }

      await (thread as ThreadChannel).setAppliedTags(tagIds);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, threadId }, 'Failed to update forum tags');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Reply to a thread (for progress updates on tasks).
   */
  async replyToThread(
    threadId: string,
    content: string
  ): Promise<SendResult> {
    try {
      if (this.client === null) {
        return { success: false, error: 'Client not initialized' };
      }
      const thread = await this.client.channels.fetch(threadId);
      if (thread === null || !thread.isThread()) {
        return { success: false, error: `Thread ${threadId} not found` };
      }

      const msg = await this.rateLimitedSend(() =>
        (thread as ThreadChannel).send(content.slice(0, MAX_MESSAGE_LENGTH))
      );
      return { success: true, messageId: msg.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, threadId }, 'Failed to reply to thread');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Create a new thread in a text channel from an initial message.
   * Used for creating per-task agent threads.
   */
  async createThreadInChannel(
    channelId: string,
    threadName: string,
    initialContent: string
  ): Promise<{ success: boolean; threadId?: string; error?: string }> {
    try {
      const channel = await this.resolveTextOrThread(channelId);
      if (channel === null || channel.isThread()) {
        return { success: false, error: `Channel ${channelId} not found or not text-based` };
      }

      const textChannel = channel as TextChannel;
      const message = await this.rateLimitedSend(async () =>
        textChannel.send(initialContent)
      );

      const thread = await message.startThread({
        name: threadName,
      });

      return { success: true, threadId: thread.id };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: errorMsg, channelId, threadName }, 'Failed to create thread in channel');
      return { success: false, error: errorMsg };
    }
  }

  /**
   * BaseAdapter createThread implementation for Discord.
   * Creates a thread in the specified text channel.
   */
  override async createThread(
    chatId: string,
    threadName: string,
    initialContent?: string
  ): Promise<{ success: boolean; threadId?: string; error?: string }> {
    return this.createThreadInChannel(chatId, threadName, initialContent ?? threadName);
  }

  /**
   * Archive a thread (for completed/cancelled tasks).
   */
  override async archiveThread(
    threadId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.client === null) {
        return { success: false, error: 'Client not initialized' };
      }
      const thread = await this.client.channels.fetch(threadId);
      if (thread === null || !thread.isThread()) {
        return { success: false, error: `Thread ${threadId} not found` };
      }

      await (thread as ThreadChannel).setArchived(true);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, threadId }, 'Failed to archive thread');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send an Embed with optional action buttons to a thread.
   * Used for quality gate review Embeds.
   */
  async replyToThreadEmbed(
    threadId: string,
    embeds: EmbedBuilder[],
    components?: ActionRowBuilder<ButtonBuilder>[]
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const thread = await this.client?.channels.fetch(threadId);
      if (!thread || !thread.isTextBased()) {
        return { success: false, error: `Thread ${threadId} not found` };
      }

      const msg = await this.rateLimitedSend(async () =>
        (thread as TextChannel).send({
          embeds,
          ...(components ? { components } : {}),
        })
      );

      return { success: true, messageId: msg.id };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: errorMsg, threadId }, 'Failed to send embed to thread');
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Fetch recent messages from a thread.
   * Used by read_task MCP tool to return thread context.
   */
  async fetchRecentThreadMessages(
    threadId: string,
    limit = 10
  ): Promise<Array<{ author: string; content: string; timestamp: string }>> {
    try {
      const thread = await this.client?.channels.fetch(threadId);
      if (!thread || !thread.isTextBased()) return [];

      const messages = await (thread as TextChannel).messages.fetch({ limit });

      return [...messages.values()]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(m => ({
          author: m.author.username,
          content: m.content.slice(0, 500),
          timestamp: m.createdAt.toISOString(),
        }));
    } catch (err) {
      this.log.warn({ event_type: EventType.ADAPTER_MESSAGE_ERROR, err: err instanceof Error ? err.message : String(err), threadId }, 'Failed to fetch thread messages');
      return [];
    }
  }

  // ============================================================
  // Interactive Prompts (Permission / Question / PlanReview)
  // ============================================================

  override async sendPermissionPrompt(
    chatId: string,
    options: PermissionPromptOptions
  ): Promise<PermissionPromptResult> {
    try {
      const channel = await this.resolveTextOrThread(chatId) ?? this.channel;
      if (channel === null) {
        return { success: false, error: 'No channel available' };
      }

      const embed = new EmbedBuilder()
        .setTitle('🔐 Permission Request')
        .setColor(0xFFA500)
        .addFields(
          { name: 'Tool', value: options.toolName, inline: true },
          { name: 'Reason', value: options.decisionReason ?? 'N/A', inline: true },
        )
        .setTimestamp();

      if (options.blockedPath !== undefined) {
        embed.addFields({ name: 'Path', value: `\`${options.blockedPath}\`` });
      }

      const inputSummary = JSON.stringify(options.toolInput, null, 2);
      if (inputSummary.length > 0 && inputSummary !== '{}') {
        embed.addFields({
          name: 'Input',
          value: `\`\`\`json\n${inputSummary.slice(0, 1000)}\n\`\`\``,
        });
      }

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`perm:allow:${options.requestId}`)
          .setLabel('Allow')
          .setStyle(3), // Success (green)
        new ButtonBuilder()
          .setCustomId(`perm:always:${options.requestId}`)
          .setLabel('Always Allow')
          .setStyle(1), // Primary (blue)
        new ButtonBuilder()
          .setCustomId(`perm:deny:${options.requestId}`)
          .setLabel('Deny')
          .setStyle(4), // Danger (red)
      );

      const msg = await this.rateLimitedSend(() => channel.send({ embeds: [embed], components: [row] }));

      return { success: true, messageId: msg.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error }, 'Failed to send permission prompt');
      return { success: false, error: errorMessage };
    }
  }

  override async updatePermissionPrompt(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    try {
      const channel = await this.resolveTextOrThread(chatId) ?? this.channel;
      if (channel === null) return;

      const message = await channel.messages.fetch(messageId);
      await this.rateLimitedSend(() => message.edit({ content: text, components: [] }));
    } catch (error) {
      this.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, messageId }, 'Failed to update permission prompt');
    }
  }

  override setPermissionResolver(resolver: PermissionResolver): void {
    this.permissionResolver = resolver;
  }

  override async sendQuestionPrompt(
    chatId: string,
    options: QuestionPromptOptions
  ): Promise<QuestionPromptResult> {
    try {
      const channel = await this.resolveTextOrThread(chatId) ?? this.channel;
      if (channel === null) {
        return { success: false, error: 'No channel available' };
      }

      const embed = new EmbedBuilder()
        .setTitle(`❓ ${options.header}`)
        .setDescription(options.question)
        .setColor(0x5865F2);

      // Build option buttons (max 5 per row, max 5 rows)
      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      let currentRow = new ActionRowBuilder<ButtonBuilder>();
      let btnCount = 0;

      for (let i = 0; i < options.options.length; i++) {
        const opt = options.options[i]!;
        if (btnCount >= 5) {
          rows.push(currentRow);
          currentRow = new ActionRowBuilder<ButtonBuilder>();
          btnCount = 0;
          if (rows.length >= 5) break; // Discord limit
        }
        currentRow.addComponents(
          new ButtonBuilder()
            // Send index because InteractionHandler expects a parseInt-able value.
            .setCustomId(`question:${options.requestId}:${i}`)
            .setLabel(opt.label.slice(0, 80))
            .setStyle(2) // Secondary
        );
        btnCount++;
      }
      if (btnCount > 0) rows.push(currentRow);

      const msg = await this.rateLimitedSend(() => channel.send({ embeds: [embed], components: rows }));

      return { success: true, messageId: msg.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error }, 'Failed to send question prompt');
      return { success: false, error: errorMessage };
    }
  }

  override async updateQuestionPrompt(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    try {
      const channel = await this.resolveTextOrThread(chatId) ?? this.channel;
      if (channel === null) return;

      const message = await channel.messages.fetch(messageId);
      await this.rateLimitedSend(() => message.edit({ content: text, components: [] }));
    } catch (error) {
      this.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, messageId }, 'Failed to update question prompt');
    }
  }

  override setQuestionResolver(resolver: QuestionResolver): void {
    this.questionResolver = resolver;
  }

  override async sendExitPlanModePrompt(
    chatId: string,
    options: ExitPlanModePromptOptions
  ): Promise<ExitPlanModePromptResult> {
    try {
      const channel = await this.resolveTextOrThread(chatId) ?? this.channel;
      if (channel === null) {
        return { success: false, error: 'No channel available' };
      }

      const allowedList = options.allowedPrompts?.length
        ? options.allowedPrompts.map((p) => `• **${p.tool}**: ${p.prompt}`).join('\n')
        : '（無特殊權限）';

      const embed = new EmbedBuilder()
        .setTitle('📋 Plan Review')
        .setDescription('Claude 已完成計畫，請審核：')
        .addFields({ name: '需要的權限', value: allowedList.slice(0, 1024) })
        .setColor(0x2B2D31)
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`plan:approve:${options.requestId}`)
          .setLabel('Approve Plan')
          .setStyle(3), // Success
        new ButtonBuilder()
          .setCustomId(`plan:reject:${options.requestId}`)
          .setLabel('Reject Plan')
          .setStyle(4), // Danger
      );

      const msg = await this.rateLimitedSend(() => channel.send({ embeds: [embed], components: [row] }));

      return { success: true, messageId: msg.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error }, 'Failed to send plan review prompt');
      return { success: false, error: errorMessage };
    }
  }

  override async updateExitPlanModePrompt(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    try {
      const channel = await this.resolveTextOrThread(chatId) ?? this.channel;
      if (channel === null) return;

      const message = await channel.messages.fetch(messageId);
      await this.rateLimitedSend(() => message.edit({ content: text, components: [] }));
    } catch (error) {
      this.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, messageId }, 'Failed to update plan review prompt');
    }
  }

  override setExitPlanModeResolver(resolver: ExitPlanModeResolver): void {
    this.exitPlanModeResolver = resolver;
  }

  /**
   * Handle a button interaction routed from InteractionHandler.
   * Parses customId and routes to the appropriate resolver.
   */
  handleButtonInteraction(customId: string): boolean {
    const parts = customId.split(':');
    if (parts.length < 3) return false;

    const type = parts[0];
    const action = parts[1];
    const requestId = parts[2];

    if (type === undefined || action === undefined || requestId === undefined) {
      return false;
    }

    this.log.debug({ customId, type, action, requestId }, 'Button interaction received');

    if (type === 'perm' && this.permissionResolver !== null) {
      const decision = action as 'allow' | 'always' | 'deny';
      this.permissionResolver(requestId, decision);
      return true;
    }

    if (type === 'question' && this.questionResolver !== null) {
      // For question buttons: customId = "question:<requestId>:<index>"
      const questionRequestId = parts[1];
      const optionIndex = parts[2];
      if (questionRequestId !== undefined && optionIndex !== undefined) {
        this.questionResolver(questionRequestId, optionIndex);
      }
      return true;
    }

    if (type === 'plan' && this.exitPlanModeResolver !== null) {
      const decision: 'approve' | 'reject' = action === 'approve' ? 'approve' : 'reject';
      this.exitPlanModeResolver(requestId, decision);
      return true;
    }

    this.log.warn({ customId }, 'Unhandled button interaction — no resolver found');
    return false;
  }

  // ============================================================
  // Media Sending (sendPhoto/Document/Audio/Video)
  // ============================================================

  override async sendPhoto(
    chatId: string,
    filePath: string,
    caption?: string,
  ): Promise<SendResult> {
    return this.sendFileAttachment(chatId, filePath, caption);
  }

  override async sendDocument(
    chatId: string,
    filePath: string,
    caption?: string,
  ): Promise<SendResult> {
    return this.sendFileAttachment(chatId, filePath, caption);
  }

  override async sendAudio(
    chatId: string,
    audio: Buffer,
    options?: { duration?: number; caption?: string; filename?: string },
  ): Promise<SendResult> {
    try {
      const target = chatId !== this.channelId
        ? await this.resolveTextOrThread(chatId)
        : this.channel;
      if (target === null) {
        return { success: false, error: 'Channel not found' };
      }
      const attachment = new AttachmentBuilder(audio, { name: options?.filename ?? 'audio.mp3' });
      const payload: { files: AttachmentBuilder[]; content?: string } = { files: [attachment] };
      if (options?.caption !== undefined) payload.content = options.caption;
      const msg = await this.rateLimitedSend(() => target.send(payload));
      return { success: true, messageId: msg.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error }, 'Failed to send audio');
      return { success: false, error: errorMessage };
    }
  }

  override async sendVideo(
    chatId: string,
    filePath: string,
    caption?: string,
  ): Promise<SendResult> {
    return this.sendFileAttachment(chatId, filePath, caption);
  }

  /**
   * Send a file as a Discord attachment (thread-aware).
   */
  private async sendFileAttachment(chatId: string, filePath: string, caption?: string): Promise<SendResult> {
    try {
      const target = chatId !== this.channelId
        ? await this.resolveTextOrThread(chatId)
        : this.channel;
      if (target === null) {
        return { success: false, error: 'Channel not found' };
      }
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      const attachment = new AttachmentBuilder(filePath, { name: path.basename(filePath) });
      const payload: { files: AttachmentBuilder[]; content?: string } = { files: [attachment] };
      if (caption !== undefined) payload.content = caption;
      const msg = await this.rateLimitedSend(() => target.send(payload));
      return { success: true, messageId: msg.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, filePath }, 'Failed to send file attachment');
      return { success: false, error: errorMessage };
    }
  }

  // ============================================================
  // Rate Limiting (simple queue-based)
  // ============================================================

  /** Pending send queue for rate limiting */
  private sendQueue: Array<() => Promise<void>> = [];
  private isFlushing = false;
  private lastSendTime = 0;
  private static readonly MIN_SEND_INTERVAL_MS = 1200; // ~5 messages per 5 seconds

  /**
   * Queue a send operation with rate limiting.
   */
  private async rateLimitedSend<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.sendQueue.push(async () => {
        try {
          const now = Date.now();
          const elapsed = now - this.lastSendTime;
          if (elapsed < DiscordAdapter.MIN_SEND_INTERVAL_MS) {
            await new Promise(r => setTimeout(r, DiscordAdapter.MIN_SEND_INTERVAL_MS - elapsed));
          }
          this.lastSendTime = Date.now();
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });

      if (!this.isFlushing) {
        void this.flushSendQueue();
      }
    });
  }

  private async flushSendQueue(): Promise<void> {
    if (this.isFlushing) return;
    this.isFlushing = true;

    while (this.sendQueue.length > 0) {
      const task = this.sendQueue.shift();
      if (task !== undefined) {
        await task();
      }
    }

    this.isFlushing = false;
  }

  // ============================================================
  // Accessor for discord.js Client (used by InteractionHandler / MainBot)
  // ============================================================

  /** Get the underlying discord.js Client (null if not initialized) */
  getClient(): Client | null {
    return this.client;
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  /**
   * Resolve a channelId that may be a TextChannel or a Thread.
   * Used by sendMessage to route replies to threads.
   */
  private async resolveTextOrThread(channelId: string): Promise<TextChannel | ThreadChannel | null> {
    if (this.client === null) return null;
    try {
      const ch = await this.client.channels.fetch(channelId);
      if (ch === null) return null;
      if (ch.type === ChannelType.GuildText) return ch as TextChannel;
      if (ch.isThread()) {
        const thread = ch as ThreadChannel;
        // Auto-unarchive if needed (so agent can continue responding)
        if (thread.archived) {
          try {
            await thread.setArchived(false);
          } catch {
            // If bot lacks permission, let send() fail naturally
          }
        }
        return thread;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve a channel ID to a TextChannel. Returns null if not found or wrong type.
   */
  private async resolveTextChannel(channelId: string): Promise<TextChannel | null> {
    if (this.client === null) return null;
    try {
      const ch = await this.client.channels.fetch(channelId);
      if (ch !== null && ch.type === ChannelType.GuildText) {
        return ch as TextChannel;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve any channel by ID. Returns null if not found.
   */
  private async resolveChannel(channelId: string) {
    if (this.client === null) return null;
    try {
      return await this.client.channels.fetch(channelId);
    } catch {
      return null;
    }
  }

}
