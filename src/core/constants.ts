import { format, type Locale } from 'date-fns';
import { enUS, zhTW } from 'date-fns/locale';
import { toZonedTime } from 'date-fns-tz';
import { getDisplayTimezone } from '../utils/timezone.js';
import { getDisplayLocale } from '../utils/locale.js';

interface LocaleData {
  dfLocale: Locale;
  timeLabel: string;
  convoLabel: string;
}

/**
 * Per-locale display data. Unknown locales fall back to English.
 * Add entries here when supporting additional display locales.
 */
const EN_DATA: LocaleData = { dfLocale: enUS, timeLabel: 'Current time', convoLabel: 'Conversation' };

const LOCALE_DATA: Record<string, LocaleData> = {
  'zh-TW': { dfLocale: zhTW, timeLabel: '當前時間', convoLabel: '當前對話' },
  en: EN_DATA,
};

/**
 * Build the prompt context for a scheduled task trigger.
 *
 * Intentionally generic: current time + conversation coordinates only.
 * Operator-specific workflow rules do NOT belong in core — each agent carries
 * its own via its CLAUDE.md / systemPrompt.
 *
 * Time is displayed in the configured display timezone (DISPLAY_TIMEZONE,
 * default UTC); labels and date locale follow DISPLAY_LOCALE (default en).
 */
export function buildPromptContext(
  chatId?: string,
  /** Platform identifier (defaults to 'discord') */
  platform?: string
): string {
  const now = toZonedTime(new Date(), getDisplayTimezone());
  const data = LOCALE_DATA[getDisplayLocale()] ?? EN_DATA;
  const displayTime = format(now, 'yyyy/MM/dd HH:mm EEEE', { locale: data.dfLocale });

  let context = `${data.timeLabel}: ${displayTime}`;

  if (chatId) {
    context += `\n${data.convoLabel}: platform=${platform ?? 'unknown'}, chatId=${chatId}`;
  }

  return context;
}
