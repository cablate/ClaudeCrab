import type { Context } from 'grammy';
import type { AgentLoader } from '../../core/AgentLoader.js';
import type { SessionManager } from '../../core/SessionManager.js';
import type { MessageProcessor } from '../../core/MessageProcessor.js';
import type { ScheduleManager } from '../../schedule/ScheduleManager.js';
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

  /** Schedule manager for schedule operations (optional) */
  scheduleManager?: ScheduleManager;
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
• /stop - 停止執行中的回應

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
/stop - 強制停止 Claude 執行
/schedule - 管理排程任務

**使用方式：**
直接輸入文字訊息即可與 AI 對話。

**提示：**
• 對話記錄會保留在同一個會話中
• 使用 /reset 可以清除記錄重新開始
• 使用 /stop 可以中斷正在執行的 Claude 回應
• 使用 /schedule 可以管理定時任務`;

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
 * Handle /stop command
 * Cancels any active Claude query for the user
 */
export async function handleStop(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const userId = ctx.from?.id.toString();
  if (userId === undefined) {
    return;
  }

  try {
    const cancelled = deps.messageProcessor.cancelQueryForUser(
      'telegram',
      deps.agentId,
      userId
    );

    if (cancelled) {
      await ctx.reply('🛑 已停止 Claude 的執行。');
      logger.info({ userId }, 'User stopped active query');
    } else {
      await ctx.reply('ℹ️ 目前沒有正在執行的查詢。');
    }
  } catch (error) {
    logger.error({ error, userId }, 'Failed to stop query');
    await ctx.reply('抱歉，停止執行失敗。請稍後再試。');
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
 * Handle /schedule command
 * Manages scheduled tasks
 */
export async function handleSchedule(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const text = ctx.message?.text ?? '';
  const args = text.split(/\s+/).slice(1); // Remove '/schedule'
  const [subcommand, ...rest] = args;

  if (!deps.scheduleManager) {
    await ctx.reply('⚠️ 排程系統未啟用。');
    return;
  }

  switch (subcommand) {
    case 'list':
      await handleScheduleList(ctx, deps);
      break;
    case 'info':
      await handleScheduleInfo(ctx, deps, rest[0]);
      break;
    case 'pause':
      await handleSchedulePause(ctx, deps, rest[0]);
      break;
    case 'resume':
      await handleScheduleResume(ctx, deps, rest[0]);
      break;
    case 'run':
      await handleScheduleRun(ctx, deps, rest[0]);
      break;
    case 'delete':
      await handleScheduleDelete(ctx, deps, rest[0]);
      break;
    case 'history':
      await handleScheduleHistory(ctx, deps, rest[0]);
      break;
    default:
      await handleScheduleHelp(ctx);
  }
}

async function handleScheduleList(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const schedules = await deps.scheduleManager!.getAllSchedules();

  if (schedules.length === 0) {
    await ctx.reply('📅 目前沒有排程任務。');
    return;
  }

  const lines = ['📅 **排程任務列表**\n'];

  for (const info of schedules) {
    const status = info.spec.metadata.enabled
      ? info.isRunning
        ? '🔄 執行中'
        : '✅ 啟用'
      : '⏸️ 暫停';
    lines.push(`• **${info.spec.name}** (${info.spec.id})`);
    lines.push(`  ${status} | Agent: ${info.agentId}`);
    lines.push(`  Cron: \`${info.spec.trigger.cron}\``);
    lines.push('');
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

async function handleScheduleInfo(
  ctx: Context,
  deps: CommandDependencies,
  scheduleId?: string
): Promise<void> {
  if (!scheduleId) {
    await ctx.reply('⚠️ 請提供排程 ID：`/schedule info <id>`', { parse_mode: 'Markdown' });
    return;
  }

  const info = await deps.scheduleManager!.getScheduleInfo(scheduleId);
  if (!info) {
    await ctx.reply(`❌ 找不到排程：${scheduleId}`);
    return;
  }

  const status = info.spec.metadata.enabled
    ? info.isRunning
      ? '🔄 執行中'
      : '✅ 啟用'
    : '⏸️ 暫停';

  const lines = [
    `📋 **${info.spec.name}**`,
    '',
    `ID: \`${info.spec.id}\``,
    `狀態：${status}`,
    `Agent：${info.agentId}`,
    `Cron：\`${info.spec.trigger.cron}\``,
    `時區：${info.spec.trigger.timezone}`,
  ];

  if (info.spec.description) {
    lines.push(`說明：${info.spec.description}`);
  }

  if (info.lastExecution) {
    const lastStatus = info.lastExecution.success ? '✅' : '❌';
    lines.push('');
    lines.push(`最後執行：${info.lastExecution.startedAt} ${lastStatus}`);
    if (info.lastExecution.durationMs) {
      lines.push(`耗時：${(info.lastExecution.durationMs / 1000).toFixed(1)}s`);
    }
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

async function handleSchedulePause(
  ctx: Context,
  deps: CommandDependencies,
  scheduleId?: string
): Promise<void> {
  if (!scheduleId) {
    await ctx.reply('⚠️ 請提供排程 ID：`/schedule pause <id>`', { parse_mode: 'Markdown' });
    return;
  }

  const success = await deps.scheduleManager!.pauseSchedule(scheduleId);
  if (success) {
    await ctx.reply(`⏸️ 已暫停排程：${scheduleId}`);
  } else {
    await ctx.reply(`❌ 找不到排程：${scheduleId}`);
  }
}

async function handleScheduleResume(
  ctx: Context,
  deps: CommandDependencies,
  scheduleId?: string
): Promise<void> {
  if (!scheduleId) {
    await ctx.reply('⚠️ 請提供排程 ID：`/schedule resume <id>`', { parse_mode: 'Markdown' });
    return;
  }

  const success = await deps.scheduleManager!.resumeSchedule(scheduleId);
  if (success) {
    await ctx.reply(`▶️ 已恢復排程：${scheduleId}`);
  } else {
    await ctx.reply(`❌ 找不到排程：${scheduleId}`);
  }
}

async function handleScheduleRun(
  ctx: Context,
  deps: CommandDependencies,
  scheduleId?: string
): Promise<void> {
  if (!scheduleId) {
    await ctx.reply('⚠️ 請提供排程 ID：`/schedule run <id>`', { parse_mode: 'Markdown' });
    return;
  }

  const success = await deps.scheduleManager!.runNow(scheduleId);
  if (success) {
    await ctx.reply(`🚀 已觸發排程執行：${scheduleId}`);
  } else {
    await ctx.reply(`❌ 找不到排程：${scheduleId}`);
  }
}

async function handleScheduleDelete(
  ctx: Context,
  deps: CommandDependencies,
  scheduleId?: string
): Promise<void> {
  if (!scheduleId) {
    await ctx.reply('⚠️ 請提供排程 ID：`/schedule delete <id>`', { parse_mode: 'Markdown' });
    return;
  }

  const success = await deps.scheduleManager!.deleteSchedule(scheduleId);
  if (success) {
    await ctx.reply(`🗑️ 已刪除排程：${scheduleId}`);
  } else {
    await ctx.reply(`❌ 找不到排程：${scheduleId}`);
  }
}

async function handleScheduleHistory(
  ctx: Context,
  deps: CommandDependencies,
  scheduleId?: string
): Promise<void> {
  const executions = scheduleId
    ? deps.scheduleManager!.getExecutionHistory(scheduleId, 10)
    : deps.scheduleManager!.getRecentExecutions(10);

  if (executions.length === 0) {
    await ctx.reply('📊 沒有執行記錄。');
    return;
  }

  const lines = [`📊 **執行歷史**${scheduleId ? ` (${scheduleId})` : ''}\n`];

  for (const exec of executions) {
    const status = exec.success === undefined
      ? '🔄'
      : exec.success
        ? '✅'
        : '❌';
    const duration = exec.durationMs
      ? ` (${(exec.durationMs / 1000).toFixed(1)}s)`
      : '';
    lines.push(`${status} ${exec.startedAt}${duration}`);
    if (!scheduleId) {
      lines.push(`   ID: ${exec.scheduleId}`);
    }
    if (exec.errorMessage) {
      const shortError = exec.errorMessage.substring(0, 50);
      lines.push(`   ⚠️ ${shortError}${exec.errorMessage.length > 50 ? '...' : ''}`);
    }
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

async function handleScheduleHelp(ctx: Context): Promise<void> {
  const helpMessage = `📅 **排程指令說明**

/schedule list - 列出所有排程任務
/schedule info <id> - 查看任務詳情
/schedule pause <id> - 暫停任務
/schedule resume <id> - 恢復任務
/schedule run <id> - 立即執行
/schedule delete <id> - 刪除任務
/schedule history [id] - 查看執行歷史

**建立新排程：**
直接與我對話，說明你想要定時執行的任務，我會引導你建立排程。`;

  await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
}

/**
 * Map of command names to handlers
 */
export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  start: handleStart,
  help: handleHelp,
  reset: handleReset,
  stop: handleStop,
  schedule: handleSchedule,
};
