/**
 * DiscordActivityReporter — Discord-specific implementation of ActivityNotifier.
 *
 * Sends operational events as Discord Embeds to #system-log and #alerts channels.
 * Used by ActivityEventService via the ActivityNotifier interface.
 */

import { EmbedBuilder } from 'discord.js';
import type { DiscordAdapter } from '../../DiscordAdapter.js';
import { EVENT_EMOJI, type ActivityNotifier } from '../../../services/ActivityEventService.js';
import type { OperationalEvent } from '../../../types/activity.js';
import type { UsageAnomalyMetrics, UsageAnomalyModelMetrics, MainSubagentSplit } from '../../../core/UsageAnomalyDiagnostics.js';
import type { TurnMetrics } from '../../../core/CacheAnomalyAnalyzer.js';

export interface DiscordActivityReporterOptions {
  /** Discord adapter (main bot) for sending events */
  discordAdapter: DiscordAdapter;
  /** #system-log channel ID */
  systemLogChannelId?: string;
  /** #alerts channel ID */
  alertsChannelId?: string;
}

export class DiscordActivityReporter implements ActivityNotifier {
  private readonly adapter: DiscordAdapter;
  private readonly systemLogChannelId: string | undefined;
  private readonly alertsChannelId: string | undefined;

  constructor(options: DiscordActivityReporterOptions) {
    this.adapter = options.discordAdapter;
    this.systemLogChannelId = options.systemLogChannelId;
    this.alertsChannelId = options.alertsChannelId;
  }

  /**
   * Send a batch of log lines to #system-log channel.
   */
  async sendSystemLog(text: string): Promise<void> {
    if (this.systemLogChannelId === undefined) return;
    await this.adapter.sendToChannel(this.systemLogChannelId, text);
  }

  /**
   * Send an alert embed to #alerts channel.
   */
  async sendAlert(event: OperationalEvent, formattedMessage: string): Promise<void> {
    if (this.alertsChannelId === undefined) return;

    const embed = event.type === 'session.cache_bust' && event.metadata !== undefined
      ? buildCacheBustEmbed(event, formattedMessage)
      : buildGenericAlertEmbed(event, formattedMessage);

    await this.adapter.sendEmbed(this.alertsChannelId, [embed]);
  }
}

// ─── Generic Alert Embed (all other event types) ────────────────────────────

function buildGenericAlertEmbed(event: OperationalEvent, formattedMessage: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${EVENT_EMOJI[event.type] ?? '⚠️'} ${event.type}`)
    .setColor(
      event.type === 'budget.exceeded' ||
      event.type === 'error.occurred'
        ? 0xFF0000
        : 0xFFA500
    )
    .addFields(
      { name: 'Agent', value: event.agentId, inline: true },
      { name: 'Message', value: event.message.slice(0, 1024) },
    )
    .setTimestamp();

  if (event.details !== undefined) {
    embed.addFields({ name: 'Details', value: event.details.slice(0, 1024) });
  }

  if (event.links !== undefined && event.links.length > 0) {
    embed.addFields({
      name: 'Links',
      value: event.links.map((link) => `[${link.label}](${link.url})`).join('\n').slice(0, 1024),
    });
  }

  if (formattedMessage) {
    embed.setDescription(`${formattedMessage} 需要你關注\n\n${embed.data.description ?? ''}`);
  }

  return embed;
}

// ─── Cache Bust Alert Embed (structured) ────────────────────────────────────

interface CacheBustMeta {
  sessionId?: string;
  sdkSessionId?: string;
  queryMetricId?: number;
  chatId?: string;
  userId?: string;
  jsonlPath?: string;
  discordUrl?: string;
  sourceMessageUrl?: string;
  hasResume?: boolean;
  sessionMessageCount?: number;
  severity?: string;
  likelyCause?: string;
  findings?: string[];
  metrics?: UsageAnomalyMetrics;
  modelBreakdown?: UsageAnomalyModelMetrics[];
  split?: MainSubagentSplit | null;
  jsonlFinding?: TurnMetrics | null;
}

function buildCacheBustEmbed(event: OperationalEvent, formattedMessage: string): EmbedBuilder {
  const m = (event.metadata ?? {}) as CacheBustMeta;
  const metrics = m.metrics;
  const split = m.split;
  const jsonlFinding = m.jsonlFinding;

  const embed = new EmbedBuilder()
    .setTitle(`${EVENT_EMOJI['session.cache_bust']} Cache Anomaly — ${event.agentId}`)
    .setColor(metrics && metrics.cacheHitPct < 50 ? 0xFF0000 : 0xFFA500)
    .setTimestamp();

  if (formattedMessage) {
    embed.setDescription(formattedMessage);
  }

  // ── Main Session Cache ──
  if (split !== null && split !== undefined) {
    const main = split.main;
    embed.addFields({
      name: '📊 Main Session',
      value: [
        `hit **${main.cacheHitPct}%** ${progressBar(main.cacheHitPct)}`,
        `write \`${fmtTk(main.cacheCreationTokens)}\` · read \`${fmtTk(main.cacheReadTokens)}\` · fresh \`${fmtTk(main.freshInputTokens)}\``,
        split.mainModel ? `model: \`${split.mainModel}\`` : undefined,
      ].filter(Boolean).join('\n'),
      inline: true,
    });

    if (split.subagent.cacheCreationTokens > 0 || split.subagent.cacheReadTokens > 0) {
      const subModels = (m.modelBreakdown ?? [])
        .filter((mb) => mb.model !== split.mainModel && mb.cacheCreationTokens > 0);
      const subLines = [
        `write \`${fmtTk(split.subagent.cacheCreationTokens)}\` · read \`${fmtTk(split.subagent.cacheReadTokens)}\``,
        ...subModels.map((mb) => {
          const web = mb.webSearchRequests > 0 ? ` · ${mb.webSearchRequests} web search` : '';
          return `\`${mb.model}\`: w \`${fmtTk(mb.cacheCreationTokens)}\`${web}`;
        }),
      ];
      embed.addFields({
        name: '🤖 Subagent',
        value: subLines.join('\n').slice(0, 1024),
        inline: true,
      });
    }
  } else if (metrics) {
    embed.addFields({
      name: '📊 Cache',
      value: [
        `hit **${metrics.cacheHitPct}%** ${progressBar(metrics.cacheHitPct)}`,
        `write \`${fmtTk(metrics.cacheCreationTokens)}\` · read \`${fmtTk(metrics.cacheReadTokens)}\` · fresh \`${fmtTk(metrics.freshInputTokens)}\``,
      ].join('\n'),
      inline: true,
    });
  }

  // ── JSONL Cause ──
  if (jsonlFinding) {
    embed.addFields({
      name: '🔍 JSONL Cause',
      value: [
        `\`${jsonlFinding.cause}\``,
        jsonlFinding.causeDetail ? `detail: ${jsonlFinding.causeDetail.slice(0, 100)}` : undefined,
        jsonlFinding.causeLine ? `at: L${jsonlFinding.causeLine}` : undefined,
      ].filter(Boolean).join('\n'),
      inline: true,
    });
  }

  // ── Likely Cause (model-level inference) ──
  if (m.likelyCause) {
    embed.addFields({
      name: '💡 Likely Cause',
      value: m.likelyCause.slice(0, 1024),
    });
  }

  // ── Query Info ──
  const queryLines = [
    metrics ? `turns: ${metrics.numTurns} · cost: $${metrics.costUsd.toFixed(4)}` : undefined,
    m.queryMetricId !== undefined ? `metric: #${m.queryMetricId}` : undefined,
    m.sessionMessageCount !== undefined ? `session messages: ${m.sessionMessageCount}` : undefined,
    m.hasResume === true ? `resumed: yes` : undefined,
    m.findings && m.findings.length > 0 ? `findings: ${m.findings.join(', ')}` : undefined,
  ].filter(Boolean);
  if (queryLines.length > 0) {
    embed.addFields({ name: '📋 Query', value: queryLines.join('\n'), inline: true });
  }

  // ── Debug IDs ──
  const debugLines = [
    m.sessionId ? `session: \`${m.sessionId}\`` : undefined,
    m.sdkSessionId ? `sdkSession: \`${m.sdkSessionId}\`` : undefined,
    m.jsonlPath ? `jsonl: \`${m.jsonlPath}\`` : undefined,
  ].filter(Boolean);
  if (debugLines.length > 0) {
    embed.addFields({ name: '🔧 Debug', value: debugLines.join('\n').slice(0, 1024) });
  }

  // ── Links ──
  const linkParts: string[] = [];
  if (m.discordUrl) linkParts.push(`[Thread](${m.discordUrl})`);
  if (m.sourceMessageUrl && m.sourceMessageUrl !== m.discordUrl) linkParts.push(`[Source](${m.sourceMessageUrl})`);
  if (event.links && event.links.length > 0) {
    for (const link of event.links) {
      if (link.url !== m.discordUrl && link.url !== m.sourceMessageUrl) {
        linkParts.push(`[${link.label}](${link.url})`);
      }
    }
  }
  if (linkParts.length > 0) {
    embed.addFields({ name: '🔗 Links', value: linkParts.join(' · '), inline: true });
  }

  return embed;
}

function fmtTk(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function progressBar(pct: number, width = 10): string {
  const filled = Math.round(Math.min(100, Math.max(0, pct)) / (100 / width));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
