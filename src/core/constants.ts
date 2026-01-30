import { format, subDays } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { toZonedTime } from 'date-fns-tz';

/**
 * Hook-related constants
 */

/**
 * Memory checkpoint reminder injected via UserPromptSubmit hook.
 * Reminds the agent to save important content from the previous turn
 * before responding to the new message.
 */
export const MEMORY_CHECKPOINT_CONTEXT =
  '【記憶檢查】回覆前，檢查上輪對話是否有該記錄的內容。有就先寫入對應檔案。';

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
export function buildPromptContext(chatId?: string, isNewSession?: boolean): string {
  const now = toZonedTime(new Date(), TAIPEI_TZ);
  const yesterday = subDays(now, 1);

  const todayDate = format(now, 'yyyy-MM-dd');
  const yesterdayDate = format(yesterday, 'yyyy-MM-dd');
  const displayTime = format(now, 'yyyy/MM/dd HH:mm EEEE', { locale: zhTW });

  let context = `【當前時間】${displayTime}`;
  context += `\n【日誌路徑】今天: memory/${todayDate}.md | 昨天: memory/${yesterdayDate}.md`;

  if (isNewSession) {
    context += `\n${STARTUP_PROTOCOL_REMINDER}`;
  }

  context += `\n${MEMORY_CHECKPOINT_CONTEXT}`;

  if (chatId) {
    context += `\n【當前對話】platform: telegram, chatId: ${chatId}`;
  }

  return context;
}
