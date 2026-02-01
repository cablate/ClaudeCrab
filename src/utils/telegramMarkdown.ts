import telegramifyMarkdown from 'telegramify-markdown';

/**
 * Convert standard Markdown to Telegram MarkdownV2 format
 * Returns null if conversion fails (caller should fallback to original text)
 */
export function convertToTelegramMarkdown(text: string): string | null {
  try {
    return telegramifyMarkdown(text, 'escape');
  } catch {
    return null;
  }
}
