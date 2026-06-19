/**
 * SDK CLI process manager for persistent V2 Claude Code sessions.
 *
 * Responsibilities:
 * - ManagedSession lifecycle (SDK CLI process ~150MB each)
 * - Query execution via executeQuery (send -> processStream -> result)
 * - Cache keepalive scheduling (SDKKeepaliveManager coordination)
 * - LRU eviction when maxSessions cap reached
 * - SubAgentMessageManager coordination
 *
 * Boundary: manages the SDK CLI process and query pipeline only. Does NOT manage
 * app-level UserSession metadata, state tracking, or dedup; use SessionManager for those.
 *
 * Requires patched sdk.mjs (scripts/patch-sdk-v2.cjs) for SDK V2 option forwarding.
 * See: docs/sop-sdk-cli-upgrade.md
 */

import type { LoadedAgent } from '../../types/agent.js';
import type { ExecuteQueryOptions, QueryResult } from '../query/types.js';
import type { RateLimitRepository } from '../../persistence/RateLimitRepository.js';
import type { IQueryMetricsRepository } from '../../persistence/types.js';
import type { CacheKeepaliveConfig } from '../../config.js';
import { DEFAULT_CACHE_KEEPALIVE_CONFIG } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type { ManagedSession } from './SDKSessionTypes.js';
import type { SubAgentMessageManager } from '../query/SubAgentMessageManager.js';
import { processStream } from '../query/SDKStreamProcessor.js';
import { preDrainResidualMessages } from '../query/SDKStreamDrain.js';
import {
  updateCacheEfficiency,
} from '../keepalive/SDKKeepaliveManager.js';
import { createSdkManagedSession } from './SDKSessionCreation.js';
import {
  clearQueryHardTimeout,
  scheduleIdleClose,
  startQueryHardTimeout,
} from './SDKSessionLifecycle.js';
import {
  getCacheStats,
  getDetectedCacheTTLMs,
  getSessionCacheActivityState,
  getSessionGuardState,
  getSessionStats,
  getSessionSummaries,
  getSessionTokenCount,
  setSessionGuardState,
  type CacheStats,
  type SDKSessionSummary,
  type SessionCacheActivityState,
  type SessionGuardState,
} from './SDKSessionSelectors.js';
import {
  cancelManagedQuery,
  destroyManagedSession,
  evictLeastRecentlyUsedIdleSession,
} from './SDKSessionOperations.js';

// Re-export types so external callers that import from SDKSessionManager still work
export type { ManagedSession };

export type { SDKSessionSummary, SessionCacheActivityState };

/**
 * Manages persistent SDK V2 sessions for agent conversations.
 *
 * Sessions stay alive between messages so prompt cache and SDK state can be reused.
 * Callers that need one-shot behavior must disable persistence and destroy the
 * session after the query completes.
 */
export class SDKSessionManager {
  private sessions = new Map<string, ManagedSession>();
  private disposed = false;
  private rateLimitRepository: RateLimitRepository | undefined;
  private queryMetricsRepository: IQueryMetricsRepository | undefined;
  private readonly keepaliveConfig: CacheKeepaliveConfig;
  /** When true, the SDK CLI process is torn down after each successful query. */
  private ephemeral = false;
  /** Max concurrent V2 sessions. Each holds an SDK CLI process (~150MB). */
  private readonly maxSessions: number;
  /** Close live V2 processes after this much real-query idle time. 0 disables. */
  private readonly idleCloseMs: number;
  /** Interrupt active queries after this runtime. 0 disables. */
  private readonly queryHardTimeoutMs: number;
  /** Force-close process this long after timeout interrupt if still querying. */
  private readonly queryHardTimeoutGraceMs: number;

  constructor(options?: {
    rateLimitRepository?: RateLimitRepository;
    queryMetricsRepository?: IQueryMetricsRepository;
    keepaliveConfig?: CacheKeepaliveConfig;
    /** Destroy the SDK CLI process after each query to free ~150MB RAM.
     *  Resume data stays on disk; next query restores context via JSONL. */
    ephemeral?: boolean;
    /** Maximum concurrent sessions (default 20). LRU evicted when exceeded. */
    maxSessions?: number;
    /** Idle real-query timeout before closing the live SDK CLI process. 0 disables. */
    idleCloseMs?: number;
    /** Active query hard timeout. 0 disables. */
    queryHardTimeoutMs?: number;
    /** Grace period between timeout interrupt and force-close. */
    queryHardTimeoutGraceMs?: number;
  }) {
    this.rateLimitRepository = options?.rateLimitRepository;
    this.queryMetricsRepository = options?.queryMetricsRepository;
    this.keepaliveConfig = options?.keepaliveConfig ?? DEFAULT_CACHE_KEEPALIVE_CONFIG;
    this.ephemeral = options?.ephemeral ?? false;
    this.maxSessions = options?.maxSessions ?? 20;
    this.idleCloseMs = options?.idleCloseMs ?? 7_200_000;
    this.queryHardTimeoutMs = options?.queryHardTimeoutMs ?? 3_600_000;
    this.queryHardTimeoutGraceMs = options?.queryHardTimeoutGraceMs ?? 30_000;
  }


  /**
   * Send a message within a persistent session.
   * Creates a new session on first call, reuses on subsequent calls.
   */
  async executeQuery(
    sessionId: string,
    prompt: string,
    agent: LoadedAgent,
    options: ExecuteQueryOptions
  ): Promise<QueryResult> {
    if (this.disposed) {
      throw new Error('SDKSessionManager has been disposed');
    }

    const startTime = Date.now();
    const updateCacheEfficiencyWithConfig = (
      currentSessionId: string,
      currentManaged: ManagedSession,
      usage: Parameters<typeof updateCacheEfficiency>[2],
    ): void => {
      updateCacheEfficiency(currentSessionId, currentManaged, usage, this.keepaliveConfig);
    };
    const queryOptions = options;

    // Get or create persistent session
    let managed = this.sessions.get(sessionId);
    if (!managed) {
      // Evict LRU idle session if over cap (each holds ~150MB SDK CLI process).
      this.evictIdleSessions();
      managed = await this._createSession(sessionId, agent, queryOptions);
    }
    managed.agentId = agent.id;
    managed.cwd = queryOptions.cwd;
    if (queryOptions.runtimeContext !== undefined) {
      managed.runtimeContext = queryOptions.runtimeContext;
    } else {
      delete managed.runtimeContext;
    }

    // Attach session-scoped subAgentManager once.
    if (queryOptions.subAgentManager && !managed.subAgentManager) {
      managed.subAgentManager = queryOptions.subAgentManager;
    }

    logger.info(
      {
        sessionId,
        agentId: agent.id,
        promptLength: prompt.length,
        sdkSessionId: managed.sdkSessionId,
        messageCount: managed.messageCount,
        sessionAgeMs: Date.now() - managed.createdAt,
      },
      'Sending message via persistent V2 session'
    );

    managed.isQuerying = true;
    managed.cancelled = false;
    managed.interruptedAt = undefined;
    managed.lastIntermediateSendPromise = undefined;
    this.startQueryHardTimeout(sessionId, managed, startTime);
    try {
      await preDrainResidualMessages(sessionId, managed);

      // Reset turn-scoped state only after pre-draining the previous query's tail.
      managed.currentOptions = queryOptions;

      await managed.session.send(prompt);
      managed.lastUsedAt = Date.now();
      managed.messageCount++;

      const result = await processStream(sessionId, managed, queryOptions, startTime, updateCacheEfficiencyWithConfig, this.rateLimitRepository);

      const intermediateCount = result.intermediateMessageCount ?? 0;
      const outputTokens = result.usage?.outputTokens ?? 0;
      const hasOutput = result.response.length > 0 || intermediateCount > 0 || outputTokens > 0;
      const wallClockMs = Date.now() - startTime;
      const isEmptyStreamFailure =
        result.response.length === 0 &&
        intermediateCount === 0 &&
        outputTokens === 0 &&
        (result.numTurns ?? 0) === 0 &&
        !result.usage &&
        (wallClockMs > 50 || Boolean(queryOptions.resume));

      if (isEmptyStreamFailure) {
        logger.warn(
          { sessionId, sdkSessionId: managed.sdkSessionId, wallClockMs, messageCount: managed.messageCount },
          'V2 empty stream detected: no turns, no usage, no output; closing process and requiring resend'
        );
        this.destroySession(sessionId);

        if (queryOptions.requireResume) {
          const err = new Error('Resume required but V2 returned an empty stream');
          (err as Error & { _resumeRequired: boolean })._resumeRequired = true;
          throw err;
        }

        const err = new Error('V2 returned an empty stream; automatic fresh-session retry disabled');
        (err as Error & { _emptyStreamRetryDisabled: boolean })._emptyStreamRetryDisabled = true;
        throw err;
      }

      if (queryOptions.resume && managed.messageCount === 1) {
        logger.debug(
          { sessionId, hasOutput, responseLen: result.response.length, intermediateCount, outputTokens },
          'V2 resume output check'
        );
      }
      if (queryOptions.resume && !hasOutput && managed.messageCount === 1) {
        logger.warn(
          { sessionId, sdkSessionId: managed.sdkSessionId, requireResume: queryOptions.requireResume },
          'V2 resumed session returned empty response'
        );
        this.destroySession(sessionId);

        if (queryOptions.requireResume) {
          const err = new Error('Resume required but session returned empty response');
          (err as Error & { _resumeRequired: boolean })._resumeRequired = true;
          throw err;
        }

        const err = new Error('Resume returned empty response; automatic fresh-session retry disabled');
        (err as Error & { _resumeRetryDisabled: boolean })._resumeRetryDisabled = true;
        throw err;
      }

      // Zombie session detection: stream completed instantly with no output.
      // This happens when the underlying CLI process died or the queryIterator
      // was closed (e.g. by for-await .return()).
      if (result.response.length === 0 && (result.numTurns ?? 0) === 0 && wallClockMs <= 50 && !result.usage) {
        logger.warn(
          { sessionId, sdkSessionId: managed.sdkSessionId, wallClockMs, messageCount: managed.messageCount },
          'Zombie session detected: stream completed instantly with no output; automatic retry disabled'
        );
        this.destroySession(sessionId);
        const err = new Error('Zombie session detected; automatic retry disabled');
        (err as Error & { _zombieRetryDisabled: boolean })._zombieRetryDisabled = true;
        throw err;
      }

      if (managed.interruptedAt) {
        logger.info(
          { sessionId, sdkSessionId: managed.sdkSessionId, interruptMs: Date.now() - managed.interruptedAt },
          'V2 query completed gracefully after interrupt; JSONL should be consistent'
        );
      }

      // If the stream detected a cache TTL tier, adjust keepalive interval.
      if (managed.detectedCacheTTLMs !== undefined) {
        const capturedDetectedTTLMs = managed.detectedCacheTTLMs;
        import('../keepalive/SDKKeepaliveManager.js').then(({ adjustKeepaliveInterval }) => {
          if (capturedDetectedTTLMs === undefined) return;
          adjustKeepaliveInterval(
            sessionId, this.sessions, capturedDetectedTTLMs,
            () => this.disposed,
            this.queryMetricsRepository,
            this.keepaliveConfig,
          );
        }).catch(() => {});
      }

      // Ephemeral mode: destroy the SDK CLI process after a successful query.
      // The JSONL transcript stays on disk so the next query can resume context.
      if (this.ephemeral) {
        this.destroySession(sessionId);
      }

      return result;
    } catch (error) {
      const errDetail = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'value' in error
          ? String((error as { value: unknown }).value)
          : String(error);

      const preservedSdkSessionId = managed.sdkSessionId;
      const wasCancelled = Boolean(managed.cancelled);
      const wasInterrupted = managed.interruptedAt !== undefined;

      logger.warn(
        { sessionId, error: errDetail, sdkSessionId: preservedSdkSessionId, wasCancelled, wasInterrupted },
        'V2 session error, cleaning up'
      );
      // Interrupted sessions (graceful /stop) keep the managed session alive.
      // The JSONL is consistent after interrupt; destroying would force a cold resume.
      if (!wasInterrupted) {
        this.destroySession(sessionId);
      }

      if (preservedSdkSessionId) {
        if (error instanceof Error) {
          (error as Error & { _sdkSessionId?: string })._sdkSessionId = preservedSdkSessionId;
        } else if (typeof error === 'object' && error !== null) {
          (error as Record<string, unknown>)._sdkSessionId = preservedSdkSessionId;
        }
      }
      throw error;
    } finally {
      clearQueryHardTimeout(managed);
      delete managed.currentOptions;
      managed.isQuerying = false;
      managed.interruptedAt = undefined;
      const current = this.sessions.get(sessionId);
      if (current && current !== managed) {
        current.isQuerying = false;
        // The original managed session was replaced by a concurrent recreate.
        // Close its CLI process to avoid resource leak.
        try { managed.session?.close(); } catch { /* best effort */ }
        this.sessions.delete(sessionId);
        logger.warn(
          { sessionId, event_type: 'session.recreate_cleanup' },
          'Cleaned up orphaned managed session after concurrent recreate'
        );
      } else if (current && !this.ephemeral) {
        this.scheduleIdleClose(sessionId, current);
      }
    }
  }

  /**
   * Create a new persistent V2 session and register it in the sessions Map.
   */
  private async _createSession(
    sessionId: string,
    agent: LoadedAgent,
    options: ExecuteQueryOptions
  ): Promise<ManagedSession> {
    return createSdkManagedSession({
      sessionId,
      agent,
      options,
      sessions: this.sessions,
      ephemeral: this.ephemeral,
      disposed: () => this.disposed,
      queryMetricsRepository: this.queryMetricsRepository,
      keepaliveConfig: this.keepaliveConfig,
    });
  }

  syncSubAgentUpdates(sessionId: string): { routed: number; drained: number; active: number } | null {
    const managed = this.sessions.get(sessionId);
    if (!managed) return null;
    if (managed.isQuerying) {
      return { routed: 0, drained: 0, active: managed.subAgentManager?.activeCount() ?? 0 };
    }
    return { routed: 0, drained: 0, active: managed.subAgentManager?.activeCount() ?? 0 };
  }

  /** Get the session's subAgentManager if attached (for MessageProcessor to reuse). */
  getSubAgentManager(sessionId: string): SubAgentMessageManager | undefined {
    return this.sessions.get(sessionId)?.subAgentManager;
  }

  /**
   * Evict the least recently used idle session when over capacity.
   * Only targets sessions that are not currently querying, protecting
   * active conversations and schedule-resumed sessions.
   */
  private evictIdleSessions(): void {
    evictLeastRecentlyUsedIdleSession(
      this.sessions,
      this.maxSessions,
      (sessionId) => this.destroySession(sessionId),
    );
  }

  /**
   * Destroy a specific session
   */
  destroySession(sessionId: string): void {
    destroyManagedSession(this.sessions, sessionId);
  }

  private scheduleIdleClose(sessionId: string, managed: ManagedSession): void {
    scheduleIdleClose({
      sessionId,
      managed,
      sessions: this.sessions,
      idleCloseMs: this.idleCloseMs,
      isDisposed: () => this.disposed,
      isEphemeral: () => this.ephemeral,
      destroySession: (id) => this.destroySession(id),
    });
  }

  private startQueryHardTimeout(sessionId: string, managed: ManagedSession, startTime: number): void {
    startQueryHardTimeout({
      sessionId,
      managed,
      sessions: this.sessions,
      startTime,
      queryHardTimeoutMs: this.queryHardTimeoutMs,
      queryHardTimeoutGraceMs: this.queryHardTimeoutGraceMs,
      isDisposed: () => this.disposed,
      cancelActiveQuery: (id) => this.cancelActiveQuery(id),
      destroySession: (id) => this.destroySession(id),
    });
  }

  /**
   * Find a session key by prefix match (for /cache flush auto-complete).
   * Returns the first matching key, or undefined.
   */
  findSessionKeyByPrefix(prefix: string): string | undefined {
    for (const key of this.sessions.keys()) {
      if (key === prefix || key.startsWith(prefix)) return key;
    }
    return undefined;
  }

  /**
   * Check if a session has an active query in progress
   */
  hasActiveQuery(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isQuerying === true;
  }

  /**
   * Cancel an active query via SDK interrupt().
   * interrupt() tells the CLI to stop the current turn gracefully so the
   * JSONL transcript ends on a complete assistant turn.
   */
  cancelActiveQuery(sessionId: string): boolean {
    return cancelManagedQuery(this.sessions, sessionId);
  }

  /**
   * Estimated context size in tokens (throughput / numTurns from last query).
   * Returns null if no query has completed yet.
   */
  getSessionTokenCount(sessionId: string): number | null {
    return getSessionTokenCount(this.sessions.get(sessionId));
  }

  /**
   * Get the cache-relevant activity timestamp for a session.
   * Includes both user queries and keepalive pings; reflects when the
   * cache was last touched, not just when the user last sent a message.
   */
  getSessionCacheActivityState(sessionId: string): SessionCacheActivityState | null {
    return getSessionCacheActivityState(this.sessions.get(sessionId));
  }

  /**
   * Get detected cache TTL in ms from API response, or null if not yet detected.
   */
  getDetectedCacheTTLMs(sessionId: string): number | null {
    return getDetectedCacheTTLMs(this.sessions.get(sessionId));
  }

  /**
   * Get guard state fields from a session (for session-length-handoff-guard).
   * Returns null if the session does not exist.
   */
  getSessionGuardState(sessionId: string): SessionGuardState | null {
    return getSessionGuardState(this.sessions.get(sessionId));
  }

  /**
   * Update guard state on a session (called by MessageProcessor after showing a guard prompt).
   */
  setSessionGuardState(sessionId: string, state: {
    guardShownForLength?: boolean;
    guardLastShownTokenCount?: number;
    guardShownForCacheTTL?: boolean;
  }): void {
    setSessionGuardState(this.sessions.get(sessionId), state);
  }

  /**
   * Get session stats
   */
  getSessionStats(sessionId: string): { messageCount: number; ageMs: number } | null {
    return getSessionStats(this.sessions.get(sessionId));
  }

  /**
   * Aggregated cache health snapshot for heartbeat, `/metrics/cache`, and ops commands.
   */
  getCacheStats(): CacheStats {
    return getCacheStats(this.sessions);
  }

  getSessionSummaries(): SDKSessionSummary[] {
    return getSessionSummaries(this.sessions);
  }

  /**
   * Dispose all sessions
   */
  dispose(): void {
    this.disposed = true;
    for (const [sessionId] of this.sessions) {
      this.destroySession(sessionId);
    }
  }
}
