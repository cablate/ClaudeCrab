/**
 * Unified message format
 * Standardized representation of messages from any platform
 */
export interface UnifiedMessage {
  /** Unique message identifier (used for idempotency) */
  id: string;

  /** Platform identifier (e.g., 'telegram', 'discord') */
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

  /** Additional platform-specific data */
  [key: string]: unknown;
}

/**
 * Options for sending messages
 */
export interface SendOptions {
  /** Text formatting mode */
  parseMode?: 'Markdown' | 'HTML' | 'MarkdownV2';

  /** Message ID to reply to */
  replyToMessageId?: string;

  /** Disable link previews */
  disableLinkPreview?: boolean;

  /** Disable notification sound */
  disableNotification?: boolean;

  /** Additional platform-specific options */
  platformOptions?: Record<string, unknown>;
}

/**
 * Result of sending a message
 */
export interface SendResult {
  /** Whether the message was sent successfully */
  success: boolean;

  /** Sent message ID if available */
  messageId?: string;

  /** Error message if failed */
  error?: string;
}

/**
 * Adapter lifecycle state
 */
export type AdapterState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

/**
 * Message handler function type
 */
export type MessageHandler = (message: UnifiedMessage) => void | Promise<void>;

/**
 * Adapter configuration base
 */
export interface AdapterConfig {
  /** Platform identifier */
  platform: string;

  /** Agent identifier this adapter is bound to */
  agentId: string;

  /** Whether to enable debug logging */
  debug?: boolean;

  /** Custom rate limit settings */
  rateLimit?: RateLimitConfig;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per second */
  maxRequestsPerSecond: number;

  /** Minimum interval between requests in ms */
  minIntervalMs: number;

  /** Maximum queue size */
  maxQueueSize: number;
}

/**
 * Default rate limit configuration
 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequestsPerSecond: 30,
  minIntervalMs: 35,
  maxQueueSize: 100,
};

/**
 * Security configuration for adapters
 */
export interface AdapterSecurityConfig {
  /** List of allowed user IDs (empty = allow all) */
  allowedUsers: string[];

  /** Whether whitelist is enabled */
  whitelistEnabled: boolean;

  /** Maximum message length in characters */
  maxMessageLength: number;

  /** Whether to enable prompt injection detection */
  promptInjectionDetection: boolean;
}

/**
 * Telegram-specific adapter configuration
 *
 * Note: commandDependencies uses CommandDependencies type from commands/TelegramCommands.ts
 * This ensures proper decoupling - the commands module defines its own dependencies,
 * and adapters simply provide actual instances without wrapper interfaces.
 */
export interface TelegramAdapterConfig extends AdapterConfig {
  platform: 'telegram';

  /** Telegram bot token */
  token: string;

  /** Use webhook instead of polling */
  useWebhook?: boolean;

  /** Webhook URL if using webhook mode */
  webhookUrl?: string;

  /** Webhook secret for verification */
  webhookSecret?: string;

  /**
   * Command dependencies for handling bot commands.
   * Type is defined in commands/TelegramCommands.ts as CommandDependencies.
   * We use unknown here to avoid circular imports - TelegramAdapter will cast appropriately.
   */
  commandDependencies?: unknown;

  /** Security configuration */
  securityConfig?: AdapterSecurityConfig;
}
