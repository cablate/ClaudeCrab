import type { MessageProcessor } from './MessageProcessor.js';
import type { IQueryMetricsRepository } from '../persistence/types.js';
import type { UnifiedMessage } from '../adapters/types.js';
import type { InitiativeSettings } from '../types/agent.js';
import type { InitiativeEvaluator } from './InitiativeEvaluator.js';
import { logger } from '../utils/logger.js';

/**
 * Options for InitiativeHandler (ADR-023)
 */
export interface InitiativeHandlerOptions {
  messageProcessor: MessageProcessor;
  getGroupMembers: (chatId: string) => string[];
  getInitiativeSettings?: (agentId: string) => InitiativeSettings | undefined;
  getAgentDescription?: (agentId: string) => { name: string; description?: string } | undefined;
  initiativeEvaluator?: InitiativeEvaluator;
  queryMetricsRepository?: IQueryMetricsRepository;
}

/**
 * Handles bot initiative evaluation and execution (ADR-023).
 *
 * Extracted from GroupBroadcaster to isolate initiative-specific logic:
 * gate/throttle checks, LLM evaluation, cooldown tracking.
 */
export class InitiativeHandler {
  private readonly log = logger.child({ module: 'InitiativeHandler' });
  private readonly messageProcessor: MessageProcessor;
  private readonly getGroupMembers: (chatId: string) => string[];
  private readonly getInitiativeSettings: ((agentId: string) => InitiativeSettings | undefined) | undefined;
  private readonly getAgentDescription: ((agentId: string) => { name: string; description?: string } | undefined) | undefined;
  private readonly initiativeEvaluator: InitiativeEvaluator | undefined;
  private readonly queryMetricsRepository: IQueryMetricsRepository | undefined;

  /** Per-bot cooldown timestamps: `${chatId}:${agentId}` → lastTriggerMs */
  private readonly cooldowns = new Map<string, number>();

  /** Per-bot hourly counters: `${chatId}:${agentId}` → { count, resetAt } */
  private readonly hourlyCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(options: InitiativeHandlerOptions) {
    this.messageProcessor = options.messageProcessor;
    this.getGroupMembers = options.getGroupMembers;
    this.getInitiativeSettings = options.getInitiativeSettings;
    this.getAgentDescription = options.getAgentDescription;
    this.initiativeEvaluator = options.initiativeEvaluator;
    this.queryMetricsRepository = options.queryMetricsRepository;
  }

  /**
   * Evaluate which bots should proactively respond to a message.
   * Pipeline: Gate → Throttle → LLM Evaluation → Execute
   */
  async evaluateInitiatives(
    message: UnifiedMessage,
    chatId: string,
    senderLabel: string,
  ): Promise<void> {
    const evaluator = this.initiativeEvaluator;
    if (!evaluator) {
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
      const lastTime = this.cooldowns.get(cooldownKey);
      if (lastTime !== undefined && (Date.now() - lastTime) < cooldownMs) {
        this.log.debug({ agentId, chatId }, 'Initiative on cooldown');
        continue;
      }

      // Throttle: maxPerHour
      const maxPerHour = settings.maxPerHour ?? 5;
      const now = Date.now();
      let counter = this.hourlyCounters.get(cooldownKey);
      if (!counter || now >= counter.resetAt) {
        counter = { count: 0, resetAt: now + 3_600_000 };
        this.hourlyCounters.set(cooldownKey, counter);
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
        const result = await evaluator.shouldRespond(message, description, name);
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
      this.cooldowns.set(cooldownKey, Date.now());
      const counter = this.hourlyCounters.get(cooldownKey);
      if (counter) counter.count++;

      this.log.info(
        { agentId, chatId, reason },
        'Initiative evaluation passed, executing response (ADR-023)'
      );

      await this.executeInitiative(agentId, message, chatId, senderLabel, reason);
    }
  }

  /**
   * Execute an initiative response for a specific bot.
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
   * Clear all internal state (cooldowns, counters).
   */
  dispose(): void {
    this.cooldowns.clear();
    this.hourlyCounters.clear();
  }
}
