/**
 * CostReportService — Daily cost report Embed to #cost-report channel.
 *
 * Generates a per-agent cost breakdown with progress bars.
 * Intended to be triggered by a cron schedule (daily at 23:55).
 */

import { EmbedBuilder } from 'discord.js';
import type { DiscordAdapter } from '../adapters/DiscordAdapter.js';
import type { IQueryMetricsRepository } from '../persistence/types.js';
import type { AgentLoader } from '../core/AgentLoader.js';
import type { BudgetService } from './BudgetService.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'CostReportService' });

export interface CostReportServiceOptions {
  adapter: DiscordAdapter;
  channelId: string;
  agentLoader: AgentLoader;
  queryMetricsRepository: IQueryMetricsRepository;
  budgetService?: BudgetService;
}

export class CostReportService {
  private readonly adapter: DiscordAdapter;
  private readonly channelId: string;
  private readonly agentLoader: AgentLoader;
  private readonly queryMetrics: IQueryMetricsRepository;
  private readonly budgetService: BudgetService | undefined;

  constructor(options: CostReportServiceOptions) {
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

    // Build table
    const header = `Agent        Today      Month      Budget`;
    const sep = '─'.repeat(45);
    const lines: string[] = [header, sep];

    let totalToday = 0;
    let totalMonth = 0;
    let anyOverBudget = false;

    for (const agentId of this.agentLoader.list()) {
      const agent = this.agentLoader.get(agentId);
      if (agent === undefined) continue;
      const name = (agent.config.name || agentId).slice(0, 12);

      const todayCost = todayMap.get(agentId)?.totalCostUsd ?? 0;
      const monthCost = monthMap.get(agentId)?.totalCostUsd ?? 0;
      totalToday += todayCost;
      totalMonth += monthCost;

      // Budget bar
      const budgetStatus = this.budgetService?.checkBudget(agentId);
      let bar = '';
      if (budgetStatus !== null && budgetStatus !== undefined && budgetStatus.monthlyLimitCents > 0) {
        const limitUsd = budgetStatus.monthlyLimitCents / 100;
        const pct = Math.min(Math.round((monthCost / limitUsd) * 100), 100);
        const filled = Math.round(pct / 10);
        bar = '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${pct}%`;
        if (budgetStatus.exceeded) anyOverBudget = true;
      }

      lines.push(
        `${name.padEnd(12)} $${todayCost.toFixed(2).padStart(7)} $${monthCost.toFixed(2).padStart(7)}  ${bar}`
      );
    }

    lines.push(sep);
    lines.push(`${'合計'.padEnd(12)} $${totalToday.toFixed(2).padStart(7)} $${totalMonth.toFixed(2).padStart(7)}`);

    // Status line
    const statusLine = anyOverBudget
      ? '🔴 有 Agent 超預算！'
      : '🟢 All agents within budget';

    const embed = new EmbedBuilder()
      .setTitle(`💰 Daily Cost Report — ${dateStr}`)
      .setDescription(`\`\`\`\n${lines.join('\n')}\n\`\`\`\n\n${statusLine}`)
      .setColor(anyOverBudget ? 0xFF0000 : 0x00FF00)
      .setTimestamp()
      .setFooter({ text: 'ClaudeCab Cost Tracking' });

    const result = await this.adapter.sendEmbed(this.channelId, [embed]);
    if (result.success) {
      log.info({ date: dateStr, messageId: result.messageId }, 'Daily cost report sent');
    } else {
      log.error({ error: result.error }, 'Failed to send daily cost report');
    }
  }
}
