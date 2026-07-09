import type { ManagedSession } from '../session/SDKSessionTypes.js';
import type { IQueryMetricsRepository } from '../../persistence/types.js';
import type { CacheKeepaliveConfig } from '../../config.js';
import { DEFAULT_CACHE_KEEPALIVE_CONFIG } from '../../config.js';
import {
  computeNextKeepaliveDelay,
  scheduleKeepalive,
  type KeepaliveContext,
} from './KeepaliveScheduler.js';
import { logger } from '../../utils/logger.js';

export { updateCacheEfficiency } from './KeepaliveCacheEfficiency.js';

export const CACHE_KEEPALIVE_INTERVAL_MS = DEFAULT_CACHE_KEEPALIVE_CONFIG.intervalMs;
export const CACHE_EFFICIENCY_WARN_THRESHOLD = DEFAULT_CACHE_KEEPALIVE_CONFIG.efficiencyWarnThreshold;
export const KEEPALIVE_ALERT_COOLDOWN_MS = DEFAULT_CACHE_KEEPALIVE_CONFIG.alertCooldownMs;

export function computeDetectedTTLKeepaliveIntervalMs(
  detectedTTLMs: number,
  config: CacheKeepaliveConfig = DEFAULT_CACHE_KEEPALIVE_CONFIG,
): number {
  return Math.max(config.minIntervalMs, Math.round(detectedTTLMs * config.detectedTTLRatio));
}

export function startKeepalive(
  sessionId: string,
  sessions: Map<string, ManagedSession>,
  isDisposed: () => boolean,
  queryMetricsRepository?: IQueryMetricsRepository,
  config: CacheKeepaliveConfig = DEFAULT_CACHE_KEEPALIVE_CONFIG,
): void {
  const managed = sessions.get(sessionId);
  if (!managed) return;

  if (managed.keepaliveTimer) {
    clearTimeout(managed.keepaliveTimer);
  }

  if (config.enabled === false) {
    logger.info({ sessionId, event_type: 'sdk.keepalive_disabled' }, 'Cache keepalive disabled (CACHE_KEEPALIVE_ENABLED=false)');
    return;
  }

  if (config.intervalMs <= 0) {
    logger.info({ sessionId }, 'Cache keepalive disabled (CACHE_KEEPALIVE_INTERVAL_MS=0)');
    return;
  }

  managed.currentKeepaliveIntervalMs = config.intervalMs;
  scheduleKeepalive(
    buildKeepaliveContext(sessionId, sessions, isDisposed, queryMetricsRepository, config.intervalMs, config.skipRecentMs, config),
    computeNextKeepaliveDelay(managed, config.intervalMs, config),
  );
}

export function adjustKeepaliveInterval(
  sessionId: string,
  sessions: Map<string, ManagedSession>,
  detectedTTLMs: number,
  isDisposed: () => boolean,
  queryMetricsRepository?: IQueryMetricsRepository,
  config: CacheKeepaliveConfig = DEFAULT_CACHE_KEEPALIVE_CONFIG,
): void {
  const managed = sessions.get(sessionId);
  if (!managed || !managed.keepaliveTimer) return;
  if (config.enabled === false) return;

  const targetInterval = computeDetectedTTLKeepaliveIntervalMs(detectedTTLMs, config);
  const currentInterval = managed.currentKeepaliveIntervalMs ?? config.intervalMs;
  const skipIfRecentMs = currentInterval === targetInterval
    ? Math.round(currentInterval * 0.5)
    : Math.round(targetInterval * 0.5);

  if (currentInterval === targetInterval) {
    managed.currentKeepaliveIntervalMs = currentInterval;
    scheduleKeepalive(
      buildKeepaliveContext(sessionId, sessions, isDisposed, queryMetricsRepository, currentInterval, skipIfRecentMs, config),
      computeNextKeepaliveDelay(managed, currentInterval, config),
    );
    return;
  }

  logger.info(
    {
      sessionId,
      detectedTTLMs,
      currentIntervalMs: currentInterval,
      newIntervalMs: targetInterval,
      event_type: 'sdk.keepalive_interval_adjusted',
    },
    `Keepalive interval updated for detected TTL; restarting timer at ${Math.round(targetInterval / 60000)} min`,
  );

  clearTimeout(managed.keepaliveTimer);
  managed.keepaliveTimer = undefined;
  managed.currentKeepaliveIntervalMs = targetInterval;

  scheduleKeepalive(
    buildKeepaliveContext(sessionId, sessions, isDisposed, queryMetricsRepository, targetInterval, skipIfRecentMs, config),
    computeNextKeepaliveDelay(managed, targetInterval, config),
  );
}

function buildKeepaliveContext(
  sessionId: string,
  sessions: Map<string, ManagedSession>,
  isDisposed: () => boolean,
  queryMetricsRepository: IQueryMetricsRepository | undefined,
  intervalMs: number,
  skipIfRecentMs: number,
  config: CacheKeepaliveConfig,
): KeepaliveContext {
  return {
    sessionId,
    sessions,
    isDisposed,
    queryMetricsRepository,
    intervalMs,
    skipIfRecentMs,
    config,
  };
}
