/**
 * KeepaliveROIService — Calculates cache keepalive cost vs. benefit.
 *
 * The keepalive ping costs a small amount of tokens but prevents cache rebuild
 * on the next query (which costs 125% of the full context in cache_creation tokens).
 * ROI is the ratio of savings to actual ping cost.
 */

import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'KeepaliveROIService' });

/**
 * Per-million-token pricing for each model family.
 */
const MODEL_PRICING: Record<string, {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheCreationPerM: number;
}> = {
  'claude-opus-4': { inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.50, cacheCreationPerM: 6.25 },
  'claude-sonnet-4': { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.30, cacheCreationPerM: 3.75 },
  'claude-haiku-4': { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.10, cacheCreationPerM: 1.25 },
  // DeepSeek pricing: cache_creation == cache miss input (no premium tier like Claude).
  'deepseek-v4-flash': { inputPerM: 0.27, outputPerM: 1.10, cacheReadPerM: 0.07, cacheCreationPerM: 0.27 },
  'deepseek': { inputPerM: 0.27, outputPerM: 1.10, cacheReadPerM: 0.07, cacheCreationPerM: 0.27 },
};

interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheCreationPerM: number;
}

interface KeepaliveUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
}

interface PingROIResult {
  actualCost: number;
  hypotheticalNoCacheCost: number;
  savings: number;
  roiRatio: number | null;
}

/**
 * Resolve pricing for a model ID using prefix matching.
 * Falls back to claude-opus-4 pricing + logs a warning.
 */
function resolvePricing(modelId: string): ModelPricing {
  const lc = (modelId ?? '').toLowerCase();
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (lc.includes(key)) return pricing;
  }
  log.warn(
    { modelId },
    'KeepaliveROIService: unknown model, falling back to claude-opus-4 pricing'
  );
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- fallback guaranteed in map
  return MODEL_PRICING['claude-opus-4']!;
}

/**
 * Calculate keepalive ROI for a single ping.
 *
 * @param usage - Token usage from the keepalive ping
 * @param modelId - Model ID used during the session
 */
export function calculatePingROI(usage: KeepaliveUsage, modelId: string): PingROIResult {
  const pricing = resolvePricing(modelId);

  // Actual cost of the ping (what we paid)
  const actualCost = usage.totalCostUsd;

  // Hypothetical cost: if cache had expired, the next query would pay full cache_creation
  // for all the tokens currently served as cache_read.
  // We use the sum of cacheReadTokens (the tokens we're "protecting" with the ping) as the
  // hypothetical re-creation cost denominator.
  const cacheReadM = (usage.cacheReadTokens ?? 0) / 1_000_000;
  const hypotheticalNoCacheCost = cacheReadM * pricing.cacheCreationPerM;

  const savings = hypotheticalNoCacheCost - actualCost;
  const roiRatio = actualCost === 0 ? null : savings / actualCost;

  return {
    actualCost,
    hypotheticalNoCacheCost,
    savings,
    roiRatio,
  };
}
