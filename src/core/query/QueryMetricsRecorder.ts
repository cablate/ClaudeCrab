/**
 * QueryMetricsRecorder ??Handles post-query metrics recording and audit logging.
 *
 * Extracted from MessageProcessor / QueryExecutor to isolate metrics concerns:
 * - Query metrics recording (token usage, cost, durations)
 * - Execution audit trail
 * - Activity event logging (workflow/reaction events)
 * - Cache efficiency snapshot recording
 */

import type { IQueryMetricsRepository } from '../../persistence/types.js';
import type { ExecutionRecordRepository } from '../../persistence/ExecutionRecordRepository.js';
import type { ActivityEventService } from '../../services/ActivityEventService.js';
import { SessionManager } from '../session/SessionManager.js';
import type { QueryResult } from './SDKQueryManager.js';
import { serializeContextUsageSnapshot } from '../keepalive/ContextUsageTelemetry.js';
import { logger } from '../../utils/logger.js';

const qmrLogger = logger.child({ module: 'QueryMetricsRecorder' });

export interface QueryMetricsRecorderDeps {
  sessionManager: SessionManager;
  queryMetricsRepository?: IQueryMetricsRepository;
  executionRecordRepository?: ExecutionRecordRepository;
  activityEventService?: ActivityEventService;
}

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
  sessionManager: SessionManager
): number | undefined {
  if (!queryMetricsRepository || !result.usage) return undefined;

  try {
    let deltaInput = result.usage.inputTokens;
    let deltaOutput = result.usage.outputTokens;
    let deltaCacheRead = result.usage.cacheReadInputTokens;
    let deltaCacheCreate = result.usage.cacheCreationInputTokens;
    let deltaCost = result.totalCostUsd ?? result.usage.costUsd;

    // V2 path: usage is already per-query delta (SDKSessionManager computed it).
    // V1 path (resume): SDK reports CUMULATIVE usage across the full conversation.
    //   ??compute delta from session's previous snapshot.
    if (result.isUsageDelta !== true) {
      const internalSession = sessionManager.getInternalSession(platform, agentId, userId);
      const prev = internalSession?.prevUsage;

      if (prev !== undefined) {
        deltaInput = Math.max(0, deltaInput - prev.inputTokens);
        deltaOutput = Math.max(0, deltaOutput - prev.outputTokens);
        deltaCacheRead = Math.max(0, deltaCacheRead - prev.cacheReadInputTokens);
        deltaCacheCreate = Math.max(0, deltaCacheCreate - prev.cacheCreationInputTokens);
        deltaCost = Math.max(0, deltaCost - prev.totalCostUsd);
      }

      // Update snapshot for next V1 query
      if (internalSession !== undefined) {
        internalSession.prevUsage = {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadInputTokens: result.usage.cacheReadInputTokens,
          cacheCreationInputTokens: result.usage.cacheCreationInputTokens,
          costUsd: result.usage.costUsd,
          totalCostUsd: result.totalCostUsd ?? result.usage.costUsd,
        };
      }
    }

    return queryMetricsRepository.record({
      agentId,
      platform,
      chatId,
      userId,
      inputTokens: deltaInput,
      outputTokens: deltaOutput,
      cacheReadTokens: deltaCacheRead,
      cacheCreationTokens: deltaCacheCreate,
      totalCostUsd: deltaCost,
      numTurns: result.numTurns ?? 0,
      durationMs: result.durationMs ?? 0,
      sdkSessionId: result.sdkSessionId,
      ...(result.contextUsage !== undefined ? {
        contextTotalTokens: result.contextUsage.totalTokens,
        contextMaxTokens: result.contextUsage.maxTokens,
        contextPercentage: result.contextUsage.percentage,
        contextModel: result.contextUsage.model,
        contextUsageJson: serializeContextUsageSnapshot(result.contextUsage),
      } : {}),
    });
  } catch (error) {
    qmrLogger.warn({ error, agentId }, 'Failed to record query metrics');
    return undefined;
  }
}

/**
 * Record execution audit entry for every SDK query.
 */
export function recordExecutionAudit(
  result: QueryResult,
  agentId: string,
  triggerType: 'chat' | 'schedule' | 'agent_call',
  triggerSource: string,
  _chatId: string | undefined,
  taskId: string | undefined,
  executionRecordRepository: ExecutionRecordRepository | undefined
): void {
  if (executionRecordRepository === undefined || result.usage === undefined) return;

  try {
    const costUsd = result.totalCostUsd ?? result.usage.costUsd ?? 0;
    executionRecordRepository.insert({
      agentId,
      triggerType,
      triggerSource,
      ...(taskId !== undefined ? { taskId } : {}),
      // promptSummary omitted ??optional field
      responseSummary: result.response?.slice(0, 200),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costCents: Math.round(costUsd * 100),
      durationMs: result.durationMs ?? 0,
      status: 'success',
    });
  } catch (error) {
    qmrLogger.warn({ error, agentId }, 'Failed to record execution audit');
  }
}
