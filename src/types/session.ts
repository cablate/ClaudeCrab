/**
 * Session state machine states
 */
export type SessionState = 'idle' | 'processing' | 'error';

/**
 * User session representing an active conversation
 */
export interface UserSession {
  /** Unique session identifier */
  sessionId: string;

  /** Associated agent identifier */
  agentId: string;

  /** Platform identifier (e.g., 'telegram', 'discord') */
  platform: string;

  /** User identifier on the platform */
  userId: string;

  /** Current session state */
  state: SessionState;

  /** Session creation timestamp */
  createdAt: Date;

  /** Last activity timestamp */
  lastActiveAt: Date;

  /** Set of processed message IDs for idempotency */
  processedMessageIds: Set<string>;

  /** Optional SDK session reference for resumption */
  sdkSessionId?: string;
}

/**
 * Options for creating a new session
 */
export interface CreateSessionOptions {
  platform: string;
  userId: string;
  agentId: string;
  chatId?: string;
}

/**
 * Session store configuration
 */
export interface SessionStoreConfig {
  /** Session timeout in milliseconds (default: 1 hour) */
  sessionTimeoutMs: number;

  /** Cleanup interval in milliseconds (default: 1 minute) */
  cleanupIntervalMs: number;

  /** Maximum number of concurrent sessions */
  maxSessions: number;

  /** Maximum processed message IDs to track per session */
  maxProcessedMessageIds: number;

  /** Database retention period in milliseconds (default: 30 days).
   *  Sessions older than this are purged from DB on startup. */
  dbRetentionMs: number;
}

/**
 * Default session store configuration
 */
export const DEFAULT_SESSION_CONFIG: SessionStoreConfig = {
  sessionTimeoutMs: 60 * 60 * 1000, // 1 hour
  cleanupIntervalMs: 60 * 1000, // 1 minute
  maxSessions: 1000,
  maxProcessedMessageIds: 100,
  dbRetentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
};

/**
 * Generate a session key from platform, agentId, and userId
 * Uses double colon to avoid collision
 */
export function getSessionKey(platform: string, agentId: string, userId: string): string {
  return `${platform}::${agentId}::${userId}`;
}

/**
 * Parse a session key back to platform, agentId, and userId
 */
export function parseSessionKey(
  key: string
): { platform: string; agentId: string; userId: string } | null {
  const parts = key.split('::');
  if (parts.length !== 3 || parts[0] === undefined || parts[1] === undefined || parts[2] === undefined) {
    return null;
  }
  return { platform: parts[0], agentId: parts[1], userId: parts[2] };
}
