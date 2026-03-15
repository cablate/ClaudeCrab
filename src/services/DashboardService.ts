/**
 * DashboardService — Discord Embed-based dashboard for ClaudeCab HQ.
 *
 * Maintains a single pinned Embed message in #dashboard channel.
 * Updates via message.edit() (not send) to avoid spamming.
 * Shows: Agent status, cost summary, task counts, recent activity.
 */

import { EmbedBuilder } from 'discord.js';
import type { DiscordAdapter } from '../adapters/DiscordAdapter.js';
import type { IQueryMetricsRepository } from '../persistence/types.js';
import type { TaskRecordRepository } from '../persistence/TaskRecordRepository.js';
import type { ExecutionRecordRepository } from '../persistence/ExecutionRecordRepository.js';
import type { AgentLoader } from '../core/AgentLoader.js';
import type { BudgetService } from './BudgetService.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'DashboardService' });

export interface DashboardServiceOptions {
  /** The Discord adapter (main bot) used to send/edit embeds */
  adapter: DiscordAdapter;
  /** Dashboard channel ID */
  channelId: string;
  /** Agent loader for listing agents */
  agentLoader: AgentLoader;
  /** Query metrics for cost data */
  queryMetricsRepository?: IQueryMetricsRepository;
  /** Task records for task summary */
  taskRecordRepository?: TaskRecordRepository;
  /** Execution records for recent activity */
  executionRecordRepository?: ExecutionRecordRepository;
  /** Budget service for budget status */
  budgetService?: BudgetService;
  /** Update interval in minutes (default 15) */
  updateIntervalMinutes?: number;
}

export class DashboardService {
  private readonly adapter: DiscordAdapter;
  private readonly channelId: string;
  private readonly agentLoader: AgentLoader;
  private readonly queryMetrics: IQueryMetricsRepository | undefined;
  private readonly taskRepo: TaskRecordRepository | undefined;
  private readonly execRepo: ExecutionRecordRepository | undefined;
  private readonly budgetService: BudgetService | undefined;
  private readonly updateIntervalMs: number;

  private dashboardMessageId: string | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: DashboardServiceOptions) {
    this.adapter = options.adapter;
    this.channelId = options.channelId;
    this.agentLoader = options.agentLoader;
    this.queryMetrics = options.queryMetricsRepository;
    this.taskRepo = options.taskRecordRepository;
    this.execRepo = options.executionRecordRepository;
    this.budgetService = options.budgetService;
    this.updateIntervalMs = (options.updateIntervalMinutes ?? 15) * 60 * 1000;
  }

  /**
   * Initialize: send first dashboard embed and start periodic updates.
   */
  async start(): Promise<void> {
    log.info({ channelId: this.channelId }, 'Starting DashboardService');

    await this.update();

    this.updateTimer = setInterval(() => {
      void this.update().catch((err) => {
        log.error({ err }, 'Dashboard update failed');
      });
    }, this.updateIntervalMs);
    this.updateTimer.unref();

    log.info(
      { intervalMs: this.updateIntervalMs },
      'Dashboard periodic update started'
    );
  }

  /**
   * Stop periodic updates.
   */
  stop(): void {
    if (this.updateTimer !== null) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * Build and send/edit the dashboard embed.
   */
  async update(): Promise<void> {
    const embeds = this.buildEmbeds();

    if (this.dashboardMessageId !== null) {
      // Edit existing message
      const result = await this.adapter.editEmbed(
        this.channelId,
        this.dashboardMessageId,
        embeds
      );
      if (!result.success) {
        // Message may have been deleted — send new one
        log.warn('Dashboard message edit failed, sending new one');
        this.dashboardMessageId = null;
        await this.sendNew(embeds);
      }
    } else {
      await this.sendNew(embeds);
    }
  }

  private async sendNew(embeds: EmbedBuilder[]): Promise<void> {
    const result = await this.adapter.sendEmbed(this.channelId, embeds);
    if (result.success && result.messageId !== undefined) {
      this.dashboardMessageId = result.messageId;
      log.info({ messageId: this.dashboardMessageId }, 'Dashboard message created');
    }
  }

  /**
   * Build all dashboard embeds.
   */
  private buildEmbeds(): EmbedBuilder[] {
    const embeds: EmbedBuilder[] = [];

    // Embed 1: Agent Status
    embeds.push(this.buildAgentStatusEmbed());

    // Embed 2: Cost Summary
    embeds.push(this.buildCostEmbed());

    // Embed 3: Task Summary (if task repo available)
    if (this.taskRepo !== undefined) {
      embeds.push(this.buildTaskEmbed());
    }

    return embeds;
  }

  private buildAgentStatusEmbed(): EmbedBuilder {
    const agents = this.agentLoader.list();
    const lines: string[] = [];

    for (const agentId of agents) {
      const agent = this.agentLoader.get(agentId);
      if (agent === undefined) continue;

      const isPaused = this.budgetService?.isAgentPaused(agentId) ?? false;
      const status = isPaused ? '⏸ paused' : '🟢 idle';
      const name = agent.config.name || agentId;
      lines.push(`\`${name.padEnd(14)}\` ${status}`);
    }

    return new EmbedBuilder()
      .setTitle('🏢 ClaudeCab HQ — 戰情室')
      .addFields({
        name: '🤖 Agent 狀態',
        value: lines.length > 0 ? lines.join('\n') : '（無 Agent）',
      })
      .setColor(0x5865F2)
      .setTimestamp()
      .setFooter({ text: `每 ${Math.round(this.updateIntervalMs / 60000)} 分鐘更新` });
  }

  private buildCostEmbed(): EmbedBuilder {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const embed = new EmbedBuilder()
      .setTitle('💰 Cost Summary')
      .setColor(0x00FF00)
      .setTimestamp();

    if (this.queryMetrics === undefined) {
      embed.setDescription('（成本追蹤未啟用）');
      return embed;
    }

    // Per-agent cost
    const todayStats = this.queryMetrics.getAllAgentStatsSince(todayStart);
    const monthStats = this.queryMetrics.getAllAgentStatsSince(monthStart);

    const monthMap = new Map(monthStats.map(s => [s.agentId, s]));
    const todayMap = new Map(todayStats.map(s => [s.agentId, s]));

    let totalTodayUsd = 0;
    let totalMonthUsd = 0;
    const lines: string[] = [];

    for (const agentId of this.agentLoader.list()) {
      const agent = this.agentLoader.get(agentId);
      if (agent === undefined) continue;
      const name = (agent.config.name || agentId).slice(0, 10);

      const todayCost = todayMap.get(agentId)?.totalCostUsd ?? 0;
      const monthCost = monthMap.get(agentId)?.totalCostUsd ?? 0;
      totalTodayUsd += todayCost;
      totalMonthUsd += monthCost;

      const budgetStatus = this.budgetService?.checkBudget(agentId);
      const monthLimitUsd = budgetStatus !== null && budgetStatus !== undefined && budgetStatus.monthlyLimitCents > 0
        ? budgetStatus.monthlyLimitCents / 100
        : 0;

      let bar = '';
      if (monthLimitUsd > 0) {
        const pct = Math.min(Math.round((monthCost / monthLimitUsd) * 100), 100);
        const filled = Math.round(pct / 10);
        bar = '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${pct}%`;
      }

      const todayStr = `$${todayCost.toFixed(2)}`;
      const monthStr = `$${monthCost.toFixed(2)}`;
      lines.push(`\`${name.padEnd(10)}\` today ${todayStr} | month ${monthStr} ${bar}`);
    }

    lines.push('─'.repeat(40));
    lines.push(`\`${'合計'.padEnd(10)}\` today $${totalTodayUsd.toFixed(2)} | month $${totalMonthUsd.toFixed(2)}`);

    embed.setDescription(lines.join('\n'));

    if (totalMonthUsd > 50) {
      embed.setColor(0xFF0000); // Red if high
    } else if (totalMonthUsd > 20) {
      embed.setColor(0xFFA500); // Orange
    }

    return embed;
  }

  private buildTaskEmbed(): EmbedBuilder {
    const summary = this.taskRepo!.getSummary();
    const totalActive = summary.backlog + summary.in_progress + summary.in_review;
    const totalDone = summary.done;

    return new EmbedBuilder()
      .setTitle('📋 Tasks')
      .addFields(
        { name: 'Backlog', value: `${summary.backlog}`, inline: true },
        { name: 'In Progress', value: `${summary.in_progress}`, inline: true },
        { name: 'In Review', value: `${summary.in_review}`, inline: true },
        { name: 'Done', value: `${totalDone}`, inline: true },
        { name: 'Active Total', value: `${totalActive}`, inline: true },
      )
      .setColor(0x2B2D31);
  }
}
