import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import {
  CLAUDE_CONTEXT_WINDOW_TOKENS, formatDuration, formatQueryMetricAnomaly,
  fitSessionDescription,
  type SlashCommandDependencies, type QueryMetricRow,
} from './_shared.js';
import { parseSessionKey } from '../../../types/session.js';
import { buildDiscordChannelUrl, buildDiscordMessageUrl } from '../../../types/runtimeContext.js';
import { getJsonlPath } from '../../../core/keepalive/SDKTranscriptDiagnostics.js';

export async function handleSessions(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const ownerId = deps.ownerUserId;
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
  const latestQueryBySdkSession = new Map<string, QueryMetricRow>();
  for (const q of deps.queryMetricsRepository?.getLatestQueryPerSession() ?? []) {
    if (q.sdkSessionId === undefined) continue;
    latestQueryBySdkSession.set(q.sdkSessionId, q);
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

    const guildId = s.runtimeContext?.guildId ?? interaction.guildId ?? deps.guildId;
    const discordUrl = buildDiscordChannelUrl(guildId, targetChannelId);
    const sourceMessageUrl = buildDiscordMessageUrl(guildId, s.runtimeContext?.sourceMessageChannelId ?? targetChannelId, s.runtimeContext?.originalMessageId);
    const target = discordUrl !== undefined ? ` · [${targetLabel}](${discordUrl})` : ` · ${targetLabel}`;
    const jsonlPath = s.sdkSessionId && s.cwd ? getJsonlPath(s.sdkSessionId, s.cwd) : undefined;
    const dirty = s.lastPromptCacheMutation;
    const anomaly = s.lastKeepaliveAnomaly;
    const cacheTail = dirty !== undefined ? `cache tail: ${dirty.reason} ${formatDuration(now - dirty.at)} ago` : undefined;
    const anomalyLine = anomaly !== undefined ? `last keepalive anomaly: ${anomaly.hitPct ?? 0}% · ${anomaly.likelyCause ?? 'unknown'} · ${formatDuration(now - anomaly.at)} ago` : undefined;

    const latestQueryAnomaly = latestQuery !== undefined
      ? formatQueryMetricAnomaly(latestQuery, {
          sessionId: s.sessionId, agentId,
          ...(discordUrl !== undefined ? { discordUrl } : {}),
          ...(sourceMessageUrl !== undefined ? { sourceMessageUrl } : {}),
          ...(jsonlPath !== undefined ? { jsonlPath } : {}),
          sessionMessageCount: s.messageCount,
        })
      : undefined;

    const ctxK = s.contextTokens !== undefined ? (s.contextTokens / 1000).toFixed(1) : '?';
    const ctxWinK = s.contextWindowSize !== undefined ? (s.contextWindowSize / 1000).toFixed(0) : String(CLAUDE_CONTEXT_WINDOW_TOKENS / 1000);
    const ctxPct = s.contextTokens !== undefined && s.contextWindowSize ? ((s.contextTokens / s.contextWindowSize) * 100).toFixed(1) : '?';
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
      cacheTail, anomalyLine,
      latestQueryAnomaly !== undefined ? `last query anomaly: ${latestQueryAnomaly}` : undefined,
      latestQuery !== undefined ? `last query row: #${latestQuery.id} · chatId: \`${latestQuery.chatId}\`` : undefined,
    ].filter((x): x is string => x !== undefined).join('\n'));

    buttonSessions.push({ sessionId: s.sessionId, label: `${agentId} ${s.sessionId.slice(0, 8)}` });
  }

  const description = fitSessionDescription(lines, 15, 3900);
  const embed = new EmbedBuilder()
    .setTitle(`🖥️ V2 Sessions（${summaries.length} 個活躍）`)
    .setDescription(description)
    .setColor(0x5865F2)
    .setTimestamp();

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();
  let btnCount = 0;
  for (const { sessionId, label } of buttonSessions) {
    if (btnCount >= 20) break;
    const fullCustomId = `sess:close:${sessionId}`;
    if (fullCustomId.length > 100) continue;
    if (currentRow.components.length >= 5) { rows.push(currentRow); currentRow = new ActionRowBuilder<ButtonBuilder>(); }
    currentRow.addComponents(new ButtonBuilder().setCustomId(fullCustomId).setLabel(`❌ ${label.slice(0, 20)}`).setStyle(ButtonStyle.Secondary));
    btnCount++;
  }
  if (currentRow.components.length > 0) rows.push(currentRow);

  if (rows.length < 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('sess:closeall').setLabel('🗑️ 全部關閉').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('sess:closeidle').setLabel('🧹 關閉閒置 >1h').setStyle(ButtonStyle.Primary),
    ));
  }

  await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });

  try {
    const reply = await interaction.fetchReply();
    const timer = setTimeout(async () => { try { await reply.edit({ components: [] }); } catch { /* message may be deleted */ } }, 5 * 60 * 1000);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  } catch { /* fetchReply failed */ }
}
