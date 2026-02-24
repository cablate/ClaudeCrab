/**
 * TTS (Text-to-Speech) Custom Tool
 *
 * 讓 Agent 可以透過 MCP 呼叫 TTS 功能，將文字轉換成語音並播放。
 * 用途：對話結束摘要、通知、重要訊息語音提醒。
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { TTSService } from '../services/TTSService.js';
import { logger } from '../utils/logger.js';

export interface TTSMcpContext {
  agentId: string;
  chatId?: string;
}

/**
 * Create the TTS MCP server with speak tool.
 */
export function createTTSMcpServer(ttsService: TTSService, context: TTSMcpContext) {
  return createSdkMcpServer({
    name: 'tts',
    version: '1.0.0',
    tools: [
      tool(
        'speak',
        '將文字轉換成語音並在本地播放。用途：對話結束時語音摘要、重要通知、提醒訊息。建議內容簡短扼要（50字內最佳）。',
        {
          text: z.string().describe('要轉換成語音的文字內容，建議簡短扼要'),
          voiceId: z.string().optional().describe('語音 ID（可選，使用預設）'),
          language: z
            .enum(['Chinese', 'English', 'Japanese', 'Korean'])
            .optional()
            .describe('語言（預設: Chinese）'),
          playLocal: z
            .boolean()
            .optional()
            .default(true)
            .describe('是否在本地播放（預設: true）'),
        },
        async (args: {
          text: string;
          voiceId: string | undefined;
          language: 'Chinese' | 'English' | 'Japanese' | 'Korean' | undefined;
          playLocal: boolean;
        }) => {
          logger.info(
            { agentId: context.agentId, textLength: args.text.length },
            '[TTS Tool] Speak invoked'
          );

          // Validate text length
          if (args.text.length > 500) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: '⚠️ 文字過長（超過 500 字）。TTS 適合短訊息，建議精簡後再試。',
                },
              ],
            };
          }

          try {
            const speakOpts: { voiceId?: string; language?: string; playLocal?: boolean } = {};
            if (args.voiceId !== undefined) speakOpts.voiceId = args.voiceId;
            if (args.language !== undefined) speakOpts.language = args.language;
            if (args.playLocal !== undefined) speakOpts.playLocal = args.playLocal;
            
            const result = await ttsService.speak(args.text, speakOpts);

            if (result.success) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `✅ 語音已生成${args.playLocal !== false ? '並播放' : ''}。檔案：${result.filePath}`,
                  },
                ],
              };
            } else {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `❌ 語音生成失敗：${result.error}`,
                  },
                ],
              };
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({ error, text: args.text.substring(0, 50) }, '[TTS Tool] Failed');
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `❌ TTS 錯誤：${errorMessage}`,
                },
              ],
            };
          }
        }
      ),
    ],
  });
}

/**
 * Get the list of TTS tool names.
 */
export function getTTSToolNames(): string[] {
  return ['speak'];
}
