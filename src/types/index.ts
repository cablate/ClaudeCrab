/**
 * ClaudeCab Type Definitions
 * Central export file for all type definitions
 */

// SDK types (re-exported from @anthropic-ai/claude-agent-sdk)
export * from './sdk.js';

// Agent types
export {
  AgentConfigSchema,
  AgentSettingsSchema,
  ModelSchema,
  PermissionModeSchema,
  validateAgentConfig,
  safeValidateAgentConfig,
  type AgentConfig,
  type AgentSettings,
  type Model,
  type PermissionMode,
  type LoadedAgent,
  type McpServerConfig,
  type IAgentRepository,
} from './agent.js';

// Hook types
export {
  HOOK_EVENT_NAMES,
  type AgentHooks,
  type HookCallback,
  type HookContext,
  type HookInput,
  type HookResult,
  type HookEventName,
  type PreToolUseHookInput,
  type PostToolUseHookInput,
} from './hooks.js';

// Session types
export {
  DEFAULT_SESSION_CONFIG,
  getSessionKey,
  parseSessionKey,
  type SessionState,
  type UserSession,
  type CreateSessionOptions,
  type SessionStoreConfig,
} from './session.js';

// Event types
export {
  EVENT_NAMES,
  type EventMap,
  type EventHandler,
  type EventName,
  type MessageSentPayload,
  type SessionClosedPayload,
  type SessionSwitchedPayload,
  type SessionStateChangedPayload,
} from './events.js';

// Error types
export {
  ClaudeCabError,
  AgentLoadError,
  AgentConfigError,
  AgentNotFoundError,
  SessionError,
  RateLimitError,
  AdapterError,
  McpError,
  ValidationError,
  isClaudeCabError,
  wrapError,
  type SessionErrorCode,
} from './errors.js';
