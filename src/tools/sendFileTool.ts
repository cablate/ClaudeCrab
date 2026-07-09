/**
 * File Send Custom Tool
 *
 * 讓 Agent 透過 MCP tool 明確傳送檔案給使用者。
 * 自動偵測副檔名選擇最適合的傳送方式（圖片/音檔/文件）。
 */
import { createSdkMcpServer, tool } from '../core/sdk/index.js';
import { z } from 'zod';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import { logger } from '../utils/logger.js';
import { existsSync } from 'node:fs';
import fs from 'node:fs';
import * as path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);

/**
 * Create the file-send MCP server.
 */
export function createSendFileMcpServer(adapter: BaseAdapter, chatId: string) {
  return createSdkMcpServer({
    name: 'file-send',
    version: '1.0.0',
    tools: [
      tool(
        'send_file',
        '傳送檔案給使用者。自動偵測檔案類型（圖片以照片方式傳送、音檔以可播放音訊傳送、其他以文件傳送）。傳送前會驗證檔案是否存在。',
        {
          path: z.string().describe('檔案的完整路徑（絕對路徑或相對於工作目錄的路徑）'),
          caption: z.string().optional().describe('附帶說明文字（可選）'),
        },
        async (args: { path: string; caption: string | undefined }) => {
          const raw = args.path.trim();
          const resolved = existsSync(raw) ? raw : path.resolve(process.cwd(), raw);

          if (!existsSync(resolved)) {
            logger.warn({ chatId, path: raw, resolved }, '[send_file] File not found');
            return {
              content: [{
                type: 'text' as const,
                text: `❌ 檔案不存在：${raw}`,
              }],
            };
          }

          const ext = path.extname(resolved).toLowerCase();
          const filename = path.basename(resolved);

          try {
            if (IMAGE_EXTENSIONS.has(ext)) {
              const result = await adapter.sendPhoto(chatId, resolved, args.caption);
              if (result.success) {
                logger.info({ chatId, filePath: resolved }, '[send_file] Sent image');
                return {
                  content: [{
                    type: 'text' as const,
                    text: `✅ 已傳送圖片：${filename}`,
                  }],
                };
              }
              return {
                content: [{
                  type: 'text' as const,
                  text: `❌ 圖片傳送失敗：${result.error}`,
                }],
              };
            }

            if (VIDEO_EXTENSIONS.has(ext)) {
              const result = await adapter.sendVideo(chatId, resolved, args.caption);
              if (result.success) {
                logger.info({ chatId, filePath: resolved }, '[send_file] Sent video');
                return {
                  content: [{
                    type: 'text' as const,
                    text: `✅ 已傳送影片：${filename}`,
                  }],
                };
              }
              return {
                content: [{
                  type: 'text' as const,
                  text: `❌ 影片傳送失敗：${result.error}`,
                }],
              };
            }

            if (AUDIO_EXTENSIONS.has(ext)) {
              const audioBuffer = await fs.promises.readFile(resolved);
              const audioOpts: { filename: string; caption?: string } = { filename };
              if (args.caption !== undefined) audioOpts.caption = args.caption;
              const result = await adapter.sendAudio(chatId, audioBuffer, audioOpts);
              if (result.success) {
                logger.info({ chatId, filePath: resolved }, '[send_file] Sent audio');
                return {
                  content: [{
                    type: 'text' as const,
                    text: `✅ 已傳送音檔：${filename}`,
                  }],
                };
              }
              return {
                content: [{
                  type: 'text' as const,
                  text: `❌ 音檔傳送失敗：${result.error}`,
                }],
              };
            }

            // Default: send as document
            const result = await adapter.sendDocument(chatId, resolved, args.caption);
            if (result.success) {
              logger.info({ chatId, filePath: resolved }, '[send_file] Sent document');
              return {
                content: [{
                  type: 'text' as const,
                  text: `✅ 已傳送文件：${filename}`,
                }],
              };
            }
            return {
              content: [{
                type: 'text' as const,
                text: `❌ 文件傳送失敗：${result.error}`,
              }],
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({ error, chatId, path: resolved }, '[send_file] Failed');
            return {
              content: [{
                type: 'text' as const,
                text: `❌ 傳送錯誤：${errorMessage}`,
              }],
            };
          }
        },
      ),
    ],
  });
}

export function getSendFileToolNames(): string[] {
  return ['send_file'];
}
