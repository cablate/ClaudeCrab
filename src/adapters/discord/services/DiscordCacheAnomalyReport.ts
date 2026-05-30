/**
 * DiscordCacheAnomalyReport — Daily cache anomaly report Embed.
 *
 * Scans today's JSONL files via CacheAnomalyAnalyzer and sends a summary
 * to a Discord channel. Same pattern as DiscordCostReport.
 */

import { EmbedBuilder } from 'discord.js';
import type { DiscordAdapter } from '../../DiscordAdapter.js';
import { scanRecentJsonlFiles, type ScanResult, type CauseLabel } from '../../../core/keepalive/CacheAnomalyAnalyzer.js';
import { logger } from '../../../utils/logger.js';
import { EventType } from '../../../utils/events.js';

const log = logger.child({ module: 'DiscordCacheAnomalyReport' });

export interface DiscordCacheAnomalyReportOptions {
  adapter: DiscordAdapter;
  channelId: string;
}

export class DiscordCacheAnomalyReport {
  private readonly adapter: DiscordAdapter;
  private readonly channelId: string;

  constructor(options: DiscordCacheAnomalyReportOptions) {
    this.adapter = options.adapter;
    this.channelId = options.channelId;
  }

  async sendDailyReport(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    log.info({ event_type: EventType.ADAPTER_DISCORD_CACHE_ANOMALY_REPORT, date: today }, 'Generating cache anomaly report');

    const results = scanRecentJsonlFiles({ since: today });

    if (results.length === 0) {
      log.info({ date: today }, 'No cache anomalies today, skipping report');
      return;
    }

    const totalAnomalies = results.reduce((sum, r) => sum + r.anomalies.length, 0);
    const worstResult = results[0]!;
    const worstTurn = worstResult.worstTurn;

    const embed = new EmbedBuilder()
      .setAuthor({ name: 'ClaudeCab Cache Monitor' })
      .setTitle(`Cache Anomaly Report — ${today}`)
      .setColor(totalAnomalies >= 10 ? 0xED4245 : totalAnomalies >= 3 ? 0xFEE75C : 0x57F287)
      .setTimestamp();

    // Session overview table
    const sessionLines = results.slice(0, 8).map(r => {
      const sessionId = extractSessionId(r.file);
      const worst = r.worstTurn;
      return `\`${sessionId}\` ${r.anomalies.length} anomalies · worst ${fmtTokens(worst?.cacheCreation ?? 0)} · ${worst?.cause ?? '?'}`;
    });
    embed.setDescription(sessionLines.join('\n'));

    // Summary fields
    embed.addFields(
      { name: '📊 Sessions', value: `${results.length}`, inline: true },
      { name: '⚠️ Anomalies', value: `${totalAnomalies}`, inline: true },
      { name: '💸 Worst Create', value: worstTurn ? fmtTokens(worstTurn.cacheCreation) : 'N/A', inline: true },
    );

    // Cause distribution
    const causeCounts = countCauses(results);
    if (causeCounts.length > 0) {
      const causeText = causeCounts
        .slice(0, 6)
        .map(([cause, count]) => `${causeEmoji(cause)} \`${cause}\`: ${count}`)
        .join('\n');
      embed.addFields({ name: 'Cause Distribution', value: causeText });
    }

    // Worst turn detail
    if (worstTurn) {
      const sessionId = extractSessionId(worstResult.file);
      const time = worstTurn.timestamp ? new Date(worstTurn.timestamp).toTimeString().slice(0, 8) : '?';
      embed.addFields({
        name: '🔍 Worst Turn Detail',
        value: [
          `Session: \`${sessionId}\``,
          `Line: L${worstTurn.line} @ ${time}`,
          `input=${fmtTokens(worstTurn.inputTokens)} read=${fmtTokens(worstTurn.cacheRead)} **create=${fmtTokens(worstTurn.cacheCreation)}** out=${fmtTokens(worstTurn.outputTokens)}`,
          `Cause: ${causeEmoji(worstTurn.cause)} \`${worstTurn.cause ?? 'unknown'}\`${worstTurn.causeDetail ? ` — ${worstTurn.causeDetail.slice(0, 80)}` : ''}`,
        ].join('\n'),
      });
    }

    embed.setFooter({ text: 'npm run trace:cache -- --scan-files --today' });

    const sendResult = await this.adapter.sendEmbed(this.channelId, [embed]);
    if (sendResult.success) {
      log.info({ event_type: EventType.ADAPTER_DISCORD_CACHE_ANOMALY_REPORT_SENT, date: today, anomalies: totalAnomalies }, 'Cache anomaly report sent');
    } else {
      log.error({ event_type: EventType.ADAPTER_DISCORD_CACHE_ANOMALY_REPORT_ERROR, error: sendResult.error }, 'Failed to send cache anomaly report');
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractSessionId(filePath: string): string {
  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  return basename.replace('.jsonl', '').slice(0, 8);
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function countCauses(results: ScanResult[]): [CauseLabel, number][] {
  const counts = new Map<CauseLabel, number>();
  for (const r of results) {
    for (const a of r.anomalies) {
      if (a.cause) counts.set(a.cause, (counts.get(a.cause) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function causeEmoji(cause: CauseLabel | null | undefined): string {
  switch (cause) {
    case 'stop_hook_summary': return '🔴';
    case 'hook_blocking_error': return '🔴';
    case 'todo_reminder': return '🟡';
    case 'task_reminder': return '🟡';
    case 'prefix_rebuild': return '🔵';
    case 'mcp_instructions_delta': return '🟠';
    case 'deferred_tools_delta': return '🟠';
    case 'hook_additional_context': return '🟠';
    case 'dynamic_system_reminder': return '🟠';
    case 'ttl_expiry': return '⏰';
    case 'batch_tool_results': return '📦';
    case 'near_ttl_gap': return '⏳';
    case 'unknown_prefix_rebuild': return '❓';
    default: return '⬜';
  }
}
