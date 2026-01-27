import type { Context } from 'grammy';
import type { AgentLoader } from '../../core/AgentLoader.js';
import type { SessionManager } from '../../core/SessionManager.js';
import type { MessageProcessor } from '../../core/MessageProcessor.js';
import { logger } from '../../utils/logger.js';

/**
 * Dependencies required for command handlers
 */
export interface CommandDependencies {
  /** Agent loader for listing and switching agents */
  agentLoader: AgentLoader;

  /** Session manager for session operations */
  sessionManager: SessionManager;

  /** Message processor for conversation operations */
  messageProcessor: MessageProcessor;

  /** Default agent ID */
  defaultAgentId: string;
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
      agentId: deps.defaultAgentId,
    });

    // Get agent name from agent loader
    const agent = deps.agentLoader.get(session.agentId);
    const agentName = agent?.config.name ?? session.agentId;

    const welcomeMessage = `👋 你好 ${firstName}！

我是你的 AI 助手，由 Claude 驅動。

🤖 目前使用的代理：**${agentName}**

可用指令：
• /help - 顯示幫助訊息
• /list - 列出可用的代理
• /switch <代理名稱> - 切換到其他代理
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

🤖 目前代理：**${agentName}**

**可用指令：**

/start - 開始使用並顯示歡迎訊息
/help - 顯示此幫助訊息
/list - 列出所有可用的代理
/switch <代理名稱> - 切換到指定的代理
/reset - 清除對話記錄，重新開始

**使用方式：**
直接輸入文字訊息即可與 AI 對話。

**提示：**
• 對話記錄會保留在同一個會話中
• 使用 /reset 可以清除記錄重新開始
• 使用 /switch 可以切換不同能力的代理`;

  await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
}

/**
 * Handle /list command
 * Lists all available agents
 */
export async function handleList(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const session = await getCurrentSession(ctx, deps);
  const currentAgentId = session?.agentId ?? deps.defaultAgentId;

  try {
    // Scan directory for all available agents (not just cached ones)
    const agentIds = await deps.agentLoader.scanAgents();

    if (agentIds.length === 0) {
      await ctx.reply('目前沒有可用的代理。');
      return;
    }

    const agentLines: string[] = [];

    for (const agentId of agentIds) {
      // Load agent if not already loaded
      let agent = deps.agentLoader.get(agentId);
      if (agent === undefined) {
        try {
          agent = await deps.agentLoader.loadAgent(agentId);
        } catch {
          // Skip agents that fail to load
          continue;
        }
      }

      const isCurrent = agentId === currentAgentId;
      const marker = isCurrent ? '✅' : '•';
      const name = agent.config.name;
      const description = agent.config.description ?? '';

      agentLines.push(
        `${marker} **${name}** (${agentId})${description !== '' ? `\n   ${description}` : ''}`
      );
    }

    const message = `📋 **可用代理列表**

${agentLines.join('\n\n')}

使用 \`/switch <代理ID>\` 來切換代理
例如：\`/switch ${agentIds[0] ?? 'default'}\``;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error({ error }, 'Failed to list agents');
    await ctx.reply('抱歉，無法取得代理列表。');
  }
}

/**
 * Handle /switch command
 * Switches to a different agent
 */
export async function handleSwitch(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const userId = ctx.from?.id.toString();
  if (userId === undefined) {
    return;
  }

  const messageText = ctx.message?.text ?? '';
  const parts = messageText.split(/\s+/);
  const targetAgentId = parts[1];

  // Scan for all available agents
  const availableAgents = await deps.agentLoader.scanAgents();

  if (targetAgentId === undefined || targetAgentId === '') {
    await ctx.reply(
      `請指定要切換的代理。\n\n用法：\`/switch <代理ID>\`\n\n可用代理：${availableAgents.join(', ')}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Check if agent exists in available agents
  if (!availableAgents.includes(targetAgentId)) {
    await ctx.reply(
      `找不到代理 "${targetAgentId}"。\n\n可用代理：${availableAgents.join(', ')}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Load agent if not already loaded
  let agent = deps.agentLoader.get(targetAgentId);
  if (agent === undefined) {
    try {
      agent = await deps.agentLoader.loadAgent(targetAgentId);
    } catch (error) {
      logger.error({ error, targetAgentId }, 'Failed to load agent');
      await ctx.reply(`無法載入代理 "${targetAgentId}"。請稍後再試。`);
      return;
    }
  }

  try {
    // Get current session
    const session = await deps.sessionManager.getOrCreateSession({
      platform: 'telegram',
      userId,
      agentId: targetAgentId,
    });

    // Update session with new agent
    await deps.sessionManager.switchAgent('telegram', userId, targetAgentId);

    // Clear conversation history for fresh start
    deps.messageProcessor.clearConversation(session.sessionId);

    await ctx.reply(
      `✅ 已切換到代理：**${agent.config.name}**\n\n${agent.config.description ?? ''}`,
      { parse_mode: 'Markdown' }
    );

    logger.info({ userId, agentId: targetAgentId }, 'User switched agent');
  } catch (error) {
    logger.error({ error, userId, targetAgentId }, 'Failed to switch agent');
    await ctx.reply('抱歉，切換代理失敗。請稍後再試。');
  }
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
      agentId: deps.defaultAgentId,
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
  list: handleList,
  switch: handleSwitch,
  reset: handleReset,
};
