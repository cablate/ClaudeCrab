import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { log, formatQueryMetricAnomaly, requireOperator, type SlashCommandDependencies, type QueryMetricRow } from './_shared.js';

export async function handleCache(
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
    const rows = deps.queryMetricsRepository.getRecentQueries(2000, 0, agentFilter);
    const recent = rows.filter(r => new Date(r.createdAt).getTime() >= cutoffMs);
    if (recent.length === 0) {
      await interaction.reply({ content: `過去 ${days} 天沒有 query 紀錄`, ephemeral: true });
      return;
    }
    const byDay = new Map<string, { count: number; read: number; create: number; input: number; output: number; cost: number }>();
    for (const r of recent) {
      const d = new Date(r.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const cur = byDay.get(key) ?? { count: 0, read: 0, create: 0, input: 0, output: 0, cost: 0 };
      cur.count++; cur.read += r.cacheReadTokens ?? 0; cur.create += r.cacheCreationTokens ?? 0;
      cur.input += r.inputTokens ?? 0; cur.output += r.outputTokens ?? 0; cur.cost += r.totalCostUsd ?? 0;
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
        '', ...lines,
        ...(anomalyLines.length > 0 ? ['', '**Recent anomalies**', ...anomalyLines] : []),
      ].join('\n').slice(0, 4000))
      .setColor(overallEff >= 80 ? 0x2ECC71 : overallEff >= 50 ? 0xFFA500 : 0xED4245);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === 'flush') {
    if (!(await requireOperator(interaction, deps))) return;
    if (deps.sdkSessionManager === undefined) {
      await interaction.reply({ content: '❌ SDKSessionManager 不可用', ephemeral: true });
      return;
    }
    const sidInput = interaction.options.getString('session', true);
    const cacheStats = deps.sdkSessionManager.getCacheStats();
    const matched = deps.sdkSessionManager.findSessionKeyByPrefix(sidInput);
    if (matched === undefined) {
      await interaction.reply({ content: `❌ 找不到符合 \`${sidInput}\` 的 session（共 ${cacheStats.active_sessions} 個活 session）`, ephemeral: true });
      return;
    }
    deps.sdkSessionManager.destroySession(matched);
    log.warn({ sessionId: matched, by: interaction.user.id }, 'Discord /cache flush — V2 session destroyed by admin');
    await interaction.reply({ content: `✅ Session \`${matched}\` 已銷毀。下次訊息會自動建新 session。`, ephemeral: true });
    return;
  }
  await interaction.reply({ content: `未知子指令：${sub}`, ephemeral: true });
}
