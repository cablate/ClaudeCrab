import type { MessageProcessor } from './MessageProcessor.js';
import type { IQueryMetricsRepository } from '../persistence/types.js';
import type { UnifiedMessage } from '../adapters/types.js';
import type { SocialSettings } from '../types/agent.js';
import type { SocialEvaluator } from './SocialEvaluator.js';
import { logger } from '../utils/logger.js';
import { appendFileSync } from 'node:fs';

// Temporary debug log for social mode diagnosis
function socialDebug(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync('social-debug.log', line); } catch { /* ignore */ }
}

/** Default social settings */
const DEFAULTS = {
  energyThreshold: 3,
  cooldown: 600,       // seconds (longer than initiative's 300s)
  maxPerHour: 10,
  maxConsecutiveBotTurns: 3,
  initialEnergy: 5,
  energyDecay: 2,
} as const;

/**
 * Options for SocialHandler (ADR-030)
 */
export interface SocialHandlerOptions {
  messageProcessor: MessageProcessor;
  getGroupMembers: (chatId: string) => string[];
  getSocialSettings?: (agentId: string) => SocialSettings | undefined;
  getAgentDescription?: (agentId: string) => { name: string; description?: string } | undefined;
  socialEvaluator?: SocialEvaluator;
  queryMetricsRepository?: IQueryMetricsRepository;
}

/**
 * Handles bot social mode evaluation and execution (ADR-030).
 *
 * Social mode lets bots organically chime in to group conversations
 * based on personality fit, with energy decay to prevent bot-to-bot loops.
 */
export class SocialHandler {
  private readonly log = logger.child({ module: 'SocialHandler' });
  private readonly messageProcessor: MessageProcessor;
  private readonly getGroupMembers: (chatId: string) => string[];
  private readonly getSocialSettings: ((agentId: string) => SocialSettings | undefined) | undefined;
  private readonly getAgentDescription: ((agentId: string) => { name: string; description?: string } | undefined) | undefined;
  private readonly socialEvaluator: SocialEvaluator | undefined;
  private readonly queryMetricsRepository: IQueryMetricsRepository | undefined;

  /** Per-bot cooldown timestamps: `${chatId}:${agentId}` → lastTriggerMs */
  private readonly cooldowns = new Map<string, number>();

  /** Per-bot hourly counters: `${chatId}:${agentId}` → { count, resetAt } */
  private readonly hourlyCounters = new Map<string, { count: number; resetAt: number }>();

  /** Per-group social energy: chatId → energy (0-5) */
  private readonly groupEnergy = new Map<string, number>();

  /** Per-group consecutive bot turn counter: chatId → count */
  private readonly consecutiveBotTurns = new Map<string, number>();

  constructor(options: SocialHandlerOptions) {
    this.messageProcessor = options.messageProcessor;
    this.getGroupMembers = options.getGroupMembers;
    this.getSocialSettings = options.getSocialSettings;
    this.getAgentDescription = options.getAgentDescription;
    this.socialEvaluator = options.socialEvaluator;
    this.queryMetricsRepository = options.queryMetricsRepository;
  }

  /**
   * Called when a human message arrives — reset energy and consecutive bot turns.
   */
  resetEnergy(chatId: string): void {
    this.groupEnergy.set(chatId, DEFAULTS.initialEnergy);
    this.consecutiveBotTurns.set(chatId, 0);
  }

  /**
   * Called when any bot replies — decay energy and increment consecutive bot turns.
   */
  decayEnergy(chatId: string): void {
    const current = this.groupEnergy.get(chatId) ?? DEFAULTS.initialEnergy;
    this.groupEnergy.set(chatId, Math.max(0, current - DEFAULTS.energyDecay));
    this.consecutiveBotTurns.set(chatId, (this.consecutiveBotTurns.get(chatId) ?? 0) + 1);
  }

  /**
   * Evaluate which bot (if any) should socially respond to a message.
   * Pipeline: Gate → Throttle → LLM Evaluation → Pick highest energy → Execute
   *
   * @returns true if a bot responded, false otherwise
   */
  async evaluateSocial(
    message: UnifiedMessage,
    chatId: string,
    senderLabel: string,
  ): Promise<boolean> {
    socialDebug(`evaluateSocial called: chatId=${chatId}, sender=${senderLabel}, text=${message.text.substring(0, 80)}`);

    const evaluator = this.socialEvaluator;
    if (!evaluator) {
      socialDebug('BLOCKED: no social evaluator configured');
      return false;
    }

    // Energy gate: if group energy is depleted, skip all social evaluation
    const energy = this.groupEnergy.get(chatId) ?? DEFAULTS.initialEnergy;
    if (energy <= 0) {
      socialDebug(`BLOCKED: energy depleted (energy=${energy})`);
      return false;
    }

    const members = this.getGroupMembers(chatId);
    socialDebug(`energy=${energy}, consecutiveBotTurns=${this.consecutiveBotTurns.get(chatId) ?? 0}, members=${JSON.stringify(members)}`);
    if (members.length === 0) {
      socialDebug('BLOCKED: no members');
      return false;
    }

    // Collect bots that pass Gate + Throttle
    const eligible: Array<{ agentId: string; name: string; description: string; settings: SocialSettings }> = [];

    for (const agentId of members) {
      const settings = this.getSocialSettings?.(agentId);

      // Gate: must be explicitly enabled
      if (!settings?.enabled) continue;

      // Gate: consecutive bot turns limit
      const maxConsecutive = settings.maxConsecutiveBotTurns ?? DEFAULTS.maxConsecutiveBotTurns;
      const consecutive = this.consecutiveBotTurns.get(chatId) ?? 0;
      if (consecutive >= maxConsecutive) {
        this.log.debug({ agentId, chatId, consecutive, maxConsecutive }, 'Social: consecutive bot turns limit reached');
        continue;
      }

      // Gate: must have description
      const agentInfo = this.getAgentDescription?.(agentId);
      if (!agentInfo?.description) {
        this.log.debug({ agentId }, 'Agent has no description, skipping social');
        continue;
      }

      // Throttle: cooldown
      const cooldownKey = `${chatId}:${agentId}`;
      const cooldownMs = (settings.cooldown ?? DEFAULTS.cooldown) * 1000;
      const lastTime = this.cooldowns.get(cooldownKey);
      if (lastTime !== undefined && (Date.now() - lastTime) < cooldownMs) {
        this.log.debug({ agentId, chatId }, 'Social: on cooldown');
        continue;
      }

      // Throttle: maxPerHour
      const maxPerHour = settings.maxPerHour ?? DEFAULTS.maxPerHour;
      const now = Date.now();
      let counter = this.hourlyCounters.get(cooldownKey);
      if (!counter || now >= counter.resetAt) {
        counter = { count: 0, resetAt: now + 3_600_000 };
        this.hourlyCounters.set(cooldownKey, counter);
      }
      if (counter.count >= maxPerHour) {
        this.log.debug({ agentId, chatId, count: counter.count, maxPerHour }, 'Social: hourly limit reached');
        continue;
      }

      eligible.push({ agentId, name: agentInfo.name, description: agentInfo.description, settings });
    }

    if (eligible.length === 0) {
      socialDebug(`BLOCKED: no eligible bots (total members=${members.length})`);
      return false;
    }

    socialDebug(`eligible bots: ${eligible.map(e => e.agentId).join(', ')}`);

    this.log.info(
      { chatId, eligibleCount: eligible.length, eligible: eligible.map(e => e.agentId) },
      'Social: evaluating eligible bots (ADR-030)'
    );

    // Evaluate all eligible bots in parallel
    const results = await Promise.allSettled(
      eligible.map(async ({ agentId, name, description, settings }) => {
        const result = await evaluator.shouldRespondSocially(message, description, name);
        return { agentId, settings, ...result };
      })
    );

    // Filter: respond === true && energy >= threshold, then pick highest energy
    let best: { agentId: string; reason: string | undefined; energy: number } | undefined;

    for (const settled of results) {
      if (settled.status === 'rejected') {
        this.log.warn({ error: settled.reason }, 'Social evaluation rejected');
        continue;
      }
      const { agentId, respond, reason, energy: evalEnergy, usage, settings } = settled.value;

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
        socialDebug(`LLM DECLINED: ${agentId} reason=${reason}`);
        continue;
      }

      const threshold = settings.energyThreshold ?? DEFAULTS.energyThreshold;
      const botEnergy = evalEnergy ?? 1;
      socialDebug(`LLM PASSED: ${agentId} respond=true energy=${botEnergy} threshold=${threshold} reason=${reason}`);
      if (botEnergy < threshold) {
        socialDebug(`BLOCKED: ${agentId} energy(${botEnergy}) < threshold(${threshold})`);
        continue;
      }

      if (!best || botEnergy > best.energy) {
        best = { agentId, reason, energy: botEnergy };
      }
    }

    if (!best) {
      socialDebug('RESULT: no bot passed evaluation + threshold');
      return false;
    }

    socialDebug(`RESULT: winner=${best.agentId} energy=${best.energy} reason=${best.reason}`);

    // Record cooldown and hourly count for winner
    const cooldownKey = `${chatId}:${best.agentId}`;
    this.cooldowns.set(cooldownKey, Date.now());
    const counter = this.hourlyCounters.get(cooldownKey);
    if (counter) counter.count++;

    this.log.info(
      { agentId: best.agentId, chatId, reason: best.reason, energy: best.energy },
      'Social evaluation passed, executing response (ADR-030)'
    );

    await this.executeSocial(best.agentId, message, chatId, senderLabel, best.reason);
    return true;
  }

  /**
   * Execute a social response for a specific bot.
   */
  private async executeSocial(
    agentId: string,
    originalMessage: UnifiedMessage,
    chatId: string,
    senderLabel: string,
    reason?: string,
  ): Promise<void> {
    const syntheticMessage: UnifiedMessage = {
      id: `social-${Date.now()}-${agentId}`,
      platform: originalMessage.platform,
      userId: originalMessage.userId,
      chatId,
      text: `${senderLabel}: ${originalMessage.text}`,
      timestamp: new Date(),
      metadata: {
        isGroupChat: true,
        isSocial: true,
        socialReason: reason,
      },
    };

    try {
      await this.messageProcessor.processMessage(syntheticMessage, agentId, {
        isGroupChat: true,
        isSocial: true,
      });
    } catch (error) {
      this.log.error(
        { error, chatId, agentId },
        'Social response failed (ADR-030)'
      );
    }
  }

  /**
   * Clear all internal state.
   */
  dispose(): void {
    this.cooldowns.clear();
    this.hourlyCounters.clear();
    this.groupEnergy.clear();
    this.consecutiveBotTurns.clear();
  }
}
