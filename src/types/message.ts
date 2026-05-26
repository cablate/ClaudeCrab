/**
 * Core message types — platform-agnostic.
 * Lives in types/ to avoid circular dependency (types/ → adapters/).
 * Re-exported from adapters/types.ts for backward compatibility.
 */

/**
 * Unified message format
 * Standardized representation of messages from any platform
 */
export interface UnifiedMessage {
  /** Unique message identifier (used for idempotency) */
  id: string;

  /** Platform identifier, currently 'discord' */
  platform: string;

  /** User identifier on the platform */
  userId: string;

  /** Chat/conversation identifier */
  chatId: string;

  /** Message text content */
  text: string;

  /** Message timestamp */
  timestamp: Date;

  /** Optional platform-specific metadata */
  metadata?: MessageMetadata;
}

/**
 * Platform-specific message metadata
 */
export interface MessageMetadata {
  /** Original message ID from the platform */
  originalMessageId?: string;

  /** Username if available */
  username?: string;

  /** Display name if available */
  displayName?: string;

  /** Reply to message ID if this is a reply */
  replyToMessageId?: string;

  /** Whether the message is from a group chat */
  isGroupChat?: boolean;

  /** Group/chat title if applicable */
  chatTitle?: string;

  /**
   * Override userId for session routing.
   * When set, MessageProcessor uses this instead of message.userId for session key.
   * Adapters use this to isolate sub-conversations (e.g., threads) without
   * core needing to know about platform-specific concepts.
   */
  sessionUserId?: string;

  /**
   * If this message is in a sub-conversation (thread, reply chain, etc.),
   * the ID of the parent conversation. Platform-agnostic.
   */
  parentConversationId?: string;

  /**
   * Task ID for two-layer thread architecture.
   * When present, links this message to a structured task for audit trail.
   */
  taskId?: string;

  /** Additional platform-specific data */
  [key: string]: unknown;
}

/**
 * Connection health state for adapter monitoring.
 */
export type ConnectionState = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Options for sending messages (platform-agnostic).
 */
export interface SendOptions {
  parseMode?: 'Markdown' | 'HTML' | 'MarkdownV2';
  replyToMessageId?: string;
  disableLinkPreview?: boolean;
  disableNotification?: boolean;
  messageThreadId?: string;
  platformOptions?: Record<string, unknown>;
}

/**
 * Result of sending a message.
 */
export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Tool use event for status tracking.
 */
export interface ToolEvent {
  type: 'tool_use' | 'tool_result' | 'tool_progress' | 'thinking';
  toolName: string;
  summary?: string;
  elapsedSeconds?: number;
  timestamp: number;
  /**
   * Stream scope. V2 SDK inlines subagent tool events into the parent stream;
   * callers use this to avoid showing subagent internals as main-session work.
   */
  scope?: 'main' | 'subagent';
}
