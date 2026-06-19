import type { QueryUsage } from '../query/types.js';
import type { ManagedSession } from '../session/SDKSessionTypes.js';
import type { CacheKeepaliveConfig } from '../../config.js';
import { DEFAULT_CACHE_KEEPALIVE_CONFIG } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';

export function updateCacheEfficiency(
  sessionId: string,
  managed: ManagedSession,
  usage: QueryUsage,
  config: CacheKeepaliveConfig = DEFAULT_CACHE_KEEPALIVE_CONFIG,
): void {
  const totalInput =
    (usage.inputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0);
  if (totalInput === 0) return;

  if ((usage.cacheReadInputTokens ?? 0) > 0 || (usage.cacheCreationInputTokens ?? 0) > 0) {
    managed.lastCacheTouchAt = Date.now();
  }

  if (!managed.isKeepalivePing) {
    managed.needsCacheWarmup = true;
  }

  const efficiency = Math.round(((usage.cacheReadInputTokens ?? 0) / totalInput) * 100);
  const prev = managed.cacheEfficiencyAvg ?? efficiency;
  managed.cacheEfficiencyAvg = Math.round(prev * 0.7 + efficiency * 0.3);

  if (managed.messageCount > 2 && managed.cacheEfficiencyAvg < config.efficiencyWarnThreshold) {
    logger.warn(
      {
        event_type: EventType.CACHE_EFFICIENCY_WARN,
        sessionId,
        currentEfficiency: efficiency,
        rollingAvg: managed.cacheEfficiencyAvg,
        messageCount: managed.messageCount,
        threshold: config.efficiencyWarnThreshold,
      },
      `Cache efficiency below ${config.efficiencyWarnThreshold}%; possible cache bust issue`,
    );
  }

  if (managed.messageCount === 2 || managed.messageCount % 10 === 0) {
    logger.info(
      {
        event_type: EventType.CACHE_EFFICIENCY_SNAPSHOT,
        sessionId,
        messageCount: managed.messageCount,
        currentEfficiency: efficiency,
        rollingAvg: managed.cacheEfficiencyAvg,
        cacheReadTokens: usage.cacheReadInputTokens,
        cacheCreationTokens: usage.cacheCreationInputTokens,
        inputTokens: usage.inputTokens,
      },
      'Cache efficiency snapshot',
    );
  }
}
