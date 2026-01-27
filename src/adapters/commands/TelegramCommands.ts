import type { Context } from 'grammy';
import type { AgentLoader } from '../../core/AgentLoader.js';
import type { SessionManager } from '../../core/SessionManager.js';
import type { MessageProcessor } from '../../core/MessageProcessor.js';
import { logger } from '../../utils/logger.js';

/**
 * Dependencies required for command handlers
 */
export interface CommandDependencies {
  /** Agent loader for listing agents */
  agentLoader: AgentLoader;

  /** Session manager for session operations */
  sessionManager: SessionManager;

  /** Message processor for conversation operations */
  messageProcessor: MessageProcessor;

  /** Agent ID this bot is bound to */
  agentId: string;
}

/**
 * Command handler function type
 */
export type CommandHandler = (
  ctx: Context,
  deps: CommandDependencies
) => Promise<void>;

/**
 * Handle /start command
 * Sends a welcome message and creates initial session
 */
export async function handleStart(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const userId = ctx.from?.id.toString();
  const firstName = ctx.from?.first_name ?? '你';

  if (userId === undefined) {
    logger.warn('Received /start command without user ID');
    return;
  }

  // Get or create session
  try {
    const session = await deps.sessionManager.getOrCreateSession({
      platform: 'telegram',
      userId,
      agentId: deps.agentId,
    });

    // Get agent name from agent loader
    const agent = deps.agentLoader.get(session.agentId);
    const agentName = agent?.config.name ?? session.agentId;

    const welcomeMessage = `👋 你好 ${firstName}！

我是你的 AI 助手，由 Claude 驅動。

🤖 代理：**${agentName}**

可用指令：
• /help - 顯示幫助訊息
• /reset - 重置對話記錄

直接輸入訊息即可開始對話！`;

    await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });

    logger.info({ userId }, 'User started bot');
  } catch (error) {
    logger.error({ error, userId }, 'Failed to handle /start command');
    await ctx.reply('抱歉，初始化失敗。請稍後再試。');
  }
}

/**
 * Handle /help command
 * Shows available commands and usage information
 */
export async function handleHelp(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const session = await getCurrentSession(ctx, deps);
  const agent = session !== undefined ? deps.agentLoader.get(session.agentId) : undefined;
  const agentName = agent?.config.name ?? '未知';

  const helpMessage = `📖 **幫助訊息**

🤖 代理：**${agentName}**

**可用指令：**

/start - 開始使用並顯示歡迎訊息
/help - 顯示此幫助訊息
/reset - 清除對話記錄，重新開始

**使用方式：**
直接輸入文字訊息即可與 AI 對話。

**提示：**
• 對話記錄會保留在同一個會話中
• 使用 /reset 可以清除記錄重新開始`;

  await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
}

/**
 * Handle /reset command
 * Clears conversation history
 */
export async function handleReset(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const userId = ctx.from?.id.toString();
  if (userId === undefined) {
    return;
  }

  try {
    const session = await getCurrentSession(ctx, deps);
    if (session !== undefined) {
      // Clear conversation history
      deps.messageProcessor.clearConversation(session.sessionId);
    }

    await ctx.reply('🔄 對話記錄已清除。\n\n現在可以開始新的對話了！');

    logger.info({ userId }, 'User reset conversation');
  } catch (error) {
    logger.error({ error, userId }, 'Failed to reset conversation');
    await ctx.reply('抱歉，重置對話失敗。請稍後再試。');
  }
}

/**
 * Get current session for the user
 */
async function getCurrentSession(
  ctx: Context,
  deps: CommandDependencies
): Promise<
  | Awaited<ReturnType<typeof deps.sessionManager.getOrCreateSession>>
  | undefined
> {
  const userId = ctx.from?.id.toString();
  if (userId === undefined) {
    return undefined;
  }

  try {
    return await deps.sessionManager.getOrCreateSession({
      platform: 'telegram',
      userId,
      agentId: deps.agentId,
    });
  } catch {
    return undefined;
  }
}

/**
 * Map of command names to handlers
 */
export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  start: handleStart,
  help: handleHelp,
  reset: handleReset,
};
