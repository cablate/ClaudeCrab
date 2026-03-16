/**
 * DiscordSlashCommands — register and handle Discord Slash Commands.
 *
 * Mirrors Telegram commands: /help, /reset, /stop, /model, /status, /schedule
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { AgentLoader } from '../../core/AgentLoader.js';
import type { SessionManager } from '../../core/SessionManager.js';
import type { MessageProcessor } from '../../core/MessageProcessor.js';
import type { SDKSessionManager } from '../../core/SDKSessionManager.js';
import type { BudgetService } from '../../services/BudgetService.js';
import type { TaskService } from '../../services/TaskService.js';
import type { IQueryMetricsRepository } from '../../persistence/types.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'DiscordSlashCommands' });

export interface SlashCommandDependencies {
  agentLoader: AgentLoader;
  sessionManager: SessionManager;
  messageProcessor: MessageProcessor;
  budgetService?: BudgetService;
  taskService?: TaskService | undefined;
  queryMetricsRepository?: IQueryMetricsRepository;
  sdkSessionManager?: SDKSessionManager;
  getBotStatus?: (agentId: string, platform?: 'telegram' | 'discord') => 'running' | 'stopped' | 'error' | 'no-token';
}

/** Build the slash command definitions for guild registration */
export function buildSlashCommands(): SlashCommandBuilder[] {
  return [
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('顯示指令說明'),

    new SlashCommandBuilder()
      .setName('status')
      .setDescription('顯示所有 Agent 狀態'),

    new SlashCommandBuilder()
      .setName('reset')
      .setDescription('重置指定 Agent 的對話記錄')
      .addStringOption(opt =>
        opt.setName('agent').setDescription('Agent ID（留空 = 當前頻道的 Agent）').setRequired(false)
      ) as SlashCommandBuilder,

    new SlashCommandBuilder()
      .setName('model')
      .setDescription('查看或切換 Agent 的 AI 模型')
      .addStringOption(opt =>
        opt.setName('agent').setDescription('Agent ID').setRequired(false)
      )
      .addStringOption(opt =>
        opt.setName('to').setDescription('切換到的模型')
          .addChoices(
            { name: 'Opus', value: 'opus' },
            { name: 'Sonnet', value: 'sonnet' },
            { name: 'Haiku', value: 'haiku' },
          )
          .setRequired(false)
      ) as SlashCommandBuilder,

    new SlashCommandBuilder()
      .setName('cost')
      .setDescription('查看今日和月度花費摘要'),

    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('停止指定 Agent 的執行')
      .addStringOption(opt =>
        opt.setName('agent').setDescription('Agent ID').setRequired(false)
      ) as SlashCommandBuilder,

    new SlashCommandBuilder()
      .setName('restart')
      .setDescription('重啟 ClaudeCab（先跑 tsc 檢查，通過才重啟）'),

    new SlashCommandBuilder()
      .setName('ctx')
      .setDescription('顯示當前 session 的 context 使用量、cache 狀態、花費'),

    new SlashCommandBuilder()
      .setName('task')
      .setDescription('任務管理')
      .addSubcommand(sub =>
        sub.setName('create').setDescription('建立新任務')
          .addStringOption(opt => opt.setName('title').setDescription('任務標題').setRequired(true))
          .addStringOption(opt => opt.setName('priority').setDescription('優先級')
            .addChoices(
              { name: '🔴 緊急', value: 'urgent' },
              { name: '🟡 一般', value: 'medium' },
              { name: '🟢 低', value: 'low' },
            ).setRequired(false))
          .addStringOption(opt => opt.setName('assignee').setDescription('指派 Agent ID').setRequired(false))
          .addStringOption(opt => opt.setName('description').setDescription('任務描述').setRequired(false))
      )
      .addSubcommand(sub =>
        sub.setName('list').setDescription('列出任務')
          .addStringOption(opt => opt.setName('status').setDescription('篩選狀態')
            .addChoices(
              { name: '📋 待辦', value: 'backlog' },
              { name: '🔄 進行中', value: 'in_progress' },
              { name: '✅ 完成', value: 'done' },
            ).setRequired(false))
      )
      .addSubcommand(sub =>
        sub.setName('complete').setDescription('完成任務')
          .addStringOption(opt => opt.setName('id').setDescription('任務 ID（前 8 碼）').setRequired(true))
      ) as SlashCommandBuilder,
  ];
}

/**
 * Register slash commands with Discord API for a specific guild.
 */
export async function registerSlashCommands(
  token: string,
  clientId: string,
  guildId: string,
): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(token);
  const commands = buildSlashCommands().map(cmd => cmd.toJSON());

  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    log.info({ commandCount: commands.length, guildId }, 'Slash commands registered');
  } catch (error) {
    log.error({ error }, 'Failed to register slash commands');
  }
}

/**
 * Handle a slash command interaction.
 */
export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const { commandName } = interaction;

  try {
    switch (commandName) {
      case 'help':
        await handleHelp(interaction);
        break;
      case 'status':
        await handleStatus(interaction, deps);
        break;
      case 'reset':
        await handleReset(interaction, deps);
        break;
      case 'model':
        await handleModel(interaction, deps);
        break;
      case 'cost':
        await handleCost(interaction, deps);
        break;
      case 'stop':
        await handleStop(interaction, deps);
        break;
      case 'ctx':
        await handleCtx(interaction, deps);
        break;
      case 'restart':
        await handleRestart(interaction);
        break;
      case 'task':
        await handleTask(interaction, deps);
        break;
      default:
        await interaction.reply({ content: `未知指令：/${commandName}`, ephemeral: true });
    }
  } catch (error) {
    log.error({ error, commandName }, 'Slash command error');
    const msg = error instanceof Error ? error.message : String(error);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: `❌ 錯誤：${msg}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `❌ 錯誤：${msg}`, ephemeral: true });
      }
    } catch {
      // Interaction may have expired
    }
  }
}

// ── Individual command handlers ──

async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('📖 指令說明')
    .setColor(0x5865F2)
    .setDescription([
      '`/help` — 顯示此說明',
      '`/status` — 顯示所有 Agent 狀態',
      '`/reset [agent]` — 重置對話記錄',
      '`/model [agent] [to]` — 查看或切換模型',
      '`/cost` — 花費摘要',
      '`/stop [agent]` — 停止執行中的回應',
    ].join('\n'))
    .setFooter({ text: '直接在 Agent 頻道輸入文字即可對話' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const agents = deps.agentLoader.list();
  const lines: string[] = [];

  for (const agentId of agents) {
    const agent = deps.agentLoader.get(agentId);
    if (agent === undefined) continue;

    const name = agent.config.name || agentId;
    const emoji = agent.config.display?.avatar ?? '🤖';
    const model = agent.config.model ?? 'sonnet';

    const tgStatus = deps.getBotStatus?.(agentId, 'telegram') ?? 'no-token';
    const dcStatus = deps.getBotStatus?.(agentId, 'discord') ?? 'no-token';
    const paused = deps.budgetService?.isAgentPaused(agentId) ?? false;

    const statusParts: string[] = [];
    if (paused) {
      statusParts.push('⏸️ 預算暫停');
    } else {
      const tgIcon = tgStatus === 'running' ? '🟢' : tgStatus === 'no-token' ? '⚫' : '🔴';
      const dcIcon = dcStatus === 'running' ? '🟢' : dcStatus === 'no-token' ? '⚫' : '🔴';
      statusParts.push(`TG ${tgIcon} DC ${dcIcon}`);
    }

    lines.push(`${emoji} **${name}** (${model}) — ${statusParts.join(' ')}`);
  }

  const embed = new EmbedBuilder()
    .setTitle('🤖 Agent 狀態')
    .setColor(0x5865F2)
    .setDescription(lines.join('\n'))
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleReset(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const agentId = interaction.options.getString('agent');
  const userId = interaction.user.id;

  if (agentId !== null) {
    // Reset specific agent
    if (!deps.agentLoader.has(agentId)) {
      await interaction.editReply(`❌ Agent「${agentId}」不存在`);
      return;
    }
    deps.sessionManager.setSdkSessionId('discord', agentId, userId, undefined);
    await interaction.editReply(`✅ 已重置與 **${agentId}** 的對話`);
  } else {
    // Reset all agents for this user on discord
    for (const id of deps.agentLoader.list()) {
      deps.sessionManager.setSdkSessionId('discord', id, userId, undefined);
    }
    await interaction.editReply('✅ 已重置所有 Agent 的 Discord 對話');
  }
}

async function handleModel(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const agentId = interaction.options.getString('agent');
  const targetModel = interaction.options.getString('to');

  if (agentId === null && targetModel === null) {
    // Show all agent models
    const lines = deps.agentLoader.list().map(id => {
      const agent = deps.agentLoader.get(id);
      const name = agent?.config.name ?? id;
      const model = agent?.config.model ?? 'sonnet';
      return `**${name}** → \`${model}\``;
    });
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle('🧠 模型配置').setDescription(lines.join('\n')).setColor(0x5865F2)],
      ephemeral: true,
    });
    return;
  }

  // Model switching requires file modification — just show current for now
  await interaction.reply({
    content: '模型切換需要修改 agent.json，請使用 Telegram 的 /model 指令或手動編輯設定檔。',
    ephemeral: true,
  });
}

async function handleCost(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const agents = deps.agentLoader.list();
  const lines: string[] = [];

  for (const agentId of agents) {
    const agent = deps.agentLoader.get(agentId);
    if (agent === undefined) continue;

    const budgetStatus = deps.budgetService?.checkBudget(agentId);
    if (budgetStatus === null || budgetStatus === undefined) continue;

    const name = (agent.config.name || agentId).slice(0, 10);
    const monthUsd = (budgetStatus.monthCents / 100).toFixed(2);
    const todayUsd = (budgetStatus.todayCents / 100).toFixed(2);

    let bar = '';
    if (budgetStatus.monthlyLimitCents > 0) {
      const pct = Math.min(Math.round(budgetStatus.monthCents / budgetStatus.monthlyLimitCents * 100), 100);
      const filled = Math.round(pct / 10);
      const ch = pct >= 80 ? '🟥' : pct >= 50 ? '🟨' : '🟩';
      bar = ` ${ch.repeat(filled)}${'⬜'.repeat(10 - filled)} ${pct}%`;
    }

    lines.push(`**${name}**　$${todayUsd} 今日 · $${monthUsd} 月${bar}`);
  }

  if (lines.length === 0) {
    await interaction.reply({ content: '尚無花費紀錄或未設定預算', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('💰 花費摘要')
    .setDescription(lines.join('\n'))
    .setColor(0x57F287)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleStop(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  await interaction.reply({
    content: '⚠️ Discord 端的停止功能開發中。目前請透過 Telegram 使用 /stop。',
    ephemeral: true,
  });
}

async function handleCtx(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;
  const isThread = interaction.channel?.isThread() ?? false;

  // Find which agent owns this channel (or parent channel if in thread)
  const parentChannelId = isThread && interaction.channel?.isThread()
    ? interaction.channel.parentId
    : channelId;

  let agentId: string | undefined;
  for (const id of deps.agentLoader.list()) {
    const agent = deps.agentLoader.get(id);
    if (agent?.config.discordChannelId === parentChannelId) {
      agentId = id;
      break;
    }
  }

  if (agentId === undefined) {
    await interaction.reply({ content: '此頻道沒有綁定 Agent', ephemeral: true });
    return;
  }

  const agent = deps.agentLoader.get(agentId)!;
  const agentName = agent.config.name || agentId;
  const model = agent.config.model ?? 'sonnet';

  // Context window sizes per model
  const ctxLimits: Record<string, number> = { opus: 200000, sonnet: 200000, haiku: 200000 };
  const ctxLimit = ctxLimits[model] ?? 200000;

  // Session key: for thread it's userId::thread::threadId, for main channel it's userId
  const effectiveUserId = isThread ? `${userId}::thread::${channelId}` : userId;

  // Get the actual SessionManager session to find the real sessionId
  const session = deps.sessionManager.getSession('discord', agentId, effectiveUserId);
  const realSessionId = session?.sessionId;

  // Get V2 session stats using the real session ID
  const sessionStats = (realSessionId !== undefined && deps.sdkSessionManager !== undefined)
    ? deps.sdkSessionManager.getSessionStats(realSessionId)
    : null;

  // Get recent query metrics for this agent + user
  // Collect query data for this thread/channel
  interface QueryInfo {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalCostUsd: number;
    numTurns: number;
  }
  let lastQuery: QueryInfo | undefined;
  let sessionTotalCost = 0;
  let sessionQueryCount = 0;
  let sessionTotalOutput = 0;

  if (deps.queryMetricsRepository !== undefined) {
    const recent = deps.queryMetricsRepository.getRecentQueries(50, 0, agentId);
    for (const q of recent) {
      if (q.platform !== 'discord') continue;
      if (q.chatId !== channelId) continue;

      sessionQueryCount++;
      sessionTotalCost += q.totalCostUsd;
      sessionTotalOutput += q.outputTokens;

      if (lastQuery === undefined) {
        lastQuery = {
          inputTokens: q.inputTokens,
          outputTokens: q.outputTokens,
          cacheReadTokens: q.cacheReadTokens,
          cacheCreationTokens: q.cacheCreationTokens,
          totalCostUsd: q.totalCostUsd,
          numTurns: q.numTurns,
        };
      }
    }
  }

  // Estimate context size from last query's cache_creation + cache_read
  // (This approximates the actual context window content, excluding multi-turn re-reads)
  const estimatedCtx = lastQuery !== undefined
    ? lastQuery.cacheReadTokens + lastQuery.cacheCreationTokens
    : 0;
  const ctxUsagePct = Math.min(Math.round((estimatedCtx / ctxLimit) * 100), 100);
  const filled = Math.min(Math.max(Math.round(ctxUsagePct / 10), 0), 10);
  const ctxBar = '█'.repeat(filled) + '░'.repeat(10 - filled);

  // Cache status from V2 session liveness
  let cacheStatus: string;
  if (sessionStats !== null) {
    const ageMs = sessionStats.ageMs;
    if (ageMs < 5 * 60 * 1000) {
      cacheStatus = '🟢 熱（V2 process 存活，cache 有效）';
    } else if (ageMs < 15 * 60 * 1000) {
      cacheStatus = '🟡 溫（process 存活但 cache 可能部分過期）';
    } else {
      cacheStatus = '🔴 冷（process 閒置超過 15 分鐘）';
    }
  } else {
    cacheStatus = '⚫ 無 V2 session（下次對話會建新 process）';
  }

  // Last query cache hit rate
  let cacheHitPct = 0;
  let cacheDetail = '無資料';
  if (lastQuery !== undefined) {
    const totalCacheable = lastQuery.cacheReadTokens + lastQuery.cacheCreationTokens;
    cacheHitPct = totalCacheable > 0 ? Math.round((lastQuery.cacheReadTokens / totalCacheable) * 100) : 0;
    cacheDetail = [
      `${cacheHitPct}%`,
      `read ${(lastQuery.cacheReadTokens / 1000).toFixed(1)}K`,
      `create ${(lastQuery.cacheCreationTokens / 1000).toFixed(1)}K`,
      `new input ${(lastQuery.inputTokens / 1000).toFixed(1)}K`,
      `output ${(lastQuery.outputTokens / 1000).toFixed(1)}K`,
      `${lastQuery.numTurns} turns`,
      `$${lastQuery.totalCostUsd.toFixed(3)}`,
    ].join(' · ');
  }

  const embed = new EmbedBuilder()
    .setTitle(`📊 Session — ${agentName}`)
    .setColor(ctxUsagePct > 80 ? 0xED4245 : ctxUsagePct > 50 ? 0xFEE75C : 0x57F287)
    .addFields(
      {
        name: '📐 Context Window',
        value: `${ctxBar} **${ctxUsagePct}%**\n預估 ${(estimatedCtx / 1000).toFixed(1)}K / ${(ctxLimit / 1000).toFixed(0)}K tokens`,
        inline: false,
      },
      { name: '🔄 Cache', value: cacheStatus, inline: false },
      { name: '📈 最近一次查詢', value: cacheDetail, inline: false },
      {
        name: '📊 Session 累計',
        value: `${sessionQueryCount} 次查詢 · ${(sessionTotalOutput / 1000).toFixed(1)}K output · $${sessionTotalCost.toFixed(3)}`,
        inline: true,
      },
      {
        name: '⚙️ V2 Process',
        value: sessionStats !== null ? `🟢 存活（${sessionStats.messageCount} msg）` : '⚫ 無',
        inline: true,
      },
    )
    .setFooter({ text: `${model} · ${isThread ? 'thread' : 'main'} · ${channelId}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleRestart(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  log.info({ userId: interaction.user.id }, 'Discord /restart command received');
  await interaction.editReply('🔍 正在檢查程式碼（`npm run build`）...');

  // Pre-flight: npm run build (includes tsc)
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    await execAsync('npm run build', { cwd: process.cwd(), timeout: 120000 });
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string };
    const errorOutput = (err.stderr ?? err.stdout ?? 'Unknown error').slice(0, 1500);
    log.error({ error: errorOutput }, 'Build failed, aborting restart');
    await interaction.editReply(`❌ Build 失敗，取消重啟：\n\`\`\`\n${errorOutput}\n\`\`\``);
    return;
  }

  log.info({ userId: interaction.user.id }, 'Build passed, initiating restart');
  await interaction.editReply('✅ Build 通過！🔄 正在重啟 ClaudeCab...\n\n稍後會重新上線！');

  // Graceful shutdown — PM2 auto-restart
  setTimeout(() => {
    log.info('Graceful shutdown initiated via Discord /restart');
    process.exit(0);
  }, 1000);
}

async function handleTask(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  if (deps.taskService === undefined) {
    await interaction.reply({ content: '❌ TaskService 未啟用', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'create': {
      await interaction.deferReply();
      const title = interaction.options.getString('title', true);
      const priority = (interaction.options.getString('priority') ?? 'medium') as 'urgent' | 'medium' | 'low';
      const assignee = interaction.options.getString('assignee');
      const description = interaction.options.getString('description');

      const taskId = await deps.taskService.createTask({
        title,
        priority,
        ...(assignee !== null ? { assigneeAgentId: assignee } : {}),
        ...(description !== null ? { description } : {}),
        createdByUserId: interaction.user.id,
      });

      const emoji = priority === 'urgent' ? '🔴' : priority === 'low' ? '🟢' : '🟡';
      await interaction.editReply(
        `✅ 任務已建立\n${emoji} **${title}**\nID: \`${taskId.slice(0, 8)}\`${assignee !== null ? `\n指派: ${assignee}` : ''}`
      );
      break;
    }

    case 'list': {
      const status = interaction.options.getString('status') as 'backlog' | 'in_progress' | 'done' | undefined;
      const tasks = deps.taskService.list(status ?? undefined, 15);

      if (tasks.length === 0) {
        await interaction.reply({ content: '目前沒有任務', ephemeral: true });
        return;
      }

      const statusEmoji: Record<string, string> = {
        backlog: '📋', in_progress: '🔄', in_review: '👀', done: '✅', cancelled: '❌',
      };
      const priorityEmoji: Record<string, string> = { urgent: '🔴', medium: '🟡', low: '🟢' };

      const lines = tasks.map(t => {
        const s = statusEmoji[t.status] ?? '?';
        const p = priorityEmoji[t.priority] ?? '⚪';
        const assignee = t.assignee_agent_id ? ` → ${t.assignee_agent_id}` : '';
        return `${s}${p} **${t.title}**${assignee} \`${t.id.slice(0, 8)}\``;
      });

      const embed = new EmbedBuilder()
        .setTitle('📋 任務清單')
        .setDescription(lines.join('\n'))
        .setColor(0x5865F2)
        .setFooter({ text: `共 ${tasks.length} 筆` });

      await interaction.reply({ embeds: [embed] });
      break;
    }

    case 'complete': {
      await interaction.deferReply({ ephemeral: true });
      const taskId = interaction.options.getString('id', true);

      // Find task by prefix match
      const allTasks = deps.taskService.list(undefined, 500);
      const match = allTasks.find(t => t.id.startsWith(taskId));

      if (match === undefined) {
        await interaction.editReply(`❌ 找不到 ID 開頭為 \`${taskId}\` 的任務`);
        return;
      }

      await deps.taskService.completeTask(match.id);
      await interaction.editReply(`✅ 任務「${match.title}」已完成`);
      break;
    }

    default:
      await interaction.reply({ content: `未知子指令：${sub}`, ephemeral: true });
  }
}
