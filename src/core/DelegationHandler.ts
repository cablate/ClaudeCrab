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

    // ADR-030: Synthesis responses do not trigger delegation chains
    if (payload.isSynthesis === true) {
      this.log.debug(
        { chatId: payload.chatId, agentId: payload.agentId },
        'Skipping delegation for synthesis response (ADR-030)'
      );
      return;
    }

    // ADR-030: Social responses do not trigger delegation chains
    if (payload.isSocial === true) {
      this.log.debug(
        { chatId: payload.chatId, agentId: payload.agentId },
        'Skipping delegation for social response (ADR-030)'
      );
      return;
    }

    const { chatId, agentId, response } = payload;

    const depth = payload.delegationDepth ?? 0;

    // ADR-030 Tier 1.1: Delegation responses do not trigger further delegations.
    // Bots responding to a delegation (depth > 0) are "submitting work", not dispatching.
    // Sub-delegation will be re-enabled in Tier 2 via structured task list.
    if (depth > 0) {
      this.log.debug(
        { chatId, agentId, depth },
        'Skipping delegation scan for delegation response (ADR-030 Tier 1.1)'
      );
      return;
    }

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

    if (targets.length <= 1) {
      // Single target: existing serial path (no synthesis overhead)
      for (const target of targets) {
        const newChain = [...chain, target];
        this.log.info(
          { chatId, from: agentId, to: target, depth: depth + 1, chain: newChain, totalTargets: targets.length },
          'Auto-delegating to mentioned bot (ADR-021/022)'
        );
        await this.executeDelegation(target, payload, newChain);
      }
    } else {
      // ADR-030: Multiple targets → parallel execution + synthesis
      await this.executeParallelDelegation(targets, payload, chain);
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
   * ADR-030: Execute multiple delegations in parallel and synthesize results.
   * The coordinator (payload.agentId) will receive a synthesis prompt after all delegations complete.
   */
  private async executeParallelDelegation(
    targets: string[],
    payload: BotRepliedPayload,
    chain: string[]
  ): Promise<void> {
    const { chatId, agentId } = payload;
    const depth = payload.delegationDepth ?? 0;

    this.log.info(
      { chatId, coordinator: agentId, targets, depth },
      'Starting parallel delegation (ADR-030)'
    );

    // Launch all delegations in parallel
    const delegationPromises = targets.map(target => {
      const newChain = [...chain, target];
      this.log.info(
        { chatId, from: agentId, to: target, depth: depth + 1, chain: newChain, totalTargets: targets.length },
        'Auto-delegating to mentioned bot in parallel (ADR-030)'
      );
      return this.executeDelegation(target, payload, newChain);
    });

    const results = await Promise.allSettled(delegationPromises);

    // Collect results
    const delegationResults: Array<{ agentId: string; response?: string; success: boolean }> = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        delegationResults.push(result.value);
      } else {
        // Promise.allSettled shouldn't reject (executeDelegation catches errors),
        // but handle gracefully
        delegationResults.push({ agentId: 'unknown', success: false });
      }
    }

    const successCount = delegationResults.filter(r => r.success).length;
    const failCount = delegationResults.filter(r => !r.success).length;

    this.log.info(
      { chatId, coordinator: agentId, successCount, failCount, total: targets.length },
      'Parallel delegations completed, preparing synthesis (ADR-030)'
    );

    // Skip synthesis if all delegations failed
    if (successCount === 0) {
      this.log.warn(
        { chatId, coordinator: agentId },
        'All parallel delegations failed, skipping synthesis (ADR-030)'
      );
      return;
    }

    // Build synthesis prompt
    const synthesisPrompt = this.buildSynthesisPrompt(delegationResults);

    // Send synthesis to coordinator
    const syntheticMessage: UnifiedMessage = {
      id: `synthesis-${Date.now()}-${agentId}`,
      platform: payload.platform,
      userId: payload.chatId,
      chatId: payload.chatId,
      text: synthesisPrompt,
      timestamp: new Date(),
      metadata: {
        isGroupChat: true,
        isSynthesis: true,
      },
    };

    try {
      await this.messageProcessor.processMessage(syntheticMessage, agentId, {
        isGroupChat: true,
        isSynthesis: true,
      });
    } catch (error) {
      this.log.error(
        { error, chatId, coordinator: agentId },
        'Synthesis message processing failed (ADR-030)'
      );
    }
  }

  /**
   * Build a synthesis prompt containing all delegation results for the coordinator.
   */
  private buildSynthesisPrompt(
    results: Array<{ agentId: string; response?: string; success: boolean }>
  ): string {
    const resultSections = results.map(r => {
      const botInfo = this.getBotInfo?.(r.agentId);
      const label = botInfo?.username ? `@${botInfo.username}` : r.agentId;
      if (r.success) {
        return `### ${label}\n${r.response || '（已完成處理）'}`;
      }
      return `### ${label}\n（未能完成回覆）`;
    });

    return [
      '以下是各位成員的回覆結果，請綜合整理後給出完整回覆：',
      '',
      ...resultSections,
    ].join('\n');
  }

  /**
   * Execute delegation to a specific target bot.
   */
  private async executeDelegation(
    targetAgentId: string,
    payload: BotRepliedPayload,
    newChain: string[]
  ): Promise<{ agentId: string; response?: string; success: boolean }> {
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
      const result = await this.messageProcessor.processMessage(syntheticMessage, targetAgentId, {
        isGroupChat: true,
        delegationDepth: newDepth,
        delegationChain: newChain,
      });
      return {
        agentId: targetAgentId,
        ...(result.response !== undefined ? { response: result.response } : {}),
        success: result.success,
      };
    } catch (error) {
      this.log.error(
        { error, chatId: payload.chatId, from: payload.agentId, to: targetAgentId, depth: newDepth },
        'Auto-delegation failed'
      );
      return { agentId: targetAgentId, success: false };
    }
  }
}
