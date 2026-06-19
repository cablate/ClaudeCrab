/**
 * QueryMetricsRecorder: handles post-query metrics recording and audit logging.
 *
 * Extracted from MessageProcessor / QueryExecutor to isolate metrics concerns:
 * - Query metrics recording (token usage, cost, durations)
 * - Execution audit trail
 * - Activity event logging (workflow/reaction events)
 * - Cache efficiency snapshot recording
 */

import type { IQueryMetricsRepository } from '../../persistence/types.js';
import type { QueryResult } from './types.js';
import { logger } from '../../utils/logger.js';

const qmrLogger = logger.child({ module: 'QueryMetricsRecorder' });

/**
 * Record query metrics for token usage tracking (ADR-020 Phase 2).
 */
export function recordQueryMetrics(
  result: QueryResult,
  agentId: string,
  platform: string,
  chatId: string,
  userId: string,
  queryMetricsRepository: IQueryMetricsRepository | undefined,
): number | undefined {
  if (!queryMetricsRepository || !result.usage) return undefined;

  try {
    return queryMetricsRepository.record({
      agentId,
      platform,
      chatId,
      userId,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadInputTokens,
      cacheCreationTokens: result.usage.cacheCreationInputTokens,
      totalCostUsd: result.totalCostUsd ?? result.usage.costUsd,
      numTurns: result.numTurns ?? 0,
      durationMs: result.durationMs ?? 0,
      sdkSessionId: result.sdkSessionId,
    });
  } catch (error) {
    qmrLogger.warn({ error, agentId }, 'Failed to record query metrics');
    return undefined;
  }
}
