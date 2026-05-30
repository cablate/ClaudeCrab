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
  type TextChannel,
  type ForumChannel,
  type ThreadChannel,
  type Message as DiscordMessage,
  ChannelType,
} from 'discord.js';
import * as path from 'node:path';
import { generateThreadTitle } from './discord/discordUtils.js';
import { BaseAdapter } from './BaseAdapter.js';
import type {
  DiscordAdapterConfig,
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
import {
  sendPermissionPrompt as uiSendPermissionPrompt,
  updatePermissionPrompt as uiUpdatePermissionPrompt,
  sendQuestionPrompt as uiSendQuestionPrompt,
  updateQuestionPrompt as uiUpdateQuestionPrompt,
  sendExitPlanModePrompt as uiSendExitPlanModePrompt,
  updateExitPlanModePrompt as uiUpdateExitPlanModePrompt,
  handleButtonInteraction as uiHandleButtonInteraction,
  type PermissionRenderDeps,
  type ButtonHandlerDeps,
} from './discord/DiscordInteractionUI.js';
import { DiscordRateLimiter } from './discord/DiscordRateLimiter.js';
import {
  sendMessage as senderSendMessage,
  sendStatusMessage as senderSendStatusMessage,
  sendSubtitleMessage as senderSendSubtitleMessage,
  updateStatusMessage as senderUpdateStatusMessage,
  sendEmbed as senderSendEmbed,
  editEmbed as senderEditEmbed,
  sendToChannel as senderSendToChannel,
  sendPhoto as senderSendPhoto,
  sendDocument as senderSendDocument,
  sendAudio as senderSendAudio,
  sendVideo as senderSendVideo,
  type DiscordSenderDeps,
} from './discord/DiscordSender.js';

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

  // Rate limiter for send operations
  private rateLimiter = new DiscordRateLimiter();

  private get senderDeps(): DiscordSenderDeps {
    return {
      channel: this.channel,
      channelId: this.channelId,
      rateLimiter: this.rateLimiter,
      resolveTextOrThread: (id) => this.resolveTextOrThread(id),
      resolveTextChannel: (id) => this.resolveTextChannel(id),
      resolveChannel: (id) => this.resolveTextOrThread(id),
      log: this.log,
      emitMessageSent: (chatId, text, userId) => this.emitMessageSent(chatId, text, userId),
    };
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
      await this.client.destroy();
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
    return senderSendMessage(this.senderDeps, chatId, text);
  }

  async sendStatusMessage(
    chatId: string,
    initialText: string = '🔄 處理中...'
  ): Promise<string | null> {
    return senderSendStatusMessage(this.senderDeps, chatId, initialText);
  }

  async sendSubtitleMessage(
    chatId: string,
    text: string,
  ): Promise<string | null> {
    return senderSendSubtitleMessage(this.senderDeps, chatId, text);
  }

  async updateStatusMessage(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<boolean> {
    return senderUpdateStatusMessage(this.senderDeps, chatId, messageId, text);
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    try {
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

  async sendEmbed(
    channelId: string,
    embeds: EmbedBuilder[],
    components?: ActionRowBuilder<ButtonBuilder>[]
  ): Promise<SendResult> {
    return senderSendEmbed(this.senderDeps, channelId, embeds, components);
  }

  async editEmbed(
    channelId: string,
    messageId: string,
    embeds: EmbedBuilder[],
    components?: ActionRowBuilder<ButtonBuilder>[]
  ): Promise<SendResult> {
    return senderEditEmbed(this.senderDeps, channelId, messageId, embeds, components);
  }

  async sendToChannel(channelId: string, content: string): Promise<SendResult> {
    return senderSendToChannel(this.senderDeps, channelId, content);
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

      const msg = await this.rateLimiter.rateLimitedSend(() =>
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
      const message = await this.rateLimiter.rateLimitedSend(async () =>
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

      const msg = await this.rateLimiter.rateLimitedSend(async () =>
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
  // Delegated to DiscordInteractionUI.ts
  // ============================================================

  private get interactionUIDeps(): PermissionRenderDeps {
    return {
      resolveChannel: (chatId) => this.resolveTextOrThread(chatId).then(c => c as TextChannel | ThreadChannel | null),
      rateLimitedSend: <T>(fn: () => Promise<T>) => this.rateLimiter.rateLimitedSend(fn),
      log: this.log,
    };
  }

  private get buttonHandlerDeps(): ButtonHandlerDeps {
    return {
      permissionResolver: this.permissionResolver,
      questionResolver: this.questionResolver,
      exitPlanModeResolver: this.exitPlanModeResolver,
      log: this.log,
    };
  }

  override async sendPermissionPrompt(
    chatId: string,
    options: PermissionPromptOptions
  ): Promise<PermissionPromptResult> {
    return uiSendPermissionPrompt(this.interactionUIDeps, chatId, options);
  }

  override async updatePermissionPrompt(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    return uiUpdatePermissionPrompt(this.interactionUIDeps, chatId, messageId, text);
  }

  override setPermissionResolver(resolver: PermissionResolver): void {
    this.permissionResolver = resolver;
  }

  override async sendQuestionPrompt(
    chatId: string,
    options: QuestionPromptOptions
  ): Promise<QuestionPromptResult> {
    return uiSendQuestionPrompt(this.interactionUIDeps, chatId, options);
  }

  override async updateQuestionPrompt(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    return uiUpdateQuestionPrompt(this.interactionUIDeps, chatId, messageId, text);
  }

  override setQuestionResolver(resolver: QuestionResolver): void {
    this.questionResolver = resolver;
  }

  override async sendExitPlanModePrompt(
    chatId: string,
    options: ExitPlanModePromptOptions
  ): Promise<ExitPlanModePromptResult> {
    return uiSendExitPlanModePrompt(this.interactionUIDeps, chatId, options);
  }

  override async updateExitPlanModePrompt(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    return uiUpdateExitPlanModePrompt(this.interactionUIDeps, chatId, messageId, text);
  }

  override setExitPlanModeResolver(resolver: ExitPlanModeResolver): void {
    this.exitPlanModeResolver = resolver;
  }

  /**
   * Handle a button interaction routed from InteractionHandler.
   * Parses customId and routes to the appropriate resolver.
   */
  handleButtonInteraction(customId: string): boolean {
    return uiHandleButtonInteraction(this.buttonHandlerDeps, customId);
  }

  // ============================================================
  // Media Sending (sendPhoto/Document/Audio/Video)
  // Delegated to DiscordSender.ts
  // ============================================================

  override async sendPhoto(
    chatId: string,
    filePath: string,
    caption?: string,
  ): Promise<SendResult> {
    return senderSendPhoto(this.senderDeps, chatId, filePath, caption);
  }

  override async sendDocument(
    chatId: string,
    filePath: string,
    caption?: string,
  ): Promise<SendResult> {
    return senderSendDocument(this.senderDeps, chatId, filePath, caption);
  }

  override async sendAudio(
    chatId: string,
    audio: Buffer,
    options?: { duration?: number; caption?: string; filename?: string },
  ): Promise<SendResult> {
    return senderSendAudio(this.senderDeps, chatId, audio, options);
  }

  override async sendVideo(
    chatId: string,
    filePath: string,
    caption?: string,
  ): Promise<SendResult> {
    return senderSendVideo(this.senderDeps, chatId, filePath, caption);
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
