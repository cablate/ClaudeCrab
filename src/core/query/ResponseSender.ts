/**
 * ResponseSender — handles formatting, noise filtering, and delivery of
 * bot responses to the user via BaseAdapter.
 *
 * Extracted from MessageProcessor to separate "response delivery" concerns
 * from "message processing / SDK orchestration".
 */

import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import type { SendOptions } from '../../types/message.js';

import { isRateLimitError, isTransientError } from '../../utils/retry.js';
import { logger } from '../../utils/logger.js';


// ---------------------------------------------------------------------------
// Noise filtering
// ---------------------------------------------------------------------------

const NOISE_PATTERNS = [
  /^No response requested\.?$/i,
  /^No significant events?\b/i,
  /^Nothing (?:significant|notable|important) to (?:record|note|report)\b/i,
  /^沒有(?:重要|顯著|值得).*(?:記錄|紀錄|回報)/,
];

export function isNoiseResponse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  return NOISE_PATTERNS.some(pattern => pattern.test(trimmed));
}

// ---------------------------------------------------------------------------
// Final response delivery
// ---------------------------------------------------------------------------

export async function sendFinalResponse(
  response: string,
  adapter: BaseAdapter,
  chatId: string,
  agentId: string,
  options?: { replyToMessageId?: string },
): Promise<string | undefined> {
  if (isNoiseResponse(response)) return undefined;

  const sendOpts: SendOptions = {};
  if (options?.replyToMessageId) {
    sendOpts.replyToMessageId = options.replyToMessageId;
  }

  const sendResult = await adapter.sendMessage(chatId, response, sendOpts);

  if (!sendResult.success) {
    logger.warn({ error: sendResult.error, chatId }, 'Failed to send response');
    return undefined;
  }

  if (sendResult.messageId) {
    logger.debug(
      { chatId, agentId, lastSentMessageId: sendResult.messageId },
      'Final message sent successfully',
    );
    return sendResult.messageId;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Error message formatting & delivery
// ---------------------------------------------------------------------------

const ERROR_PATTERNS = {
  auth: ['401', '403', 'auth', 'unauthorized', 'forbidden'],
  server: ['500', '502', '503', '504', 'internal server error'],
  rateLimit: ['429', 'rate limit', 'too many requests'],
  overloaded: ['overloaded', 'capacity'],
  timeout: ['timeout', 'etimedout'],
  invalid: ['invalid', '400'],
  content: ['content', 'filter'],
  context: ['context', 'token'],
} as const;

function classifyError(message: string): keyof typeof ERROR_PATTERNS | 'unknown' {
  const lower = message.toLowerCase();
  for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
    if ((patterns as readonly string[]).some(p => lower.includes(p))) {
      return category as keyof typeof ERROR_PATTERNS;
    }
  }
  return 'unknown';
}

export function getUserFriendlyError(error: Error): string {
  if (isRateLimitError(error)) {
    return '抱歉，目前請求過於頻繁，請稍後再試。';
  }

  const category = classifyError(error.message);

  switch (category) {
    case 'timeout':
      return '抱歉，處理超時，請重新發送您的訊息。';
    case 'auth':
      return '抱歉，服務授權發生問題，請聯繫管理員。';
    case 'server':
    case 'overloaded':
      if (isTransientError(error)) {
        return '抱歉，網路連線發生問題，請檢查網路後重試。';
      }
      return '抱歉，服務暫時無法使用，請稍後再試。';
    case 'rateLimit':
      return '抱歉，目前請求過於頻繁，請稍後再試。';
    case 'invalid':
      return '抱歉，您的請求無法處理，請嘗試修改訊息內容。';
    case 'content':
      return '抱歉，您的訊息內容無法處理，請嘗試修改訊息內容。';
    case 'context':
      return '抱歉，對話過長，請使用 /reset 指令重置對話。';
    default:
      if (isTransientError(error)) {
        return '抱歉，網路連線發生問題，請檢查網路後重試。';
      }
      return '抱歉，處理您的訊息時發生錯誤。請稍後再試。';
  }
}

export async function sendErrorToUser(
  adapter: BaseAdapter,
  chatId: string,
  error: Error,
): Promise<void> {
  const userMessage = getUserFriendlyError(error);

  try {
    await adapter.sendMessage(chatId, userMessage);
  } catch (sendError) {
    logger.error({ error: sendError, chatId }, 'Failed to send error message to user');
  }
}
