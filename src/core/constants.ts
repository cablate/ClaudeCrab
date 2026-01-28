/**
 * Hook-related constants
 */

/**
 * Memory checkpoint reminder injected via UserPromptSubmit hook.
 * Reminds the agent to save important content from the previous turn
 * before responding to the new message.
 */
export const MEMORY_CHECKPOINT_CONTEXT =
  '【記憶檢查點】回覆前，先檢查上一輪對話是否有值得記錄的內容。如果有，先寫入對應的記憶檔案再回覆使用者。';
