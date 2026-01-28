/**
 * Hook-related constants
 */

/**
 * Memory checkpoint reminder injected via UserPromptSubmit hook.
 * Reminds the agent to save important content from the previous turn
 * before responding to the new message.
 */
export const MEMORY_CHECKPOINT_CONTEXT =
  '【記憶檢查】回覆前，參照 CLAUDE.md 的 Memory System 段落，檢查上輪對話是否有該記錄的內容。有就先寫入對應檔案。';
