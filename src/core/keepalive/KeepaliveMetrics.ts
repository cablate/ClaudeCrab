import type { IQueryMetricsRepository } from '../../persistence/types.js';
import { calculatePingROI } from '../../services/KeepaliveROIService.js';
import { EventType } from '../../utils/events.js';
import { logger } from '../../utils/logger.js';
import type { KeepaliveUsageDelta } from './KeepaliveAudit.js';

export function recordKeepaliveMetrics(params: {
  sessionId: string;
  sdkSessionId: string;
  usage: KeepaliveUsageDelta;
  repository: IQueryMetricsRepository | undefined;
}): void {
  const { sessionId, sdkSessionId, usage, repository } = params;
  if (!repository) return;

  try {
    repository.record({
      agentId: 'system',
      platform: 'keepalive',
      chatId: sessionId,
      userId: 'system',
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: 0,
      cacheReadTokens: usage.cacheReadInputTokens ?? 0,
      cacheCreationTokens: usage.cacheCreationInputTokens ?? 0,
      totalCostUsd: 0,
      numTurns: 1,
      durationMs: 0,
      turnType: 'keepalive',
      sdkSessionId,
    });
  } catch (err) {
    logger.warn({ sessionId, err }, 'Failed to record keepalive metrics');
  }
}

export function logKeepaliveROI(params: {
  sessionId: string;
  usage: KeepaliveUsageDelta;
  modelId: string | undefined;
}): void {
  const { sessionId, usage, modelId } = params;
  const roi = calculatePingROI({
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: 0,
    cacheReadTokens: usage.cacheReadInputTokens ?? 0,
    cacheCreationTokens: usage.cacheCreationInputTokens ?? 0,
    totalCostUsd: 0,
  }, modelId ?? 'claude-opus-4');

  if (roi.savings !== 0) {
    logger.info(
      { sessionId, event_type: EventType.CACHE_KEEPALIVE_PING, ...roi },
      `Keepalive ROI: saved $${roi.savings.toFixed(6)} (ratio: ${roi.roiRatio?.toFixed(2) ?? 'N/A'})`
    );
  }
}
