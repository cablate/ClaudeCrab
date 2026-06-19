import { logger } from '../../utils/logger.js';
import type { ManagedSession } from './SDKSessionTypes.js';

export function clearSessionTimers(managed: ManagedSession): void {
  if (managed.keepaliveTimer) {
    clearTimeout(managed.keepaliveTimer);
    managed.keepaliveTimer = undefined;
  }
  if (managed.idleCloseTimer) {
    clearTimeout(managed.idleCloseTimer);
    managed.idleCloseTimer = undefined;
  }
  clearQueryHardTimeout(managed);
}

export function clearQueryHardTimeout(managed: ManagedSession): void {
  if (managed.queryHardTimeoutTimer) {
    clearTimeout(managed.queryHardTimeoutTimer);
    managed.queryHardTimeoutTimer = undefined;
  }
  if (managed.queryHardTimeoutForceTimer) {
    clearTimeout(managed.queryHardTimeoutForceTimer);
    managed.queryHardTimeoutForceTimer = undefined;
  }
}

export function scheduleIdleClose(options: {
  sessionId: string;
  managed: ManagedSession;
  sessions: Map<string, ManagedSession>;
  idleCloseMs: number;
  isDisposed: () => boolean;
  isEphemeral: () => boolean;
  destroySession: (sessionId: string) => void;
}): void {
  const { sessionId, managed, sessions, idleCloseMs, isDisposed, isEphemeral, destroySession } = options;
  if (managed.idleCloseTimer) {
    clearTimeout(managed.idleCloseTimer);
    managed.idleCloseTimer = undefined;
  }
  if (isDisposed() || isEphemeral() || idleCloseMs <= 0) return;

  const idleMs = Date.now() - managed.lastQueryAt;
  const delayMs = Math.max(0, idleCloseMs - idleMs);
  managed.idleCloseTimer = setTimeout(() => {
    const current = sessions.get(sessionId);
    if (!current || isDisposed()) return;
    if (current.isQuerying) {
      scheduleIdleClose(options);
      return;
    }

    const currentIdleMs = Date.now() - current.lastQueryAt;
    if (currentIdleMs < idleCloseMs) {
      scheduleIdleClose({ ...options, managed: current });
      return;
    }

    logger.info(
      { sessionId, sdkSessionId: current.sdkSessionId, idleMs: currentIdleMs, idleCloseMs },
      'Closing idle V2 process; sdkSessionId is preserved by app session for resume'
    );
    destroySession(sessionId);
  }, delayMs);
  managed.idleCloseTimer.unref?.();
}

export function startQueryHardTimeout(options: {
  sessionId: string;
  managed: ManagedSession;
  sessions: Map<string, ManagedSession>;
  startTime: number;
  queryHardTimeoutMs: number;
  queryHardTimeoutGraceMs: number;
  isDisposed: () => boolean;
  cancelActiveQuery: (sessionId: string) => boolean;
  destroySession: (sessionId: string) => void;
}): void {
  const {
    sessionId,
    managed,
    sessions,
    startTime,
    queryHardTimeoutMs,
    queryHardTimeoutGraceMs,
    isDisposed,
    cancelActiveQuery,
    destroySession,
  } = options;

  clearQueryHardTimeout(managed);
  if (isDisposed() || queryHardTimeoutMs <= 0) return;

  managed.queryHardTimeoutTimer = setTimeout(() => {
    const current = sessions.get(sessionId);
    if (!current || current !== managed || !current.isQuerying || isDisposed()) return;

    logger.warn(
      {
        sessionId,
        sdkSessionId: current.sdkSessionId,
        runtimeMs: Date.now() - startTime,
        queryHardTimeoutMs,
        queryHardTimeoutGraceMs,
      },
      'Active V2 query exceeded hard timeout; interrupting'
    );
    const interrupted = cancelActiveQuery(sessionId);

    if (!interrupted || queryHardTimeoutGraceMs <= 0) {
      destroySession(sessionId);
      return;
    }

    current.queryHardTimeoutForceTimer = setTimeout(() => {
      const latest = sessions.get(sessionId);
      if (!latest || latest !== current || !latest.isQuerying || isDisposed()) return;
      logger.error(
        {
          sessionId,
          sdkSessionId: latest.sdkSessionId,
          runtimeMs: Date.now() - startTime,
          queryHardTimeoutMs,
          queryHardTimeoutGraceMs,
        },
        'Active V2 query still running after timeout interrupt; force-closing process'
      );
      destroySession(sessionId);
    }, queryHardTimeoutGraceMs);
    current.queryHardTimeoutForceTimer.unref?.();
  }, queryHardTimeoutMs);
  managed.queryHardTimeoutTimer.unref?.();
}
