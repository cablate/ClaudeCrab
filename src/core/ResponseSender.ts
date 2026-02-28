/**
 * ResponseSender — handles formatting, noise filtering, and delivery of
 * bot responses to the user via BaseAdapter.
 *
 * Extracted from MessageProcessor to separate "response delivery" concerns
 * from "message processing / SDK orchestration".
 */

import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import type { SendOptions } from '../adapters/types.js';
import { sendWithMarkdownFallback } from '../utils/telegramMarkdown.js';
import { isRateLimitError, isTransientError } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { existsSync } from 'node:fs';
import fs from 'node:fs';
import * as path from 'node:path';

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
// Inline media regex
// ---------------------------------------------------------------------------

export const IMAGE_PATH_RE =
  /(?:^|[\s`]|!\[[^\]]*\]\()(?<fp>(?:[A-Za-z]:[\\\/]|\/|[\w.-]+[\/\\])[^\s"'<>)`]*\.(?:png|jpe?g|gif|webp))\)?(?:[\s`]|$|[.。,，)）\]])/gim;

export const DOCUMENT_PATH_RE = /\[send:(?<fp>[^\]]+)\]/gim;

// ---------------------------------------------------------------------------
// Inline media extraction & sending
// ---------------------------------------------------------------------------

export async function sendInlineImages(
  text: string,
  adapter: BaseAdapter,
  chatId: string,
  sendOpts?: SendOptions,
): Promise<string> {
  const paths: string[] = [];
  const originals: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(IMAGE_PATH_RE.source, IMAGE_PATH_RE.flags);
  while ((match = re.exec(text)) !== null) {
    const raw = (match.groups?.fp ?? match[1])?.trim();
    if (!raw) continue;
    const resolved = existsSync(raw) ? raw : path.resolve(process.cwd(), raw);
    if (existsSync(resolved)) {
      paths.push(resolved);
      originals.push(raw);
    }
  }
  if (paths.length === 0) return text;

  for (const p of paths) {
    const result = await adapter.sendPhoto(chatId, p);
    if (result.success) {
      logger.debug({ chatId, filePath: p }, 'Sent inline image as photo');
    } else {
      logger.warn({ chatId, filePath: p, error: result.error }, 'Failed to send inline image');
    }
  }

  let cleaned = text;
  for (const raw of originals) {
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`!\\[[^\\]]*\\]\\(\\s*${escaped}\\s*\\)`, 'g'), '');
    cleaned = cleaned.replace(raw, '');
  }
  cleaned = cleaned.replace(/`\s*`/g, '').replace(/!\[[^\]]*\]\(\s*\)/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

export async function sendInlineDocuments(
  text: string,
  adapter: BaseAdapter,
  chatId: string,
  _sendOpts?: SendOptions,
): Promise<string> {
  logger.info({ text: text.substring(0, 200) }, '[sendInlineDocuments] called');
  const paths: string[] = [];
  const originals: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(DOCUMENT_PATH_RE.source, DOCUMENT_PATH_RE.flags);
  while ((match = re.exec(text)) !== null) {
    const raw = (match.groups?.fp ?? match[1])?.trim();
    if (!raw) continue;
    const asIs = existsSync(raw);
    const resolved = asIs ? raw : path.resolve(process.cwd(), raw);
    const resolvedExists = existsSync(resolved);

    if (resolvedExists) {
      paths.push(resolved);
      originals.push(raw);
    } else {
      logger.warn({ raw, resolved, asIs, resolvedExists }, '[sendInlineDocuments] Path matched but file not found');
    }
  }
  if (paths.length === 0) return text;

  const audioExtensions = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);

  for (const p of paths) {
    const ext = path.extname(p).toLowerCase();
    const isAudio = audioExtensions.has(ext);

    if (isAudio) {
      const audioBuffer = await fs.promises.readFile(p);
      const filename = path.basename(p);
      const result = await adapter.sendAudio(chatId, audioBuffer, { filename });
      if (result.success) {
        logger.info({ chatId, filePath: p }, 'Sent inline audio');
      } else {
        logger.warn({ chatId, filePath: p, error: result.error }, 'Failed to send inline audio');
      }
    } else {
      const result = await adapter.sendDocument(chatId, p);
      if (result.success) {
        logger.info({ chatId, filePath: p }, 'Sent inline document');
      } else {
        logger.warn({ chatId, filePath: p, error: result.error }, 'Failed to send inline document');
      }
    }
  }

  let cleaned = text;
  for (const raw of originals) {
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`\\[send:\\s*${escaped}\\s*\\]`, 'gi'), '');
  }
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

// ---------------------------------------------------------------------------
// Final response delivery
// ---------------------------------------------------------------------------

export async function sendFinalResponse(
  response: string,
  adapter: BaseAdapter,
  chatId: string,
  agentId: string,
  options?: { isGroupChat?: boolean; replyToMessageId?: string },
): Promise<string | undefined> {
  if (isNoiseResponse(response)) return undefined;

  const sendOpts: SendOptions = {};
  if (options?.isGroupChat && options?.replyToMessageId) {
    sendOpts.replyToMessageId = options.replyToMessageId;
  }

  let cleaned = await sendInlineImages(response, adapter, chatId, sendOpts);
  if (isNoiseResponse(cleaned)) return undefined;

  cleaned = await sendInlineDocuments(cleaned, adapter, chatId, sendOpts);
  if (isNoiseResponse(cleaned)) return undefined;

  const sendResult = await sendWithMarkdownFallback(adapter, chatId, cleaned, sendOpts);

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

export function getUserFriendlyError(error: Error): string {
  const message = error.message.toLowerCase();

  if (isRateLimitError(error)) {
    return '抱歉，目前請求過於頻繁，請稍後再試。';
  }
  if (message.includes('timeout') || message.includes('etimedout')) {
    return '抱歉，處理超時，請重新發送您的訊息。';
  }
  if (isTransientError(error) && !message.includes('500')) {
    return '抱歉，網路連線發生問題，請檢查網路後重試。';
  }
  if (message.includes('auth') || message.includes('401') || message.includes('403')) {
    return '抱歉，服務授權發生問題，請聯繫管理員。';
  }
  if (message.includes('500') || message.includes('502') || message.includes('503')) {
    return '抱歉，服務暫時無法使用，請稍後再試。';
  }
  if (message.includes('invalid') || message.includes('400')) {
    return '抱歉，您的請求無法處理，請嘗試修改訊息內容。';
  }
  if (message.includes('content') || message.includes('filter')) {
    return '抱歉，您的訊息內容無法處理，請嘗試修改訊息內容。';
  }
  if (message.includes('context') || message.includes('token')) {
    return '抱歉，對話過長，請使用 /reset 指令重置對話。';
  }
  return '抱歉，處理您的訊息時發生錯誤。請稍後再試。';
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
