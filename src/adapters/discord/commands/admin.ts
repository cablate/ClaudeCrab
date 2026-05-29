import type { ChatInputCommandInteraction } from 'discord.js';
import { log, resolveEffectiveUserId, type SlashCommandDependencies } from './_shared.js';

export async function handleClose(
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
  if (session !== undefined && deps.messageProcessor.closeSession(session.sessionId)) {
    await interaction.reply({ content: '🔒 V2 session 已關閉。對話紀錄保留，下次訊息會建立新 session。', ephemeral: true });
  } else {
    await interaction.reply({ content: 'ℹ️ 目前沒有活躍的 V2 session。', ephemeral: true });
  }
}

export async function handleSync(
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
    await interaction.reply({ content: `🔄 已更新 ${result.routed} 個子代理。仍在執行：${result.active}。`, ephemeral: true });
  } else if (result.active > 0) {
    await interaction.reply({ content: `🔄 無新進度。仍有 ${result.active} 個子代理在執行。`, ephemeral: true });
  } else {
    await interaction.reply({ content: '🔄 無更新。', ephemeral: true });
  }
}

export async function handleRestart(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  log.info({ userId: interaction.user.id }, 'Discord /restart command received');
  await interaction.editReply('🔍 正在檢查程式碼（`npm run build`）...');
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
  setTimeout(() => { log.info('Graceful shutdown initiated via Discord /restart'); process.exit(0); }, 1000);
}
