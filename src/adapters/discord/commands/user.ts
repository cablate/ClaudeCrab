import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { resolveEffectiveUserId, type SlashCommandDependencies } from './_shared.js';
import { applyModelChange } from '../../commands/index.js';

export async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
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

export async function handleStatus(
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
    const dcIcon = dcStatus === 'running' ? '🟢' : dcStatus === 'no-token' ? '⚫' : '🔴';
    lines.push(`${emoji} **${name}** (${model}) — DC ${dcIcon}`);
  }
  const embed = new EmbedBuilder()
    .setTitle('🤖 Agent 狀態')
    .setColor(0x5865F2)
    .setDescription(lines.join('\n'))
    .setTimestamp();
  await interaction.reply({ embeds: [embed] });
}

export async function handleReset(
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
    let resetCount = 0;
    for (const id of deps.agentLoader.list()) {
      if (deps.messageProcessor.clearConversationFor('discord', id, effectiveUserId)) resetCount++;
    }
    await interaction.editReply(`✅ 已重置 ${resetCount} 個對話`);
  }
}

export async function handleModel(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const agentId = interaction.options.getString('agent');
  const targetModel = interaction.options.getString('to');
  if (agentId === null && targetModel === null) {
    const lines = deps.agentLoader.list().map(id => {
      const agent = deps.agentLoader.get(id);
      const name = agent?.config.name ?? id;
      const model = agent?.config.model ?? 'sonnet';
      return `**${name}** → \`${model}\``;
    });
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🧠 模型配置').setDescription(lines.join('\n')).setColor(0x5865F2)], ephemeral: true });
    return;
  }
  if (targetModel !== null) {
    const targetAgent = agentId ?? deps.agentLoader.list()[0];
    if (targetAgent === undefined) {
      await interaction.reply({ content: '❌ 找不到 Agent', ephemeral: true });
      return;
    }
    try {
      const result = await applyModelChange(targetAgent, targetModel, deps.agentLoader);
      if (result.success) {
        const MODEL_LABELS: Record<string, string> = { opus: '🟣 Opus', sonnet: '🔵 Sonnet', haiku: '🟢 Haiku' };
        await interaction.reply({ content: `✅ **${targetAgent}** 模型已切換為 ${MODEL_LABELS[targetModel] ?? targetModel}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `❌ 切換失敗：${result.error}`, ephemeral: true });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await interaction.reply({ content: `❌ 切換失敗：${msg}`, ephemeral: true });
    }
    return;
  }
  const agent = deps.agentLoader.get(agentId!);
  if (agent === undefined) {
    await interaction.reply({ content: `❌ Agent "${agentId}" 不存在`, ephemeral: true });
    return;
  }
  await interaction.reply({ content: `🧠 **${agent.config.name ?? agentId}** → \`${agent.config.model ?? 'sonnet'}\``, ephemeral: true });
}

export async function handleCost(
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

export async function handleStop(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const agentId = interaction.options.getString('agent');
  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const isThread = interaction.channel?.isThread() ?? false;
  const effectiveUserId = resolveEffectiveUserId(userId, channelId, isThread);
  const targetAgents = agentId !== null ? [agentId] : deps.agentLoader.list();
  let cancelled = 0;
  for (const aid of targetAgents) {
    if (deps.messageProcessor.cancelQueryForUser('discord', aid, effectiveUserId)) cancelled++;
  }
  if (cancelled > 0) {
    await interaction.reply({ content: `🛑 已停止 ${cancelled} 個執行中的查詢。`, ephemeral: true });
  } else {
    await interaction.reply({ content: 'ℹ️ 目前沒有正在執行的查詢。', ephemeral: true });
  }
}
