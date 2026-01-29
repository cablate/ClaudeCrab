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

/**
 * Weekday names in Traditional Chinese
 */
const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

/**
 * Build the complete prompt context with current time.
 * Time is displayed in Asia/Taipei timezone.
 */
export function buildPromptContext(chatId?: string): string {
  const now = new Date();
  const taipeiTime = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  
  // Get weekday in Taipei timezone
  const taipeiDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const weekday = WEEKDAYS[taipeiDate.getDay()];
  
  let context = `【當前時間】${taipeiTime} ${weekday}\n${MEMORY_CHECKPOINT_CONTEXT}`;
  
  if (chatId) {
    context += `\n【當前對話】platform: telegram, chatId: ${chatId}`;
  }
  
  return context;
}
