/**
 * Daily Discord cost report.
 *
 * This is Discord-specific ops reporting, not part of the chat runtime path.
 */

import { EmbedBuilder } from 'discord.js';
import type { DiscordAdapter } from '../../DiscordAdapter.js';
import type { IQueryMetricsRepository } from '../../../persistence/types.js';
import type { AgentLoader } from '../../../core/orchestrator/AgentLoader.js';
import { calculatePingROI } from '../../../services/KeepaliveROIService.js';
import { logger } from '../../../utils/logger.js';
import { EventType } from '../../../utils/events.js';

const log = logger.child({ module: 'DiscordCostReport' });

export interface DiscordCostReportOptions {
  adapter: DiscordAdapter;
  channelId: string;
  agentLoader: AgentLoader;
  queryMetricsRepository: IQueryMetricsRepository;
}

export class DiscordCostReport {
  private readonly adapter: DiscordAdapter;
  private readonly channelId: string;
  private readonly agentLoader: AgentLoader;
  private readonly queryMetrics: IQueryMetricsRepository;

  constructor(options: DiscordCostReportOptions) {
    this.adapter = options.adapter;
    this.channelId = options.channelId;
    this.agentLoader = options.agentLoader;
    this.queryMetrics = options.queryMetricsRepository;
  }

  async sendDailyReport(): Promise<void> {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    log.info({ event_type: EventType.ADAPTER_DISCORD_COST_REPORT, date: dateStr }, 'Generating daily cost report');

    const todayStats = this.queryMetrics.getAllAgentStatsSince(todayStart);
    const monthStats = this.queryMetrics.getAllAgentStatsSince(monthStart);
    const todayMap = new Map(todayStats.map((stat) => [stat.agentId, stat]));
    const monthMap = new Map(monthStats.map((stat) => [stat.agentId, stat]));

    let totalToday = 0;
    let totalMonth = 0;
    const agentRows: string[] = [];

    for (const agentId of this.agentLoader.list()) {
      const agent = this.agentLoader.get(agentId);
      if (agent === undefined) continue;

      const name = agent.config.name || agentId;
      const emoji = agent.config.display?.avatar ?? '\u{1F916}';
      const todayCost = todayMap.get(agentId)?.totalCostUsd ?? 0;
      const monthCost = monthMap.get(agentId)?.totalCostUsd ?? 0;
      const todayQueries = todayMap.get(agentId)?.totalQueries ?? 0;
      totalToday += todayCost;
      totalMonth += monthCost;

      agentRows.push(
        `${emoji} **${name}**\n` +
        `Today $${todayCost.toFixed(2)} (${todayQueries} queries) | Month $${monthCost.toFixed(2)}`
      );
    }

    const embed = new EmbedBuilder()
      .setAuthor({ name: 'ClaudeCrab Cost Tracking' })
      .setTitle(`Daily Cost Report - ${dateStr}`)
      .setColor(0x57F287)
      .setTimestamp();

    embed.setDescription(agentRows.length > 0 ? agentRows.join('\n\n') : 'No spend recorded today');
    embed.addFields({ name: '\u200b', value: '\u200b' });
    embed.addFields(
      { name: 'Today Total', value: `**$${totalToday.toFixed(2)}**`, inline: true },
      { name: 'Month Total', value: `**$${totalMonth.toFixed(2)}**`, inline: true },
    );

    try {
      const keepaliveStats = this.queryMetrics.getKeepaliveStats();
      if (keepaliveStats.totalPings > 0) {
        const roiResult = calculatePingROI(
          {
            inputTokens: keepaliveStats.totalInputTokens,
            outputTokens: 0,
            cacheReadTokens: keepaliveStats.totalCacheReadTokens,
            cacheCreationTokens: keepaliveStats.totalCacheCreationTokens,
            totalCostUsd: keepaliveStats.totalCostUsd,
          },
          'claude-sonnet-4'
        );

        const roiDisplay = roiResult.roiRatio !== null
          ? `${(roiResult.roiRatio * 100).toFixed(0)}%`
          : 'N/A';

        embed.addFields({ name: '\u200b', value: '\u200b' });
        embed.addFields({
          name: 'Keepalive ROI',
          value: [
            `Pings: **${keepaliveStats.totalPings}**`,
            `Cost: **$${keepaliveStats.totalCostUsd.toFixed(4)}**`,
            `Savings: **$${roiResult.savings.toFixed(4)}**`,
            `ROI: **${roiDisplay}**`,
          ].join(' | '),
        });
      }
    } catch (roiErr) {
      log.debug({ err: roiErr }, 'Keepalive ROI query failed, omitting section');
    }

    const result = await this.adapter.sendEmbed(this.channelId, [embed]);
    if (result.success) {
      log.info({ event_type: EventType.ADAPTER_DISCORD_COST_REPORT_SENT, date: dateStr, messageId: result.messageId }, 'Daily cost report sent');
    } else {
      log.error({ event_type: EventType.ADAPTER_DISCORD_COST_REPORT_ERROR, error: result.error }, 'Failed to send daily cost report');
    }
  }
}
