import type { ManagedSession } from '../session/SDKSessionTypes.js';
import { logger } from '../../utils/logger.js';

const HEALING_THRESHOLD = 50;
const HEALING_MAX_RETRIES = 3;

export function updateKeepaliveHealingState(
  sessionId: string,
  session: ManagedSession,
  cacheCreationTokens: number,
): void {
  if (cacheCreationTokens > HEALING_THRESHOLD) {
    const retries = session.healingRetryCount ?? 0;
    if (retries < HEALING_MAX_RETRIES) {
      session.needsCacheWarmup = true;
      session.healingRetryCount = retries + 1;
      logger.info(
        {
          sessionId,
          event_type: 'sdk.keepalive_healing_scheduled',
          cacheCreationTokens,
          threshold: HEALING_THRESHOLD,
          healingRetry: retries + 1,
          maxRetries: HEALING_MAX_RETRIES,
        },
        retries > 0
          ? `Healing retry ${retries + 1}/${HEALING_MAX_RETRIES}; still saw creation ${cacheCreationTokens}`
          : `Keepalive cache creation ${cacheCreationTokens} > ${HEALING_THRESHOLD}; scheduling healing warmup`
      );
    } else {
      session.healingRetryCount = 0;
      logger.warn(
        {
          sessionId,
          event_type: 'sdk.keepalive_healing_exhausted',
          cacheCreationTokens,
          retries: HEALING_MAX_RETRIES,
        },
        `Healing exhausted after ${HEALING_MAX_RETRIES} retries; cache prefix likely permanently drifted`
      );
    }
    return;
  }

  if ((session.healingRetryCount ?? 0) > 0) {
    logger.info(
      { sessionId, event_type: 'sdk.keepalive_healing_resolved', retries: session.healingRetryCount },
      `Healing resolved after ${session.healingRetryCount} retries`
    );
    session.healingRetryCount = 0;
  }
}
