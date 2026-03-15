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
import type { BudgetService } from '../../services/BudgetService.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'DiscordSlashCommands' });

export interface SlashCommandDependencies {
  agentLoader: AgentLoader;
  sessionManager: SessionManager;
  messageProcessor: MessageProcessor;
  budgetService?: BudgetService;
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
  // SDK doesn't expose a clean abort for running queries from Discord
  // This is a placeholder — Telegram's /stop works via grammy context
  await interaction.reply({
    content: '⚠️ Discord 端的停止功能開發中。目前請透過 Telegram 使用 /stop。',
    ephemeral: true,
  });
}
