import type { Context } from 'grammy';
import type { ScheduleManager } from '../../schedule/ScheduleManager.js';
import type { CommandDependencies } from './TelegramCommands.js';
import { replyWithMarkdown } from './TelegramCommands.js';

/**
 * Extended dependencies for schedule commands (requires scheduleManager).
 */
export interface ScheduleCommandDeps extends CommandDependencies {
  scheduleManager: ScheduleManager;
}

/**
 * Format trigger info for display in Telegram messages.
 */
function formatTriggerText(trigger: { type?: string | undefined; cron?: string | undefined; at?: string | undefined; interval?: number | undefined; timezone?: string | undefined }): string {
  const tz = trigger.timezone || 'UTC';
  switch (trigger.type) {
    case 'once':
      return `Once: \`${trigger.at || 'N/A'}\` (${tz})`;
    case 'interval': {
      const ms = trigger.interval || 0;
      const min = Math.round(ms / 60000);
      const label = min >= 60 ? `${Math.round(min / 60)}h` : `${min}m`;
      return `Interval: every ${label} (${tz})`;
    }
    default:
      return `Cron: \`${trigger.cron || 'N/A'}\` (${tz})`;
  }
}

/**
 * Main schedule command router.
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
    lines.push(`  ${formatTriggerText(info.spec.trigger)}`);
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
    `觸發：${formatTriggerText(info.spec.trigger)}`,
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
