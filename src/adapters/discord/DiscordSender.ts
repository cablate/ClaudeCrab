/**
 * DiscordSender — Message and media sending utilities for DiscordAdapter.
 *
 * Extracted from DiscordAdapter.ts to reduce file size.
 * All functions take a DiscordSenderDeps object for their dependencies.
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  AttachmentBuilder,
  type TextChannel,
  type ThreadChannel,
  type MessageEditOptions,
} from 'discord.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { splitDiscordMessage } from './discordUtils.js';
import { DiscordRateLimiter } from './DiscordRateLimiter.js';
import { EventType } from '../../utils/events.js';
import type { SendResult } from '../types.js';

export interface DiscordSenderDeps {
  channel: TextChannel | null;
  channelId: string;
  rateLimiter: DiscordRateLimiter;
  resolveTextOrThread(channelId: string): Promise<TextChannel | ThreadChannel | null>;
  resolveTextChannel(channelId: string): Promise<TextChannel | null>;
  resolveChannel(channelId: string): Promise<TextChannel | ThreadChannel | null>;
  log: { error: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void };
  emitMessageSent(chatId: string, text: string, userId: string): void;
}

// ---------------------------------------------------------------------------
// Shared helper — resolve the target TextChannel/ThreadChannel for a given
// chatId, preferring the main channel when chatId matches.
// ---------------------------------------------------------------------------

async function resolveTarget(
  deps: DiscordSenderDeps,
  chatId: string,
): Promise<TextChannel | ThreadChannel | null> {
  return chatId !== deps.channelId
    ? await deps.resolveTextOrThread(chatId)
    : deps.channel;
}

// ============================================================
// Basic Message Sending
// ============================================================

export async function sendMessage(
  deps: DiscordSenderDeps,
  chatId: string,
  text: string,
): Promise<SendResult> {
  if (deps.channel === null) {
    return { success: false, error: 'Channel not initialized' };
  }

  try {
    const targetChannel = await resolveTarget(deps, chatId);

    if (targetChannel === null) {
      return { success: false, error: `Channel/thread ${chatId} not found` };
    }

    const chunks = splitDiscordMessage(text);
    let lastMessageId = '';

    for (const chunk of chunks) {
      const sent = await deps.rateLimiter.rateLimitedSend(() => targetChannel.send(chunk));
      lastMessageId = sent.id;
    }

    deps.emitMessageSent(chatId, text, chatId);

    return { success: true, messageId: lastMessageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, chatId }, 'Failed to send Discord message');
    return { success: false, error: errorMessage };
  }
}

export async function sendStatusMessage(
  deps: DiscordSenderDeps,
  chatId: string,
  initialText: string = '🔄 處理中...',
): Promise<string | null> {
  try {
    const targetChannel = await resolveTarget(deps, chatId);

    if (targetChannel === null) return null;

    // Code fence adds 8 chars overhead; truncate to stay within Discord's 2000-char limit
    const MAX_STATUS_BODY = 1990;
    const safeText = initialText.length > MAX_STATUS_BODY
      ? initialText.slice(0, MAX_STATUS_BODY - 3) + '...'
      : initialText;
    const msg = await deps.rateLimiter.rateLimitedSend(() => targetChannel.send(`\`\`\`\n${safeText}\n\`\`\``));
    return msg.id;
  } catch (error) {
    deps.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, chatId }, 'Failed to send status message');
    return null;
  }
}

export async function sendSubtitleMessage(
  deps: DiscordSenderDeps,
  chatId: string,
  text: string,
): Promise<string | null> {
  try {
    const targetChannel = await resolveTarget(deps, chatId);

    if (targetChannel === null) return null;

    const safeText = text.length > 1990 ? text.slice(0, 1987) + '...' : text;
    const msg = await deps.rateLimiter.rateLimitedSend(() => targetChannel.send(safeText));
    return msg.id;
  } catch (error) {
    deps.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, chatId }, 'Failed to send subtitle message');
    return null;
  }
}

export async function updateStatusMessage(
  deps: DiscordSenderDeps,
  chatId: string,
  messageId: string,
  text: string,
): Promise<boolean> {
  try {
    const targetChannel = await resolveTarget(deps, chatId);

    if (targetChannel === null) return false;

    const msg = await targetChannel.messages.fetch(messageId);
    await deps.rateLimiter.rateLimitedSend(() => msg.edit(`\`\`\`\n${text}\n\`\`\``));
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (!errorMsg.includes('Unknown Message')) {
      deps.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, chatId, messageId }, 'Failed to update status message');
    }
    return false;
  }
}

// ============================================================
// Rich Messaging: Embed + Button
// ============================================================

export async function sendEmbed(
  deps: DiscordSenderDeps,
  channelId: string,
  embeds: EmbedBuilder[],
  components?: ActionRowBuilder<ButtonBuilder>[],
): Promise<SendResult> {
  try {
    const channel = await deps.resolveTextOrThread(channelId);
    if (channel === null) {
      return { success: false, error: `Channel ${channelId} not found or not text` };
    }

    const payload: { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] } = { embeds };
    if (components !== undefined) {
      payload.components = components;
    }
    const msg = await deps.rateLimiter.rateLimitedSend(() => channel.send(payload));

    return { success: true, messageId: msg.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, channelId }, 'Failed to send embed');
    return { success: false, error: errorMessage };
  }
}

export async function editEmbed(
  deps: DiscordSenderDeps,
  channelId: string,
  messageId: string,
  embeds: EmbedBuilder[],
  components?: ActionRowBuilder<ButtonBuilder>[],
): Promise<SendResult> {
  try {
    const channel = await deps.resolveTextChannel(channelId);
    if (channel === null) {
      return { success: false, error: `Channel ${channelId} not found` };
    }

    const message = await channel.messages.fetch(messageId);
    const editPayload: MessageEditOptions = { embeds };
    if (components !== undefined) {
      editPayload.components = components as ActionRowBuilder<ButtonBuilder>[];
    }
    await deps.rateLimiter.rateLimitedSend(() => message.edit(editPayload));

    return { success: true, messageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, channelId, messageId }, 'Failed to edit embed');
    return { success: false, error: errorMessage };
  }
}

export async function sendToChannel(
  deps: DiscordSenderDeps,
  channelId: string,
  content: string,
): Promise<SendResult> {
  try {
    const channel = await deps.resolveTextChannel(channelId);
    if (channel === null) {
      return { success: false, error: `Channel ${channelId} not found` };
    }

    const chunks = splitDiscordMessage(content);
    let lastMessageId = '';
    for (const chunk of chunks) {
      const sent = await deps.rateLimiter.rateLimitedSend(() => channel.send(chunk));
      lastMessageId = sent.id;
    }

    return { success: true, messageId: lastMessageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, channelId }, 'Failed to send to channel');
    return { success: false, error: errorMessage };
  }
}

// ============================================================
// Edit Message
// ============================================================

export async function editMessage(
  deps: DiscordSenderDeps,
  chatId: string,
  messageId: string,
  text: string,
): Promise<SendResult> {
  try {
    const channel = await deps.resolveTextOrThread(chatId) ?? deps.channel;
    if (channel === null) return { success: false, error: 'Channel not found' };

    const message = await channel.messages.fetch(messageId);
    await deps.rateLimiter.rateLimitedSend(() => message.edit({ content: text, components: [] }));
    return { success: true, messageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.log.warn({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, messageId }, 'Failed to edit Discord message');
    return { success: false, error: errorMessage };
  }
}

// ============================================================
// Media Sending
// ============================================================

export async function sendPhoto(
  deps: DiscordSenderDeps,
  chatId: string,
  filePath: string,
  caption?: string,
): Promise<SendResult> {
  return sendFileAttachment(deps, chatId, filePath, caption);
}

export async function sendDocument(
  deps: DiscordSenderDeps,
  chatId: string,
  filePath: string,
  caption?: string,
): Promise<SendResult> {
  return sendFileAttachment(deps, chatId, filePath, caption);
}

export async function sendVideo(
  deps: DiscordSenderDeps,
  chatId: string,
  filePath: string,
  caption?: string,
): Promise<SendResult> {
  return sendFileAttachment(deps, chatId, filePath, caption);
}

export async function sendAudio(
  deps: DiscordSenderDeps,
  chatId: string,
  audio: Buffer,
  options?: { duration?: number; caption?: string; filename?: string },
): Promise<SendResult> {
  try {
    const target = await resolveTarget(deps, chatId);
    if (target === null) {
      return { success: false, error: 'Channel not found' };
    }
    const attachment = new AttachmentBuilder(audio, { name: options?.filename ?? 'audio.mp3' });
    const payload: { files: AttachmentBuilder[]; content?: string } = { files: [attachment] };
    if (options?.caption !== undefined) payload.content = options.caption;
    const msg = await deps.rateLimiter.rateLimitedSend(() => target.send(payload));
    return { success: true, messageId: msg.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error }, 'Failed to send audio');
    return { success: false, error: errorMessage };
  }
}

async function sendFileAttachment(
  deps: DiscordSenderDeps,
  chatId: string,
  filePath: string,
  caption?: string,
): Promise<SendResult> {
  try {
    const target = await resolveTarget(deps, chatId);
    if (target === null) {
      return { success: false, error: 'Channel not found' };
    }
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }
    const attachment = new AttachmentBuilder(filePath, { name: path.basename(filePath) });
    const payload: { files: AttachmentBuilder[]; content?: string } = { files: [attachment] };
    if (caption !== undefined) payload.content = caption;
    const msg = await deps.rateLimiter.rateLimitedSend(() => target.send(payload));
    return { success: true, messageId: msg.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.log.error({ event_type: EventType.ADAPTER_SEND_ERROR, err: error, filePath }, 'Failed to send file attachment');
    return { success: false, error: errorMessage };
  }
}
