import {
  MessageFlags,
  MessageType,
  type Client,
  type Message as DiscordMessage,
} from 'discord.js';
import type { UnifiedMessage } from '../../types/message.js';
import type { SecurityConfig } from '../../utils/security.js';
import {
  validateMessage,
  getSecurityErrorMessage,
  detectPromptInjection,
} from '../../utils/security.js';
import { auditLogger } from '../../utils/audit.js';
import { EventType } from '../../utils/events.js';
import {
  downloadAttachment,
  formatAttachmentContext,
  isAutoConvertedTextFile,
  type AttachmentInfo,
} from '../../utils/attachmentDownloader.js';
import type { STTProvider } from '../../core/stt/index.js';
import type { Logger } from 'pino';

export interface DiscordMessageContext {
  channelId: string;
  agentId: string;
  agentsDir: string;
  securityConfig: SecurityConfig;
  log: Logger;
  client: Client;
  scheduleThreadResolver: ((threadId: string) => { sdkSessionId: string; agentId: string } | undefined) | undefined;
  sttProvider?: STTProvider | undefined;
  generateThreadTitle: (text: string) => Promise<string | null>;
  emitMessage: (msg: UnifiedMessage) => Promise<void>;
}

export async function handleDiscordMessage(
  message: DiscordMessage,
  ctx: DiscordMessageContext
): Promise<void> {
  const { channelId, agentId, securityConfig, log } = ctx;

  const isMainChannel = message.channelId === channelId;
  const isChildThread = message.channel.isThread() && message.channel.parentId === channelId;

  if (!isMainChannel && !isChildThread) return;
  if (message.author.bot) return;
  if (message.type !== MessageType.Default && message.type !== MessageType.Reply) return;

  let userId = message.author.id;
  let text = message.content;

  // --- Voice message transcription ---
  const isVoiceMessage = message.flags.has(MessageFlags.IsVoiceMessage);

  if (isVoiceMessage && ctx.sttProvider) {
    const voiceAttachment = message.attachments.first();
    if (voiceAttachment) {
      try {
        const response = await fetch(voiceAttachment.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const audioBuffer = Buffer.from(await response.arrayBuffer());
        const fileName = voiceAttachment.name ?? 'voice.ogg';

        const result = await ctx.sttProvider.transcribe(audioBuffer, { fileName });
        const durationInfo = result.duration !== undefined ? ` (${Math.round(result.duration)}s)` : '';

        text = result.text;
        log.info(
          { event_type: EventType.ADAPTER_MESSAGE_INGRESS, userId, fileName, duration: result.duration, language: result.language, textLength: text.length },
          `Voice message transcribed${durationInfo}`
        );
      } catch (err) {
        log.error({ event_type: EventType.ADAPTER_MESSAGE_ERROR, err, userId }, 'Voice message transcription failed');
        await message.reply('語音轉文字失敗，請重試或改用文字輸入。');
        return;
      }
    }
  }

  // --- Attachment handling (skip for voice messages — already transcribed) ---
  let isFromAttachment = false;
  const downloadedAttachments: AttachmentInfo[] = [];

  if (!isVoiceMessage && message.attachments.size > 0) {
    const agentsDir = ctx.agentsDir;

    // ⚠️ 注意：必須使用單一迴圈 + continue，不可拆成 Phase 1 (inline) + Phase 2 (filter+download)
    //
    // 邊界案例說明（踩過坑）：
    //
    // 案例 A：使用者打字「幫我看」+ 上傳 notes.txt
    //   - text.trim().length > 0 → 不進入 inline 分支
    //   - continue 不會執行 → 正常進 downloadAttachment 下載檔案 ✅
    //   - 若拆成兩階段，Phase 2 的 filter 會直接把 .txt 濾掉 → 檔案遺失 ❌
    //
    // 案例 B：使用者只上傳 auto-converted .txt（Discord 把長訊息轉檔）
    //   - text.trim().length === 0 → 進入 inline 分支
    //   - continue 跳過 download → 文字內容直接用 ✅
    //
    // 案例 C：使用者上傳圖片/PDF（非文字檔）
    //   - isAutoConvertedTextFile 回傳 false → 不進 inline
    //   - 正常進 downloadAttachment ✅
    //
    // 核心原則：continue 同時控制了「已 inline 就不下載」與
    // 「未 inline 就不能被 filter 擋掉」兩種行為，不可分離。
    // 2026-06-03 hotfix: revert from Phase 1/2 split back to single loop.
    for (const [, attachment] of message.attachments) {
      const fileName = attachment.name ?? 'unknown';
      const mimeType = attachment.contentType ?? undefined;

      if (isAutoConvertedTextFile(fileName, mimeType) && text.trim().length === 0) {
        try {
          const response = await fetch(attachment.url);
          if (response.ok) {
            text = await response.text();
            isFromAttachment = true;
            log.info(
              { event_type: EventType.ADAPTER_MESSAGE_INGRESS, userId, fileName, size: attachment.size, extractedLength: text.length },
              'Extracted text from auto-converted .txt attachment'
            );
          }
        } catch (err) {
          log.warn({ event_type: EventType.ADAPTER_MESSAGE_ERROR, err, url: attachment.url }, 'Failed to fetch .txt attachment');
        }
        continue;
      }

      const result = await downloadAttachment(
        attachment.url,
        fileName,
        agentsDir,
        agentId,
        attachment.size,
      );
      if (result.success && result.filePath) {
        downloadedAttachments.push({
          fileName,
          mimeType,
          fileSize: result.fileSize,
          localPath: result.filePath,
        });
      } else {
        log.warn({ event_type: EventType.ADAPTER_MESSAGE_ERROR, fileName, error: result.error }, 'Failed to download attachment');
      }
    }

    if (downloadedAttachments.length > 0) {
      const attachmentContext = formatAttachmentContext(downloadedAttachments);
      text = text.trim().length > 0
        ? `${text}\n\n${attachmentContext}`
        : attachmentContext;
    }
  }

  if (text.trim().length === 0) return;

  // --- Security validation ---
  const hasAttachments = isFromAttachment || downloadedAttachments.length > 0;
  const validation = hasAttachments
    ? validateMessage('', userId, securityConfig)
    : validateMessage(text, userId, securityConfig);

  if (!validation.valid) {
    if (validation.error === 'unauthorized') {
      auditLogger.logUnauthorizedAccess('discord', userId, channelId);
      log.warn({ event_type: EventType.ADAPTER_MESSAGE_REJECTED, userId }, 'Unauthorized access attempt');
    } else if (validation.error === 'message_too_long') {
      auditLogger.logValidationFailed('discord', userId, 'message_too_long', channelId);
    }
    const error = validation.error ?? 'unknown';
    const errorMessage = getSecurityErrorMessage(error);
    await message.reply(errorMessage);
    return;
  }

  // Track injection flag across both text and attachment paths
  const injectionPatterns: string[] = [];

  if (validation.warnings?.includes('potential_prompt_injection')) {
    // validateMessage() already ran detectPromptInjection internally;
    // re-detect here only to capture pattern list for audit + downstream metadata.
    const patterns = detectPromptInjection(text, securityConfig);
    injectionPatterns.push(...patterns);
    auditLogger.logInjectionDetected('discord', userId, patterns, channelId);
    log.warn({ event_type: EventType.ADAPTER_MESSAGE_REJECTED, userId, patternCount: patterns.length }, 'Potential prompt injection detected');
  }

  // For attachment-based messages (auto-converted .txt OR regular downloads),
  // run a separate injection scan since the content source differs from the text input.
  if (hasAttachments && !validation.warnings?.includes('potential_prompt_injection')) {
    const patterns = detectPromptInjection(text, securityConfig);
    injectionPatterns.push(...patterns);
    if (patterns.length > 0) {
      auditLogger.logInjectionDetected('discord', userId, patterns, channelId);
      log.warn({ event_type: EventType.ADAPTER_MESSAGE_REJECTED, userId, patternCount: patterns.length }, 'Potential prompt injection detected in attachment content');
    }
  }

  // --- Thread routing ---
  let chatId: string;
  let threadId: string | undefined;

  if (isChildThread) {
    chatId = message.channelId;
    threadId = message.channelId;
  } else {
    try {
      const fallbackTitle = text.length > 50 ? text.slice(0, 47) + '...' : text;
      const thread = await message.startThread({
        name: fallbackTitle,
        autoArchiveDuration: 10080,
      });
      chatId = thread.id;
      threadId = thread.id;
      log.info({ event_type: EventType.ADAPTER_MESSAGE_INGRESS, threadId: thread.id, title: fallbackTitle }, 'Auto-created thread for new conversation');

      ctx.generateThreadTitle(text).then(async (aiTitle) => {
        if (aiTitle && aiTitle !== fallbackTitle) {
          try {
            await thread.setName(aiTitle);
            log.info({ event_type: EventType.ADAPTER_MESSAGE_INGRESS, threadId: thread.id, oldTitle: fallbackTitle, newTitle: aiTitle }, 'Thread renamed with AI-generated title');
          } catch (renameErr) {
            log.warn({ event_type: EventType.ADAPTER_MESSAGE_ERROR, err: renameErr, threadId: thread.id }, 'Failed to rename thread');
          }
        }
      }).catch((err) => {
        log.warn({ event_type: EventType.ADAPTER_MESSAGE_ERROR, err }, 'AI thread title generation failed');
      });
    } catch (err) {
      log.warn({ event_type: EventType.ADAPTER_MESSAGE_ERROR, err }, 'Failed to auto-create thread, using main channel');
      chatId = channelId;
      threadId = undefined;
    }
  }

  // --- Schedule thread override ---
  let inheritedSdkSessionId: string | undefined;

  if (isChildThread && ctx.scheduleThreadResolver) {
    const resolved = ctx.scheduleThreadResolver(message.channelId);
    if (resolved) {
      inheritedSdkSessionId = resolved.sdkSessionId;
      userId = `schedule:thread:${message.channelId}`;
      log.info({ event_type: EventType.ADAPTER_MESSAGE_INGRESS, threadId: message.channelId, sdkSessionId: resolved.sdkSessionId }, 'Schedule thread detected — bridging session for continuity');
    }
  }

  // --- Build UnifiedMessage ---
  const displayName = message.member?.displayName ?? message.author.displayName;

  const unifiedMessage: UnifiedMessage = {
    id: `discord:${message.id}:${chatId}`,
    platform: 'discord',
    userId,
    chatId,
    text,
    timestamp: message.createdAt,
    metadata: {
      originalMessageId: message.id,
      sourceMessageChannelId: message.channelId,
      displayName,
      username: message.author.username,
      ...(inheritedSdkSessionId !== undefined ? { inheritedSdkSessionId } : {}),
      ...(threadId !== undefined && inheritedSdkSessionId === undefined ? {
        sessionUserId: `${userId}::thread::${threadId}`,
        parentConversationId: channelId,
      } : {}),
      ...(injectionPatterns.length > 0 ? { injectionDetected: injectionPatterns } : {}),
    },
  };

  auditLogger.logUserMessage(unifiedMessage);

  void ctx.emitMessage(unifiedMessage).catch((error) => {
    log.error({ event_type: EventType.ADAPTER_MESSAGE_ERROR, err: error }, 'Error emitting Discord message');
  });
}
