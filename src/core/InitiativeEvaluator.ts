import { query } from '@anthropic-ai/claude-agent-sdk';
import type { UnifiedMessage } from '../adapters/types.js';
import { logger } from '../utils/logger.js';

/**
 * ADR-023: Strategy interface for initiative evaluation.
 * Determines whether a bot should proactively respond to a group message
 * it was not @mentioned in.
 */
export interface InitiativeEvaluationUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  durationMs: number;
}

export interface InitiativeEvaluationResult {
  respond: boolean;
  reason?: string;
  usage?: InitiativeEvaluationUsage;
}

export interface InitiativeEvaluator {
  shouldRespond(
    message: UnifiedMessage,
    agentDescription: string,
    agentName: string,
  ): Promise<InitiativeEvaluationResult>;
}

/**
 * LLM-based evaluator using Haiku for lightweight semantic judgment.
 * Cost: ~$0.001 per evaluation.
 */
export class LLMInitiativeEvaluator implements InitiativeEvaluator {
  private readonly queryFn: typeof query;
  private readonly model: string;
  private readonly log = logger.child({ module: 'LLMInitiativeEvaluator' });

  constructor(options?: { queryFn?: typeof query; model?: string }) {
    this.queryFn = options?.queryFn ?? query;
    this.model = options?.model ?? 'claude-haiku-4-5-20251001';
  }

  async shouldRespond(
    message: UnifiedMessage,
    agentDescription: string,
    agentName: string,
  ): Promise<InitiativeEvaluationResult> {
    const prompt = this.buildWorkModePrompt(message.text, agentDescription, agentName);

    try {
      const q = this.queryFn({
        prompt,
        options: {
          model: this.model,
          maxTurns: 1,
          tools: [],
          persistSession: false,
          permissionMode: 'dontAsk',
        },
      });

      let responseText = '';
      let usage: InitiativeEvaluationUsage | undefined;
      for await (const msg of q) {
        if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            responseText = msg.result;
            // Extract usage from SDK result
            const resultMsg = msg as {
              duration_ms?: number;
              total_cost_usd?: number;
              usage?: { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number };
            };
            usage = {
              inputTokens: resultMsg.usage?.inputTokens ?? 0,
              outputTokens: resultMsg.usage?.outputTokens ?? 0,
              cacheReadTokens: resultMsg.usage?.cacheReadInputTokens ?? 0,
              cacheCreationTokens: resultMsg.usage?.cacheCreationInputTokens ?? 0,
              totalCostUsd: resultMsg.total_cost_usd ?? 0,
              durationMs: resultMsg.duration_ms ?? 0,
            };
          } else {
            throw new Error(`SDK query error: ${msg.subtype}`);
          }
          break;
        }
      }

      this.log.debug({ agentName, responseText: responseText.substring(0, 200) }, 'Raw evaluation response');
      // Strip markdown code block wrapper if present (e.g. ```json ... ```)
      const cleaned = responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned) as { respond: boolean; reason?: string };
      this.log.debug({ agentName, respond: parsed.respond, reason: parsed.reason, usage }, 'Evaluation result');
      return {
        respond: !!parsed.respond,
        ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
        ...(usage !== undefined ? { usage } : {}),
      };
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
    // Trim personality to avoid excessive token usage (soul.md can be long)
    const personality = agentDescription.length > 500
      ? agentDescription.substring(0, 500) + '...'
      : agentDescription;
    return `You are evaluating whether a bot should proactively respond to a group chat message.

Bot name: ${agentName}
Bot personality: ${personality}

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
