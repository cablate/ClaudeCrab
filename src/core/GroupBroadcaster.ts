import { getEventBus } from './EventBus.js';
import type { MessageProcessor } from './MessageProcessor.js';
import type { GroupMessagePayload, BotRepliedPayload } from '../types/events.js';
import type {
  IGroupMessageRepository,
  IInjectionStateRepository,
  IGroupMemberRepository,
  IQueryMetricsRepository,
} from '../persistence/types.js';
import type { InitiativeSettings, SocialSettings } from '../types/agent.js';
import type { InitiativeEvaluator } from './InitiativeEvaluator.js';
import type { SocialEvaluator } from './SocialEvaluator.js';
import { logger } from '../utils/logger.js';
import { formatUserLabel, formatBotLabel } from '../utils/format.js';
import { DedupTracker } from '../utils/DedupTracker.js';
import { InitiativeHandler } from './InitiativeHandler.js';
import { DelegationHandler } from './DelegationHandler.js';
import { SocialHandler } from './SocialHandler.js';

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

  /** ADR-022: Get agent delegation settings */
  getDelegationSettings?: (agentId: string) => { inbound?: boolean; outbound?: boolean } | undefined;

  /** ADR-023: Get agent initiative settings */
  getInitiativeSettings?: (agentId: string) => InitiativeSettings | undefined;

  /** ADR-023: Get agent description for initiative evaluation */
  getAgentDescription?: (agentId: string) => { name: string; description?: string } | undefined;

  /** ADR-023: Initiative evaluator (Strategy pattern) */
  initiativeEvaluator?: InitiativeEvaluator;

  /** Query metrics repository for recording initiative evaluation costs */
  queryMetricsRepository?: IQueryMetricsRepository;

  /** ADR-030: Get agent social settings */
  getSocialSettings?: (agentId: string) => SocialSettings | undefined;

  /** ADR-030: Social evaluator (Strategy pattern) */
  socialEvaluator?: SocialEvaluator;

  /** v2.0: ActivityService for workflow event emissions in delegation */
  activityService?: import('./ActivityService.js').ActivityService;

  /** v2.0: Get agent display name by ID */
  getAgentName?: (agentId: string) => string;
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

  /** ADR-023: Initiative evaluation and execution handler */
  private readonly initiativeHandler: InitiativeHandler;
  private readonly socialHandler: SocialHandler;

  /** ADR-021/022: Delegation detection and execution handler */
  private readonly delegationHandler: DelegationHandler;

  /**
   * Maps chatId to set of agentIds that are members of that group.
   * Bots are automatically registered when they receive a message from a group.
   */
  private readonly groupMemberships: Map<string, Set<string>> = new Map();

  /**
   * Tracks processed message IDs to prevent duplicate processing.
   * Since each TelegramAdapter emits group:message events independently,
   * the same message can arrive multiple times.
   * Uses DedupTracker with TTL for automatic cleanup.
   */
  private readonly processedMessages = new DedupTracker({ maxSize: 1000, ttlMs: 5 * 60 * 1000 });

  /** ADR-030 Tier 1.2: Track chats with active delegation to suppress initiative */
  private readonly delegationActive = new Set<string>();

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

    // Create handlers with shared dependencies
    this.initiativeHandler = new InitiativeHandler({
      messageProcessor: options.messageProcessor,
      getGroupMembers: (chatId) => this.getGroupMembers(chatId),
      ...(options.getInitiativeSettings ? { getInitiativeSettings: options.getInitiativeSettings } : {}),
      ...(options.getAgentDescription ? { getAgentDescription: options.getAgentDescription } : {}),
      ...(options.initiativeEvaluator ? { initiativeEvaluator: options.initiativeEvaluator } : {}),
      ...(options.queryMetricsRepository ? { queryMetricsRepository: options.queryMetricsRepository } : {}),
    });

    this.socialHandler = new SocialHandler({
      messageProcessor: options.messageProcessor,
      getGroupMembers: (chatId) => this.getGroupMembers(chatId),
      ...(options.getSocialSettings ? { getSocialSettings: options.getSocialSettings } : {}),
      ...(options.getAgentDescription ? { getAgentDescription: options.getAgentDescription } : {}),
      ...(options.socialEvaluator ? { socialEvaluator: options.socialEvaluator } : {}),
      ...(options.queryMetricsRepository ? { queryMetricsRepository: options.queryMetricsRepository } : {}),
    });

    this.delegationHandler = new DelegationHandler({
      messageProcessor: options.messageProcessor,
      getGroupMembers: (chatId) => this.getGroupMembers(chatId),
      getBotInfo: options.getBotInfo,
      ...(options.getDelegationSettings ? { getDelegationSettings: options.getDelegationSettings } : {}),
      ...(options.activityService ? { activityService: options.activityService } : {}),
      ...(options.getAgentName ? { getAgentName: options.getAgentName } : {}),
    });

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

    // DedupTracker.isDuplicate() checks and records in one step
    if (this.processedMessages.isDuplicate(messageKey)) {
      this.log.debug(
        { messageKey, sourceAgentId },
        'Skipping duplicate group message (bot already registered)'
      );
      return;
    }

    // Cleanup stale perBotMessageIds entries (DedupTracker handles processedMessages internally)
    if (this.perBotMessageIds.size > 1000) {
      const entries = [...this.perBotMessageIds.entries()];
      const toDelete = entries.slice(0, 500).map(([key]) => key);
      for (const key of toDelete) {
        this.perBotMessageIds.delete(key);
      }
    }

    // Format sender label for the message
    const senderLabel = formatUserLabel({
      displayName: typeof message.metadata?.displayName === 'string' ? message.metadata.displayName : undefined,
      username: typeof message.metadata?.username === 'string' ? message.metadata.username : undefined,
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

    // ADR-030: Any human message resets social energy (regardless of @mention)
    this.socialHandler.resetEnergy(chatId);

    // Determine which bot should respond (ADR-019: only one bot processes)
    const respondingBot = this.getRespondingBot(chatId, mentionedBot, isReplyToBot, sourceAgentId);

    if (respondingBot === null) {
      this.log.debug(
        { chatId, mentionedBot, isReplyToBot, sourceAgentId },
        'No bot should respond to this message'
      );
      // ADR-030 Tier 1.2: Suppress initiative during active delegation
      if (this.delegationActive.has(chatId)) {
        this.log.info(
          { chatId },
          'Suppressing initiative evaluation - delegation in progress (ADR-030 Tier 1.2)'
        );
        return;
      }

      // ADR-023: Evaluate initiative responses for non-@mentioned messages (work mode first)
      const initiativeHandled = await this.initiativeHandler.evaluateInitiatives(message, chatId, senderLabel);

      // ADR-030: If initiative didn't handle it, try social mode
      if (!initiativeHandled) {
        await this.socialHandler.evaluateSocial(message, chatId, senderLabel);
      }
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
    this.recordBotReplyToGroupMessages(payload);

    // ADR-030: Decay social energy on any bot reply
    this.socialHandler.decayEnergy(payload.chatId);

    // ADR-030 Tier 1.2: Mark delegation as active for this chat
    this.delegationActive.add(payload.chatId);
    try {
      await this.delegationHandler.processDelegation(payload);
    } finally {
      this.delegationActive.delete(payload.chatId);
    }

    // ADR-030: Bot-to-bot social chaining
    // After a bot replies, let other bots evaluate if they want to socially respond.
    // Energy decay + cooldown + maxConsecutiveBotTurns prevent infinite loops.
    if (!this.delegationActive.has(payload.chatId)) {
      const botInfo = this.getBotInfo(payload.agentId);
      const botLabel = botInfo ? `@${botInfo.username}` : payload.agentId;

      const syntheticMessage: import('../adapters/types.js').UnifiedMessage = {
        id: `bot-social-${Date.now()}-${payload.agentId}`,
        platform: payload.platform,
        userId: payload.agentId,
        chatId: payload.chatId,
        text: payload.response,
        timestamp: new Date(),
        metadata: { isGroupChat: true },
      };

      await this.socialHandler.evaluateSocial(syntheticMessage, payload.chatId, botLabel);
    }
  }

  /**
   * Record bot reply to group_messages table for context injection.
   * ADR-019: No broadcast to other sessions - context is shared via group_messages.
   */
  private recordBotReplyToGroupMessages(payload: BotRepliedPayload): void {
    const { chatId, agentId, response, platform, replyMessageId } = payload;

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
    this.processedMessages.clear();
    this.initiativeHandler.dispose();
    this.socialHandler.dispose();
    this.log.info('GroupBroadcaster disposed');
  }
}
