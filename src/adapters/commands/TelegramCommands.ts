import { type Context, InlineKeyboard } from 'grammy';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentLoader } from '../../core/AgentLoader.js';
import type { SessionManager } from '../../core/SessionManager.js';
import type { MessageProcessor } from '../../core/MessageProcessor.js';
import type { ScheduleManager } from '../../schedule/ScheduleManager.js';
import { handleSchedule } from './ScheduleCommands.js';
import { logger } from '../../utils/logger.js';
import { buildGroupUserId } from '../../utils/groupSession.js';
import { DedupTracker } from '../../utils/DedupTracker.js';

/** Max entries in the group-command dedup tracker */
const COMMAND_DEDUP_MAX_SIZE = 500;
/** TTL for group-command dedup entries (5 minutes) */
const COMMAND_DEDUP_TTL_MS = 5 * 60 * 1000;

/**
 * Reply with Markdown parse mode, falling back to plain text if parsing fails.
 * Use for messages containing dynamic content (agent names, schedule IDs, etc.).
 */
export async function replyWithMarkdown(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.debug({ error }, 'Markdown parse failed, falling back to plain text');
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

  /** Security config for admin-only commands like /restart */
  securityConfig?: {
    allowedUsers: string[];
    whitelistEnabled: boolean;
  };

  /** ADR-024: Get group member bot infos for /members command */
  getGroupBotMembers?: (chatId: string) => Array<{
    agentId: string;
    name: string;
    username?: string;
    description?: string;
  }>;

  /** ADR-024: Get bot running status for /status command */
  getBotStatus?: (agentId: string) => 'running' | 'stopped' | 'error' | 'no-token';

  /** Sync agents: hot add/remove agents without restart */
  syncAgents?: () => Promise<{ added: string[]; removed: string[] }>;
}

/**
 * CommandDependencies with required scheduleManager.
 * Used by schedule sub-commands after parent has verified scheduleManager exists.
 */


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
    maxSize: COMMAND_DEDUP_MAX_SIZE,
    ttlMs: COMMAND_DEDUP_TTL_MS,
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
/model - 切換 AI 模型（Opus/Sonnet/Haiku）
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
  } catch (error) {
    logger.debug({ error }, 'Failed to get/create session');
    return undefined;
  }
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


/**
 * /restart command — admin-only, triggers graceful restart via PM2
 * Supports:
 * - /restart — full process restart (PM2 will auto-restart)
 * - /restart all — hot sync agents (add new, remove deleted)
 */
async function handleRestart(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const userId = ctx.from?.id.toString();
  if (userId === undefined) {
    await ctx.reply('⚠️ 無法識別使用者身份');
    return;
  }

  // Check if user is in allowedUsers
  const securityConfig = deps.securityConfig;
  if (securityConfig === undefined) {
    await ctx.reply('⚠️ 安全設定未配置，無法執行此指令');
    return;
  }

  const isAllowed = !securityConfig.whitelistEnabled || 
    securityConfig.allowedUsers.includes(userId);
  
  if (!isAllowed) {
    logger.warn({ userId, agentId: deps.agentId }, 'Unauthorized /restart attempt');
    await ctx.reply('⛔ 你沒有權限執行此指令');
    return;
  }

  // Parse argument: /restart all triggers hot sync instead of full restart
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.split(/\s+/).slice(1);
  const isHotSync = args[0]?.toLowerCase() === 'all';

  if (isHotSync) {
    // Hot sync mode: add new agents, remove deleted agents
    if (!deps.syncAgents) {
      await ctx.reply('⚠️ Hot sync 功能未配置');
      return;
    }

    logger.info({ userId, agentId: deps.agentId }, 'Hot sync agents requested');
    await ctx.reply('🔄 正在同步 agents...');

    try {
      const result = await deps.syncAgents();
      
      if (result.added.length === 0 && result.removed.length === 0) {
        await ctx.reply('✅ 所有 agents 已是最新狀態，無需變更');
      } else {
        const lines: string[] = ['✅ Agent 同步完成！'];
        if (result.added.length > 0) {
          lines.push(`\n🆕 新增: ${result.added.join(', ')}`);
        }
        if (result.removed.length > 0) {
          lines.push(`\n🗑️ 移除: ${result.removed.join(', ')}`);
        }
        await ctx.reply(lines.join(''));
      }
    } catch (error) {
      logger.error({ error }, 'Hot sync failed');
      await ctx.reply('❌ 同步失敗，請查看 logs');
    }
    return;
  }

  // Full restart mode
  logger.info({ userId, agentId: deps.agentId }, 'Restart command received, running pre-flight check...');
  await ctx.reply('🔍 正在檢查程式碼...');

  // Pre-flight check: run tsc --noEmit to catch TypeScript errors
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    await execAsync('npx tsc --noEmit', { cwd: process.cwd(), timeout: 60000 });
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string };
    const errorOutput = err.stderr || err.stdout || 'Unknown error';
    logger.error({ error: errorOutput }, 'TypeScript check failed, aborting restart');
    await ctx.reply(`❌ TypeScript 檢查失敗，取消重啟：\n\n<code>${errorOutput.slice(0, 500)}</code>`, { parse_mode: 'HTML' });
    return;
  }

  // All checks passed
  logger.info({ userId, agentId: deps.agentId }, 'Pre-flight check passed, initiating restart');
  await ctx.reply('✅ 檢查通過！🔄 正在重啟 ClaudeCab...\n\n稍後我會重新上線！');

  // Graceful shutdown - PM2 will auto-restart
  setTimeout(() => {
    logger.info('Graceful shutdown initiated via /restart command');
    process.exit(0);
  }, 1000);
}

// ── /model command ──────────────────────────────────────────────

const MODEL_LABELS: Record<string, string> = {
  opus: '🟣 Opus',
  sonnet: '🔵 Sonnet',
  haiku: '🟢 Haiku',
};

/**
 * Handle /model command
 * Shows inline keyboard to select model (opus/sonnet/haiku)
 */
export async function handleModel(
  ctx: Context,
  deps: CommandDependencies
): Promise<void> {
  const agent = deps.agentLoader.get(deps.agentId);
  if (agent === undefined) {
    await ctx.reply('❌ 無法載入 Agent 設定');
    return;
  }

  // Read current model from settings.local.json (source of truth)
  const settingsPath = path.join(agent.path, '.claude', 'settings.local.json');
  let currentModel = 'sonnet';
  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(content) as Record<string, unknown>;
    if (typeof settings.model === 'string') {
      currentModel = settings.model;
    }
  } catch {
    // Fallback to agent config
    currentModel = agent.config.model ?? 'sonnet';
  }

  const keyboard = new InlineKeyboard();
  for (const model of ['opus', 'sonnet', 'haiku']) {
    const label = model === currentModel
      ? `${MODEL_LABELS[model]} ✓`
      : MODEL_LABELS[model]!;
    keyboard.text(label, `model_set:${deps.agentId}:${model}`);
  }

  await ctx.reply(
    `🤖 目前模型：**${MODEL_LABELS[currentModel] ?? currentModel}**\n\n選擇要切換的模型：`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

/**
 * Apply model change to settings.local.json and reload agent.
 * Called from TelegramAdapter callback handler.
 */
export async function applyModelChange(
  agentId: string,
  model: string,
  agentLoader: AgentLoader
): Promise<{ success: boolean; error?: string }> {
  const agent = agentLoader.get(agentId);
  if (agent === undefined) {
    return { success: false, error: 'Agent not found' };
  }

  const settingsPath = path.join(agent.path, '.claude', 'settings.local.json');
  let settings: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    settings = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // File doesn't exist, create new
  }

  settings.model = model;
  await fs.mkdir(path.join(agent.path, '.claude'), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

  // Reload agent config
  await agentLoader.loadAgent(agentId);

  return { success: true };
}

export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  start: handleStart,
  help: handleHelp,
  reset: handleReset,
  stop: handleStop,
  schedule: handleSchedule,
  members: handleMembers,
  status: handleStatus,
  restart: handleRestart,
  model: handleModel,
};
