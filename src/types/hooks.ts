/**
 * Hook callback function type
 * Matches the SDK's HookCallback signature
 */
export type HookCallback = (
  input: HookInput,
  toolUseId: string | undefined,
  context: HookContext
) => Promise<HookResult>;

/**
 * Hook execution context
 */
export interface HookContext {
  signal?: AbortSignal;
}

/**
 * Base hook input structure
 */
export interface HookInput {
  session_id: string;
  [key: string]: unknown;
}

/**
 * PreToolUse hook specific input
 */
export interface PreToolUseHookInput extends HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

/**
 * PostToolUse hook specific input
 */
export interface PostToolUseHookInput extends HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_result: unknown;
}

/**
 * Hook result structure
 */
export interface HookResult {
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: 'allow' | 'deny';
    permissionDecisionReason?: string;
    [key: string]: unknown;
  };
}

/**
 * Agent hooks definition
 * Corresponds to SDK HookEvent types
 */
export interface AgentHooks {
  /** Called before a tool is executed */
  preToolUse?: HookCallback;

  /** Called after a tool is executed successfully */
  postToolUse?: HookCallback;

  /** Called when a tool execution fails */
  postToolUseFailure?: HookCallback;

  /** Called when a notification is sent */
  notification?: HookCallback;

  /** Called when user submits a prompt */
  userPromptSubmit?: HookCallback;

  /** Called when a session starts */
  sessionStart?: HookCallback;

  /** Called when a session ends */
  sessionEnd?: HookCallback;

  /** Called when the agent stops */
  stop?: HookCallback;

  /** Called when a subagent starts */
  subagentStart?: HookCallback;

  /** Called when a subagent stops */
  subagentStop?: HookCallback;

  /** Called before conversation compaction */
  preCompact?: HookCallback;

  /** Called when a permission is requested */
  permissionRequest?: HookCallback;
}

/**
 * List of all supported hook event names
 */
export const HOOK_EVENT_NAMES = [
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'notification',
  'userPromptSubmit',
  'sessionStart',
  'sessionEnd',
  'stop',
  'subagentStart',
  'subagentStop',
  'preCompact',
  'permissionRequest',
] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];
