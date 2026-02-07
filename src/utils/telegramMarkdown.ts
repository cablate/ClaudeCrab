import telegramifyMarkdown from 'telegramify-markdown';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import type { SendOptions, SendResult } from '../adapters/types.js';

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

/**
 * Send a message with MarkdownV2 formatting, falling back to Markdown on failure.
 *
 * This consolidates the common pattern of:
 * 1. Convert text to MarkdownV2
 * 2. Try sending with MarkdownV2
 * 3. If that fails, send with plain Markdown
 */
export async function sendWithMarkdownFallback(
  adapter: BaseAdapter,
  chatId: string,
  text: string,
  sendOpts?: SendOptions
): Promise<SendResult> {
  const converted = convertToTelegramMarkdown(text);
  let result = converted
    ? await adapter.sendMessage(chatId, converted, {
        parseMode: 'MarkdownV2',
        ...sendOpts,
      })
    : { success: false as const, error: 'Conversion failed' };

  if (!result.success) {
    result = await adapter.sendMessage(chatId, text, {
      parseMode: 'Markdown',
      ...sendOpts,
    });
  }

  // Final fallback: plain text (no parse_mode) to ensure message is always delivered
  if (!result.success) {
    result = await adapter.sendMessage(chatId, text, {
      ...sendOpts,
    });
  }

  return result;
}
