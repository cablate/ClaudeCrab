/**
 * Daily Discord report for JSONL cache anomalies.
 *
 * This is an ops-only report. The chat runtime does not call this path.
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

    const totalAnomalies = results.reduce((sum, result) => sum + result.anomalies.length, 0);
    const worstResult = results[0];
    if (worstResult === undefined) return;

    const worstTurn = worstResult.worstTurn;
    const embed = new EmbedBuilder()
      .setAuthor({ name: 'ClaudeCrab Cache Monitor' })
      .setTitle(`Cache Anomaly Report - ${today}`)
      .setColor(totalAnomalies >= 10 ? 0xED4245 : totalAnomalies >= 3 ? 0xFEE75C : 0x57F287)
      .setTimestamp();

    embed.setDescription(results.slice(0, 8).map(formatSessionSummary).join('\n'));
    embed.addFields(
      { name: 'Sessions', value: `${results.length}`, inline: true },
      { name: 'Anomalies', value: `${totalAnomalies}`, inline: true },
      { name: 'Worst Create', value: worstTurn ? fmtTokens(worstTurn.cacheCreation) : 'N/A', inline: true },
    );

    const causeText = countCauses(results)
      .slice(0, 6)
      .map(([cause, count]) => `${causeLabel(cause)}: ${count}`)
      .join('\n');
    if (causeText.length > 0) {
      embed.addFields({ name: 'Cause Distribution', value: causeText });
    }

    if (worstTurn !== null) {
      const sessionId = extractSessionId(worstResult.file);
      const time = worstTurn.timestamp ? new Date(worstTurn.timestamp).toTimeString().slice(0, 8) : '?';
      embed.addFields({
        name: 'Worst Turn Detail',
        value: [
          `Session: \`${sessionId}\``,
          `Line: L${worstTurn.line} @ ${time}`,
          `input=${fmtTokens(worstTurn.inputTokens)} read=${fmtTokens(worstTurn.cacheRead)} create=${fmtTokens(worstTurn.cacheCreation)} out=${fmtTokens(worstTurn.outputTokens)}`,
          `Cause: ${causeLabel(worstTurn.cause)}${worstTurn.causeDetail ? ` - ${worstTurn.causeDetail.slice(0, 80)}` : ''}`,
        ].join('\n'),
      });
    }

    const sendResult = await this.adapter.sendEmbed(this.channelId, [embed]);
    if (sendResult.success) {
      log.info({ event_type: EventType.ADAPTER_DISCORD_CACHE_ANOMALY_REPORT_SENT, date: today, anomalies: totalAnomalies }, 'Cache anomaly report sent');
    } else {
      log.error({ event_type: EventType.ADAPTER_DISCORD_CACHE_ANOMALY_REPORT_ERROR, error: sendResult.error }, 'Failed to send cache anomaly report');
    }
  }
}

function formatSessionSummary(result: ScanResult): string {
  const sessionId = extractSessionId(result.file);
  const worst = result.worstTurn;
  return `\`${sessionId}\` ${result.anomalies.length} anomalies | worst ${fmtTokens(worst?.cacheCreation ?? 0)} | ${causeLabel(worst?.cause)}`;
}

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
  for (const result of results) {
    for (const anomaly of result.anomalies) {
      if (anomaly.cause) counts.set(anomaly.cause, (counts.get(anomaly.cause) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function causeLabel(cause: CauseLabel | null | undefined): string {
  return cause ?? 'unknown';
}
