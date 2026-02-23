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
export const MEMORY_CHECKPOINT_CONTEXT = `【記憶（靜默）】遵循 memory-system 規範，靜默執行記憶操作。不要在回覆中提及記憶寫入過程或結果。
1. 上輪有漏記？→ 根據規範寫入對應檔案
2. 處理用戶訊息並回覆
3. 結束前靜默檢查，不要輸出檢查過程`;



const TAIPEI_TZ = 'Asia/Taipei';

/**
 * Startup protocol reminder for new sessions.
 */
export const STARTUP_PROTOCOL_REMINDER =
  '【啟動協議】新 session，回覆前先完成 CLAUDE.md 規定的 Startup Protocol。';

/**
 * Cross-agent call tools reminder.
 * Agents can use these tools to trigger other agents.
 */
export const CROSS_AGENT_CALL_CONTEXT = `【跨 Agent 呼叫】
可用工具：call_agent — 觸發其他 Agent 執行任務（fire-and-forget，不等待回覆）
使用時機：需要其他 Agent 協助處理任務、通知有新工作、請求審閱或回饋時。`;

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
    context += `\n【群組回覆長度】群組中回覆保持簡潔，通常不超過 3-5 段。需要詳細回覆時，先給摘要，再問是否要展開。`;
  } else {
    context += `\n【日誌路徑】今天: memory/${todayDate}.md | 昨天: memory/${yesterdayDate}.md`;
  }

  if (isNewSession) {
    context += `\n${STARTUP_PROTOCOL_REMINDER}`;
    context += `\n${CROSS_AGENT_CALL_CONTEXT}`;
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
