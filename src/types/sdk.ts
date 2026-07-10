/**
 * SDK 類型轉接層
 * 從 @anthropic-ai/claude-agent-sdk 導入並 re-export
 * 方便 ClaudeCrab 內部使用和追蹤
 */

// =============================================================================
// 權限系統
// =============================================================================
export type {
  PermissionMode,
  PermissionBehavior,
  PermissionResult,
  PermissionUpdate,
  PermissionUpdateDestination,
  PermissionRuleValue,
  CanUseTool,
} from '../core/sdk/index.js';

// =============================================================================
// Hook 系統
// =============================================================================
export type {
  HookEvent,
  HookInput as SDKHookInput,
  HookCallback as SDKHookCallback,
  HookCallbackMatcher,
  HookJSONOutput,
  // Hook 輸入類型
  BaseHookInput,
  PreToolUseHookInput as SDKPreToolUseHookInput,
  PostToolUseHookInput as SDKPostToolUseHookInput,
  PostToolUseFailureHookInput,
  NotificationHookInput,
  UserPromptSubmitHookInput,
  SessionStartHookInput,
  SessionEndHookInput,
  StopHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  PreCompactHookInput,
  PermissionRequestHookInput,
  SetupHookInput,
  // Hook 輸出類型
  PreToolUseHookSpecificOutput,
  PostToolUseHookSpecificOutput,
  PostToolUseFailureHookSpecificOutput,
  NotificationHookSpecificOutput,
  UserPromptSubmitHookSpecificOutput,
  SessionStartHookSpecificOutput,
  SetupHookSpecificOutput,
  SubagentStartHookSpecificOutput,
  PermissionRequestHookSpecificOutput,
} from '../core/sdk/index.js';

// =============================================================================
// 會話系統
// =============================================================================
export type {
  ExitReason,
  ConfigScope,
  SettingSource,
} from '../core/sdk/index.js';

// =============================================================================
// 訊息類型
// =============================================================================
export type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKSystemMessage,
  SDKUserMessage,
  SDKPartialAssistantMessage,
  SDKToolProgressMessage,
  SDKHookStartedMessage,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
  SDKRateLimitEvent,
  SDKAPIRetryMessage,
  SDKMemoryRecallMessage,
  SDKStatusMessage,
  SDKMirrorErrorMessage,
} from '../core/sdk/index.js';

// =============================================================================
// 常數
// =============================================================================
export { HOOK_EVENTS, EXIT_REASONS } from '../core/sdk/index.js';

// =============================================================================
// AskUserQuestion 類型（SDK 未暴露）
// =============================================================================

/**
 * AskUserQuestion 選項
 */
export interface QuestionOption {
  label: string;
  description: string;
}

/**
 * AskUserQuestion 問題結構
 */
export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

