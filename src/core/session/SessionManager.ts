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
import type { ISessionRepository } from '../../persistence/types.js';
import { buildInternalSession, extractPreviousSessionState } from './SessionCreation.js';
import {
  restoreSessionsFromRepository,
  toPublicSession,
  toSessionRow,
} from './SessionPersistence.js';

export interface InternalSession extends UserSession {
  mutex: Mutex;
  agent: LoadedAgent;
  sdkOptions: SDKOptions;
}

export interface SessionManagerOptions {
  agentLoader: AgentLoader;
  config?: Partial<SessionStoreConfig>;
  sessionRepository?: ISessionRepository | undefined;
}

/**
 * UserSession lifecycle manager for conversation sessions per (platform, agentId, userId).
 *
 * Responsibilities:
 * - CRUD of UserSession records with state tracking (idle/processing/error)
 * - Message dedup (isMessageProcessed / markMessageProcessed)
 * - Session key mapping and DB persistence (optional)
 * - Idle cleanup via configurable interval
 *
 * Boundary: manages app-level session metadata only. Does NOT manage SDK CLI
 * processes, cache keepalive, or query execution; use SDKSessionManager for those.
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
      this.cleanupExpired();
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
   * Resolve the stable ClaudeCrab session ID without touching lastActiveAt.
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

    const previousRow = this.sessionRepository?.findByPlatformAgentAndUser(platform, agentId, userId);
    const previous = extractPreviousSessionState(previousRow);
    const session = buildInternalSession({ options, agent, sdkOptions, previous });

    this.sessions.set(key, session);

    // Persist to database (ON CONFLICT updates existing row, preserving FK linkage)
    if (this.sessionRepository !== undefined) {
      this.sessionRepository.save(toSessionRow(session));
    }

    logger.info(
      {
        event_type: EventType.SESSION_CREATED,
        sessionId: session.sessionId,
        platform,
        userId,
        agentId,
        inherited: previous.previousSessionId !== undefined,
        hasSdkSessionId: session.sdkSessionId !== undefined,
      },
      'Session created'
    );

    return toPublicSession(session);
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

    // Soft-deleted (isActive=false) or no session: remove stale entry and create fresh
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
  }

  /**
   * Soft-delete a session: mark as inactive in memory + DB.
   * Used by /reset; survives process restart unlike memory-only isActive.
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

    // Session not in memory (expired/cleaned up): deactivate DB row directly
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
          'Dedup cache full; evicting oldest processed message id (risk: same id replay would bypass dedup)'
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

  /**
   * Cleanup expired sessions
   */
  cleanupExpired(): number {
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

        // NOTE: Do not delete from database; DB row preserves sdkSessionId
        // for conversation continuity when the user returns.
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

    return restoreSessionsFromRepository({
      sessionRepository: this.sessionRepository,
      config: this.config,
      agentLoader: this.agentLoader,
      sessions: this.sessions,
      getSessionKey,
    });
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): UserSession[] {
    return Array.from(this.sessions.values()).map((s) =>
      toPublicSession(s)
    );
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
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
