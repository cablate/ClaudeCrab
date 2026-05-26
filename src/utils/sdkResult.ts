/**
 * Classifier for SDKResultMessage stream endings (stateless callers).
 *
 * Stateless SDK callers (evaluators, reaction generator) all need to read the
 * `type: 'result'` terminator and branch on `subtype`. Historically they did
 * `if (subtype === 'success') …else throw`, which:
 *   - loses structured context (error list, usage),
 *   - treats business-level limits (max_turns, budget) as SDK crashes,
 *   - breaks silently when new subtypes land (SDK 0.2.119 added
 *     error_max_structured_output_retries).
 *
 * This module centralises the branch. Callers get a discriminated union and
 * decide policy (usually: fall back to "no response" + log).
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { EventType } from './events.js';

type ResultMessage = Extract<SDKMessage, { type: 'result' }>;

export interface SdkResultUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  durationMs: number;
}

/**
 * limit-exceeded → business-level stop (max_turns, budget, structured-output retries).
 *                  Caller should fall back gracefully; not a bug.
 * sdk-error      → error_during_execution; real runtime error from the SDK.
 * unknown-subtype→ SDK introduced a subtype we haven't mapped. Fall back + warn.
 */
export type SdkResultOutcome =
  | { ok: true; responseText: string; usage: SdkResultUsage }
  | {
      ok: false;
      kind: 'limit-exceeded' | 'sdk-error' | 'unknown-subtype';
      subtype: string;
      errors: string[];
      usage: SdkResultUsage;
    };

interface MinimalLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

const LIMIT_SUBTYPES = new Set([
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries',
]);

export function classifySdkResult(msg: ResultMessage, log?: MinimalLogger): SdkResultOutcome {
  const anyMsg = msg as unknown as {
    subtype: string;
    result?: string;
    duration_ms?: number;
    total_cost_usd?: number;
    errors?: string[];
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    };
  };

  const usage: SdkResultUsage = {
    inputTokens: anyMsg.usage?.inputTokens ?? 0,
    outputTokens: anyMsg.usage?.outputTokens ?? 0,
    cacheReadTokens: anyMsg.usage?.cacheReadInputTokens ?? 0,
    cacheCreationTokens: anyMsg.usage?.cacheCreationInputTokens ?? 0,
    totalCostUsd: anyMsg.total_cost_usd ?? 0,
    durationMs: anyMsg.duration_ms ?? 0,
  };

  if (anyMsg.subtype === 'success') {
    return { ok: true, responseText: anyMsg.result ?? '', usage };
  }

  const errors = anyMsg.errors ?? [];

  if (LIMIT_SUBTYPES.has(anyMsg.subtype)) {
    log?.warn(
      { event_type: EventType.SDK_RESULT_NON_SUCCESS, kind: 'limit-exceeded', subtype: anyMsg.subtype, errors },
      'sdk.result limit reached',
    );
    return { ok: false, kind: 'limit-exceeded', subtype: anyMsg.subtype, errors, usage };
  }

  if (anyMsg.subtype === 'error_during_execution') {
    log?.warn(
      { event_type: EventType.SDK_RESULT_NON_SUCCESS, kind: 'sdk-error', subtype: anyMsg.subtype, errors },
      'sdk.result error during execution',
    );
    return { ok: false, kind: 'sdk-error', subtype: anyMsg.subtype, errors, usage };
  }

  log?.warn(
    { event_type: EventType.SDK_RESULT_NON_SUCCESS, kind: 'unknown-subtype', subtype: anyMsg.subtype, errors },
    'sdk.result unknown subtype (SDK version newer than our classifier)',
  );
  return { ok: false, kind: 'unknown-subtype', subtype: anyMsg.subtype, errors, usage };
}
