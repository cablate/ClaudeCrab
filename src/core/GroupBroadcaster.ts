import { getEventBus } from './EventBus.js';
import type { MessageProcessor } from './MessageProcessor.js';
import type { GroupMessagePayload, BotRepliedPayload } from '../types/events.js';
import type {
  IGroupMessageRepository,
  IInjectionStateRepository,
  IGroupMemberRepository,
  IQueryMetricsRepository,
} from '../persistence/types.js';
import type { UnifiedMessage } from '../adapters/types.js';
import type { InitiativeSettings } from '../types/agent.js';
import type { InitiativeEvaluator } from './InitiativeEvaluator.js';
import { logger } from '../utils/logger.js';
import { formatUserLabel, formatBotLabel } from '../utils/format.js';
import { DedupTracker } from '../utils/DedupTracker.js';

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

  /** ADR-022: Get agent delegation settings */
  private readonly getDelegationSettings: ((agentId: string) => { inbound?: boolean; outbound?: boolean } | undefined) | undefined;

  /** ADR-023: Get agent initiative settings */
  private readonly getInitiativeSettings: ((agentId: string) => InitiativeSettings | undefined) | undefined;

  /** ADR-023: Get agent description for initiative evaluation */
  private readonly getAgentDescription: ((agentId: string) => { name: string; description?: string } | undefined) | undefined;

  /** ADR-023: Initiative evaluator */
  private readonly initiativeEvaluator: InitiativeEvaluator | undefined;

  /** Query metrics repository for recording initiative evaluation costs */
  private readonly queryMetricsRepository: IQueryMetricsRepository | undefined;

  /** ADR-023: Cooldown timestamps per group per bot (key: `${chatId}:${agentId}` → timestamp) */
  private readonly initiativeCooldowns = new Map<string, number>();

  /** ADR-023: Hourly counter per group per bot */
  private readonly initiativeHourlyCounters = new Map<string, { count: number; resetAt: number }>();

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
    this.getDelegationSettings = options.getDelegationSettings;
    this.getInitiativeSettings = options.getInitiativeSettings;
    this.getAgentDescription = options.getAgentDescription;
    this.initiativeEvaluator = options.initiativeEvaluator;
    this.queryMetricsRepository = options.queryMetricsRepository;

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

    // Determine which bot should respond (ADR-019: only one bot processes)
    const respondingBot = this.getRespondingBot(chatId, mentionedBot, isReplyToBot, sourceAgentId);

    if (respondingBot === null) {
      this.log.debug(
        { chatId, mentionedBot, isReplyToBot, sourceAgentId },
        'No bot should respond to this message'
      );
      // ADR-023: Evaluate initiative responses for non-@mentioned messages
      await this.evaluateInitiatives(message, chatId, senderLabel);
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
    await this.processDelegation(payload);
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
   * Process auto-delegation when bot reply mentions other bots.
   * ADR-021 + ADR-022: Multi-target delegation with cycle prevention and configurable settings.
   */
  private async processDelegation(payload: BotRepliedPayload): Promise<void> {
    // ADR-023: Initiative responses do not trigger delegation chains
    if (payload.isInitiative === true) {
      this.log.debug(
        { chatId: payload.chatId, agentId: payload.agentId },
        'Skipping delegation for initiative response (ADR-023)'
      );
      return;
    }

    const { chatId, agentId, response } = payload;

    const depth = payload.delegationDepth ?? 0;
    if (depth >= MAX_DELEGATION_DEPTH) {
      this.log.debug(
        { chatId, agentId, depth },
        'Max delegation depth reached, skipping auto-delegation'
      );
      return;
    }

    const chain = payload.delegationChain ?? [agentId];

    // ADR-022: Check outbound setting for sender
    const senderDelegationSettings = this.getDelegationSettings?.(agentId);
    if (senderDelegationSettings?.outbound === false) {
      this.log.info(
        { chatId, agentId },
        'Sender has delegation.outbound=false, skipping delegation detection (ADR-022)'
      );
      return;
    }

    // ADR-022: Detect all @mentioned bots (multi-delegation)
    const targets = this.detectDelegationTargets(response, chatId, agentId, chain);
    for (const target of targets) {
      const newChain = [...chain, target];
      this.log.info(
        { chatId, from: agentId, to: target, depth: depth + 1, chain: newChain, totalTargets: targets.length },
        'Auto-delegating to mentioned bot (ADR-021/022)'
      );
      await this.executeDelegation(target, payload, newChain);
    }
  }

  /**
   * ADR-021/022: Detect if a bot's reply @mentions other bots in the group.
   * Returns all matching agentIds (ADR-022: multi-delegation support).
   */
  private detectDelegationTargets(
    response: string,
    chatId: string,
    senderAgentId: string,
    delegationChain: string[]
  ): string[] {
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
      return [];
    }

    // Get sender's username to filter out self-mentions
    const senderInfo = this.getBotInfo(senderAgentId);
    const senderUsername = senderInfo?.username?.toLowerCase();

    const members = this.getGroupMembers(chatId);
    const targets: string[] = [];

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

        // Skip bots already collected as targets (avoid duplicates)
        if (targets.includes(agentId)) {
          continue;
        }

        // ADR-022: Check acceptDelegation setting
        const delegationSettings = this.getDelegationSettings?.(agentId);
        if (delegationSettings?.inbound === false) {
          this.log.info(
            { agentId, mention },
            'Skipping delegation target - delegation.inbound is false (ADR-022)'
          );
          continue;
        }

        const botInfo = this.getBotInfo(agentId);
        if (botInfo && mentionLower === botInfo.username.toLowerCase()) {
          targets.push(agentId);
        }
      }
    }

    return targets;
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

  // ─── ADR-023: Initiative Pipeline ───────────────────────────────────────

  /**
   * ADR-023: Evaluate initiative responses for all eligible bots.
   * Called when no bot was @mentioned or replied-to.
   *
   * Pipeline: Gate → Throttle → Evaluate (Haiku) → Execute
   */
  private async evaluateInitiatives(
    message: UnifiedMessage,
    chatId: string,
    senderLabel: string,
  ): Promise<void> {
    if (!this.initiativeEvaluator) {
      this.log.debug({ chatId }, 'No initiative evaluator configured');
      return;
    }

    const members = this.getGroupMembers(chatId);
    if (members.length === 0) {
      this.log.debug({ chatId }, 'No group members for initiative evaluation');
      return;
    }

    // Collect bots that pass Gate + Throttle (before expensive AI evaluation)
    const eligible: Array<{ agentId: string; name: string; description: string }> = [];

    for (const agentId of members) {
      const settings = this.getInitiativeSettings?.(agentId);

      // Gate: must be explicitly enabled (opt-in)
      if (!settings?.enabled) continue;

      // Gate: v1 only supports work mode
      if (settings.mode !== undefined && settings.mode !== 'work') {
        this.log.debug({ agentId, mode: settings.mode }, 'Initiative mode not "work", skipping (v1)');
        continue;
      }

      // Gate: must have description for evaluation
      const agentInfo = this.getAgentDescription?.(agentId);
      if (!agentInfo?.description) {
        this.log.debug({ agentId }, 'Agent has no description, skipping initiative');
        continue;
      }

      // Throttle: cooldown
      const cooldownKey = `${chatId}:${agentId}`;
      const cooldownMs = (settings.cooldown ?? 300) * 1000;
      const lastTime = this.initiativeCooldowns.get(cooldownKey);
      if (lastTime !== undefined && (Date.now() - lastTime) < cooldownMs) {
        this.log.debug({ agentId, chatId }, 'Initiative on cooldown');
        continue;
      }

      // Throttle: maxPerHour
      const maxPerHour = settings.maxPerHour ?? 5;
      const now = Date.now();
      let counter = this.initiativeHourlyCounters.get(cooldownKey);
      if (!counter || now >= counter.resetAt) {
        counter = { count: 0, resetAt: now + 3_600_000 };
        this.initiativeHourlyCounters.set(cooldownKey, counter);
      }
      if (counter.count >= maxPerHour) {
        this.log.debug({ agentId, chatId, count: counter.count, maxPerHour }, 'Initiative hourly limit reached');
        continue;
      }

      eligible.push({ agentId, name: agentInfo.name, description: agentInfo.description });
    }

    if (eligible.length === 0) {
      this.log.info({ chatId, memberCount: members.length }, 'Initiative: no eligible bots (all filtered by gate/throttle)');
      return;
    }

    this.log.info(
      { chatId, eligibleCount: eligible.length, eligible: eligible.map(e => e.agentId) },
      'Initiative: evaluating eligible bots (ADR-023)'
    );

    // Evaluate all eligible bots in parallel
    const results = await Promise.allSettled(
      eligible.map(async ({ agentId, name, description }) => {
        const result = await this.initiativeEvaluator!.shouldRespond(message, description, name);
        return { agentId, ...result };
      })
    );

    // Execute for all bots that passed evaluation
    for (const settled of results) {
      if (settled.status === 'rejected') {
        this.log.warn({ error: settled.reason }, 'Initiative evaluation rejected');
        continue;
      }
      const { agentId, respond, reason, usage } = settled.value;

      // Record evaluation cost regardless of outcome
      if (usage && this.queryMetricsRepository) {
        this.queryMetricsRepository.record({
          agentId,
          platform: message.platform,
          chatId,
          userId: message.userId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          totalCostUsd: usage.totalCostUsd,
          numTurns: 1,
          durationMs: usage.durationMs,
        });
      }

      if (!respond) {
        this.log.info({ agentId, reason }, 'Initiative: bot declined to respond');
        continue;
      }

      // Record cooldown and hourly count
      const cooldownKey = `${chatId}:${agentId}`;
      this.initiativeCooldowns.set(cooldownKey, Date.now());
      const counter = this.initiativeHourlyCounters.get(cooldownKey);
      if (counter) counter.count++;

      this.log.info(
        { agentId, chatId, reason },
        'Initiative evaluation passed, executing response (ADR-023)'
      );

      await this.executeInitiative(agentId, message, chatId, senderLabel, reason);
    }
  }

  /**
   * ADR-023: Execute initiative response by creating a synthetic message.
   * Reuses the delegation pattern but with initiative metadata.
   */
  private async executeInitiative(
    agentId: string,
    originalMessage: UnifiedMessage,
    chatId: string,
    senderLabel: string,
    reason?: string,
  ): Promise<void> {
    const syntheticMessage: UnifiedMessage = {
      id: `initiative-${Date.now()}-${agentId}`,
      platform: originalMessage.platform,
      userId: originalMessage.userId,
      chatId,
      text: `${senderLabel}: ${originalMessage.text}`,
      timestamp: new Date(),
      metadata: {
        isGroupChat: true,
        isInitiative: true,
        initiativeReason: reason,
      },
    };

    try {
      await this.messageProcessor.processMessage(syntheticMessage, agentId, {
        isGroupChat: true,
        isInitiative: true,
      });
    } catch (error) {
      this.log.error(
        { error, chatId, agentId },
        'Initiative response failed (ADR-023)'
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
    // ADR-023: Initiative state cleanup
    this.initiativeCooldowns.clear();
    this.initiativeHourlyCounters.clear();
    this.log.info('GroupBroadcaster disposed');
  }
}
