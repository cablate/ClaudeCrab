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
  type TextChannel,
  type Message as DiscordMessage,
  ChannelType,
} from 'discord.js';
import { BaseAdapter } from './BaseAdapter.js';
import type {
  DiscordAdapterConfig,
  UnifiedMessage,
  SendOptions,
  SendResult,
} from './types.js';
import {
  validateMessage,
  getSecurityErrorMessage,
  detectPromptInjection,
  type SecurityConfig,
} from '../utils/security.js';
import { auditLogger } from '../utils/audit.js';

const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  allowedUsers: [],
  whitelistEnabled: false,
  maxMessageLength: 10000,
  promptInjectionDetection: true,
};

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
  private boundMessageHandler: ((message: DiscordMessage) => void) | null =
    null;

  constructor(config: DiscordAdapterConfig) {
    super(config);
    this.channelId = config.channelId;

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
      { username: this.client.user?.username },
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
      { channelId: this.channelId, channelName: this.channel.name },
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
        this.log.error({ error }, 'Unhandled error in Discord message handler');
      });
    };

    this.client.on('messageCreate', this.boundMessageHandler);
    this.log.info(
      { channelId: this.channelId },
      'Discord adapter listening for messages'
    );
  }

  protected async doStop(): Promise<void> {
    if (this.client !== null && this.boundMessageHandler !== null) {
      this.client.removeListener('messageCreate', this.boundMessageHandler);
      this.boundMessageHandler = null;
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

  /**
   * Handle incoming Discord message
   */
  private async handleMessage(message: DiscordMessage): Promise<void> {
    // Only process messages in our channel
    if (message.channelId !== this.channelId) {
      return;
    }

    // Ignore bot messages (prevents infinite loops)
    if (message.author.bot) {
      return;
    }

    const userId = message.author.id;
    const chatId = message.channelId;
    const text = message.content;

    // Skip empty messages (attachments only, etc.)
    if (text.length === 0) {
      return;
    }

    // Security validation
    const validation = validateMessage(text, userId, this.securityConfig);

    if (!validation.valid) {
      if (validation.error === 'unauthorized') {
        auditLogger.logUnauthorizedAccess('discord', userId, chatId);
        this.log.warn({ userId, chatId }, 'Unauthorized access attempt');
      } else if (validation.error === 'message_too_long') {
        auditLogger.logValidationFailed(
          'discord',
          userId,
          'message_too_long',
          chatId
        );
      }

      const errorMessage = getSecurityErrorMessage(validation.error!);
      await message.reply(errorMessage);
      return;
    }

    // Check for prompt injection (warning only)
    if (validation.warnings?.includes('potential_prompt_injection')) {
      const patterns = detectPromptInjection(text, this.securityConfig);
      auditLogger.logInjectionDetected('discord', userId, patterns, chatId);
      this.log.warn(
        { userId, chatId, patternCount: patterns.length },
        'Potential prompt injection detected'
      );
    }

    // Build UnifiedMessage
    const displayName =
      message.member?.displayName ?? message.author.displayName;

    const unifiedMessage: UnifiedMessage = {
      id: `discord:${message.id}:${chatId}`,
      platform: 'discord',
      userId,
      chatId,
      text,
      timestamp: message.createdAt,
      metadata: {
        originalMessageId: message.id,
        displayName,
        username: message.author.username,
        isGroupChat: false, // Phase 1: treat all Discord channels as 1:1
      },
    };

    // Log user message
    auditLogger.logUserMessage(unifiedMessage);

    // Emit to message handler (registered by PlatformOrchestrator)
    void this.emitMessage(unifiedMessage).catch((error) => {
      this.log.error({ error }, 'Error emitting Discord message');
    });
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
      const chunks = this.splitMessage(text);
      let lastMessageId = '';

      for (const chunk of chunks) {
        const sent = await this.channel.send(chunk);
        lastMessageId = sent.id;
      }

      this.emitMessageSent(chatId, text, chatId);

      return { success: true, messageId: lastMessageId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.log.error({ error, chatId }, 'Failed to send Discord message');
      return { success: false, error: errorMessage };
    }
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {
    if (this.channel === null) {
      return;
    }

    try {
      await this.channel.sendTyping();
    } catch (error) {
      this.log.warn({ error }, 'Failed to send typing indicator');
    }
  }

  /**
   * Split message into chunks respecting Discord's 2000 char limit
   */
  private splitMessage(text: string): string[] {
    if (text.length <= MAX_MESSAGE_LENGTH) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_MESSAGE_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // Try to split at newline
      let splitIndex = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);

      // If no newline found, try space
      if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH / 2) {
        splitIndex = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
      }

      // Force split if no good split point
      if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH / 2) {
        splitIndex = MAX_MESSAGE_LENGTH;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).trimStart();
    }

    return chunks;
  }
}
