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
  type ThreadChannel,
  type Message as DiscordMessage,
  ChannelType,
} from 'discord.js';
import * as path from 'node:path';
import { generateThreadTitle } from './discord/discordUtils.js';
import { BaseAdapter } from './BaseAdapter.js';
import type {
  DiscordAdapterConfig,
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
import type { SendOptions, SendResult } from '../types/message.js';
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

  protected doStart(): Promise<void> {
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
    return Promise.resolve();
  }

  protected doStop(): Promise<void> {
    if (this.client !== null) {
      if (this.boundMessageHandler !== null) {
        this.client.removeListener('messageCreate', this.boundMessageHandler);
        this.boundMessageHandler = null;
      }

    }
    return Promise.resolve();
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
      scheduleThreadResolver: this.scheduleThreadResolver,
      sttProvider: this.sttProvider,
      generateThreadTitle: (text) => generateThreadTitle(text),
      emitMessage: (msg) => this.emitMessage(msg),
    });
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
  // Thread Operations
  // ============================================================

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
