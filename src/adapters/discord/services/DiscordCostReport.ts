/**
 * DiscordCostReport — Daily cost report Embed to #cost-report channel.
 *
 * Generates a per-agent cost breakdown with progress bars.
 * Intended to be triggered by a cron schedule (daily at 23:55).
 *
 * Moved from services/CostReportService.ts — this is 100% Discord-specific.
 */

import { EmbedBuilder } from 'discord.js';
import type { DiscordAdapter } from '../../DiscordAdapter.js';
import type { IQueryMetricsRepository } from '../../../persistence/types.js';
import type { AgentLoader } from '../../../core/AgentLoader.js';
import type { BudgetService } from '../../../services/BudgetService.js';
import { logger } from '../../../utils/logger.js';

const log = logger.child({ module: 'DiscordCostReport' });

export interface DiscordCostReportOptions {
  adapter: DiscordAdapter;
  channelId: string;
  agentLoader: AgentLoader;
  queryMetricsRepository: IQueryMetricsRepository;
  budgetService?: BudgetService;
}

export class DiscordCostReport {
  private readonly adapter: DiscordAdapter;
  private readonly channelId: string;
  private readonly agentLoader: AgentLoader;
  private readonly queryMetrics: IQueryMetricsRepository;
  private readonly budgetService: BudgetService | undefined;

  constructor(options: DiscordCostReportOptions) {
    this.adapter = options.adapter;
    this.channelId = options.channelId;
    this.agentLoader = options.agentLoader;
    this.queryMetrics = options.queryMetricsRepository;
    this.budgetService = options.budgetService;
  }

  /**
   * Generate and send the daily cost report.
   */
  async sendDailyReport(): Promise<void> {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    log.info({ date: dateStr }, 'Generating daily cost report');

    const todayStats = this.queryMetrics.getAllAgentStatsSince(todayStart);
    const monthStats = this.queryMetrics.getAllAgentStatsSince(monthStart);

    const todayMap = new Map(todayStats.map(s => [s.agentId, s]));
    const monthMap = new Map(monthStats.map(s => [s.agentId, s]));

    let totalToday = 0;
    let totalMonth = 0;
    let anyOverBudget = false;
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

      // Budget progress
      const budgetStatus = this.budgetService?.checkBudget(agentId);
      let budgetLine = '';
      if (budgetStatus !== null && budgetStatus !== undefined && budgetStatus.monthlyLimitCents > 0) {
        const limitUsd = budgetStatus.monthlyLimitCents / 100;
        const pct = Math.min(Math.round((monthCost / limitUsd) * 100), 100);
        const filled = Math.round(pct / 10);
        const ch = pct >= 80 ? '\u{1F7E5}' : pct >= 50 ? '\u{1F7E8}' : '\u{1F7E9}';
        budgetLine = `\n${ch.repeat(filled)}${'\u2B1C'.repeat(10 - filled)} ${pct}% of $${limitUsd.toFixed(0)}`;
        if (budgetStatus.exceeded) anyOverBudget = true;
      }

      agentRows.push(
        `${emoji} **${name}**\n` +
        `\u4ECA\u65E5 $${todayCost.toFixed(2)}\uFF08${todayQueries} \u6B21\uFF09\u00B7 \u6708\u7D2F\u8A08 $${monthCost.toFixed(2)}${budgetLine}`
      );
    }

    // Summary embed
    const embed = new EmbedBuilder()
      .setAuthor({ name: 'ClaudeCab Cost Tracking' })
      .setTitle(`\u6BCF\u65E5\u6210\u672C\u5831\u544A \u2014 ${dateStr}`)
      .setColor(anyOverBudget ? 0xED4245 : 0x57F287)
      .setTimestamp();

    if (agentRows.length > 0) {
      embed.setDescription(agentRows.join('\n\n'));
    } else {
      embed.setDescription('\u4ECA\u65E5\u7121\u82B1\u8CBB\u7D00\u9304');
    }

    // Total summary as fields
    embed.addFields({ name: '\u200b', value: '\u200b' }); // spacer
    embed.addFields(
      { name: '\u{1F4CA} \u4ECA\u65E5\u5408\u8A08', value: `**$${totalToday.toFixed(2)}**`, inline: true },
      { name: '\u{1F4C8} \u6708\u7D2F\u8A08', value: `**$${totalMonth.toFixed(2)}**`, inline: true },
      { name: '\u72C0\u614B', value: anyOverBudget ? '\u{1F534} \u6709 Agent \u8D85\u9810\u7B97' : '\u{1F7E2} \u5168\u90E8\u6B63\u5E38', inline: true },
    );

    const result = await this.adapter.sendEmbed(this.channelId, [embed]);
    if (result.success) {
      log.info({ date: dateStr, messageId: result.messageId }, 'Daily cost report sent');
    } else {
      log.error({ error: result.error }, 'Failed to send daily cost report');
    }
  }
}
