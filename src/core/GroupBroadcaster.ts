import { getEventBus } from './EventBus.js';
import type { MessageProcessor } from './MessageProcessor.js';
import type { GroupMessagePayload } from '../types/events.js';
import { logger } from '../utils/logger.js';

/**
 * Options for GroupBroadcaster
 */
export interface GroupBroadcasterOptions {
  /** Message processor for handling messages */
  messageProcessor: MessageProcessor;

  /** Function to get bot info by agentId */
  getBotInfo: (agentId: string) => { username: string; id: number } | null;
}

/**
 * GroupBroadcaster manages message broadcasting in Telegram groups.
 *
 * When a group message is received, it broadcasts to all bots in that group:
 * - The mentioned bot (or reply target) processes and replies
 * - Other bots observe (query without replying)
 *
 * This enables multi-bot collaboration where all bots maintain
 * awareness of the conversation.
 */
export class GroupBroadcaster {
  private readonly messageProcessor: MessageProcessor;
  private readonly getBotInfo: (
    agentId: string
  ) => { username: string; id: number } | null;

  /**
   * Maps chatId to set of agentIds that are members of that group.
   * Bots are automatically registered when they receive a message from a group.
   */
  private readonly groupMemberships: Map<string, Set<string>> = new Map();

  private readonly log = logger.child({ module: 'GroupBroadcaster' });

  constructor(options: GroupBroadcasterOptions) {
    this.messageProcessor = options.messageProcessor;
    this.getBotInfo = options.getBotInfo;

    // Listen to group:message events
    getEventBus().on('group:message', this.handleGroupMessage.bind(this));

    this.log.info('GroupBroadcaster initialized');
  }

  /**
   * Register a bot as a member of a group.
   * Called automatically when a bot receives a message from a group.
   */
  registerBotInGroup(chatId: string, agentId: string): void {
    let members = this.groupMemberships.get(chatId);
    if (members === undefined) {
      members = new Set();
      this.groupMemberships.set(chatId, members);
    }

    if (!members.has(agentId)) {
      members.add(agentId);
      this.log.debug(
        { chatId, agentId, memberCount: members.size },
        'Bot registered in group'
      );
    }
  }

  /**
   * Get all bot agentIds that are members of a group.
   */
  getGroupMembers(chatId: string): string[] {
    const members = this.groupMemberships.get(chatId);
    return members ? Array.from(members) : [];
  }

  /**
   * Handle group:message event - broadcast to all bots in the group.
   */
  private async handleGroupMessage(event: GroupMessagePayload): Promise<void> {
    const { message, sourceAgentId, mentionedBot, isReplyToBot } = event;
    const chatId = message.chatId;

    // Register the source bot in this group
    this.registerBotInGroup(chatId, sourceAgentId);

    // Get all bots in this group
    const members = this.getGroupMembers(chatId);

    this.log.debug(
      {
        chatId,
        sourceAgentId,
        mentionedBot,
        isReplyToBot,
        memberCount: members.length,
      },
      'Broadcasting group message'
    );

    // Process message for each bot
    const processingPromises = members.map(async (agentId) => {
      // Determine if this bot should reply or just observe
      const botInfo = this.getBotInfo(agentId);
      const shouldReply = this.shouldBotReply(
        agentId,
        botInfo,
        mentionedBot,
        isReplyToBot,
        sourceAgentId
      );

      this.log.debug(
        { chatId, agentId, shouldReply, mentionedBot },
        shouldReply ? 'Bot will reply' : 'Bot will observe'
      );

      try {
        // Build options object - only include replyToMessageId if defined
        const processOpts: { observeOnly: boolean; replyToMessageId?: string } =
          {
            observeOnly: !shouldReply,
          };
        if (message.metadata?.originalMessageId !== undefined) {
          processOpts.replyToMessageId = message.metadata.originalMessageId;
        }
        await this.messageProcessor.processMessage(
          message,
          agentId,
          processOpts
        );
      } catch (error) {
        this.log.error(
          { error, chatId, agentId, observeOnly: !shouldReply },
          'Failed to process group message for bot'
        );
      }
    });

    // Wait for all bots to process (but don't fail if some fail)
    await Promise.allSettled(processingPromises);
  }

  /**
   * Determine if a bot should reply to the message or just observe.
   */
  private shouldBotReply(
    agentId: string,
    botInfo: { username: string; id: number } | null,
    mentionedBot: string | null,
    isReplyToBot: boolean,
    sourceAgentId: string
  ): boolean {
    // Only the source bot (the one that received the message) can be the reply target
    if (agentId !== sourceAgentId) {
      return false;
    }

    // Reply if this bot was mentioned
    if (mentionedBot !== null && botInfo !== null) {
      return mentionedBot.toLowerCase() === botInfo.username.toLowerCase();
    }

    // Reply if this is a reply to the bot's message
    if (isReplyToBot) {
      return true;
    }

    return false;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.groupMemberships.clear();
    this.log.info('GroupBroadcaster disposed');
  }
}
