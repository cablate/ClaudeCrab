/**
 * DiscordDashboard — Discord Embed-based dashboard for ClaudeCab HQ.
 *
 * Maintains a single pinned Embed message in #dashboard channel.
 * Updates via message.edit() (not send) to avoid spamming.
 * Shows: Agent status, cost summary, task counts, recent activity.
 *
 * Moved from services/DashboardService.ts — this is 100% Discord-specific.
 */

import { EmbedBuilder } from 'discord.js';
import type { DiscordAdapter } from '../../DiscordAdapter.js';
import type { IQueryMetricsRepository } from '../../../persistence/types.js';
import type { RateLimitRepository } from '../../../persistence/RateLimitRepository.js';
import type { ExecutionRecordRepository } from '../../../persistence/ExecutionRecordRepository.js';
import type { AgentLoader } from '../../../core/orchestrator/AgentLoader.js';
import { logger } from '../../../utils/logger.js';
import { EventType } from '../../../utils/events.js';

const log = logger.child({ module: 'DiscordDashboard' });

export interface DiscordDashboardOptions {
  /** The Discord adapter (main bot) used to send/edit embeds */
  adapter: DiscordAdapter;
  /** Dashboard channel ID */
  channelId: string;
  /** Agent loader for listing agents */
  agentLoader: AgentLoader;
  /** Query metrics for cost data */
  queryMetricsRepository?: IQueryMetricsRepository;
  /** Rate limit repository for quota utilization */
  rateLimitRepository?: RateLimitRepository;
  /** Execution records for recent activity */
  executionRecordRepository?: ExecutionRecordRepository;
  /** Update interval in minutes (default 15) */
  updateIntervalMinutes?: number;
}

export class DiscordDashboard {
  private readonly adapter: DiscordAdapter;
  private readonly channelId: string;
  private readonly agentLoader: AgentLoader;
  private readonly queryMetrics: IQueryMetricsRepository | undefined;
  private readonly rateLimitRepo: RateLimitRepository | undefined;
  private readonly execRepo: ExecutionRecordRepository | undefined;
  private readonly updateIntervalMs: number;

  private dashboardMessageId: string | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: DiscordDashboardOptions) {
    this.adapter = options.adapter;
    this.channelId = options.channelId;
    this.agentLoader = options.agentLoader;
    this.queryMetrics = options.queryMetricsRepository;
    this.rateLimitRepo = options.rateLimitRepository;
    this.execRepo = options.executionRecordRepository;
    this.updateIntervalMs = (options.updateIntervalMinutes ?? 15) * 60 * 1000;
  }

  /**
   * Initialize: send first dashboard embed and start periodic updates.
   */
  async start(): Promise<void> {
    log.info({ event_type: EventType.ADAPTER_DISCORD_DASHBOARD_STARTED, channelId: this.channelId }, 'Starting DiscordDashboard');

    // Try to find and reuse the last dashboard embed (avoids duplicate on restart)
    try {
      const client = this.adapter.getClient();
      if (client !== null) {
        const channel = await client.channels.fetch(this.channelId);
        if (channel !== null && channel.isTextBased() && 'messages' in channel) {
          const recent = await (channel as import('discord.js').TextChannel).messages.fetch({ limit: 10 });
          const botId = client.user?.id;
          const existing = recent.find(
            (m) => m.author.id === botId && m.embeds.length > 0
          );
          if (existing !== undefined) {
            this.dashboardMessageId = existing.id;
            log.info({ event_type: EventType.ADAPTER_DISCORD_DASHBOARD_RECOVERED, messageId: existing.id }, 'Recovered existing dashboard message (will edit instead of create)');
          }
        }
      }
    } catch (err) {
      log.debug({ err }, 'Could not recover dashboard message, will create new');
    }

    await this.update();

    this.updateTimer = setInterval(() => {
      void this.update().catch((err) => {
        log.error({ event_type: EventType.ADAPTER_DISCORD_DASHBOARD_UPDATE_ERROR, err }, 'Dashboard update failed');
      });
    }, this.updateIntervalMs);
    this.updateTimer.unref();

    log.info(
      { event_type: EventType.ADAPTER_DISCORD_DASHBOARD_STARTED, intervalMs: this.updateIntervalMs },
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
        log.warn({ event_type: EventType.ADAPTER_DISCORD_DASHBOARD_EDIT_FAILED }, 'Dashboard message edit failed, sending new one');
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
      log.info({ event_type: EventType.ADAPTER_DISCORD_DASHBOARD_CREATED, messageId: this.dashboardMessageId }, 'Dashboard message created');
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
      .setTitle('\u6230\u60C5\u5BA4')
      .setColor(0x5865F2)
      .setTimestamp()
      .setFooter({ text: `\u6BCF ${Math.round(this.updateIntervalMs / 60000)} \u5206\u9418\u81EA\u52D5\u66F4\u65B0 \u00B7 ${timeStr}` });

    // ── Agent \u72C0\u614B ──
    const agentLines = this.buildAgentStatusLines();
    embed.addFields({
      name: '\u2500\u2500\u2500\u2500 \u{1F916} \u5718\u968A\u72C0\u614B \u2500\u2500\u2500\u2500',
      value: agentLines || '\u5C1A\u7121 Agent',
    });

    // ── \u6210\u672C ──
    const costBlock = this.buildCostBlock(now);
    if (costBlock !== null) {
      embed.addFields({ name: '\u200b', value: '\u200b' }); // spacer
      embed.addFields({
        name: '\u2500\u2500\u2500\u2500 \u{1F4B0} \u6210\u672C \u2500\u2500\u2500\u2500',
        value: costBlock.text,
      });

      // Color based on spending
      if (costBlock.totalMonthUsd > 50) {
        embed.setColor(0xED4245); // red
      } else if (costBlock.totalMonthUsd > 20) {
        embed.setColor(0xFEE75C); // yellow
      }
    }

    // ── \u4EFB\u52D9 ──

    // ── Rate Limit 利用率 ──
    const quotaBlock = this.buildQuotaBlock();
    if (quotaBlock !== null) {
      embed.addFields({ name: '​', value: '​' }); // spacer
      embed.addFields({
        name: '\u{1F4CA} Rate Limit 利用率',
        value: quotaBlock,
      });
    }

    return [embed];
  }

  private buildAgentStatusLines(): string {
    const agents = this.agentLoader.list();
    const lines: string[] = [];

    for (const agentId of agents) {
      const agent = this.agentLoader.get(agentId);
      if (agent === undefined) continue;

      const name = agent.config.name || agentId;
      const emoji = agent.config.display?.avatar ?? '\u{1F916}';

      lines.push(`${emoji} **${name}** \u{1F7E2} \u5F85\u547D`);
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

      rows.push(`**${name}**\u3000$${todayCost.toFixed(2)} \u4ECA\u65E5\uFF08${todayQueries}\u6B21\uFF09\u00B7 $${monthCost.toFixed(2)} \u6708`);
    }

    if (rows.length === 0) {
      return { text: '\u672C\u6708\u5C1A\u7121\u82B1\u8CBB\u7D00\u9304', totalMonthUsd: 0 };
    }

    rows.push('');
    rows.push(`**\u5408\u8A08**\u3000$${totalTodayUsd.toFixed(2)} \u4ECA\u65E5 \u00B7 $${totalMonthUsd.toFixed(2)} \u6708`);

    return { text: rows.join('\n'), totalMonthUsd };
  }

  /**
   * Build rate limit utilization string.
   * Queries the two most relevant rate limit types: five_hour and seven_day.
   * Returns null if no data or rateLimitRepository is not available.
   */
  private buildQuotaBlock(): string | null {
    // Synchronous fallback: try rate_limit_snapshots from DB
    if (this.rateLimitRepo !== undefined) {
      try {
        const fiveHour = this.rateLimitRepo.getLatest('five_hour');
        const sevenDay = this.rateLimitRepo.getLatest('seven_day');
        if (fiveHour !== null || sevenDay !== null) {
          const parts: string[] = [];
          if (fiveHour !== null) parts.push(`5h: **${fiveHour.utilization_pct.toFixed(1)}%**`);
          if (sevenDay !== null) parts.push(`7d: **${sevenDay.utilization_pct.toFixed(1)}%**`);
          return parts.join(' | ');
        }
      } catch { /* fall through to OAuth */ }
    }
    return null;
  }

  async buildQuotaBlockAsync(): Promise<string | null> {
    const sync = this.buildQuotaBlock();
    if (sync !== null) return sync;
    try {
      const { getOAuthUsage } = await import('../../../services/OAuthUsageService.js');
      const usage = await getOAuthUsage();
      if (!usage) return null;
      const parts: string[] = [];
      if (usage.five_hour) parts.push(`5h: **${usage.five_hour.utilization.toFixed(1)}%**`);
      if (usage.seven_day) parts.push(`7d: **${usage.seven_day.utilization.toFixed(1)}%**`);
      return parts.length > 0 ? parts.join(' | ') : null;
    } catch { return null; }
  }
}
