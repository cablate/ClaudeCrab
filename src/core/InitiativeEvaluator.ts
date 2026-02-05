import Anthropic from '@anthropic-ai/sdk';
import type { UnifiedMessage } from '../adapters/types.js';
import { logger } from '../utils/logger.js';

/**
 * ADR-023: Strategy interface for initiative evaluation.
 * Determines whether a bot should proactively respond to a group message
 * it was not @mentioned in.
 */
export interface InitiativeEvaluator {
  shouldRespond(
    message: UnifiedMessage,
    agentDescription: string,
    agentName: string,
  ): Promise<{ respond: boolean; reason?: string }>;
}

/**
 * LLM-based evaluator using Haiku for lightweight semantic judgment.
 * Cost: ~$0.001 per evaluation.
 */
export class LLMInitiativeEvaluator implements InitiativeEvaluator {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly log = logger.child({ module: 'LLMInitiativeEvaluator' });

  constructor(options?: { client?: Anthropic; model?: string }) {
    this.client = options?.client ?? new Anthropic();
    this.model = options?.model ?? 'claude-haiku-4-20250514';
  }

  async shouldRespond(
    message: UnifiedMessage,
    agentDescription: string,
    agentName: string,
  ): Promise<{ respond: boolean; reason?: string }> {
    const prompt = this.buildWorkModePrompt(message.text, agentDescription, agentName);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const parsed = JSON.parse(text) as { respond: boolean; reason?: string };
      this.log.debug({ agentName, respond: parsed.respond, reason: parsed.reason }, 'Evaluation result');
      return { respond: !!parsed.respond, ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}) };
    } catch (error) {
      this.log.warn({ error, agentName }, 'Initiative evaluation failed, defaulting to no response');
      return { respond: false, reason: 'evaluation_error' };
    }
  }

  private buildWorkModePrompt(
    messageText: string,
    agentDescription: string,
    agentName: string,
  ): string {
    return `You are evaluating whether a bot should proactively respond to a group chat message.

Bot name: ${agentName}
Bot role: ${agentDescription}

Group message: "${messageText}"

Rules for "work" mode:
- ONLY respond true if the message is DIRECTLY relevant to this bot's professional domain/expertise
- Do NOT respond to casual chat, greetings, or off-topic messages
- The message must contain a clear work-related topic that matches the bot's role
- When in doubt, respond false

Respond with JSON only, no other text:
{"respond": true, "reason": "brief reason"}
or
{"respond": false, "reason": "brief reason"}`;
  }
}

/**
 * Always-respond evaluator for testing/debug purposes.
 */
export class AlwaysRespondEvaluator implements InitiativeEvaluator {
  async shouldRespond(): Promise<{ respond: boolean; reason?: string }> {
    return { respond: true, reason: 'always_respond_evaluator' };
  }
}
