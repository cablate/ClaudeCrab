import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { CLAUDE_CONTEXT_WINDOW_TOKENS, resolveEffectiveUserId, type SlashCommandDependencies } from './_shared.js';
import { restoreContextFromJsonl } from '../../../core/session/SDKContextRestore.js';

export async function handleCtx(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const channelId = interaction.channelId;
  const userId = interaction.user.id;
  const isThread = interaction.channel?.isThread() ?? false;
  const parentChannelId = isThread && interaction.channel?.isThread()
    ? interaction.channel.parentId
    : channelId;

  let agentId: string | undefined;
  for (const id of deps.agentLoader.list()) {
    const agent = deps.agentLoader.get(id);
    if (agent?.config.discordChannelId === parentChannelId) { agentId = id; break; }
  }
  if (agentId === undefined) {
    await interaction.reply({ content: '此頻道沒有綁定 Agent', ephemeral: true });
    return;
  }

  const agent = deps.agentLoader.get(agentId)!;
  const agentName = agent.config.name || agentId;
  const model = agent.config.model ?? 'sonnet';
  const ctxLimits: Record<string, number> = { opus: CLAUDE_CONTEXT_WINDOW_TOKENS, sonnet: CLAUDE_CONTEXT_WINDOW_TOKENS, haiku: CLAUDE_CONTEXT_WINDOW_TOKENS };
  const ctxLimit = ctxLimits[model] ?? CLAUDE_CONTEXT_WINDOW_TOKENS;

  const effectiveUserId = resolveEffectiveUserId(userId, channelId, isThread);
  const session = deps.sessionManager.getSession('discord', agentId, effectiveUserId);
  if (session !== undefined && !session.isActive) {
    await interaction.reply({ content: '🔄 Session 已重置，尚無活躍 session。發送訊息後會建立新 session。', ephemeral: true });
    return;
  }

  const sessionCreatedAt = session?.createdAt
    ?? deps.sessionManager.getSessionCreatedAtFromDB('discord', agentId, effectiveUserId);
  const realSessionId = session?.sessionId;
  const sessionStats = (realSessionId !== undefined && deps.sdkSessionManager !== undefined)
    ? deps.sdkSessionManager.getSessionStats(realSessionId)
    : null;

  interface QueryInfo { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalCostUsd: number; numTurns: number; }
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
      const info: QueryInfo = { inputTokens: q.inputTokens, outputTokens: q.outputTokens, cacheReadTokens: q.cacheReadTokens, cacheCreationTokens: q.cacheCreationTokens, totalCostUsd: q.totalCostUsd, numTurns: q.numTurns };
      matchedQueries.push(info);
      if (lastQuery === undefined) lastQuery = info;
    }
  }

  let estimatedCtx = 0;
  const liveCtx = (realSessionId !== undefined && deps.sdkSessionManager !== undefined)
    ? deps.sdkSessionManager.getSessionTokenCount(realSessionId)
    : null;
  if (liveCtx !== null) {
    estimatedCtx = liveCtx;
  } else if (session?.sdkSessionId) {
    try {
      const jsonlCtx = await restoreContextFromJsonl(session.sdkSessionId, agent.path);
      if (jsonlCtx !== null) estimatedCtx = jsonlCtx;
    } catch { /* JSONL not available */ }
  }
  const ctxUsagePct = Math.min(Math.round((estimatedCtx / ctxLimit) * 100), 100);
  const filled = Math.min(Math.max(Math.round(ctxUsagePct / 10), 0), 10);
  const ctxBar = '█'.repeat(filled) + '░'.repeat(10 - filled);

  let cacheStatus: string;
  if (sessionStats !== null) {
    const ageMs = sessionStats.ageMs;
    if (ageMs < 5 * 60 * 1000) cacheStatus = '🟢 熱（V2 process 存活，cache 有效）';
    else if (ageMs < 15 * 60 * 1000) cacheStatus = '🟡 溫（process 存活但 cache 可能部分過期）';
    else cacheStatus = '🔴 冷（process 閒置超過 15 分鐘）';
  } else {
    cacheStatus = '⚫ 無 V2 session（下次對話會建新 process）';
  }

  let cacheHitPct = 0;
  let cacheDetail = '無資料';
  if (lastQuery !== undefined) {
    const totalCacheable = lastQuery.cacheReadTokens + lastQuery.cacheCreationTokens;
    cacheHitPct = totalCacheable > 0 ? Math.round((lastQuery.cacheReadTokens / totalCacheable) * 100) : 0;
    const lastCtxK = lastQuery.numTurns > 0
      ? Math.round((lastQuery.inputTokens + lastQuery.cacheReadTokens + lastQuery.cacheCreationTokens) / lastQuery.numTurns / 1000)
      : 0;
    cacheDetail = [`ctx ≈${lastCtxK}K`, `${lastQuery.numTurns} turns`, `cache ${cacheHitPct}%`, `out ${(lastQuery.outputTokens / 1000).toFixed(1)}K`, `$${lastQuery.totalCostUsd.toFixed(3)}`].join(' · ');
  }

  const embed = new EmbedBuilder()
    .setTitle(`📊 Session — ${agentName}`)
    .setColor(ctxUsagePct > 80 ? 0xED4245 : ctxUsagePct > 50 ? 0xFEE75C : 0x57F287)
    .addFields(
      { name: '📐 Context Window', value: `${ctxBar} **${ctxUsagePct}%**\n預估 ${(estimatedCtx / 1000).toFixed(1)}K / ${(ctxLimit / 1000).toFixed(0)}K tokens`, inline: false },
      { name: '🔄 Cache', value: cacheStatus, inline: false },
      { name: '📈 最近一次查詢', value: cacheDetail, inline: false },
      { name: '📊 Session 累計', value: `${sessionQueryCount} 次查詢 · ${(sessionTotalOutput / 1000).toFixed(1)}K output · $${sessionTotalCost.toFixed(3)}`, inline: true },
      { name: '⚙️ V2 Process', value: sessionStats !== null ? `🟢 存活（${sessionStats.messageCount} msg）` : '⚫ 無', inline: true },
    )
    .setFooter({ text: `${model} · ${isThread ? 'thread' : 'main'} · ${channelId}` })
    .setTimestamp();

  const embeds: EmbedBuilder[] = [embed];
  if (matchedQueries.length > 0) {
    const historyLines: string[] = [];
    const chronological = [...matchedQueries].reverse();
    const showMax = chronological.length;
    for (let i = 0; i < showMax; i++) {
      const q = chronological[i]!;
      const throughput = q.inputTokens + q.cacheReadTokens + q.cacheCreationTokens;
      const hitPct = throughput > 0 ? Math.round((q.cacheReadTokens / throughput) * 100) : 0;
      const hitBar = hitPct >= 80 ? '🟩' : hitPct >= 40 ? '🟨' : '🟥';
      const ctxK = q.numTurns > 0 ? Math.round(throughput / q.numTurns / 1000) : Math.round(throughput / 1000);
      historyLines.push(`\`#${i + 1}\` ${hitBar} **${hitPct}%** hit · ctx ≈${ctxK}K · ${q.numTurns}t · out ${(q.outputTokens / 1000).toFixed(1)}K · $${q.totalCostUsd.toFixed(3)}`);
    }
    const EMBED_DESC_LIMIT = 4000;
    let currentChunk: string[] = [];
    let currentLen = 0;
    let chunkIndex = 0;
    for (const line of historyLines) {
      if (currentLen + line.length + 1 > EMBED_DESC_LIMIT && currentChunk.length > 0) {
        embeds.push(new EmbedBuilder().setTitle(chunkIndex === 0 ? `📜 查詢歷史（${chronological.length} 筆）` : '📜 查詢歷史（續）').setDescription(currentChunk.join('\n')).setColor(0x2B2D31));
        currentChunk = []; currentLen = 0; chunkIndex++;
        if (embeds.length >= 9) break;
      }
      currentChunk.push(line); currentLen += line.length + 1;
    }
    if (currentChunk.length > 0) {
      embeds.push(new EmbedBuilder().setTitle(chunkIndex === 0 ? `📜 查詢歷史（${chronological.length} 筆）` : '📜 查詢歷史（續）').setDescription(currentChunk.join('\n')).setColor(0x2B2D31));
    }
  }
  await interaction.reply({ embeds, ephemeral: true });
}
