import type { Context } from 'grammy';
import type { AgentLoader } from '../../core/AgentLoader.js';
import type { SessionManager } from '../../core/SessionManager.js';
import type { MessageProcessor } from '../../core/MessageProcessor.js';
import type { ScheduleManager } from '../../schedule/ScheduleManager.js';
import { logger } from '../../utils/logger.js';
import { buildGroupUserId } from '../../utils/groupSession.js';
import { DedupTracker } from '../../utils/DedupTracker.js';

/**
 * Reply with Markdown parse mode, falling back to plain text if parsing fails.
 * Use for messages containing dynamic content (agent names, schedule IDs, etc.).
 */
async function replyWithMarkdown(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch {
    await ctx.reply(text);
  }
}

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

  /** ADR-024: Get group member bot infos for /members command */
  getGroupBotMembers?: (chatId: string) => Array<{
    agentId: string;
    name: string;
    username?: string;
    description?: string;
  }>;

  /** ADR-024: Get bot running status for /status command */
  getBotStatus?: (agentId: string) => 'running' | 'stopped' | 'error' | 'no-token';
}

/**
 * CommandDependencies with required scheduleManager.
 * Used by schedule sub-commands after parent has verified scheduleManager exists.
 */
interface ScheduleCommandDeps extends CommandDependencies {
  scheduleManager: ScheduleManager;
}

// ── ADR-024: Group command utilities ────────────────────────────

/** Commands that modify state — require explicit @target in groups */
export const DESTRUCTIVE_COMMANDS = new Set(['reset', 'stop']);

/** Escape HTML special characters for Telegram HTML parse mode */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Route a command in a group chat.
 * - `'targeted'` — explicitly addressed to this bot (`@me` or `@all`)
 * - `'bare'`     — no `@` suffix; needs dedup for read-only, rejection for destructive
 * - `'other_bot'`— addressed to a different bot; ignore
 */
export function routeGroupCommand(
  ctx: Context,
  myUsername: string
): 'targeted' | 'bare' | 'other_bot' {
  const text = ctx.message?.text ?? '';
  const match = text.match(/^\/\w+@(\w+)/);
  if (!match) return 'bare';

  const target = match[1];
  if (target === undefined) return 'bare';
  const targetUsername = target.toLowerCase();
  if (targetUsername === 'all') return 'targeted';
  if (targetUsername === myUsername.toLowerCase()) return 'targeted';
  return 'other_bot';
}

/** Check if a command targets `@all` (e.g. `/reset@all`). */
export function isTargetAll(ctx: Context): boolean {
  const text = ctx.message?.text ?? '';
  const match = text.match(/^\/\w+@(\w+)/);
  return match !== null && match[1] !== undefined && match[1].toLowerCase() === 'all';
}

/**
 * Cross-bot dedup for group commands.
 *
 * Telegram assigns each bot a **different `message_id`** for the same message,
 * so we key on `chatId:date:userId:command` instead.  `ctx.message.date` is a
 * server-side Unix timestamp (seconds) that IS identical across all bots.
 *
 * Uses globalThis + DedupTracker to guarantee a single instance even if the
 * module is resolved through different import paths.
 */
const DEDUP_GLOBAL_KEY = '__claudecab_group_cmd_dedup__';
if ((globalThis as Record<string, unknown>)[DEDUP_GLOBAL_KEY] === undefined) {
  (globalThis as Record<string, unknown>)[DEDUP_GLOBAL_KEY] = new DedupTracker({
    maxSize: 500,
    ttlMs: 5 * 60 * 1000, // 5 minutes TTL
  });
}
const processedGroupCommands = (globalThis as Record<string, unknown>)[
  DEDUP_GLOBAL_KEY
] as DedupTracker;

export function isGroupCommandProcessed(
  chatId: string,
  messageDate: number,
  userId: string,
  command: string
): boolean {
  const key = `${chatId}:${messageDate}:${userId}:${command}`;
  // isDuplicate() checks and records in one step; handles cleanup internally
  if (processedGroupCommands.isDuplicate(key)) {
    logger.debug({ key }, 'Group command dedup hit');
    return true;
  }
  return false;
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

    await replyWithMarkdown(ctx, welcomeMessage);

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
  const isGroupChat = ctx.chat?.type !== 'private';

  if (isGroupChat) {
    const groupHelp = `📖 **群組指令說明**

**唯讀指令（直接使用）：**
/help - 顯示此幫助訊息
/status - 顯示所有 Bot 狀態
/members - 顯示群組 Bot 成員列表

**操作指令（需指定目標）：**
/reset@botname - 重置指定 Bot 的對話記錄
/reset@all - 重置所有 Bot 的對話記錄
/stop@botname - 停止指定 Bot 的執行
/stop@all - 停止所有 Bot 的執行

**對話方式：**
使用 @botname 來呼叫特定 Bot。`;

    await ctx.reply(groupHelp, { parse_mode: 'Markdown' });
    return;
  }

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
/status - 顯示 Bot 狀態

**使用方式：**
直接輸入文字訊息即可與 AI 對話。

**提示：**
• 對話記錄會保留在同一個會話中
• 使用 /reset 可以清除記錄重新開始
• 使用 /stop 可以中斷正在執行的 Claude 回應
• 使用 /schedule 可以管理定時任務`;

  await replyWithMarkdown(ctx, helpMessage);
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

    // ADR-024: @all in group — reset silently (combined reply sent by routing layer)
    if (ctx.chat?.type !== 'private' && isTargetAll(ctx)) {
      logger.info({ userId, agentId: deps.agentId }, 'Group @all reset (silent)');
      return;
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

  const chatId = ctx.chat?.id.toString();
  const isGroupChat = ctx.chat?.type !== 'private';

  // For group chats, use chatId-based session key to match shared history
  const effectiveUserId = isGroupChat && chatId ? buildGroupUserId(chatId) : userId;

  try {
    const cancelled = deps.messageProcessor.cancelQueryForUser(
      'telegram',
      deps.agentId,
      effectiveUserId
    );

    // ADR-024: @all in group — stop silently (combined reply sent by routing layer)
    if (isGroupChat && isTargetAll(ctx)) {
      logger.info({ userId, agentId: deps.agentId, cancelled }, 'Group @all stop (silent)');
      return;
    }

    if (cancelled) {
      await ctx.reply('🛑 已停止 Claude 的執行。');
      logger.info({ userId, effectiveUserId }, 'User stopped active query');
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

  const chatId = ctx.chat?.id.toString();
  const isGroupChat = ctx.chat?.type !== 'private';

  // For group chats, use chatId-based session key to match shared history
  const effectiveUserId = isGroupChat && chatId ? buildGroupUserId(chatId) : userId;

  try {
    return await deps.sessionManager.getOrCreateSession({
      platform: 'telegram',
      userId: effectiveUserId,
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

  // After the check above, we know scheduleManager exists
  const scheduleDeps = deps as ScheduleCommandDeps;

  switch (subcommand) {
    case 'list':
      await handleScheduleList(ctx, scheduleDeps);
      break;
    case 'info':
      await handleScheduleInfo(ctx, scheduleDeps, rest[0]);
      break;
    case 'pause':
      await handleSchedulePause(ctx, scheduleDeps, rest[0]);
      break;
    case 'resume':
      await handleScheduleResume(ctx, scheduleDeps, rest[0]);
      break;
    case 'run':
      await handleScheduleRun(ctx, scheduleDeps, rest[0]);
      break;
    case 'delete':
      await handleScheduleDelete(ctx, scheduleDeps, rest[0]);
      break;
    case 'history':
      await handleScheduleHistory(ctx, scheduleDeps, rest[0]);
      break;
    default:
      await handleScheduleHelp(ctx);
  }
}

async function handleScheduleList(
  ctx: Context,
  deps: ScheduleCommandDeps
): Promise<void> {
  const schedules = await deps.scheduleManager.getAllSchedules();

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

  await replyWithMarkdown(ctx, lines.join('\n'));
}

async function handleScheduleInfo(
  ctx: Context,
  deps: ScheduleCommandDeps,
  scheduleId?: string
): Promise<void> {
  if (!scheduleId) {
    await ctx.reply('⚠️ 請提供排程 ID：`/schedule info <id>`', { parse_mode: 'Markdown' });
    return;
  }

  const info = await deps.scheduleManager.getScheduleInfo(scheduleId);
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

  await replyWithMarkdown(ctx, lines.join('\n'));
}

async function handleSchedulePause(
  ctx: Context,
  deps: ScheduleCommandDeps,
  scheduleId?: string
): Promise<void> {
  if (!scheduleId) {
    await ctx.reply('⚠️ 請提供排程 ID：`/schedule pause <id>`', { parse_mode: 'Markdown' });
    return;
  }

  const success = await deps.scheduleManager.pauseSchedule(scheduleId);
  if (success) {
    await ctx.reply(`⏸️ 已暫停排程：${scheduleId}`);
  } else {
    await ctx.reply(`❌ 找不到排程：${scheduleId}`);
  }
}

async function handleScheduleResume(
  ctx: Context,
  deps: ScheduleCommandDeps,
  scheduleId?: string
): Promise<void> {
  if (!scheduleId) {
    await ctx.reply('⚠️ 請提供排程 ID：`/schedule resume <id>`', { parse_mode: 'Markdown' });
    return;
  }

  const success = await deps.scheduleManager.resumeSchedule(scheduleId);
  if (success) {
    await ctx.reply(`▶️ 已恢復排程：${scheduleId}`);
  } else {
    await ctx.reply(`❌ 找不到排程：${scheduleId}`);
  }
}

async function handleScheduleRun(
  ctx: Context,
  deps: ScheduleCommandDeps,
  scheduleId?: string
): Promise<void> {
  if (!scheduleId) {
    await ctx.reply('⚠️ 請提供排程 ID：`/schedule run <id>`', { parse_mode: 'Markdown' });
    return;
  }

  const success = await deps.scheduleManager.runNow(scheduleId);
  if (success) {
    await ctx.reply(`🚀 已觸發排程執行：${scheduleId}`);
  } else {
    await ctx.reply(`❌ 找不到排程：${scheduleId}`);
  }
}

async function handleScheduleDelete(
  ctx: Context,
  deps: ScheduleCommandDeps,
  scheduleId?: string
): Promise<void> {
  if (!scheduleId) {
    await ctx.reply('⚠️ 請提供排程 ID：`/schedule delete <id>`', { parse_mode: 'Markdown' });
    return;
  }

  const success = await deps.scheduleManager.deleteSchedule(scheduleId);
  if (success) {
    await ctx.reply(`🗑️ 已刪除排程：${scheduleId}`);
  } else {
    await ctx.reply(`❌ 找不到排程：${scheduleId}`);
  }
}

async function handleScheduleHistory(
  ctx: Context,
  deps: ScheduleCommandDeps,
  scheduleId?: string
): Promise<void> {
  const executions = scheduleId
    ? deps.scheduleManager.getExecutionHistory(scheduleId, 10)
    : deps.scheduleManager.getRecentExecutions(10);

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

  await replyWithMarkdown(ctx, lines.join('\n'));
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

/** ADR-024: /members — show group bot member list */
async function handleMembers(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const chatId = ctx.chat?.id.toString();
  if (chatId === undefined) return;

  const isGroupChat = ctx.chat?.type !== 'private';
  if (!isGroupChat) {
    await ctx.reply('ℹ️ /members 命令只能在群組中使用。');
    return;
  }

  if (deps.getGroupBotMembers === undefined) {
    await ctx.reply('ℹ️ 群組成員資訊暫時無法取得。');
    return;
  }

  const members = deps.getGroupBotMembers(chatId);
  if (members.length === 0) {
    await ctx.reply('ℹ️ 此群組尚未有已註冊的 Bot 成員。');
    return;
  }

  const statusEmoji = (s: string): string =>
    s === 'running' ? '🟢' : s === 'stopped' ? '🔴' : s === 'error' ? '⚠️' : '⚪';

  const lines = members.map((m) => {
    const username = m.username !== undefined ? `@${m.username}` : '';
    const desc = m.description !== undefined ? ` — ${escapeHtml(m.description)}` : '';
    const status = deps.getBotStatus !== undefined ? deps.getBotStatus(m.agentId) : 'unknown';
    return `${statusEmoji(status)} <b>${escapeHtml(m.name)}</b> ${username}${desc}`;
  });

  const message = `👥 <b>群組 Bot 成員</b>\n\n${lines.join('\n')}`;
  await ctx.reply(message, { parse_mode: 'HTML' });
}

/** ADR-024: /status — show bot status */
async function handleStatus(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const chatId = ctx.chat?.id.toString();
  if (chatId === undefined) return;

  const isGroupChat = ctx.chat?.type !== 'private';

  const statusEmoji = (s: string): string =>
    s === 'running' ? '🟢' : s === 'stopped' ? '🔴' : s === 'error' ? '⚠️' : '⚪';

  if (!isGroupChat) {
    // Private chat: show this bot's status
    const agent = deps.agentLoader.get(deps.agentId);
    const name = agent?.config.name ?? deps.agentId;
    const status = deps.getBotStatus !== undefined ? deps.getBotStatus(deps.agentId) : 'unknown';
    const session = await getCurrentSession(ctx, deps);
    const sessionInfo = session !== undefined ? `Session: <code>${session.sessionId}</code>` : '無 active session';

    await ctx.reply(
      `📊 <b>Bot 狀態</b>\n\n${statusEmoji(status)} <b>${escapeHtml(name)}</b> — ${status}\n${sessionInfo}`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Group chat: show all bots' status
  if (deps.getGroupBotMembers === undefined) {
    await ctx.reply('ℹ️ 群組狀態資訊暫時無法取得。');
    return;
  }

  const members = deps.getGroupBotMembers(chatId);
  if (members.length === 0) {
    await ctx.reply('ℹ️ 此群組尚未有已註冊的 Bot 成員。');
    return;
  }

  const lines = members.map((m) => {
    const status = deps.getBotStatus !== undefined ? deps.getBotStatus(m.agentId) : 'unknown';
    const username = m.username !== undefined ? `@${m.username}` : '';
    return `${statusEmoji(status)} <b>${escapeHtml(m.name)}</b> ${username} — ${status}`;
  });

  const message = `📊 <b>群組 Bot 狀態</b>\n\n${lines.join('\n')}`;
  await ctx.reply(message, { parse_mode: 'HTML' });
}

export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  start: handleStart,
  help: handleHelp,
  reset: handleReset,
  stop: handleStop,
  schedule: handleSchedule,
  members: handleMembers,
  status: handleStatus,
};
