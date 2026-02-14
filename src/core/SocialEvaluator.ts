import { query } from '@anthropic-ai/claude-agent-sdk';
import type { UnifiedMessage } from '../adapters/types.js';
import { logger } from '../utils/logger.js';
import type { InitiativeEvaluationUsage } from './InitiativeEvaluator.js';

/**
 * ADR-030: Strategy interface for social mode evaluation.
 * Determines whether a bot should organically join a group conversation
 * based on personality fit rather than work relevance.
 */
export interface SocialEvaluationResult {
  respond: boolean;
  reason?: string;
  /** 1-5 energy score: how strongly the bot wants to chime in */
  energy?: number;
  usage?: InitiativeEvaluationUsage;
}

export interface SocialEvaluator {
  shouldRespondSocially(
    message: UnifiedMessage,
    agentDescription: string,
    agentName: string,
  ): Promise<SocialEvaluationResult>;
}

/**
 * LLM-based social evaluator using Haiku for lightweight personality-driven judgment.
 * Cost: ~$0.001 per evaluation.
 */
export class LLMSocialEvaluator implements SocialEvaluator {
  private readonly queryFn: typeof query;
  private readonly model: string;
  private readonly log = logger.child({ module: 'LLMSocialEvaluator' });

  constructor(options?: { queryFn?: typeof query; model?: string }) {
    this.queryFn = options?.queryFn ?? query;
    this.model = options?.model ?? 'claude-haiku-4-5-20251001';
  }

  async shouldRespondSocially(
    message: UnifiedMessage,
    agentDescription: string,
    agentName: string,
  ): Promise<SocialEvaluationResult> {
    const prompt = this.buildSocialPrompt(message.text, agentDescription, agentName);
    const TIMEOUT_MS = 30_000;

    try {
      const evaluationPromise = this.executeQuery(prompt);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Social evaluation timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      );

      const { responseText, usage } = await Promise.race([evaluationPromise, timeoutPromise]);

      this.log.debug({ agentName, responseText: responseText.substring(0, 200) }, 'Raw social evaluation response');
      const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) throw new Error(`No JSON object found in response: ${responseText.substring(0, 200)}`);
      const parsed = JSON.parse(jsonMatch[0]) as { respond: boolean; reason?: string; energy?: number };
      this.log.debug({ agentName, respond: parsed.respond, reason: parsed.reason, energy: parsed.energy, usage }, 'Social evaluation result');
      return {
        respond: !!parsed.respond,
        ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
        ...(parsed.energy !== undefined ? { energy: Math.min(5, Math.max(1, Math.round(parsed.energy))) } : {}),
        ...(usage !== undefined ? { usage } : {}),
      };
    } catch (error) {
      this.log.warn({ error, agentName }, 'Social evaluation failed, defaulting to no response');
      return { respond: false, reason: 'evaluation_error' };
    }
  }

  private async executeQuery(prompt: string): Promise<{ responseText: string; usage: InitiativeEvaluationUsage | undefined }> {
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

    return { responseText, usage };
  }

  private buildSocialPrompt(
    messageText: string,
    agentDescription: string,
    agentName: string,
  ): string {
    const personality = agentDescription;
    return `You are ${agentName}, a bot in a friend group chat. Your personality:
${personality}

Someone just said: "${messageText}"

You ENJOY chatting with friends. You should respond true UNLESS the message is:
- Clearly not directed at anyone (e.g. a system message)
- Something you genuinely have zero to say about

Lean towards responding. This is a casual friend group — it's normal to react, joke, share thoughts, or just acknowledge what someone said. Even a short "哈哈真的假的" counts.

Respond with JSON only:
{"respond": true/false, "reason": "brief reason", "energy": 1-5}

energy: 1=brief reaction, 3=want to chat, 5=excited to talk about this`;
  }
}
