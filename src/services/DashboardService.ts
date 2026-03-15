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
   * Build dashboard as a single well-designed Embed.
   */
  private buildEmbeds(): EmbedBuilder[] {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

    const embed = new EmbedBuilder()
      .setAuthor({ name: 'ClaudeCab HQ' })
      .setTitle('戰情室')
      .setColor(0x5865F2)
      .setTimestamp()
      .setFooter({ text: `每 ${Math.round(this.updateIntervalMs / 60000)} 分鐘自動更新 · ${timeStr}` });

    // ── Agent 狀態 ──
    const agentLines = this.buildAgentStatusLines();
    embed.addFields({
      name: '──── 🤖 團隊狀態 ────',
      value: agentLines || '尚無 Agent',
    });

    // ── 成本 ──
    const costBlock = this.buildCostBlock(now);
    if (costBlock !== null) {
      embed.addFields({ name: '\u200b', value: '\u200b' }); // spacer
      embed.addFields({
        name: '──── 💰 成本 ────',
        value: costBlock.text,
      });

      // Color based on spending
      if (costBlock.totalMonthUsd > 50) {
        embed.setColor(0xED4245); // red
      } else if (costBlock.totalMonthUsd > 20) {
        embed.setColor(0xFEE75C); // yellow
      }
    }

    // ── 任務 ──
    if (this.taskRepo !== undefined) {
      const taskBlock = this.buildTaskBlock();
      embed.addFields({ name: '\u200b', value: '\u200b' }); // spacer
      embed.addFields(
        { name: '📋 待辦', value: `**${taskBlock.backlog}**`, inline: true },
        { name: '🔄 進行中', value: `**${taskBlock.inProgress}**`, inline: true },
        { name: '✅ 完成', value: `**${taskBlock.done}**`, inline: true },
      );
    }

    return [embed];
  }

  private buildAgentStatusLines(): string {
    const agents = this.agentLoader.list();
    const lines: string[] = [];

    for (const agentId of agents) {
      const agent = this.agentLoader.get(agentId);
      if (agent === undefined) continue;

      const isPaused = this.budgetService?.isAgentPaused(agentId) ?? false;
      const name = agent.config.name || agentId;
      const emoji = agent.config.display?.avatar ?? '🤖';

      let statusIcon: string;
      let statusText: string;
      if (isPaused) {
        statusIcon = '⏸️';
        statusText = '預算暫停';
      } else {
        statusIcon = '🟢';
        statusText = '待命';
      }

      lines.push(`${emoji} **${name}** ${statusIcon} ${statusText}`);
    }

    return lines.join('\n');
  }

  private buildCostBlock(now: Date): { text: string; totalMonthUsd: number } | null {
    if (this.queryMetrics === undefined) return null;

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const todayStats = this.queryMetrics.getAllAgentStatsSince(todayStart);
    const monthStats = this.queryMetrics.getAllAgentStatsSince(monthStart);

    const todayMap = new Map(todayStats.map(s => [s.agentId, s]));
    const monthMap = new Map(monthStats.map(s => [s.agentId, s]));

    let totalTodayUsd = 0;
    let totalMonthUsd = 0;
    const rows: string[] = [];

    for (const agentId of this.agentLoader.list()) {
      const agent = this.agentLoader.get(agentId);
      if (agent === undefined) continue;

      const todayCost = todayMap.get(agentId)?.totalCostUsd ?? 0;
      const monthCost = monthMap.get(agentId)?.totalCostUsd ?? 0;
      if (todayCost === 0 && monthCost === 0) continue; // skip agents with no cost

      totalTodayUsd += todayCost;
      totalMonthUsd += monthCost;

      const name = (agent.config.name || agentId).slice(0, 8);
      const todayQueries = todayMap.get(agentId)?.totalQueries ?? 0;

      // Budget bar
      const budgetStatus = this.budgetService?.checkBudget(agentId);
      let bar = '';
      if (budgetStatus !== null && budgetStatus !== undefined && budgetStatus.monthlyLimitCents > 0) {
        const limitUsd = budgetStatus.monthlyLimitCents / 100;
        const pct = Math.min(Math.round((monthCost / limitUsd) * 100), 100);
        const filled = Math.round(pct / 10);
        const barChar = pct >= 80 ? '🟥' : pct >= 50 ? '🟨' : '🟩';
        bar = ` ${barChar.repeat(filled)}${'⬜'.repeat(10 - filled)} ${pct}%`;
      }

      rows.push(`**${name}**　$${todayCost.toFixed(2)} 今日（${todayQueries}次）· $${monthCost.toFixed(2)} 月${bar}`);
    }

    if (rows.length === 0) {
      return { text: '本月尚無花費紀錄', totalMonthUsd: 0 };
    }

    rows.push('');
    rows.push(`**合計**　$${totalTodayUsd.toFixed(2)} 今日 · $${totalMonthUsd.toFixed(2)} 月`);

    return { text: rows.join('\n'), totalMonthUsd };
  }

  private buildTaskBlock(): { backlog: number; inProgress: number; done: number } {
    const summary = this.taskRepo!.getSummary();
    return {
      backlog: summary.backlog,
      inProgress: summary.in_progress + summary.in_review,
      done: summary.done,
    };
  }
}
