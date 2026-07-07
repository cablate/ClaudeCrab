import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { toZonedTime } from 'date-fns-tz';
import { getDisplayTimezone } from '../utils/timezone.js';

/**
 * Build the prompt context for a scheduled task trigger.
 *
 * Intentionally generic: current time + conversation coordinates only.
 * Operator-specific workflow rules (memory systems, cross-agent tooling, skill
 * checks, startup protocols, memory log paths) do NOT belong in core — each
 * agent carries its own via its CLAUDE.md / systemPrompt. This function only
 * adds what every agent can use regardless of operator.
 *
 * Time is displayed in the configured display timezone (DISPLAY_TIMEZONE, default UTC).
 */
export function buildPromptContext(
  chatId?: string,
  /** Platform identifier (defaults to 'discord') */
  platform?: string
): string {
  const now = toZonedTime(new Date(), getDisplayTimezone());
  const displayTime = format(now, 'yyyy/MM/dd HH:mm EEEE', { locale: zhTW });

  let context = `【當前時間】${displayTime}`;

  if (chatId) {
    context += `\n【當前對話】platform: ${platform ?? 'unknown'}, chatId: ${chatId}`;
  }

  return context;
}
