import { format, subDays } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { toZonedTime } from 'date-fns-tz';

/**
 * Hook-related constants
 */

/**
 * Memory checkpoint reminder injected via UserPromptSubmit hook.
 * Reminds the agent to follow memory-system protocol.
 */
export const MEMORY_CHECKPOINT_CONTEXT = `【記憶】遵循 memory-system 規範
1. 上輪有漏記？→ 根據規範寫入對應檔案
2. 處理用戶訊息並回覆
3. 結束前會再次檢查`;

/**
 * Memory checkpoint reminder injected via Stop hook.
 * Final check before ending the conversation turn.
 */
export const MEMORY_STOP_CHECKPOINT =
  '【記憶檢查】結束前，根據 memory-system 規範檢查這輪有沒有該記的內容。有就寫入對應檔案（memory/*.md、ACTIVE.md、MEMORY.md、USER.md、CLAUDE.md），再結束。\n\n【系統更新（批次）】\n- 使用了 domain skill？→ 更新 .claude/skills/system/proficiency/references/levels.md 的使用次數\n- 學到通用規則？→ 更新 .claude/skills/persona/references/soul.md\n- 學到特定適應？→ 寫入 MEMORY.md 或 CLAUDE.md Lessons Learned\n- 達成里程碑？→ 更新 .claude/skills/system/achievements/references/unlocked.md';

/**
 * Build memory stop checkpoint with optional group memory hint (ADR-020).
 */
export function buildMemoryStopCheckpoint(groupChatId?: string): string {
  if (!groupChatId) {
    return MEMORY_STOP_CHECKPOINT;
  }
  return `【記憶檢查（靜默模式）】這是群組對話。有需要記錄的群組事件就直接寫入 groups/${groupChatId}/，沒有就直接結束。不要輸出任何文字——不要分析、不要列檢查項目、不要回報結果。靜默執行工具操作或直接結束。`;
}

const TAIPEI_TZ = 'Asia/Taipei';

/**
 * Startup protocol reminder for new sessions.
 */
export const STARTUP_PROTOCOL_REMINDER =
  '【啟動協議】新 session，回覆前先完成 CLAUDE.md 規定的 Startup Protocol。';

/**
 * Build the complete prompt context with current time.
 * Time is displayed in Asia/Taipei timezone.
 */
export function buildPromptContext(
  chatId?: string,
  isNewSession?: boolean,
  /** Group chat ID when in a group chat (ADR-020) */
  groupChatId?: string
): string {
  const now = toZonedTime(new Date(), TAIPEI_TZ);
  const yesterday = subDays(now, 1);

  const todayDate = format(now, 'yyyy-MM-dd');
  const yesterdayDate = format(yesterday, 'yyyy-MM-dd');
  const displayTime = format(now, 'yyyy/MM/dd HH:mm EEEE', { locale: zhTW });

  let context = `【當前時間】${displayTime}`;

  if (groupChatId) {
    // Group chat: point diary path to group memory, not personal
    context += `\n【群組日誌路徑】groups/${groupChatId}/${todayDate}.md`;
    context += `\n【群組記憶】groups/${groupChatId}/MEMORY.md`;
    context += `\n【群組行為規範】你正在群組中回覆。不要回報內部操作過程（如記憶寫入結果、工具呼叫狀態、檔案讀寫紀錄）。只回覆對使用者有實質意義的內容。`;
  } else {
    context += `\n【日誌路徑】今天: memory/${todayDate}.md | 昨天: memory/${yesterdayDate}.md`;
  }

  if (isNewSession) {
    context += `\n${STARTUP_PROTOCOL_REMINDER}`;
  }

  if (groupChatId) {
    // Group chat: silent memory — do the work but don't talk about it
    context += `\n【記憶】遵循 memory-system 規範，靜默執行記憶操作。不要在回覆中提及記憶寫入過程或結果。`;
  } else {
    context += `\n${MEMORY_CHECKPOINT_CONTEXT}`;
  }

  if (chatId) {
    context += `\n【當前對話】platform: telegram, chatId: ${chatId}`;
  }

  return context;
}
