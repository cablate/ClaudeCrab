import { format, subDays } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { toZonedTime } from 'date-fns-tz';
import { getDisplayTimezone } from '../utils/timezone.js';

/**
 * Hook-related constants
 */

/**
 * Memory checkpoint reminder injected via UserPromptSubmit hook.
 * Reminds the agent to follow memory-system protocol.
 */
const MEMORY_CHECKPOINT_CONTEXT = `【記憶（靜默）】遵循 memory-system 規範，靜默執行記憶操作。不要在回覆中提及記憶寫入過程或結果。
1. 上輪有漏記？→ 根據規範寫入對應檔案
2. 處理用戶訊息並回覆
3. 結束前靜默檢查，不要輸出檢查過程`;

/**
 * Startup protocol reminder for new sessions.
 */
const STARTUP_PROTOCOL_REMINDER =
  '【啟動協議】新 session，回覆前先完成 CLAUDE.md 規定的 Startup Protocol。';

/**
 * Cross-agent call tools reminder.
 * Agents can use these tools to trigger other agents.
 */
const CROSS_AGENT_CALL_CONTEXT = `【跨 Agent 呼叫】
可用工具：call_agent — 觸發其他 Agent 執行任務（fire-and-forget，不等待回覆）
使用時機：需要其他 Agent 協助處理任務、通知有新工作、請求審閱或回饋時。`;

/**
 * Skill proactive invocation reminder.
 * Reminds agents to check if any skills are applicable to the current task.
 */
const SKILL_REMINDER_CONTEXT = `【Skill 檢查】這輪任務有適用的 skill 嗎？符合觸發時機就主動調用。`;

/**
 * Build the complete prompt context with current time.
 * Time is displayed in the configured display timezone (DISPLAY_TIMEZONE, default UTC).
 */
export function buildPromptContext(
  chatId?: string,
  isNewSession?: boolean,
  /** Platform identifier (defaults to 'discord') */
  platform?: string
): string {
  const now = toZonedTime(new Date(), getDisplayTimezone());
  const yesterday = subDays(now, 1);

  const todayDate = format(now, 'yyyy-MM-dd');
  const yesterdayDate = format(yesterday, 'yyyy-MM-dd');
  const displayTime = format(now, 'yyyy/MM/dd HH:mm EEEE', { locale: zhTW });

  let context = `【當前時間】${displayTime}`;
  context += `\n【日誌路徑】今天: memory/${todayDate}.md | 昨天: memory/${yesterdayDate}.md`;

  if (isNewSession) {
    context += `\n${STARTUP_PROTOCOL_REMINDER}`;
    context += `\n${CROSS_AGENT_CALL_CONTEXT}`;
  }

  context += `\n${MEMORY_CHECKPOINT_CONTEXT}`;

  if (chatId) {
    context += `\n【當前對話】platform: ${platform ?? 'unknown'}, chatId: ${chatId}`;
  }

  // Always remind agents to check for applicable skills
  context += `\n${SKILL_REMINDER_CONTEXT}`;

  return context;
}
