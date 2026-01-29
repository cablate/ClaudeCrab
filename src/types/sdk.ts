/**
 * SDK 類型轉接層
 * 從 @anthropic-ai/claude-agent-sdk 導入並 re-export
 * 方便 ClaudeCab 內部使用和追蹤
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
} from '@anthropic-ai/claude-agent-sdk';

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
} from '@anthropic-ai/claude-agent-sdk';

// =============================================================================
// 會話系統
// =============================================================================
export type {
  ExitReason,
  ConfigScope,
  SettingSource,
} from '@anthropic-ai/claude-agent-sdk';

// =============================================================================
// 訊息類型
// =============================================================================
export type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
  SDKPartialAssistantMessage,
  SDKToolProgressMessage,
  SDKHookStartedMessage,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
} from '@anthropic-ai/claude-agent-sdk';

// =============================================================================
// 常數
// =============================================================================
export { HOOK_EVENTS, EXIT_REASONS } from '@anthropic-ai/claude-agent-sdk';

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

/**
 * AskUserQuestion 工具輸入
 */
export interface AskUserQuestionInput {
  questions: Question[];
}

/**
 * AskUserQuestion 回應（canUseTool 的 updatedInput）
 */
export interface AskUserQuestionResponse {
  questions: Question[];
  answers: Record<string, string>;
}

// =============================================================================
// 類型別名（方便使用）
// =============================================================================

/**
 * SDK 支援的所有 PermissionMode 值
 * 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'delegate' | 'dontAsk'
 */
export type SDKPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'delegate'
  | 'dontAsk';

/**
 * SDK 支援的所有 Hook 事件名稱（PascalCase）
 */
export type SDKHookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest'
  | 'Setup';
