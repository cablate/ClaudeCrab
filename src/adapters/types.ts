import type { UnifiedMessage } from '../types/message.js';

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

/**
 * Options for sending an ExitPlanMode prompt to the user.
 */
export interface ExitPlanModePromptOptions {
  /** Unique ID for this request */
  requestId: string;
  /** Path to the plan file, if available */
  planFilePath?: string | undefined;
  /** List of permissions the plan will need */
  allowedPrompts?: Array<{
    tool: string;
    prompt: string;
  }> | undefined;
}

/**
 * Result of sending an ExitPlanMode prompt.
 */
export interface ExitPlanModePromptResult {
  success: boolean;
  /** The message ID of the sent prompt (for later editing) */
  messageId?: string | undefined;
  error?: string | undefined;
}

/**
 * Callback signature for resolving an ExitPlanMode decision from the adapter.
 */
export type ExitPlanModeResolver = (requestId: string, decision: 'approve' | 'reject') => void;

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
  /** Discord is the only supported runtime adapter. */
  platform: 'discord';

  /** Agent identifier this adapter is bound to */
  agentId: string;

  /** Base directory for agents (resolved from AGENTS_DIR or default ./agents) */
  agentsDir?: string;

}

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

export interface DiscordAdapterConfig extends AdapterConfig {
  /** Discord bot token (per-agent, each agent has its own bot) */
  token: string;

  /** Discord channel ID this adapter listens to */
  channelId: string;

  /** Security configuration */
  securityConfig?: AdapterSecurityConfig;

  /** STT provider for voice message transcription */
  sttProvider?: import('../core/stt/index.js').STTProvider;
}
