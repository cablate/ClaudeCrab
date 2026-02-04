import { getEventBus } from './EventBus.js';
import type { MessageProcessor } from './MessageProcessor.js';
import type { GroupMessagePayload, BotRepliedPayload } from '../types/events.js';
import type {
  IGroupMessageRepository,
  IInjectionStateRepository,
  IGroupMemberRepository,
} from '../persistence/types.js';
import type { UnifiedMessage } from '../adapters/types.js';
import { logger } from '../utils/logger.js';
import { formatUserLabel, formatBotLabel } from '../utils/format.js';

/** Maximum delegation depth to prevent infinite loops (ADR-021) */
const MAX_DELEGATION_DEPTH = 3;

/**
 * Options for GroupBroadcaster
 */
export interface GroupBroadcasterOptions {
  /** Message processor for handling messages */
  messageProcessor: MessageProcessor;

  /** Function to get bot info by agentId */
  getBotInfo: (agentId: string) => { username: string; id: number } | null;

  /** Group message repository for recording messages (for context injection) */
  groupMessageRepository?: IGroupMessageRepository;

  /** Injection state repository for tracking injection cursor per bot */
  injectionStateRepository?: IInjectionStateRepository;

  /** Group member repository for persistent membership (ADR-020) */
  groupMemberRepository?: IGroupMemberRepository;
}

/**
 * GroupBroadcaster manages group message handling for multi-bot collaboration.
 *
 * ADR-019 Design:
 * - Only the @mentioned bot (or reply target) processes the message
 * - Other bots do NOT process (no silent mode, no observe)
 * - All bots share context via group_messages table (Context Injection)
 *
 * Flow:
 * 1. Group message arrives
 * 2. Record user message to group_messages (once)
 * 3. Ensure injection state for all bots (lazy creation)
 * 4. Only process message for the @mentioned bot
 * 5. Bot reply is recorded to group_messages via bot:replied event
 */
export class GroupBroadcaster {
  private readonly messageProcessor: MessageProcessor;
  private readonly getBotInfo: (
    agentId: string
  ) => { username: string; id: number } | null;
  private readonly groupMessageRepository: IGroupMessageRepository | undefined;
  private readonly injectionStateRepository: IInjectionStateRepository | undefined;
  private readonly groupMemberRepository: IGroupMemberRepository | undefined;

  /**
   * Maps chatId to set of agentIds that are members of that group.
   * Bots are automatically registered when they receive a message from a group.
   */
  private readonly groupMemberships: Map<string, Set<string>> = new Map();

  /**
   * Tracks processed message IDs to prevent duplicate processing.
   * Since each TelegramAdapter emits group:message events independently,
   * the same message can arrive multiple times.
   */
  private readonly processedMessages: Set<string> = new Set();

  /**
   * Maps dedupeKey -> Map<agentId, platformMsgId>.
   * In regular Telegram groups, each bot sees a different message_id for the
   * same physical message. We store each bot's perspective so the responding
   * bot can use its own message_id for reply_to_message_id.
   */
  private readonly perBotMessageIds: Map<string, Map<string, string>> = new Map();

  private readonly log = logger.child({ module: 'GroupBroadcaster' });

  constructor(options: GroupBroadcasterOptions) {
    this.messageProcessor = options.messageProcessor;
    this.getBotInfo = options.getBotInfo;
    this.groupMessageRepository = options.groupMessageRepository;
    this.injectionStateRepository = options.injectionStateRepository;
    this.groupMemberRepository = options.groupMemberRepository;

    // Listen to group:message events
    getEventBus().on('group:message', this.handleGroupMessage.bind(this));

    // Listen to bot:replied events for recording replies to group_messages
    getEventBus().on('bot:replied', this.handleBotReplied.bind(this));

    this.log.info('GroupBroadcaster initialized (ADR-019: no silent mode)');
  }

  /**
   * Register a bot as a member of a group.
   * Called automatically when a bot receives a message from a group.
   * ADR-020: Also persists to DB so memberships survive restarts.
   */
  registerBotInGroup(chatId: string, agentId: string, platform?: string): void {
    let members = this.groupMemberships.get(chatId);
    if (members === undefined) {
      members = new Set();
      this.groupMemberships.set(chatId, members);
    }

    if (!members.has(agentId)) {
      members.add(agentId);

      // Persist to DB (ADR-020)
      if (this.groupMemberRepository && platform) {
        this.groupMemberRepository.registerMember(platform, chatId, agentId);
      }

      this.log.debug(
        { chatId, agentId, memberCount: members.size },
        'Bot registered in group'
      );
    }
  }

  /**
   * Restore group memberships from database (ADR-020).
   * Called during startup to recover persistent state.
   */
  restoreMemberships(): void {
    if (!this.groupMemberRepository) {
      this.log.debug('No groupMemberRepository, skipping membership restoration');
      return;
    }

    const allMembers = this.groupMemberRepository.getAllMembers();
    let restoredCount = 0;

    for (const row of allMembers) {
      let members = this.groupMemberships.get(row.chat_id);
      if (members === undefined) {
        members = new Set();
        this.groupMemberships.set(row.chat_id, members);
      }
      members.add(row.agent_id);
      restoredCount++;
    }

    this.log.info(
      { restoredCount, groupCount: this.groupMemberships.size },
      'Group memberships restored from database'
    );
  }

  /**
   * Get all bot agentIds that are members of a group.
   */
  getGroupMembers(chatId: string): string[] {
    const members = this.groupMemberships.get(chatId);
    return members ? Array.from(members) : [];
  }

  /**
   * Handle group:message event.
   * ADR-019: Only process for the @mentioned bot, no silent mode.
   */
  private async handleGroupMessage(event: GroupMessagePayload): Promise<void> {
    const { message, sourceAgentId, mentionedBot, isReplyToBot } = event;
    const chatId = message.chatId;

    // IMPORTANT: Register bot BEFORE dedup check!
    // Each TelegramAdapter emits group:message independently, so every bot
    // gets registered even if their event is later deduplicated.
    this.registerBotInGroup(chatId, sourceAgentId, message.platform);

    // Get platform message ID (per-bot, differs in regular Telegram groups)
    const platformMsgId = String(message.metadata?.originalMessageId ?? '');

    // IMPORTANT: Ensure injection state BEFORE dedup check!
    // Each bot needs its own injection state created when it first sees a message.
    // Use latest group_messages.id as cursor (not platform_msg_id which differs per bot).
    if (this.injectionStateRepository) {
      const latestId = this.groupMessageRepository?.getLatestId(
        message.platform,
        chatId
      );
      this.injectionStateRepository.ensureState(
        sourceAgentId,
        chatId,
        message.platform,
        latestId?.toString() ?? '0'
      );
    }

    // Deduplicate: each TelegramAdapter emits group:message independently,
    // so the same message arrives multiple times (once per bot).
    // Use content-based key because regular Telegram groups give each bot
    // different message_ids for the same physical message.
    const dedupeTs = Math.floor(message.timestamp.getTime() / 1000);
    const messageKey = `${chatId}:${message.userId}:${dedupeTs}:${message.text.substring(0, 50)}`;

    // BEFORE dedup: store this bot's perspective of the message_id.
    // Each bot in a regular Telegram group sees a different message_id.
    let botMsgIds = this.perBotMessageIds.get(messageKey);
    if (botMsgIds === undefined) {
      botMsgIds = new Map();
      this.perBotMessageIds.set(messageKey, botMsgIds);
    }
    if (platformMsgId) {
      botMsgIds.set(sourceAgentId, platformMsgId);
    }

    if (this.processedMessages.has(messageKey)) {
      this.log.debug(
        { messageKey, sourceAgentId },
        'Skipping duplicate group message (bot already registered)'
      );
      return;
    }
    this.processedMessages.add(messageKey);

    // Cleanup old entries to prevent memory leak (keep last 1000)
    if (this.processedMessages.size > 1000) {
      const toDelete = Array.from(this.processedMessages).slice(0, 500);
      for (const key of toDelete) {
        this.processedMessages.delete(key);
        this.perBotMessageIds.delete(key);
      }
    }

    // Format sender label for the message
    const senderLabel = formatUserLabel({
      displayName: (message.metadata?.displayName as string) || undefined,
      username: (message.metadata?.username as string) || undefined,
      fallbackId: message.userId,
    });

    // Record user message to group_messages table (for context injection)
    if (platformMsgId && this.groupMessageRepository) {
      this.log.info(
        { platform: message.platform, chatId, platformMsgId, senderType: 'user', senderId: message.userId },
        'Recording user message to group_messages'
      );
      this.groupMessageRepository.recordMessage(
        message.platform,
        chatId,
        platformMsgId,
        'user',
        message.userId,
        senderLabel,
        message.text
      );
    }

    // Determine which bot should respond (ADR-019: only one bot processes)
    const respondingBot = this.getRespondingBot(chatId, mentionedBot, isReplyToBot, sourceAgentId);

    if (respondingBot === null) {
      this.log.debug(
        { chatId, mentionedBot, isReplyToBot, sourceAgentId },
        'No bot should respond to this message'
      );
      return;
    }

    this.log.info(
      { chatId, respondingBot, mentionedBot, isReplyToBot },
      'Processing message for responding bot (ADR-019: single bot, no silent mode)'
    );

    // Create message with sender prefix
    const prefixedMessage = {
      ...message,
      text: `${senderLabel}: ${message.text}`,
    };

    // Look up the responding bot's own message_id.
    // In regular Telegram groups, each bot sees a different message_id.
    // If the responding bot's event arrived first (common case), we have it.
    // Otherwise, wait briefly for the responding bot's adapter to report its ID.
    let respondingBotMsgId = this.perBotMessageIds.get(messageKey)?.get(respondingBot);
    if (!respondingBotMsgId && respondingBot !== sourceAgentId) {
      respondingBotMsgId = await this.waitForBotMessageId(messageKey, respondingBot, 300);
    }

    this.log.info(
      { respondingBot, respondingBotMsgId, sourceAgentId, sourceMsgId: platformMsgId },
      'Resolved responding bot message_id'
    );

    // Process message only for the responding bot, using its own message_id
    try {
      await this.messageProcessor.processMessage(prefixedMessage, respondingBot, {
        isGroupChat: true,
        ...(respondingBotMsgId ? { replyToMessageId: respondingBotMsgId } : {}),
      });
    } catch (error) {
      this.log.error(
        { error, chatId, respondingBot },
        'Failed to process group message'
      );
    }
  }

  /**
   * Determine which bot should respond to the message.
   * Returns agentId of the responding bot, or null if no bot should respond.
   *
   * ADR-019: Only one bot processes per message (no silent observe mode).
   */
  private getRespondingBot(
    chatId: string,
    mentionedBot: string | null,
    isReplyToBot: boolean,
    sourceAgentId: string
  ): string | null {
    // Case 1: Bot was explicitly @mentioned - find the corresponding agentId
    if (mentionedBot !== null) {
      const members = this.getGroupMembers(chatId);
      for (const agentId of members) {
        const botInfo = this.getBotInfo(agentId);
        if (botInfo && mentionedBot.toLowerCase() === botInfo.username.toLowerCase()) {
          this.log.debug(
            { mentionedBot, agentId, botUsername: botInfo.username },
            'Found responding bot by @mention'
          );
          return agentId;
        }
      }
      // Mentioned bot not in group
      this.log.debug(
        { mentionedBot, members: this.getGroupMembers(chatId) },
        'Mentioned bot not found in group members'
      );
      return null;
    }

    // Case 2: Reply to bot's message - sourceAgentId is the responding bot
    if (isReplyToBot) {
      this.log.debug(
        { sourceAgentId, isReplyToBot },
        'Responding bot determined by reply-to'
      );
      return sourceAgentId;
    }

    // No bot should respond
    return null;
  }

  /**
   * Handle bot:replied event - record the reply to group_messages.
   * ADR-019: Only record to group_messages, no broadcast to other bots' sessions.
   */
  private async handleBotReplied(payload: BotRepliedPayload): Promise<void> {
    const { chatId, agentId, response, platform, replyMessageId } = payload;

    // Record bot reply to group_messages table (for context injection)
    if (replyMessageId && this.groupMessageRepository) {
      const senderLabel = formatBotLabel(this.getBotInfo(agentId), agentId);
      this.log.info(
        {
          platform,
          chatId,
          agentId,
          replyMessageId,
          senderLabel,
          responsePreview: response.substring(0, 100),
        },
        'Recording bot reply to group_messages (ADR-019: no broadcast to other sessions)'
      );
      this.groupMessageRepository.recordMessage(
        platform,
        chatId,
        replyMessageId,
        'bot',
        agentId,
        senderLabel,
        response
      );
    } else {
      this.log.warn(
        { platform, chatId, agentId, replyMessageId, hasRepo: !!this.groupMessageRepository },
        'Skipping bot reply recording - missing replyMessageId or repository'
      );
    }

    // ADR-019: NO broadcast to other bots' DB sessions
    // Context is shared via group_messages table and Context Injection

    // ADR-021: Auto-delegation — detect @mentions in bot reply
    const depth = payload.delegationDepth ?? 0;
    if (depth >= MAX_DELEGATION_DEPTH) {
      this.log.debug(
        { chatId, agentId, depth },
        'Max delegation depth reached, skipping auto-delegation'
      );
      return;
    }

    const chain = payload.delegationChain ?? [agentId];
    const target = this.detectDelegationTarget(response, chatId, agentId, chain);
    if (target !== null) {
      const newChain = [...chain, target];
      this.log.info(
        { chatId, from: agentId, to: target, depth: depth + 1, chain: newChain },
        'Auto-delegating to mentioned bot (ADR-021)'
      );
      await this.executeDelegation(target, payload, newChain);
    }
  }

  /**
   * ADR-021: Detect if a bot's reply @mentions another bot in the group.
   * Returns the agentId of the first matching bot, or null.
   */
  private detectDelegationTarget(
    response: string,
    chatId: string,
    senderAgentId: string,
    delegationChain: string[]
  ): string | null {
    // Extract all @mentions from the response text
    const mentionRegex = /@(\w+)/g;
    let match: RegExpExecArray | null;
    const mentions: string[] = [];

    while ((match = mentionRegex.exec(response)) !== null) {
      if (match[1] !== undefined) {
        mentions.push(match[1]);
      }
    }

    if (mentions.length === 0) {
      return null;
    }

    // Get sender's username to filter out self-mentions
    const senderInfo = this.getBotInfo(senderAgentId);
    const senderUsername = senderInfo?.username?.toLowerCase();

    const members = this.getGroupMembers(chatId);

    for (const mention of mentions) {
      const mentionLower = mention.toLowerCase();

      // Skip self-mention
      if (senderUsername && mentionLower === senderUsername) {
        continue;
      }

      // Find matching bot in group members
      for (const agentId of members) {
        // Skip bots already in the delegation chain (cycle detection)
        if (delegationChain.includes(agentId)) {
          this.log.debug(
            { agentId, mention, delegationChain },
            'Skipping delegation target - already in chain (cycle prevention)'
          );
          continue;
        }

        const botInfo = this.getBotInfo(agentId);
        if (botInfo && mentionLower === botInfo.username.toLowerCase()) {
          return agentId;
        }
      }
    }

    return null;
  }

  /**
   * ADR-021: Execute auto-delegation by creating a synthetic message
   * and triggering processMessage for the target bot.
   */
  private async executeDelegation(
    targetAgentId: string,
    payload: BotRepliedPayload,
    newChain: string[]
  ): Promise<void> {
    const newDepth = (payload.delegationDepth ?? 0) + 1;

    // Build synthetic UnifiedMessage from the bot's reply
    const syntheticMessage: UnifiedMessage = {
      id: `delegation-${Date.now()}-${targetAgentId}`,
      platform: payload.platform,
      userId: payload.chatId, // Will become group::{chatId} in processMessage
      chatId: payload.chatId,
      text: payload.response, // Already contains sender label from emitBotRepliedEvent
      timestamp: new Date(),
      metadata: {
        isGroupChat: true,
        isDelegation: true,
        delegationFrom: payload.agentId,
        delegationDepth: newDepth,
      },
    };

    try {
      await this.messageProcessor.processMessage(syntheticMessage, targetAgentId, {
        isGroupChat: true,
        delegationDepth: newDepth,
        delegationChain: newChain,
      });
    } catch (error) {
      this.log.error(
        { error, chatId: payload.chatId, from: payload.agentId, to: targetAgentId, depth: newDepth },
        'Auto-delegation failed'
      );
    }
  }

  /**
   * Wait for a specific bot's message_id to become available.
   * In regular Telegram groups, each bot receives updates independently.
   * The responding bot's adapter may not have emitted its event yet when
   * the first bot's event passes dedup. We poll briefly to allow it to arrive.
   */
  private async waitForBotMessageId(
    messageKey: string,
    agentId: string,
    timeoutMs: number
  ): Promise<string | undefined> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const msgId = this.perBotMessageIds.get(messageKey)?.get(agentId);
      if (msgId !== undefined) {
        this.log.debug(
          { agentId, msgId, waitedMs: Date.now() - start },
          'Resolved bot message_id after waiting'
        );
        return msgId;
      }
      // Yield to allow other event handlers to run
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    this.log.warn(
      { agentId, timeoutMs },
      'Timed out waiting for bot message_id, will send without reply_to'
    );
    return undefined;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.groupMemberships.clear();
    this.perBotMessageIds.clear();
    this.log.info('GroupBroadcaster disposed');
  }
}
