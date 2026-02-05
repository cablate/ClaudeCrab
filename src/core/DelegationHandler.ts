import type { MessageProcessor } from './MessageProcessor.js';
import type { BotRepliedPayload } from '../types/events.js';
import type { UnifiedMessage } from '../adapters/types.js';
import { logger } from '../utils/logger.js';

/** Maximum delegation depth to prevent infinite loops (ADR-021) */
const MAX_DELEGATION_DEPTH = 3;

/**
 * Options for DelegationHandler (ADR-021/022)
 */
export interface DelegationHandlerOptions {
  messageProcessor: MessageProcessor;
  getGroupMembers: (chatId: string) => string[];
  getBotInfo: (agentId: string) => { username: string; id: number } | null;
  getDelegationSettings?: (agentId: string) => { inbound?: boolean; outbound?: boolean } | undefined;
}

/**
 * Handles auto-delegation when a bot @mentions another bot in its reply (ADR-021/022).
 *
 * Extracted from GroupBroadcaster to isolate delegation-specific logic:
 * target detection, cycle prevention, depth limiting.
 * Stateless — no dispose needed.
 */
export class DelegationHandler {
  private readonly log = logger.child({ module: 'DelegationHandler' });
  private readonly messageProcessor: MessageProcessor;
  private readonly getGroupMembers: (chatId: string) => string[];
  private readonly getBotInfo: (agentId: string) => { username: string; id: number } | null;
  private readonly getDelegationSettings: ((agentId: string) => { inbound?: boolean; outbound?: boolean } | undefined) | undefined;

  constructor(options: DelegationHandlerOptions) {
    this.messageProcessor = options.messageProcessor;
    this.getGroupMembers = options.getGroupMembers;
    this.getBotInfo = options.getBotInfo;
    this.getDelegationSettings = options.getDelegationSettings;
  }

  /**
   * Process a bot reply for potential delegation to @mentioned bots.
   */
  async processDelegation(payload: BotRepliedPayload): Promise<void> {
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
   * Detect @mentioned bots in the response text that are valid delegation targets.
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
   * Execute delegation to a specific target bot.
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
}
