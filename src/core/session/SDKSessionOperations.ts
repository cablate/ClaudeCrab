import { logger } from '../../utils/logger.js';
import type { ManagedSession } from './SDKSessionTypes.js';
import { clearSessionTimers } from './SDKSessionLifecycle.js';
import { getSessionQuery } from './SDKSessionInternals.js';

export function evictLeastRecentlyUsedIdleSession(
  sessions: Map<string, ManagedSession>,
  maxSessions: number,
  destroySession: (sessionId: string) => void,
): void {
  if (sessions.size < maxSessions) return;

  let oldestId: string | undefined;
  let oldestUsed = Infinity;

  for (const [id, session] of sessions) {
    if (session.isQuerying) continue;
    if (session.lastUsedAt < oldestUsed) {
      oldestUsed = session.lastUsedAt;
      oldestId = id;
    }
  }

  if (oldestId === undefined) {
    return;
  }

  logger.info(
    { sessionId: oldestId, event_type: 'session.evicted_lru', totalSessions: sessions.size, maxSessions },
    `Evicting LRU idle session (${sessions.size} >= ${maxSessions})`
  );
  destroySession(oldestId);
}

export function destroyManagedSession(
  sessions: Map<string, ManagedSession>,
  sessionId: string,
): void {
  const managed = sessions.get(sessionId);
  if (!managed) {
    return;
  }

  clearSessionTimers(managed);
  if (managed.subAgentManager) {
    managed.subAgentManager.finalizeAll().catch((err) => {
      logger.warn(
        { sessionId, err: err instanceof Error ? err.message : String(err) },
        'destroySession: subAgentManager.finalizeAll threw, continuing'
      );
    });
    managed.subAgentManager.dispose();
    delete managed.subAgentManager;
  }

  try {
    managed.session.close();
  } catch {
    // Best-effort resource cleanup.
  }

  sessions.delete(sessionId);
  logger.info({ sessionId }, 'V2 session destroyed');
}

export function cancelManagedQuery(
  sessions: Map<string, ManagedSession>,
  sessionId: string,
): boolean {
  const managed = sessions.get(sessionId);
  if (!managed?.isQuerying) {
    return false;
  }

  const query = getSessionQuery(managed.session);
  if (!query) {
    logger.error(
      { sessionId, sdkSessionId: managed.sdkSessionId },
      'cancelActiveQuery: no Query object found on session; interrupt unavailable'
    );
    return false;
  }

  managed.interruptedAt = Date.now();
  logger.info(
    { sessionId, sdkSessionId: managed.sdkSessionId },
    'Interrupting active V2 query (graceful)'
  );

  query.interrupt().catch((err: unknown) => {
    logger.warn(
      { sessionId, sdkSessionId: managed.sdkSessionId, err: err instanceof Error ? err.message : String(err) },
      'interrupt() rejected'
    );
  });

  return true;
}
