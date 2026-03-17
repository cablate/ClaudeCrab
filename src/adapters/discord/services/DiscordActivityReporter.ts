/**
 * DiscordActivityReporter — Discord-specific implementation of ActivityNotifier.
 *
 * Sends operational events as Discord Embeds to #system-log and #alerts channels.
 * Used by ActivityEventService via the ActivityNotifier interface.
 */

import { EmbedBuilder } from 'discord.js';
import type { DiscordAdapter } from '../../DiscordAdapter.js';
import type { ActivityNotifier } from '../../../services/ActivityEventService.js';
import { EVENT_EMOJI, type OperationalEvent } from '../../../services/ActivityEventService.js';

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

    const embed = new EmbedBuilder()
      .setTitle(`${EVENT_EMOJI[event.type] ?? '\u26A0\uFE0F'} ${event.type}`)
      .setColor(event.type === 'budget.exceeded' || event.type === 'error.occurred' ? 0xFF0000 : 0xFFA500)
      .addFields(
        { name: 'Agent', value: event.agentId, inline: true },
        { name: 'Message', value: event.message.slice(0, 1024) },
      )
      .setTimestamp();

    if (event.details !== undefined) {
      embed.addFields({ name: 'Details', value: event.details.slice(0, 1024) });
    }

    // Add @mention in embed description if formattedMessage contains it
    if (formattedMessage) {
      embed.setDescription(`${formattedMessage} \u9700\u8981\u4F60\u95DC\u6CE8\n\n${embed.data.description ?? ''}`);
    }

    await this.adapter.sendEmbed(this.alertsChannelId, [embed]);
  }
}
