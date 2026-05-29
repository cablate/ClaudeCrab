/**
 * DiscordSlashCommands — register and handle Discord Slash Commands.
 *
 * Discord slash commands: /help, /reset, /stop, /model, /status, /schedule
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { AgentLoader } from '../../core/orchestrator/AgentLoader.js';
import type { SessionManager } from '../../core/session/SessionManager.js';
import type { MessageProcessor } from '../../core/orchestrator/MessageProcessor.js';
import type { SDKSessionManager } from '../../core/session/SDKSessionManager.js';
import type { IQueryMetricsRepository, QueryMetricRow } from '../../persistence/types.js';
import { parseSessionKey } from '../../types/session.js';
import { buildDiscordChannelUrl, buildDiscordMessageUrl } from '../../types/runtimeContext.js';
import { getJsonlPath } from '../../core/keepalive/SDKTranscriptDiagnostics.js';
import { diagnoseQueryUsage } from '../../core/keepalive/UsageAnomalyDiagnostics.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'DiscordSlashCommands' });

/** Claude's context window size in tokens (all current models: opus/sonnet/haiku) */
const CLAUDE_CONTEXT_WINDOW_TOKENS = 200_000;

export interface SlashCommandDependencies {
  agentLoader: AgentLoader;
  sessionManager: SessionManager;
  messageProcessor: MessageProcessor;
  queryMetricsRepository?: IQueryMetricsRepository;
  sdkSessionManager?: SDKSessionManager;
  getBotStatus?: (agentId: string) => 'running' | 'stopped' | 'error' | 'no-token';
}

/**
 * Compute the effective userId for a Discord slash command interaction.
 * Handles two session key patterns:
 * - Main channel: userId
 * - Thread: userId::thread::threadId
 */
function resolveEffectiveUserId(
  userId: string,
  channelId: string,
  isThread: boolean,
): string {
  if (!isThread) return userId;
  return `${userId}::thread::${channelId}`;
}

/** Build the slash command definitions for guild registration */
export function buildSlashCommands(): SlashCommandBuilder[] {
  return [
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('顯示指令說明')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('status')
      .setDescription('顯示所有 Agent 狀態')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('reset')
      .setDescription('重置指定 Agent 的對話記錄')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(opt =>
        opt.setName('agent').setDescription('Agent ID（留空 = 當前頻道的 Agent）').setRequired(false)
      ) as SlashCommandBuilder,

    new SlashCommandBuilder()
      .setName('model')
      .setDescription('查看或切換 Agent 的 AI 模型')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
      .setDescription('查看今日和月度花費摘要')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('停止指定 Agent 的執行')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(opt =>
        opt.setName('agent').setDescription('Agent ID').setRequired(false)
      ) as SlashCommandBuilder,

    new SlashCommandBuilder()
      .setName('close')
      .setDescription('關閉 V2 session（釋放資源，保留對話紀錄）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('sync')
      .setDescription('撈取子代理最新進度（不呼叫模型，只更新訊息）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('restart')
      .setDescription('重啟 ClaudeCab（先跑 tsc 檢查，通過才重啟）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('ctx')
      .setDescription('顯示當前 session 的 context 使用量、cache 狀態、花費')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('cache')
      .setDescription('Cache 觀測（全域）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(sub =>
        sub.setName('status').setDescription('全域 cache 健康快照：所有活 session、平均命中率'))
      .addSubcommand(sub =>
        sub.setName('efficiency').setDescription('歷史 cache 命中趨勢（從 DB 算）')
          .addStringOption(opt => opt.setName('agent').setDescription('Agent ID（留空 = 全部）').setRequired(false))
          .addIntegerOption(opt => opt.setName('days').setDescription('回看幾天（預設 7）').setRequired(false).setMinValue(1).setMaxValue(90)))
      .addSubcommand(sub =>
        sub.setName('flush').setDescription('銷毀指定 SDK session（admin）')
          .addStringOption(opt => opt.setName('session').setDescription('SessionId 前 8 碼或完整').setRequired(true))) as SlashCommandBuilder,

    new SlashCommandBuilder()
      .setName('sessions')
      .setDescription('列出所有 V2 persistent sessions（admin）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

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

async function handleClose(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const isThread = interaction.channel?.isThread() ?? false;
  const effectiveUserId = resolveEffectiveUserId(userId, channelId, isThread);

  // Find agent for this channel (check parent for threads)
  const parentChannelId = isThread && interaction.channel?.isThread()
    ? interaction.channel.parentId
    : channelId;

  const agentId = deps.agentLoader.list().find(id => {
    const agent = deps.agentLoader.get(id);
    return agent?.config.discordChannelId === parentChannelId;
  });

  if (agentId === undefined) {
    await interaction.reply({ content: 'ℹ️ 找不到此頻道的 Agent。', ephemeral: true });
    return;
  }

  const session = deps.sessionManager.getSession('discord', agentId, effectiveUserId);
  if (session !== undefined && deps.messageProcessor.closeSession(session.sessionId)) {
    await interaction.reply({ content: '🔒 V2 session 已關閉。對話紀錄保留，下次訊息會建立新 session。', ephemeral: true });
  } else {
    await interaction.reply({ content: 'ℹ️ 目前沒有活躍的 V2 session。', ephemeral: true });
  }
}

/**
 * /sync — Plan G: drain the V2 session buffer and route late sub-agent
 * task_notification events to update their original chat messages in place.
 * No model call; cheap ( < 1.5s ).
 */
async function handleSync(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const isThread = interaction.channel?.isThread() ?? false;
  const effectiveUserId = resolveEffectiveUserId(userId, channelId, isThread);

  const parentChannelId = isThread && interaction.channel?.isThread()
    ? interaction.channel.parentId
    : channelId;

  const agentId = deps.agentLoader.list().find(id => {
    const agent = deps.agentLoader.get(id);
    return agent?.config.discordChannelId === parentChannelId;
  });

  if (agentId === undefined) {
    await interaction.reply({ content: 'ℹ️ 找不到此頻道的 Agent。', ephemeral: true });
    return;
  }

  const session = deps.sessionManager.getSession('discord', agentId, effectiveUserId);
  if (session === undefined) {
    await interaction.reply({ content: 'ℹ️ 目前沒有活躍的 V2 session。', ephemeral: true });
    return;
  }

  const result = await deps.messageProcessor.syncSubAgentUpdates(session.sessionId);
  if (result === null) {
    await interaction.reply({ content: 'ℹ️ 目前沒有活躍的 V2 session。', ephemeral: true });
    return;
  }

  if (result.routed > 0) {
    await interaction.reply({
      content: `🔄 已更新 ${result.routed} 個子代理。仍在執行：${result.active}。`,
      ephemeral: true,
    });
  } else if (result.active > 0) {
    await interaction.reply({
      content: `🔄 無新進度。仍有 ${result.active} 個子代理在執行。`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({ content: '🔄 無更新。', ephemeral: true });
  }
}

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
      case 'close':
        await handleClose(interaction, deps);
        break;
      case 'sync':
        await handleSync(interaction, deps);
        break;
      case 'ctx':
        await handleCtx(interaction, deps);
        break;
      case 'cache':
        await handleCache(interaction, deps);
        break;
      case 'restart':
        await handleRestart(interaction);
        break;
      case 'sessions':
        await handleSessions(interaction, deps);
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

    const dcStatus = deps.getBotStatus?.(agentId) ?? 'no-token';

    const statusParts: string[] = [];
    const dcIcon = dcStatus === 'running' ? '🟢' : dcStatus === 'no-token' ? '⚫' : '🔴';
    statusParts.push(`DC ${dcIcon}`);

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
  const channelId = interaction.channelId;
  const isThread = interaction.channel?.isThread() ?? false;
  const effectiveUserId = resolveEffectiveUserId(userId, channelId, isThread);

  if (agentId !== null) {
    if (!deps.agentLoader.has(agentId)) {
      await interaction.editReply(`❌ Agent「${agentId}」不存在`);
      return;
    }
    deps.messageProcessor.clearConversationFor('discord', agentId, effectiveUserId);
    await interaction.editReply(`✅ 已重置與 **${agentId}** 的對話`);
  } else {
    // Reset all agents for this user
    let resetCount = 0;
    for (const id of deps.agentLoader.list()) {
      if (deps.messageProcessor.clearConversationFor('discord', id, effectiveUserId)) {
        resetCount++;
      }
    }
    await interaction.editReply(`✅ 已重置 ${resetCount} 個對話`);
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

  // Model switching
  if (targetModel !== null) {
    const targetAgent = agentId ?? deps.agentLoader.list()[0];
    if (targetAgent === undefined) {
      await interaction.reply({ content: '❌ 找不到 Agent', ephemeral: true });
      return;
    }

    try {
      const { applyModelChange } = await import('../commands/index.js');
      const result = await applyModelChange(targetAgent, targetModel, deps.agentLoader);
      if (result.success) {
        const MODEL_LABELS: Record<string, string> = { opus: '🟣 Opus', sonnet: '🔵 Sonnet', haiku: '🟢 Haiku' };
        await interaction.reply({
          content: `✅ **${targetAgent}** 模型已切換為 ${MODEL_LABELS[targetModel] ?? targetModel}`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({ content: `❌ 切換失敗：${result.error}`, ephemeral: true });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await interaction.reply({ content: `❌ 切換失敗：${msg}`, ephemeral: true });
    }
    return;
  }

  // Only agentId specified, show that agent's model
  const agent = deps.agentLoader.get(agentId!);
  if (agent === undefined) {
    await interaction.reply({ content: `❌ Agent "${agentId}" 不存在`, ephemeral: true });
    return;
  }
  await interaction.reply({
    content: `🧠 **${agent.config.name ?? agentId}** → \`${agent.config.model ?? 'sonnet'}\``,
    ephemeral: true,
  });
}

async function handleCost(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const agents = deps.agentLoader.list();
  const lines: string[] = [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  for (const agentId of agents) {
    const agent = deps.agentLoader.get(agentId);
    if (agent === undefined) continue;

    const name = (agent.config.name || agentId).slice(0, 10);
    const todayCost = deps.queryMetricsRepository?.getAgentStatsSince(agentId, todayStart)?.totalCostUsd ?? 0;
    const monthCost = deps.queryMetricsRepository?.getAgentStatsSince(agentId, monthStart)?.totalCostUsd ?? 0;

    lines.push(`**${name}**　$${todayCost.toFixed(2)} 今日 · $${monthCost.toFixed(2)} 月`);
  }

  if (lines.length === 0) {
    await interaction.reply({ content: '尚無花費紀錄', ephemeral: true });
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
  const agentId = interaction.options.getString('agent');
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const isThread = interaction.channel?.isThread() ?? false;
  const effectiveUserId = resolveEffectiveUserId(userId, channelId, isThread);

  const targetAgents = agentId !== null
    ? [agentId]
    : deps.agentLoader.list();

  let cancelled = 0;
  for (const aid of targetAgents) {
    if (deps.messageProcessor.cancelQueryForUser('discord', aid, effectiveUserId)) {
      cancelled++;
    }
  }

  if (cancelled > 0) {
    await interaction.reply({
      content: `🛑 已停止 ${cancelled} 個執行中的查詢。`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: 'ℹ️ 目前沒有正在執行的查詢。',
      ephemeral: true,
    });
  }
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

  // Context window sizes per model (all current Claude models share the same limit)
  const ctxLimits: Record<string, number> = {
    opus: CLAUDE_CONTEXT_WINDOW_TOKENS,
    sonnet: CLAUDE_CONTEXT_WINDOW_TOKENS,
    haiku: CLAUDE_CONTEXT_WINDOW_TOKENS,
  };
  const ctxLimit = ctxLimits[model] ?? CLAUDE_CONTEXT_WINDOW_TOKENS;

  const effectiveUserId = resolveEffectiveUserId(userId, channelId, isThread);

  // Get the actual SessionManager session to find the real sessionId
  const session = deps.sessionManager.getSession('discord', agentId, effectiveUserId);

  // Session was soft-deleted (reset) and no new message yet
  if (session !== undefined && !session.isActive) {
    await interaction.reply({ content: '🔄 Session 已重置，尚無活躍 session。發送訊息後會建立新 session。', ephemeral: true });
    return;
  }

  // Resolve session start time — in-memory createdAt preferred, DB created_at fallback.
  // DB fallback returns undefined for soft-deleted sessions (reset state).
  const sessionCreatedAt = session?.createdAt
    ?? deps.sessionManager.getSessionCreatedAtFromDB('discord', agentId, effectiveUserId);

  const realSessionId = session?.sessionId;

  // Get V2 session stats using the real session ID
  const sessionStats = (realSessionId !== undefined && deps.sdkSessionManager !== undefined)
    ? deps.sdkSessionManager.getSessionStats(realSessionId)
    : null;

  // Get recent query metrics for this agent + user
  // Collect query data for this thread/channel (newest first from getRecentQueries)
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
  const matchedQueries: QueryInfo[] = [];

  if (deps.queryMetricsRepository !== undefined) {
    const recent = deps.queryMetricsRepository.getRecentChannelQueries(channelId, agentId, sessionCreatedAt?.toISOString(), 100);
    for (const q of recent) {
      sessionQueryCount++;
      sessionTotalCost += q.totalCostUsd;
      sessionTotalOutput += q.outputTokens;

      const info: QueryInfo = {
        inputTokens: q.inputTokens,
        outputTokens: q.outputTokens,
        cacheReadTokens: q.cacheReadTokens,
        cacheCreationTokens: q.cacheCreationTokens,
        totalCostUsd: q.totalCostUsd,
        numTurns: q.numTurns,
      };
      matchedQueries.push(info);

      if (lastQuery === undefined) {
        lastQuery = info;
      }
    }
  }

  // Context size: live session preferred, JSONL fallback when no live session.
  let estimatedCtx = 0;
  const liveCtx = (realSessionId !== undefined && deps.sdkSessionManager !== undefined)
    ? deps.sdkSessionManager.getSessionTokenCount(realSessionId)
    : null;
  if (liveCtx !== null) {
    estimatedCtx = liveCtx;
  } else if (session?.sdkSessionId) {
    try {
      const { restoreContextFromJsonl } = await import('../../core/session/SDKContextRestore.js');
      const jsonlCtx = await restoreContextFromJsonl(session.sdkSessionId, agent.path);
      if (jsonlCtx !== null) estimatedCtx = jsonlCtx;
    } catch { /* JSONL not available */ }
  }
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
    const lastCtxK = lastQuery.numTurns > 0
      ? Math.round((lastQuery.inputTokens + lastQuery.cacheReadTokens + lastQuery.cacheCreationTokens) / lastQuery.numTurns / 1000)
      : 0;
    cacheDetail = [
      `ctx ≈${lastCtxK}K`,
      `${lastQuery.numTurns} turns`,
      `cache ${cacheHitPct}%`,
      `out ${(lastQuery.outputTokens / 1000).toFixed(1)}K`,
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

  // Per-query history (oldest → newest, max 10)
  const embeds: EmbedBuilder[] = [embed];

  if (matchedQueries.length > 0) {
    const historyLines: string[] = [];
    const chronological = [...matchedQueries].reverse(); // oldest first
    // Show all queries (Discord embed description limit is 4096 chars)
    const showMax = chronological.length;

    for (let i = 0; i < showMax; i++) {
      const q = chronological[i]!;
      const throughput = q.inputTokens + q.cacheReadTokens + q.cacheCreationTokens;
      const hitPct = throughput > 0 ? Math.round((q.cacheReadTokens / throughput) * 100) : 0;
      const hitBar = hitPct >= 80 ? '🟩' : hitPct >= 40 ? '🟨' : '🟥';
      const ctxK = q.numTurns > 0 ? Math.round(throughput / q.numTurns / 1000) : Math.round(throughput / 1000);

      historyLines.push(
        `\`#${i + 1}\` ${hitBar} **${hitPct}%** hit · ` +
        `ctx ≈${ctxK}K · ` +
        `${q.numTurns}t · ` +
        `out ${(q.outputTokens / 1000).toFixed(1)}K · ` +
        `$${q.totalCostUsd.toFixed(3)}`
      );
    }

    // Discord embed description limit: 4096 chars. Split into multiple embeds if needed.
    const EMBED_DESC_LIMIT = 4000; // Leave margin
    let currentChunk: string[] = [];
    let currentLen = 0;
    let chunkIndex = 0;

    for (const line of historyLines) {
      if (currentLen + line.length + 1 > EMBED_DESC_LIMIT && currentChunk.length > 0) {
        const title = chunkIndex === 0 ? `📜 查詢歷史（${chronological.length} 筆）` : '📜 查詢歷史（續）';
        embeds.push(new EmbedBuilder().setTitle(title).setDescription(currentChunk.join('\n')).setColor(0x2B2D31));
        currentChunk = [];
        currentLen = 0;
        chunkIndex++;
        if (embeds.length >= 9) break; // Discord max 10 embeds per message
      }
      currentChunk.push(line);
      currentLen += line.length + 1;
    }
    if (currentChunk.length > 0) {
      const title = chunkIndex === 0 ? `📜 查詢歷史（${chronological.length} 筆）` : '📜 查詢歷史（續）';
      embeds.push(new EmbedBuilder().setTitle(title).setDescription(currentChunk.join('\n')).setColor(0x2B2D31));
    }
  }

  await interaction.reply({ embeds, ephemeral: true });
}

async function handleCache(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    if (deps.sdkSessionManager === undefined) {
      await interaction.reply({ content: '❌ SDKSessionManager 不可用', ephemeral: true });
      return;
    }
    const cs = deps.sdkSessionManager.getCacheStats();
    const sessCount = deps.sessionManager.getSessionCount();
    const effTxt = cs.avg_cache_efficiency_pct === null
      ? '—（沒有足夠資料）'
      : `${cs.avg_cache_efficiency_pct}%`;
    const embed = new EmbedBuilder()
      .setTitle('🧊 Cache 全域快照')
      .setDescription([
        `**活躍 V2 session**：${cs.active_sessions}`,
        `**SessionManager session**：${sessCount}`,
        `**正在查詢中**：${cs.querying_sessions}`,
        `**平均 cache 命中率**：${effTxt}`,
        `**低命中率（<50%）session**：${cs.low_efficiency_sessions}`,
        `**累計訊息數**：${cs.total_messages}`,
      ].join('\n'))
      .setColor(cs.low_efficiency_sessions > 0 ? 0xFFA500 : 0x2ECC71)
      .setFooter({ text: `Instance: ${process.env['HOSTNAME'] ?? 'local'} · PID ${process.pid}` });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === 'efficiency') {
    if (deps.queryMetricsRepository === undefined) {
      await interaction.reply({ content: '❌ QueryMetrics 未啟用', ephemeral: true });
      return;
    }
    const agentFilter = interaction.options.getString('agent') ?? undefined;
    const days = interaction.options.getInteger('days') ?? 7;
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

    // Pull a generous slice — repo has per-agent filter; no date filter so we trim in-memory.
    const rows = deps.queryMetricsRepository.getRecentQueries(2000, 0, agentFilter);
    const recent = rows.filter(r => new Date(r.createdAt).getTime() >= cutoffMs);
    if (recent.length === 0) {
      await interaction.reply({ content: `過去 ${days} 天沒有 query 紀錄`, ephemeral: true });
      return;
    }

    // Group by day
    const byDay = new Map<string, { count: number; read: number; create: number; input: number; output: number; cost: number }>();
    for (const r of recent) {
      const d = new Date(r.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const cur = byDay.get(key) ?? { count: 0, read: 0, create: 0, input: 0, output: 0, cost: 0 };
      cur.count++;
      cur.read += r.cacheReadTokens ?? 0;
      cur.create += r.cacheCreationTokens ?? 0;
      cur.input += r.inputTokens ?? 0;
      cur.output += r.outputTokens ?? 0;
      cur.cost += r.totalCostUsd ?? 0;
      byDay.set(key, cur);
    }

    const lines = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, s]) => {
        const total = s.input + s.read + s.create;
        const effPct = total > 0 ? Math.round((s.read / total) * 100) : 0;
        const bar = effPct >= 80 ? '🟢' : effPct >= 50 ? '🟡' : '🔴';
        return `${bar} \`${day}\` · ${effPct}% · ${s.count} 次 · read ${(s.read / 1000).toFixed(1)}k · cost $${s.cost.toFixed(3)}`;
      });

    const totalRead = recent.reduce((a, r) => a + (r.cacheReadTokens ?? 0), 0);
    const totalAll = recent.reduce((a, r) => a + (r.inputTokens ?? 0) + (r.cacheReadTokens ?? 0) + (r.cacheCreationTokens ?? 0), 0);
    const overallEff = totalAll > 0 ? Math.round((totalRead / totalAll) * 100) : 0;
    const totalCost = recent.reduce((a, r) => a + (r.totalCostUsd ?? 0), 0);
    const anomalyLines = recent
      .map((row) => ({ row, anomaly: formatQueryMetricAnomaly(row, { agentId: row.agentId }, true) }))
      .filter((entry): entry is { row: QueryMetricRow; anomaly: string } => entry.anomaly !== undefined)
      .slice(0, 5)
      .map(({ row, anomaly }) => `⚠ #${row.id} ${row.agentId} ${row.createdAt} | ${anomaly}`);

    const embed = new EmbedBuilder()
      .setTitle(`📈 Cache 命中趨勢 · 過去 ${days} 天${agentFilter ? ` · ${agentFilter}` : ''}`)
      .setDescription([
        `**總體命中率**：${overallEff}% · ${recent.length} 次查詢 · 累計 $${totalCost.toFixed(3)}`,
        '',
        ...lines,
        ...(anomalyLines.length > 0 ? ['', '**Recent anomalies**', ...anomalyLines] : []),
      ].join('\n').slice(0, 4000))
      .setColor(overallEff >= 80 ? 0x2ECC71 : overallEff >= 50 ? 0xFFA500 : 0xED4245);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === 'flush') {
    // Admin gate — compare against DISCORD_OWNER_USER_ID env.
    const ownerId = process.env['DISCORD_OWNER_USER_ID'];
    if (!ownerId || interaction.user.id !== ownerId) {
      await interaction.reply({ content: '❌ 僅 admin 可用', ephemeral: true });
      return;
    }
    if (deps.sdkSessionManager === undefined) {
      await interaction.reply({ content: '❌ SDKSessionManager 不可用', ephemeral: true });
      return;
    }
    const sidInput = interaction.options.getString('session', true);

    // Allow short prefix match (first 8 chars). Iterate session keys to find match.
    const stats = deps.sdkSessionManager.getCacheStats();
    let matched: string | undefined;
    const rawSessions = (deps.sdkSessionManager as unknown as { sessions: Map<string, unknown> }).sessions;
    if (rawSessions instanceof Map) {
      for (const key of rawSessions.keys()) {
        if (key === sidInput || key.startsWith(sidInput)) {
          matched = key;
          break;
        }
      }
    }
    if (matched === undefined) {
      await interaction.reply({
        content: `❌ 找不到符合 \`${sidInput}\` 的 session（共 ${stats.active_sessions} 個活 session）`,
        ephemeral: true,
      });
      return;
    }

    deps.sdkSessionManager.destroySession(matched);
    log.warn({ sessionId: matched, by: interaction.user.id }, 'Discord /cache flush — V2 session destroyed by admin');
    await interaction.reply({
      content: `✅ Session \`${matched}\` 已銷毀。下次訊息會自動建新 session。`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({ content: `未知子指令：${sub}`, ephemeral: true });
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function fitSessionDescription(lines: string[], maxDisplay: number, maxChars: number): string {
  const visible: string[] = [];
  for (const line of lines.slice(0, maxDisplay)) {
    const candidate = [...visible, line].join('\n\n');
    const hidden = lines.length - visible.length - 1;
    const suffix = hidden > 0 ? `\n\n... ${hidden} more sessions hidden` : '';
    if ((candidate + suffix).length > maxChars) break;
    visible.push(line);
  }

  if (visible.length === 0) {
    const first = lines[0] ?? '';
    return first.length > maxChars
      ? `${first.slice(0, Math.max(0, maxChars - 16))}\n... truncated`
      : first;
  }

  const hidden = lines.length - visible.length;
  return hidden > 0
    ? `${visible.join('\n\n')}\n\n... ${hidden} more sessions hidden`
    : visible.join('\n\n');
}

function queryMetricToDiagnosticResult(row: QueryMetricRow) {
  return {
    response: '',
    sdkSessionId: row.sdkSessionId ?? 'unknown',
    numTurns: row.numTurns,
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadInputTokens: row.cacheReadTokens,
      cacheCreationInputTokens: row.cacheCreationTokens,
      costUsd: row.totalCostUsd,
    },
    totalCostUsd: row.totalCostUsd,
    ...(row.contextTotalTokens !== undefined && row.contextMaxTokens !== undefined && row.contextPercentage !== undefined
      ? {
          contextUsage: {
            totalTokens: row.contextTotalTokens,
            maxTokens: row.contextMaxTokens,
            rawMaxTokens: row.contextMaxTokens,
            percentage: row.contextPercentage,
            model: row.contextModel ?? 'unknown',
            categories: [],
            memoryFiles: [],
            mcpTools: [],
            agents: [],
            apiUsage: null,
          },
        }
      : {}),
  };
}

function formatQueryMetricAnomaly(row: QueryMetricRow, context: {
  sessionId?: string;
  agentId?: string;
  discordUrl?: string;
  sourceMessageUrl?: string;
  jsonlPath?: string;
  sessionMessageCount?: number;
} = {}, alertOnly = false): string | undefined {
  const report = diagnoseQueryUsage(queryMetricToDiagnosticResult(row), {
    ...context,
    chatId: row.chatId,
    userId: row.userId,
    queryMetricId: row.id,
    ...(row.sdkSessionId !== undefined ? { sdkSessionId: row.sdkSessionId } : {}),
  });
  if (report === null || (alertOnly && !report.shouldAlert)) return undefined;
  const codes = report.findings.map((finding) => finding.code).join(',');
  return `${report.severity} ${codes} | hit ${report.metrics.cacheHitPct}% | W ${formatTokenShort(row.cacheCreationTokens)} | R ${formatTokenShort(row.cacheReadTokens)} | $${row.totalCostUsd.toFixed(3)} | ${report.likelyCause}`;
}

function formatTokenShort(value: number): string {
  const safeValue = Math.max(0, Math.round(value));
  if (safeValue >= 1_000_000) return `${(safeValue / 1_000_000).toFixed(1)}M`;
  if (safeValue >= 10_000) return `${Math.round(safeValue / 1000)}K`;
  if (safeValue >= 1000) return `${(safeValue / 1000).toFixed(1)}K`;
  return safeValue.toLocaleString();
}

async function handleSessions(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const ownerId = process.env['DISCORD_OWNER_USER_ID'];
  if (!ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({ content: '❌ 僅 admin 可用', ephemeral: true });
    return;
  }

  if (!deps.sdkSessionManager) {
    await interaction.reply({ content: '❌ SDKSessionManager 不可用', ephemeral: true });
    return;
  }

  const summaries = deps.sdkSessionManager.getSessionSummaries();
  if (summaries.length === 0) {
    await interaction.reply({ content: 'ℹ️ 目前沒有活躍的 V2 session。', ephemeral: true });
    return;
  }

  const userSessions = deps.sessionManager.getAllSessions();
  const userSessionMap = new Map(userSessions.map(s => [s.sessionId, s]));
  const recentQueries = deps.queryMetricsRepository?.getRecentQueries(2000) ?? [];
  const latestQueryBySdkSession = new Map<string, (typeof recentQueries)[number]>();
  for (const query of recentQueries) {
    if (query.sdkSessionId === undefined || query.turnType === 'keepalive') continue;
    if (!latestQueryBySdkSession.has(query.sdkSessionId)) {
      latestQueryBySdkSession.set(query.sdkSessionId, query);
    }
  }
  const now = Date.now();

  const lines: string[] = [];
  const buttonSessions: { sessionId: string; label: string }[] = [];

  for (const s of summaries) {
    const userSession = userSessionMap.get(s.sessionId);
    const latestQuery = latestQueryBySdkSession.get(s.sdkSessionId);
    let agentId = s.agentId ?? userSession?.agentId ?? '?';
    let targetLabel = 'main';
    let targetChannelId = s.runtimeContext?.chatId ?? latestQuery?.chatId;

    if (!userSession) {
      const parsed = parseSessionKey(s.sessionId);
      if (parsed) agentId = parsed.agentId;
    }

    if (userSession?.userId?.includes('::thread::')) {
      const threadId = userSession.userId.split('::thread::')[1];
      if (threadId !== undefined) targetChannelId = targetChannelId ?? threadId;
      targetLabel = threadId !== undefined ? `thread:${threadId}` : 'thread:unknown';
    } else if (userSession?.userId?.startsWith('task:')) {
      targetLabel = userSession.userId;
    } else if (targetChannelId !== undefined) {
      targetLabel = `thread:${targetChannelId}`;
    }

    const guildId = s.runtimeContext?.guildId ?? interaction.guildId ?? process.env.DISCORD_GUILD_ID;
    const discordUrl = buildDiscordChannelUrl(guildId, targetChannelId);
    const sourceMessageUrl = buildDiscordMessageUrl(
      guildId,
      s.runtimeContext?.sourceMessageChannelId ?? targetChannelId,
      s.runtimeContext?.originalMessageId,
    );
    const target = discordUrl !== undefined
      ? ` · [${targetLabel}](${discordUrl})`
      : ` · ${targetLabel}`;
    const jsonlPath = s.sdkSessionId && s.cwd ? getJsonlPath(s.sdkSessionId, s.cwd) : undefined;
    const dirty = s.lastPromptCacheMutation;
    const anomaly = s.lastKeepaliveAnomaly;
    const cacheTail = dirty !== undefined
      ? `cache tail: ${dirty.reason} ${formatDuration(now - dirty.at)} ago`
      : undefined;
    const anomalyLine = anomaly !== undefined
      ? `last keepalive anomaly: ${anomaly.hitPct ?? 0}% · ${anomaly.likelyCause ?? 'unknown'} · ${formatDuration(now - anomaly.at)} ago`
      : undefined;

    const latestQueryAnomaly = latestQuery !== undefined
      ? formatQueryMetricAnomaly(latestQuery, {
          sessionId: s.sessionId,
          agentId,
          ...(discordUrl !== undefined ? { discordUrl } : {}),
          ...(sourceMessageUrl !== undefined ? { sourceMessageUrl } : {}),
          ...(jsonlPath !== undefined ? { jsonlPath } : {}),
          sessionMessageCount: s.messageCount,
        })
      : undefined;

    const ctxK = s.contextTokens !== undefined ? (s.contextTokens / 1000).toFixed(1) : '?';
    const ctxWinK = s.contextWindowSize !== undefined ? (s.contextWindowSize / 1000).toFixed(0) : String(CLAUDE_CONTEXT_WINDOW_TOKENS / 1000);
    const ctxPct = s.contextTokens !== undefined && s.contextWindowSize
      ? ((s.contextTokens / s.contextWindowSize) * 100).toFixed(1)
      : '?';
    const cacheStr = s.cacheEfficiencyAvg !== undefined ? `${Math.round(s.cacheEfficiencyAvg)}%` : '—';
    const lastQueryAgo = s.lastQueryAt > 0 ? formatDuration(now - s.lastQueryAt) : '—';
    const ageHrs = ((now - s.createdAt) / 3_600_000).toFixed(1);
    const costStr = `$${s.totalCostUsd.toFixed(2)}`;
    const statusIcon = s.isQuerying ? '🔄' : '💤';

    lines.push([
      `${statusIcon} **${agentId}**${target}`,
      `ctx: ${ctxK}K / ${ctxWinK}K (${ctxPct}%) · cache: ${cacheStr}`,
      `last query: ${lastQueryAgo} · age: ${ageHrs}h · msgs: ${s.messageCount}`,
      `cost: ${costStr} · session: \`${s.sessionId.slice(0, 8)}\` · sdk: \`${s.sdkSessionId.slice(0, 8)}\``,
      sourceMessageUrl !== undefined ? `source: [message](${sourceMessageUrl})` : undefined,
      jsonlPath !== undefined ? `jsonl: \`${jsonlPath}\`` : undefined,
      cacheTail,
      anomalyLine,
      latestQueryAnomaly !== undefined ? `last query anomaly: ${latestQueryAnomaly}` : undefined,
      latestQuery !== undefined ? `last query row: #${latestQuery.id} · chatId: \`${latestQuery.chatId}\`` : undefined,
    ].filter((x): x is string => x !== undefined).join('\n'));

    buttonSessions.push({ sessionId: s.sessionId, label: `${agentId} ${s.sessionId.slice(0, 8)}` });
  }

  // Truncate if too many sessions (Discord description limit 4096 chars)
  const description = fitSessionDescription(lines, 15, 3900);

  const embed = new EmbedBuilder()
    .setTitle(`🖥️ V2 Sessions（${summaries.length} 個活躍）`)
    .setDescription(description)
    .setColor(0x5865F2)
    .setTimestamp();

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Individual close buttons — max 4 rows × 5 buttons = 20, reserve last row for bulk
  let currentRow = new ActionRowBuilder<ButtonBuilder>();
  let btnCount = 0;
  for (const { sessionId, label } of buttonSessions) {
    if (btnCount >= 20) break;
    const fullCustomId = `sess:close:${sessionId}`;
    if (fullCustomId.length > 100) continue;
    if (currentRow.components.length >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(fullCustomId)
        .setLabel(`❌ ${label.slice(0, 20)}`)
        .setStyle(ButtonStyle.Secondary),
    );
    btnCount++;
  }
  if (currentRow.components.length > 0) rows.push(currentRow);

  // Bulk action row (only if there's room — Discord max 5 rows)
  if (rows.length < 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('sess:closeall')
          .setLabel('🗑️ 全部關閉')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('sess:closeidle')
          .setLabel('🧹 關閉閒置 >1h')
          .setStyle(ButtonStyle.Primary),
      ),
    );
  }

  await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });

  // 5-minute timeout — remove buttons (session list goes stale quickly)
  try {
    const reply = await interaction.fetchReply();
    const timer = setTimeout(async () => {
      try { await reply.edit({ components: [] }); } catch { /* message may be deleted */ }
    }, 5 * 60 * 1000);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  } catch { /* fetchReply failed — non-critical */ }
}

async function handleRestart(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

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

