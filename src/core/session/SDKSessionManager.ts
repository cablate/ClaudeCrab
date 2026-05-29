/**
 * SDKSessionManager ??Persistent Session wrapper for SDK V2 API
 *
 * Solves the token consumption problem: SDK V1 query() spawns a new CLI process
 * per call, causing prompt cache bust (~25% efficiency). V2 createSession keeps
 * the process alive, so prompt cache naturally persists across messages (~95%+ efficiency).
 *
 * Requires: patched sdk.mjs (scripts/patch-sdk-v2.cjs) to support
 * settingSources, systemPrompt, mcpServers in V2 SDKSessionOptions.
 *
 * See: docs/upgrades/research/sdk-reverse-engineering-v0.2.76.md
 *
 * Architecture: orchestrator that delegates to focused sub-modules:
 *   - SDKSessionFactory    ??createManagedSession()
 *   - SDKStreamProcessor   ??processStream()
 *   - SDKKeepaliveManager  ??startKeepalive(), updateCacheEfficiency()
 */

import type { LoadedAgent } from '../../types/agent.js';
import type { ExecuteQueryOptions, QueryResult } from '../query/SDKQueryManager.js';
import type { RateLimitRepository } from '../../persistence/RateLimitRepository.js';
import type { IQueryMetricsRepository } from '../../persistence/types.js';
import type { CacheKeepaliveConfig } from '../../config.js';
import type { ConversationRuntimeContext } from '../../types/runtimeContext.js';
import { DEFAULT_CACHE_KEEPALIVE_CONFIG } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type { ManagedSession } from './SDKSessionTypes.js';
import type { SubAgentMessageManager } from '../query/SubAgentMessageManager.js';
import { createManagedSession } from './SDKSessionFactory.js';
import { processStream, preDrainResidualMessages, getSessionQuery } from '../query/SDKStreamProcessor.js';
import {
  startKeepalive,
  updateCacheEfficiency,
  CACHE_EFFICIENCY_WARN_THRESHOLD,
} from '../keepalive/SDKKeepaliveManager.js';

// Re-export types so external callers that import from SDKSessionManager still work
export type { ManagedSession };

export interface SDKSessionSummary {
  sessionId: string;
  sdkSessionId: string;
  createdAt: number;
  lastQueryAt: number;
  lastUsedAt: number;
  messageCount: number;
  contextTokens: number | undefined;
  contextWindowSize: number | undefined;
  cacheEfficiencyAvg: number | undefined;
  totalCostUsd: number;
  isQuerying: boolean;
  agentId: string;
  cwd: string;
  runtimeContext: ConversationRuntimeContext | undefined;
  lastPromptCacheMutation: ManagedSession['lastPromptCacheMutation'] | undefined;
  lastKeepaliveAnomaly: ManagedSession['lastKeepaliveAnomaly'] | undefined;
}

export interface SessionCacheActivityState {
  lastActivityAt: number;
  source: 'lastCacheTouchAt' | 'lastQueryAt' | 'lastUsedAt';
  lastCacheTouchAt: number | undefined;
  lastQueryAt: number | undefined;
  lastUsedAt: number;
}

/**
 * Manages persistent SDK V2 sessions for agent conversations.
 *
 * Key difference from SDKQueryManager:
 * - V1 (old): each executeQuery() spawns new CLI process ??cache bust
 * - V2 (this): process stays alive between messages ??cache persists
 */
export class SDKSessionManager {
  private sessions = new Map<string, ManagedSession>();
  private disposed = false;
  private rateLimitRepository: RateLimitRepository | undefined;
  private queryMetricsRepository: IQueryMetricsRepository | undefined;
  private readonly keepaliveConfig: CacheKeepaliveConfig;
  /** When true, the SDK CLI process is torn down after each successful query. */
  private ephemeral = false;

  constructor(options?: {
    rateLimitRepository?: RateLimitRepository;
    queryMetricsRepository?: IQueryMetricsRepository;
    keepaliveConfig?: CacheKeepaliveConfig;
    /** Destroy the SDK CLI process after each query to free ~150MB RAM.
     *  Resume data stays on disk; next query restores context via JSONL. */
    ephemeral?: boolean;
  }) {
    this.rateLimitRepository = options?.rateLimitRepository;
    this.queryMetricsRepository = options?.queryMetricsRepository;
    this.keepaliveConfig = options?.keepaliveConfig ?? DEFAULT_CACHE_KEEPALIVE_CONFIG;
    this.ephemeral = options?.ephemeral ?? false;
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
          'V2 query completed gracefully after interrupt ??JSONL should be consistent'
        );
      }

      // If the stream detected a cache TTL tier, adjust keepalive interval.
      if (managed.detectedCacheTTLMs !== undefined) {
        import('../keepalive/SDKKeepaliveManager.js').then(({ adjustKeepaliveInterval }) => {
          adjustKeepaliveInterval(
            sessionId, this.sessions, managed!.detectedCacheTTLMs!,
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
      managed.isQuerying = false;
      managed.interruptedAt = undefined;
      const current = this.sessions.get(sessionId);
      if (current && current !== managed) {
        current.isQuerying = false;
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
    const managed = await createManagedSession(
      sessionId,
      agent,
      options,
      // onCreated: register in Map before keepalive starts so the timer
      // can find the session via sessions.get(sessionId)
      (m) => { this.sessions.set(sessionId, m); },
    );

    // Restore context size from JSONL if resuming an existing session.
    // This ensures SessionGuard and /ctx have accurate data immediately
    // after restart, before the first assistant message arrives.
    if (options.resume && managed.lastTurnContextTokens === undefined) {
      import('./SDKContextRestore.js').then(({ restoreContextFromJsonl }) =>
        restoreContextFromJsonl(options.resume!, options.cwd).then((ctx) => {
          if (ctx !== null && managed.lastTurnContextTokens === undefined) {
            managed.lastTurnContextTokens = ctx;
            logger.info(
              { sessionId, sdkSessionId: options.resume, contextTokens: ctx, event_type: 'sdk.context_restored' },
              `Context restored from JSONL: ${Math.round(ctx / 1000)}K tokens`
            );
          } else {
            logger.debug(
              { sessionId, sdkSessionId: options.resume, event_type: 'sdk.context_restore_skip' },
              ctx === null ? 'No JSONL context data found' : 'Context already set by stream'
            );
          }
        })
      ).catch((err) => {
        logger.warn({ sessionId, sdkSessionId: options.resume, err: err instanceof Error ? err.message : String(err) }, 'Context restore from JSONL failed');
      });
    }

    // Start cache keepalive timer (no-op in ephemeral mode ??session dies after one query)
    if (!this.ephemeral) {
      startKeepalive(
        sessionId,
        this.sessions,
        () => this.disposed,
        this.queryMetricsRepository,
        this.keepaliveConfig,
      );
    }

    logger.info(
      {
        sessionId,
        keepaliveIntervalMs: this.keepaliveConfig.intervalMs,
        keepaliveSkipRecentMs: this.keepaliveConfig.skipRecentMs,
        keepaliveDetectedTTLRatio: this.keepaliveConfig.detectedTTLRatio,
        ephemeral: this.ephemeral,
      },
      this.ephemeral
        ? 'V2 ephemeral session created (will be destroyed after query)'
        : 'V2 persistent session registered (with cache keepalive)'
    );

    return managed;
  }

  async syncSubAgentUpdates(sessionId: string): Promise<{ routed: number; drained: number; active: number } | null> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return null;
    if (managed.isQuerying) {
      return { routed: 0, drained: 0, active: managed.subAgentManager?.activeCount() ?? 0 };
    }
    return { routed: 0, drained: 0, active: managed.subAgentManager?.activeCount() ?? 0 };
  }

  /**
   * Attach a SubAgentMessageManager to a session so pre-drain can route
   * late task_notification messages. Idempotent: if already set, no-op.
   */
  attachSubAgentManager(sessionId: string, manager: SubAgentMessageManager): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    if (managed.subAgentManager) return;
    managed.subAgentManager = manager;
  }

  /** Get the session's subAgentManager if attached (for MessageProcessor to reuse). */
  getSubAgentManager(sessionId: string): SubAgentMessageManager | undefined {
    return this.sessions.get(sessionId)?.subAgentManager;
  }

  /**
   * Destroy a specific session
   */
  destroySession(sessionId: string): void {
    const managed = this.sessions.get(sessionId);
    if (managed) {
      if (managed.keepaliveTimer) {
        clearInterval(managed.keepaliveTimer);
        managed.keepaliveTimer = undefined;
      }
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
      } catch { /* ignore close errors */ }
      this.sessions.delete(sessionId);
      logger.info({ sessionId }, 'V2 session destroyed');
    }
  }

  /**
   * Check if a persistent session exists for the given ID
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
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
    const managed = this.sessions.get(sessionId);
    if (!managed?.isQuerying) {
      return false;
    }

    const query = getSessionQuery(managed.session);
    if (!query) {
      logger.error(
        { sessionId, sdkSessionId: managed.sdkSessionId },
        'cancelActiveQuery: no Query object found on session ??interrupt unavailable'
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

  /**
   * Estimated context size in tokens (throughput / numTurns from last query).
   * Returns null if no query has completed yet.
   */
  getSessionTokenCount(sessionId: string): number | null {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.lastTurnContextTokens === undefined) return null;
    return managed.lastTurnContextTokens;
  }

  /**
   * Get context window usage as percentage (0-100).
   * Uses modelUsage.contextWindow as the denominator.
   */
  getSessionContextPercentage(sessionId: string): number | null {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.lastTurnContextTokens === undefined || !managed.contextWindowSize) return null;
    return Math.round((managed.lastTurnContextTokens / managed.contextWindowSize) * 1000) / 10;
  }

  /**
   * Get the cache-relevant activity timestamp for a session.
   * Includes both user queries and keepalive pings ??reflects when the
   * cache was last touched, not just when the user last sent a message.
   */
  getSessionCacheActivityState(sessionId: string): SessionCacheActivityState | null {
    const managed = this.sessions.get(sessionId);
    if (!managed) return null;
    if (managed.lastCacheTouchAt !== undefined) {
      return {
        lastActivityAt: managed.lastCacheTouchAt,
        source: 'lastCacheTouchAt',
        lastCacheTouchAt: managed.lastCacheTouchAt,
        lastQueryAt: managed.lastQueryAt,
        lastUsedAt: managed.lastUsedAt,
      };
    }
    if (managed.lastQueryAt !== undefined) {
      return {
        lastActivityAt: managed.lastQueryAt,
        source: 'lastQueryAt',
        lastCacheTouchAt: managed.lastCacheTouchAt,
        lastQueryAt: managed.lastQueryAt,
        lastUsedAt: managed.lastUsedAt,
      };
    }
    return {
      lastActivityAt: managed.lastUsedAt,
      source: 'lastUsedAt',
      lastCacheTouchAt: managed.lastCacheTouchAt,
      lastQueryAt: managed.lastQueryAt,
      lastUsedAt: managed.lastUsedAt,
    };
  }

  getSessionLastActivityAt(sessionId: string): number | null {
    return this.getSessionCacheActivityState(sessionId)?.lastActivityAt ?? null;
  }

  /**
   * Get detected cache TTL in ms from API response, or null if not yet detected.
   */
  getDetectedCacheTTLMs(sessionId: string): number | null {
    return this.sessions.get(sessionId)?.detectedCacheTTLMs ?? null;
  }

  /**
   * Get the timestamp (ms) of the last completed user query for a session.
   * Returns null if the session does not exist.
   */
  getSessionLastQueryAt(sessionId: string): number | null {
    const managed = this.sessions.get(sessionId);
    if (!managed) return null;
    return managed.lastQueryAt;
  }

  /**
   * Get guard state fields from a session (for session-length-handoff-guard).
   * Returns null if the session does not exist.
   */
  getSessionGuardState(sessionId: string): {
    guardShownForLength: boolean;
    guardLastShownTokenCount: number | undefined;
    guardShownForCacheTTL: boolean;
  } | null {
    const managed = this.sessions.get(sessionId);
    if (!managed) return null;
    return {
      guardShownForLength: managed.guardShownForLength === true,
      guardLastShownTokenCount: managed.guardLastShownTokenCount,
      guardShownForCacheTTL: managed.guardShownForCacheTTL === true,
    };
  }

  /**
   * Update guard state on a session (called by MessageProcessor after showing a guard prompt).
   */
  setSessionGuardState(sessionId: string, state: {
    guardShownForLength?: boolean;
    guardLastShownTokenCount?: number;
    guardShownForCacheTTL?: boolean;
  }): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    if (state.guardShownForLength !== undefined) managed.guardShownForLength = state.guardShownForLength;
    if (state.guardLastShownTokenCount !== undefined) managed.guardLastShownTokenCount = state.guardLastShownTokenCount;
    if (state.guardShownForCacheTTL !== undefined) managed.guardShownForCacheTTL = state.guardShownForCacheTTL;
  }

  /**
   * Get session stats
   */
  getSessionStats(sessionId: string): { messageCount: number; ageMs: number } | null {
    const managed = this.sessions.get(sessionId);
    if (!managed) return null;
    return {
      messageCount: managed.messageCount,
      ageMs: Date.now() - managed.createdAt,
    };
  }

  /**
   * Aggregated cache health snapshot ??for heartbeat / `/metrics/cache` / ops commands.
   */
  getCacheStats(): {
    active_sessions: number;
    avg_cache_efficiency_pct: number | null;
    low_efficiency_sessions: number;
    querying_sessions: number;
    total_messages: number;
  } {
    let effSum = 0;
    let effCount = 0;
    let low = 0;
    let querying = 0;
    let totalMessages = 0;
    for (const s of this.sessions.values()) {
      totalMessages += s.messageCount;
      if (s.isQuerying) querying++;
      if (typeof s.cacheEfficiencyAvg === 'number') {
        effSum += s.cacheEfficiencyAvg;
        effCount++;
        if (s.cacheEfficiencyAvg < CACHE_EFFICIENCY_WARN_THRESHOLD) low++;
      }
    }
    return {
      active_sessions: this.sessions.size,
      avg_cache_efficiency_pct: effCount > 0 ? Math.round(effSum / effCount) : null,
      low_efficiency_sessions: low,
      querying_sessions: querying,
      total_messages: totalMessages,
    };
  }

  getSessionSummaries(): SDKSessionSummary[] {
    const result: SDKSessionSummary[] = [];
    for (const [sessionId, s] of this.sessions) {
      result.push({
        sessionId,
        sdkSessionId: s.sdkSessionId,
        createdAt: s.createdAt,
        lastQueryAt: s.lastQueryAt,
        lastUsedAt: s.lastUsedAt,
        messageCount: s.messageCount,
        contextTokens: s.lastTurnContextTokens,
        contextWindowSize: s.contextWindowSize,
        cacheEfficiencyAvg: s.cacheEfficiencyAvg,
        totalCostUsd: s.prevUsage.totalCostUsd,
        isQuerying: s.isQuerying,
        agentId: s.agentId,
        cwd: s.cwd,
        runtimeContext: s.runtimeContext,
        lastPromptCacheMutation: s.lastPromptCacheMutation,
        lastKeepaliveAnomaly: s.lastKeepaliveAnomaly,
      });
    }
    return result;
  }

  /**
   * Dispose all sessions
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const [sessionId] of this.sessions) {
      this.destroySession(sessionId);
    }
  }
}
