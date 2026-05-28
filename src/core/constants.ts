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
const MEMORY_CHECKPOINT_CONTEXT = `【記憶（靜默）】遵循 memory-system 規範，靜默執行記憶操作。不要在回覆中提及記憶寫入過程或結果。
1. 上輪有漏記？→ 根據規範寫入對應檔案
2. 處理用戶訊息並回覆
3. 結束前靜默檢查，不要輸出檢查過程`;

/**
 * Memory stop checkpoint prompt injected via Stop hook.
 * When an interactive session is about to stop, this prompt is injected
 * to ensure the agent performs a final memory checkpoint before exiting.
 */
const MEMORY_STOP_CHECKPOINT =
  '⚠️【系統任務：記憶檢查】這不是對話延續——禁止回覆使用者、禁止重複上輪內容。\n\n' +
  '靜默執行：有該記的→寫檔；沒有→直接結束（不輸出文字）。\n\n' +
  '檢查項（靜默）：\n' +
  '• 重要對話/決策/偏好 → memory/{date}.md 或 MEMORY.md\n' +
  '• 對使用者的觀察 → USER.md Observations（思考模式/偏好/盲點/成長/感受/murmur）\n' +
  '• domain skill使用 → sys-proficiency/levels.md\n' +
  '• 人格發現 → soul.md + MEMORY.md Personality Journal\n' +
  '• 操作規則 → CLAUDE.md Lessons Learned\n' +
  '• 方法論/領域知識 → 建獨立 Skill\n' +
  '• 【Admin】員工操作 → agent-changes-log.md';



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
 * Skill proactive invocation reminder.
 * Reminds agents to check if any skills are applicable to the current task.
 */
export const SKILL_REMINDER_CONTEXT = `【Skill 檢查】這輪任務有適用的 skill 嗎？符合觸發時機就主動調用。`;

/**
 * Build the complete prompt context with current time.
 * Time is displayed in Asia/Taipei timezone.
 */
export function buildPromptContext(
  chatId?: string,
  isNewSession?: boolean,
  /** Platform identifier (defaults to 'discord') */
  platform?: string
): string {
  const now = toZonedTime(new Date(), TAIPEI_TZ);
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
