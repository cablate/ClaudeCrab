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
 * Options for sending a permission prompt to the user.
 */
export interface PermissionPromptOptions {
  /** Unique ID for this permission request */
  requestId: string;

  /** Name of the tool requesting permission */
  toolName: string;

  /** Tool input (will be summarized for display) */
  toolInput: Record<string, unknown>;

  /** Why this permission was triggered */
  decisionReason?: string;

  /** Blocked file path, if applicable */
  blockedPath?: string;
}

/**
 * Result of sending a permission prompt.
 */
export interface PermissionPromptResult {
  success: boolean;

  /** The message ID of the sent prompt (for later editing) */
  messageId?: string | undefined;

  error?: string | undefined;
}

/**
 * Callback signature for resolving a permission decision from the adapter.
 */
export type PermissionResolver = (requestId: string, decision: 'allow' | 'always' | 'deny') => void;

/**
 * A single question option for AskUserQuestion prompts.
 */
export interface QuestionOption {
  /** Display label for this option */
  label: string;
  /** Description of what this option means */
  description: string;
}

/**
 * Options for sending a question prompt to the user (AskUserQuestion).
 */
export interface QuestionPromptOptions {
  /** Unique ID for this question request */
  requestId: string;
  /** The question text to display */
  question: string;
  /** Short header/label for the question */
  header: string;
  /** Available options for the user to choose from */
  options: QuestionOption[];
  /** Whether multiple selections are allowed (Phase 2: single-select only) */
  multiSelect: boolean;
}

/**
 * Result of a question prompt interaction.
 */
export interface QuestionPromptResult {
  success: boolean;
  /** The message ID of the sent prompt (for later editing) */
  messageId?: string;
  error?: string;
}

/**
 * Callback signature for resolving a question answer from the adapter.
 * answer can be:
 * - A single option label (single-select)
 * - null if user cancelled or timed out
 */
export type QuestionResolver = (requestId: string, answer: string | null) => void;


// ============================================================
// Tool Event Types (for status message feature)
// ============================================================

export interface ToolEvent {
  type: 'tool_use' | 'tool_result' | 'tool_progress';
  toolName: string;
  /** Brief summary or status of the tool operation */
  summary?: string;
  /** For tool_progress: elapsed time in seconds */
  elapsedSeconds?: number;
  /** Timestamp when the event occurred */
  timestamp: number;
}

export interface StatusMessageOptions {
  chatId: string;
  initialText?: string;
}

export interface StatusMessageResult {
  success: boolean;
  messageId?: string;
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
