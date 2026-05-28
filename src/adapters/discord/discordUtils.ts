import { query } from '@anthropic-ai/claude-agent-sdk';
import { ConfigTransformer } from '../../core/lib/ConfigTransformer.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';

const MAX_MESSAGE_LENGTH = 2000;

export function splitDiscordMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);

    if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH / 2) {
      splitIndex = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
    }

    if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH / 2) {
      splitIndex = MAX_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

export async function generateThreadTitle(messageText: string): Promise<string | null> {
  const input = messageText.length > 200 ? messageText.slice(0, 200) : messageText;

  const prompt = `將使用者訊息濃縮成一個繁體中文 thread 標題。

規則：
- 必須使用繁體中文
- 最多 15 個字（中文字），英文專有名詞可保留原文
- 寫出使用者「要做什麼」，不要抽象概括
- 不加引號、標點、emoji、「問題」「探討」「分析」等空泛詞
- 只回覆標題本身

好的標題：
「幫我看 Discord 訊息堵塞」→ 排查Discord訊息堵塞
「Can you fix the login bug on mobile?」→ 修復手機端登入bug
「我想加一個新的 slash command」→ 新增slash command

壞的標題（不要這樣寫）：
「登入問題探討」「Discord相關問題」「功能需求分析」

使用者訊息：
${input}`;

  try {
    const q = query({
      prompt,
      options: {
        model: ConfigTransformer.resolveModel('haiku'),
        maxTurns: 1,
        tools: [],
        persistSession: false,
        permissionMode: 'dontAsk',
      },
    });

    let result = '';
    for await (const msg of q) {
      if (msg.type === 'result') {
        if (msg.subtype === 'success') result = msg.result;
        break;
      }
    }

    const title = result.trim();
    if (!title || title.length > 30) return null;
    return title;
  } catch (err) {
    logger.warn({ event_type: EventType.ADAPTER_MESSAGE_ERROR, err }, 'generateThreadTitle failed');
    return null;
  }
}
