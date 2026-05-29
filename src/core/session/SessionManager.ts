import { v4 as uuidv4 } from 'uuid';
import { Mutex } from 'async-mutex';
import {
  type UserSession,
  type SessionState,
  type CreateSessionOptions,
  type SessionStoreConfig,
  DEFAULT_SESSION_CONFIG,
  getSessionKey,
} from '../../types/session.js';
import type { LoadedAgent } from '../../types/agent.js';
import { SessionError } from '../../types/errors.js';
import { AgentLoader } from '../orchestrator/AgentLoader.js';
import { ConfigTransformer, type SDKOptions } from '../lib/ConfigTransformer.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';
import type { ISessionRepository, SessionRow } from '../../persistence/types.js';
import {
  serializeMessageIds,
  deserializeMessageIds,
  dateToString,
  stringToDate,
} from '../../persistence/types.js';

/**
 * Internal session data with mutex for concurrency control
 */
/** Cumulative usage snapshot for per-query delta calculation */
export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  totalCostUsd: number;
}

interface InternalSession extends UserSession {
  /** Mutex for preventing concurrent message processing */
  mutex: Mutex;
  /** Loaded agent reference */
  agent: LoadedAgent;
  /** SDK options for this session */
  sdkOptions: SDKOptions;
  /** Previous cumulative usage ??for computing per-query delta (V1 resume also reports cumulative) */
  prevUsage?: UsageSnapshot;
}

/**
 * SessionManager options
 */
export interface SessionManagerOptions {
  /** Agent loader instance */
  agentLoader: AgentLoader;
  /** Session store configuration */
  config?: Partial<SessionStoreConfig>;
  /** Optional session repository for persistence */
  sessionRepository?: ISessionRepository | undefined;
}

/**
 * Manages user sessions across multiple platforms
 */
export class SessionManager {
  private readonly sessions: Map<string, InternalSession> = new Map();
  private readonly config: SessionStoreConfig;
  private readonly agentLoader: AgentLoader;
  private readonly sessionRepository: ISessionRepository | undefined;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionManagerOptions) {
    this.agentLoader = options.agentLoader;
    this.config = { ...DEFAULT_SESSION_CONFIG, ...options.config };
    this.sessionRepository = options.sessionRepository;
  }

  /**
   * Start the session manager (begins cleanup interval)
   */
  start(): void {
    if (this.cleanupInterval !== null) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      void this.cleanupExpired();
    }, this.config.cleanupIntervalMs);

    logger.info(
      { event_type: EventType.SESSION_MANAGER_STARTED, cleanupIntervalMs: this.config.cleanupIntervalMs },
      'SessionManager started'
    );
  }

  /**
   * Stop the session manager (stops cleanup interval)
   */
  stop(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    logger.info({ event_type: EventType.SESSION_MANAGER_STOPPED }, 'SessionManager stopped');
  }

  /**
   * Get a session by platform, agentId, and userId
   */
  getSession(platform: string, agentId: string, userId: string): UserSession | undefined {
    const key = getSessionKey(platform, agentId, userId);
    const session = this.sessions.get(key);

    if (session !== undefined) {
      // Update last active timestamp
      session.lastActiveAt = new Date();
    }

    return session;
  }

  /**
   * Resolve the stable ClaudeCab session ID without touching lastActiveAt.
   * Includes inactive DB rows so reset can clean orphaned SDK sessions left
   * after SessionManager memory cleanup.
   */
  getSessionId(platform: string, agentId: string, userId: string): string | undefined {
    const key = getSessionKey(platform, agentId, userId);
    const session = this.sessions.get(key);
    if (session !== undefined) {
      return session.sessionId;
    }

    return this.sessionRepository
      ?.findByPlatformAgentAndUser(platform, agentId, userId)
      ?.session_id;
  }

  /**
   * Get a session by session key
   */
  getSessionByKey(key: string): UserSession | undefined {
    const session = this.sessions.get(key);

    if (session !== undefined) {
      session.lastActiveAt = new Date();
    }

    return session;
  }

  /**
   * Check if a session exists
   */
  hasSession(platform: string, agentId: string, userId: string): boolean {
    const key = getSessionKey(platform, agentId, userId);
    return this.sessions.has(key);
  }

  /**
   * Create a new session
   */
  async createSession(options: CreateSessionOptions): Promise<UserSession> {
    const { platform, userId, agentId } = options;
    const key = getSessionKey(platform, agentId, userId);

    // Check if session already exists
    const existing = this.sessions.get(key);
    if (existing !== undefined) {
      logger.debug({ key }, 'Session already exists, returning existing');
      return existing;
    }

    // Check max sessions limit
    if (this.sessions.size >= this.config.maxSessions) {
      throw new SessionError(
        'LOCKED',
        `Maximum sessions limit reached (${this.config.maxSessions})`
      );
    }

    // Load the agent
    let agent: LoadedAgent;
    try {
      agent = this.agentLoader.get(agentId) ?? (await this.agentLoader.loadAgent(agentId));
    } catch (error) {
      throw new SessionError(
        'SDK_ERROR',
        `Failed to load agent "${agentId}": ${(error as Error).message}`
      );
    }

    // Transform config to SDK options
    const sdkOptions = ConfigTransformer.toSDKOptions(agent);

    const inheritedSdkSessionId = options.inheritedSdkSessionId;

    let previousSessionId: string | undefined;
    let previousSdkSessionId: string | undefined;
    let previousContinuationSource: 'schedule' | null | undefined;
    let previousContinuationState: 'pending' | 'active' | null | undefined;
    if (this.sessionRepository !== undefined) {
      const previousRow = this.sessionRepository.findByPlatformAgentAndUser(platform, agentId, userId);
      if (previousRow !== undefined) {
        previousSessionId = previousRow.session_id;
        const previousIsActive = previousRow.is_active !== 0;
        if (previousIsActive) {
          previousSdkSessionId = previousRow.sdk_session_id ?? undefined;
          previousContinuationSource = previousRow.continuation_source as 'schedule' | null | undefined;
          previousContinuationState = previousRow.continuation_state as 'pending' | 'active' | null | undefined;
        }
        logger.info(
          {
            event_type: EventType.SESSION_RESTORE_BEGIN,
            previousSessionId,
            previousSdkSessionId: previousSdkSessionId ?? null,
            previousIsActive: previousRow.is_active,
            previousCreatedAt: previousRow.created_at,
            continuationSource: previousContinuationSource,
            continuationState: previousContinuationState,
          },
          `Inheriting session from DB ??sdkSessionId=${previousSdkSessionId ?? 'none'}, isActive=${previousRow.is_active}`
        );
      }
    }

    const now = new Date();
    const session: InternalSession = {
      // Reuse previous session ID to maintain DB FK linkage (conversations table)
      sessionId: previousSessionId ?? uuidv4(),
      agentId,
      platform,
      userId,
      state: 'idle',
      createdAt: now,
      lastActiveAt: now,
      processedMessageIds: new Set(),
      mutex: new Mutex(),
      agent,
      sdkOptions,
      ...(inheritedSdkSessionId !== undefined
        ? { sdkSessionId: inheritedSdkSessionId }
        : previousSdkSessionId !== undefined
          ? { sdkSessionId: previousSdkSessionId }
          : {}),
      isActive: true,
      continuationSource: previousContinuationSource ?? undefined,
      continuationState: previousContinuationState ?? undefined,
    };

    this.sessions.set(key, session);

    // Persist to database (ON CONFLICT updates existing row, preserving FK linkage)
    if (this.sessionRepository !== undefined) {
      this.sessionRepository.save(this.toSessionRow(session));
    }

    logger.info(
      {
        event_type: EventType.SESSION_CREATED,
        sessionId: session.sessionId,
        platform,
        userId,
        agentId,
        inherited: previousSessionId !== undefined,
        hasSdkSessionId: session.sdkSessionId !== undefined,
      },
      'Session created'
    );

    // Emit event
    // (EventBus removed — no subscribers)

    return this.toPublicSession(session);
  }

  /**
   * Get or create a session
   */
  async getOrCreateSession(options: CreateSessionOptions): Promise<UserSession> {
    const { platform, agentId, userId } = options;
    if (agentId === undefined) {
      throw new SessionError('SDK_ERROR', 'No agent ID provided');
    }

    const existing = this.getSession(platform, agentId, userId);
    if (existing !== undefined && existing.isActive) {
      return existing;
    }

    // Soft-deleted (isActive=false) or no session ??remove stale entry and create fresh
    if (existing !== undefined && !existing.isActive) {
      const key = getSessionKey(platform, agentId, userId);
      this.sessions.delete(key);
      logger.info({ event_type: EventType.SESSION_DISPOSED, key }, 'Removed soft-deleted session, creating fresh one');
    }

    return this.createSession(options);
  }

  /**
   * Update session state
   */
  updateState(platform: string, agentId: string, userId: string, state: SessionState): void {
    const key = getSessionKey(platform, agentId, userId);
    const session = this.sessions.get(key);

    if (session === undefined) {
      throw new SessionError('NOT_FOUND', `Session not found: ${key}`);
    }

    const previousState = session.state;
    session.state = state;
    session.lastActiveAt = new Date();

    // Persist state change
    if (this.sessionRepository !== undefined) {
      this.sessionRepository.updateState(session.sessionId, state);
    }

    logger.debug(
      { sessionId: session.sessionId, previousState, newState: state },
      'Session state updated'
    );

    // (EventBus removed — no subscribers)
  }

  /**
   * Close a session
   */
  closeSession(
    platform: string,
    agentId: string,
    userId: string,
    reason: 'timeout' | 'user_request' | 'error' = 'user_request'
  ): boolean {
    const key = getSessionKey(platform, agentId, userId);
    const session = this.sessions.get(key);

    if (session === undefined) {
      return false;
    }

    this.sessions.delete(key);

    // Remove from database
    if (this.sessionRepository !== undefined) {
      this.sessionRepository.delete(session.sessionId);
    }

    logger.info(
      { event_type: EventType.SESSION_DISPOSED, sessionId: session.sessionId, reason },
      'Session closed'
    );

    // (EventBus removed — no subscribers)

    return true;
  }

  /**
   * Soft-delete a session: mark as inactive in memory + DB.
   * Used by /reset ??survives process restart (unlike memory-only isActive).
   * Also handles sessions that have been expired from memory but still exist in DB.
   */
  softDeleteSession(platform: string, agentId: string, userId: string): boolean {
    const key = getSessionKey(platform, agentId, userId);
    const session = this.sessions.get(key);

    if (session !== undefined) {
      const previousSdkSessionId = session.sdkSessionId;
      session.isActive = false;
      delete session.sdkSessionId;
      if (this.sessionRepository !== undefined) {
        this.sessionRepository.updateIsActive(session.sessionId, false);
        this.sessionRepository.updateSdkSessionId(session.sessionId, null);
      }
      logger.info(
        { event_type: EventType.SESSION_DISPOSED, sessionId: session.sessionId, clearedSdkSessionId: previousSdkSessionId ?? null },
        'Session soft-deleted (sdkSessionId cleared from memory + DB)'
      );
      return true;
    }

    // Session not in memory (expired/cleaned up) ??deactivate DB row directly
    if (this.sessionRepository !== undefined) {
      const deactivated = this.sessionRepository.deactivateByPlatformAgentAndUser(platform, agentId, userId);
      if (deactivated) {
        logger.info({ event_type: EventType.SESSION_DISPOSED, platform, agentId, userId }, 'Session soft-deleted (DB-only, was not in memory)');
      }
      return deactivated;
    }

    return false;
  }

  /**
   * Check if a message has already been processed (idempotency)
   */
  isMessageProcessed(platform: string, agentId: string, userId: string, messageId: string): boolean {
    const key = getSessionKey(platform, agentId, userId);
    const session = this.sessions.get(key);

    if (session === undefined) {
      return false;
    }

    return session.processedMessageIds.has(messageId);
  }

  /**
   * Mark a message as processed
   */
  markMessageProcessed(platform: string, agentId: string, userId: string, messageId: string): void {
    const key = getSessionKey(platform, agentId, userId);
    const session = this.sessions.get(key);

    if (session === undefined) {
      return;
    }

    session.processedMessageIds.add(messageId);

    // Trim if exceeds max
    if (session.processedMessageIds.size > this.config.maxProcessedMessageIds) {
      const iterator = session.processedMessageIds.values();
      const first = iterator.next().value;
      if (first !== undefined) {
        session.processedMessageIds.delete(first);
        logger.warn(
          {
            event_type: EventType.SESSION_DEDUP_EVICTED,
            sessionId: session.sessionId,
            evictedMessageId: first,
            dedupSize: session.processedMessageIds.size,
            maxSize: this.config.maxProcessedMessageIds,
          },
          'Dedup cache full ??evicting oldest processed message id (risk: same id replay would bypass dedup)'
        );
      }
    }

    // Persist processed message IDs
    if (this.sessionRepository !== undefined) {
      this.sessionRepository.updateProcessedMessageIds(
        session.sessionId,
        session.processedMessageIds
      );
    }
  }

  /**
   * Acquire a lock for processing a session
   * Returns a release function
   */
  async acquireLock(platform: string, agentId: string, userId: string): Promise<() => void> {
    const key = getSessionKey(platform, agentId, userId);
    const session = this.sessions.get(key);

    if (session === undefined) {
      throw new SessionError('NOT_FOUND', `Session not found: ${key}`);
    }

    const release = await session.mutex.acquire();
    return release;
  }

  /**
   * Execute a function with exclusive lock on a session
   */
  async withLock<T>(
    platform: string,
    agentId: string,
    userId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const release = await this.acquireLock(platform, agentId, userId);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Get the internal session (for SDK integration)
   */
  getInternalSession(platform: string, agentId: string, userId: string): InternalSession | undefined {
    const key = getSessionKey(platform, agentId, userId);
    return this.sessions.get(key);
  }

  /**
   * Get session created_at from DB (fallback when session not in memory).
   * Used by /ctx to filter query history after restart.
   * Returns undefined if row doesn't exist or session was soft-deleted.
   */
  getSessionCreatedAtFromDB(platform: string, agentId: string, userId: string): Date | undefined {
    if (this.sessionRepository === undefined) return undefined;
    const row = this.sessionRepository.findByPlatformAgentAndUser(platform, agentId, userId);
    if (row === undefined || row.is_active === 0) return undefined;
    return new Date(row.created_at);
  }

  /**
   * Get the filesystem path for a loaded agent (used for JSONL context restore).
   */
  getAgentPath(agentId: string): string | undefined {
    return this.agentLoader.get(agentId)?.path;
  }

  /**
   * Update SDK session ID.
   * Pass undefined to clear the SDK session ID (e.g., for conversation reset).
   */
  setSdkSessionId(platform: string, agentId: string, userId: string, sdkSessionId: string | undefined): void {
    const key = getSessionKey(platform, agentId, userId);
    const session = this.sessions.get(key);

    if (session !== undefined) {
      if (sdkSessionId === undefined) {
        delete session.sdkSessionId;
      } else {
        session.sdkSessionId = sdkSessionId;
      }

      // Persist SDK session ID
      if (this.sessionRepository !== undefined) {
        this.sessionRepository.updateSdkSessionId(session.sessionId, sdkSessionId ?? null);
      }
    }
  }

  activateScheduleHandoff(platform: string, agentId: string, userId: string): void {
    const key = getSessionKey(platform, agentId, userId);
    const session = this.sessions.get(key);
    if (session !== undefined) {
      session.continuationState = 'active';
      if (this.sessionRepository !== undefined) {
        this.sessionRepository.activateScheduleHandoff(session.sessionId);
      }
    }
  }

  clearContinuationSource(platform: string, agentId: string, userId: string): void {
    const key = getSessionKey(platform, agentId, userId);
    const session = this.sessions.get(key);
    if (session !== undefined) {
      session.continuationSource = undefined;
      session.continuationState = undefined;
      if (this.sessionRepository !== undefined) {
        this.sessionRepository.clearContinuationSource(session.sessionId);
      }
    }
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, session] of this.sessions) {
      const age = now - session.lastActiveAt.getTime();
      if (age > this.config.sessionTimeoutMs) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      const session = this.sessions.get(key);
      if (session !== undefined) {
        this.sessions.delete(key);

        // NOTE: Do NOT delete from database ??DB row preserves sdkSessionId
        // for conversation continuity when the user returns.

        // (EventBus removed — no subscribers)
      }
    }

    if (expiredKeys.length > 0) {
      logger.info(
        { event_type: EventType.SESSION_DISPOSED, count: expiredKeys.length },
        'Expired sessions cleaned up'
      );
    }

    return expiredKeys.length;
  }

  /**
   * Restore sessions from database
   * Returns the number of successfully restored sessions
   */
  async restoreSessions(): Promise<number> {
    if (this.sessionRepository === undefined) {
      return 0;
    }

    // Purge truly ancient sessions (beyond DB retention period)
    const ancientRows = this.sessionRepository.findExpired(this.config.dbRetentionMs);
    for (const row of ancientRows) {
      this.sessionRepository.delete(row.session_id);
    }
    if (ancientRows.length > 0) {
      logger.info({ event_type: EventType.SESSION_PURGED, count: ancientRows.length }, 'Purged ancient sessions from database');
    }

    // Identify expired sessions (beyond active timeout) ??skip loading but keep in DB
    const expiredRows = this.sessionRepository.findExpired(this.config.sessionTimeoutMs);
    const expiredIds = new Set(expiredRows.map((r) => r.session_id));
    if (expiredRows.length > 0) {
      logger.info(
        { event_type: EventType.SESSION_RESTORE_SKIPPED, count: expiredRows.length },
        'Skipped expired sessions (kept in DB for continuity)'
      );
    }

    // Restore active sessions into memory
    const rows = this.sessionRepository.findAll();
    let restored = 0;

    for (const row of rows) {
      // Skip expired sessions ??they stay in DB for sdkSessionId continuity
      if (expiredIds.has(row.session_id)) {
        continue;
      }

      try {
        // Try to load the agent
        const agent = this.agentLoader.get(row.agent_id) ??
          (await this.agentLoader.loadAgent(row.agent_id));

        const sdkOptions = ConfigTransformer.toSDKOptions(agent);
        const key = getSessionKey(row.platform, row.agent_id, row.user_id);

        // Skip if session already exists in memory
        if (this.sessions.has(key)) {
          continue;
        }

        // Reset stuck 'processing' state (server crash recovery)
        const restoredState = row.state === 'processing' ? 'idle' : row.state;

        // Skip soft-deleted sessions (reset by user, persisted to DB)
        if (row.is_active === 0) {
          logger.debug(
            { sessionId: row.session_id, platform: row.platform, userId: row.user_id },
            'Skipped inactive (soft-deleted) session'
          );
          continue;
        }

        const session: InternalSession = {
          sessionId: row.session_id,
          agentId: row.agent_id,
          platform: row.platform,
          userId: row.user_id,
          state: restoredState as SessionState,
          createdAt: stringToDate(row.created_at),
          lastActiveAt: stringToDate(row.last_active_at),
          processedMessageIds: deserializeMessageIds(row.processed_message_ids),
          mutex: new Mutex(),
          agent,
          sdkOptions,
          isActive: true,
        };

        // Only set sdkSessionId if it exists in the database
        if (row.sdk_session_id !== null) {
          session.sdkSessionId = row.sdk_session_id;
        }

        this.sessions.set(key, session);
        restored++;

        // Sync state reset to DB if needed
        if (restoredState !== row.state) {
          this.sessionRepository.updateState(row.session_id, restoredState as SessionState);
          logger.info({ event_type: EventType.SESSION_STATE_TRANSITION, sessionId: row.session_id }, 'Reset stuck processing state to idle');
        }

        logger.debug(
          {
            sessionId: row.session_id,
            platform: row.platform,
            userId: row.user_id,
            hasSdkSessionId: row.sdk_session_id !== null,
          },
          'Session restored from database'
        );
      } catch (error) {
        logger.warn(
          { event_type: EventType.SESSION_ERROR, sessionId: row.session_id, agentId: row.agent_id, err: (error as Error).message },
          'Failed to restore session, agent may not exist'
        );
        // Don't delete from DB ??keep for sdkSessionId continuity
      }
    }

    if (restored > 0) {
      logger.info({ event_type: EventType.SESSION_RESTORED, count: restored }, 'Sessions restored from database');
    }

    return restored;
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): UserSession[] {
    return Array.from(this.sessions.values()).map((s) =>
      this.toPublicSession(s)
    );
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get sessions by platform
   */
  getSessionsByPlatform(platform: string): UserSession[] {
    const sessions: UserSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.platform === platform) {
        sessions.push(this.toPublicSession(session));
      }
    }
    return sessions;
  }

  /**
   * Convert internal session to public session (remove mutex and internal refs)
   */
  private toPublicSession(internal: InternalSession): UserSession {
    return {
      sessionId: internal.sessionId,
      agentId: internal.agentId,
      platform: internal.platform,
      userId: internal.userId,
      state: internal.state,
      createdAt: internal.createdAt,
      lastActiveAt: internal.lastActiveAt,
      processedMessageIds: internal.processedMessageIds,
      ...(internal.sdkSessionId !== undefined
        ? { sdkSessionId: internal.sdkSessionId }
        : {}),
      isActive: internal.isActive,
      continuationSource: internal.continuationSource,
      continuationState: internal.continuationState,
    };
  }

  /**
   * Convert internal session to database row
   */
  private toSessionRow(internal: InternalSession): SessionRow {
    return {
      session_id: internal.sessionId,
      agent_id: internal.agentId,
      platform: internal.platform,
      user_id: internal.userId,
      state: internal.state,
      created_at: dateToString(internal.createdAt),
      last_active_at: dateToString(internal.lastActiveAt),
      sdk_session_id: internal.sdkSessionId ?? null,
      processed_message_ids: serializeMessageIds(internal.processedMessageIds),
      is_active: internal.isActive ? 1 : 0,
      continuation_source: internal.continuationSource ?? null,
      continuation_state: internal.continuationState ?? null,
    };
  }

  /**
   * Check if persistence is enabled
   */
  isPersistenceEnabled(): boolean {
    return this.sessionRepository !== undefined;
  }

  /**
   * Dispose of the session manager
   */
  dispose(): void {
    this.stop();
    this.sessions.clear();
    logger.info({ event_type: EventType.SESSION_MANAGER_DISPOSED }, 'SessionManager disposed');
  }
}
