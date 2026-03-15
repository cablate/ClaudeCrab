/**
 * ActivityEventService — operational event dual-write (SQLite + Discord).
 *
 * Logs structured events to execution_records/activity tables AND
 * sends formatted messages to Discord #system-log and #alerts channels.
 *
 * NOT the same as ActivityService (WebUI personality reactions).
 * This is for operational visibility: schedule results, budget alerts, errors.
 */

import { EmbedBuilder } from 'discord.js';
import type { DiscordAdapter } from '../adapters/DiscordAdapter.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'ActivityEventService' });

/** Secret patterns to redact from event details */
const SECRET_PATTERNS = [
  /(?:api[_-]?key|token|secret|password|authorization)[=:]\s*['"]?[\w\-./+=]{8,}/gi,
  /(?:Bearer|Basic)\s+[\w\-./+=]{8,}/gi,
  /sk-[a-zA-Z0-9]{20,}/g,
  /r8_[a-zA-Z0-9]{20,}/g,
];

export type OperationalEventType =
  | 'chat.received'
  | 'chat.responded'
  | 'schedule.started'
  | 'schedule.completed'
  | 'schedule.failed'
  | 'agent_call.sent'
  | 'agent_call.received'
  | 'budget.warning'
  | 'budget.exceeded'
  | 'task.created'
  | 'task.completed'
  | 'error.occurred';

export interface OperationalEvent {
  type: OperationalEventType;
  agentId: string;
  message: string;
  details?: string;
  level?: 'info' | 'warn' | 'error';
}

const EVENT_EMOJI: Record<string, string> = {
  'chat.received': '📩',
  'chat.responded': '💬',
  'schedule.started': '⏰',
  'schedule.completed': '✅',
  'schedule.failed': '❌',
  'agent_call.sent': '📤',
  'agent_call.received': '📥',
  'budget.warning': '⚠️',
  'budget.exceeded': '🔴',
  'task.created': '📋',
  'task.completed': '✅',
  'error.occurred': '🚨',
};

export interface ActivityEventServiceOptions {
  /** Discord adapter (main bot) for sending events */
  discordAdapter?: DiscordAdapter;
  /** #system-log channel ID */
  systemLogChannelId?: string;
  /** #alerts channel ID */
  alertsChannelId?: string;
  /** Owner user ID for @mention in alerts */
  ownerUserId?: string;
}

export class ActivityEventService {
  private readonly adapter: DiscordAdapter | undefined;
  private readonly systemLogChannelId: string | undefined;
  private readonly alertsChannelId: string | undefined;
  private readonly ownerUserId: string | undefined;

  /** Batch queue: accumulate events, flush periodically */
  private queue: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly FLUSH_INTERVAL_MS = 3000;
  private static readonly MAX_BATCH_SIZE = 10;

  constructor(options: ActivityEventServiceOptions) {
    this.adapter = options.discordAdapter;
    this.systemLogChannelId = options.systemLogChannelId;
    this.alertsChannelId = options.alertsChannelId;
    this.ownerUserId = options.ownerUserId;

    // Start batch flush timer
    if (this.adapter !== undefined && this.systemLogChannelId !== undefined) {
      this.flushTimer = setInterval(() => {
        void this.flush().catch((err) => {
          log.warn({ err }, 'Failed to flush activity events');
        });
      }, ActivityEventService.FLUSH_INTERVAL_MS);
      this.flushTimer.unref();
    }
  }

  /**
   * Log an operational event. Sends to Discord if configured.
   */
  async log(event: OperationalEvent): Promise<void> {
    const emoji = EVENT_EMOJI[event.type] ?? '📌';
    const line = `${emoji} **${event.agentId}** ${event.message}`;

    // Determine routing
    const level = event.level ?? (event.type.includes('error') || event.type.includes('failed') || event.type === 'budget.exceeded' ? 'error' : 'info');

    if (level === 'error' || level === 'warn') {
      // Alerts go immediately (not batched)
      await this.sendAlert(event);
    }

    // Queue for #system-log batch
    this.queue.push(this.redactSecrets(line));

    if (this.queue.length >= ActivityEventService.MAX_BATCH_SIZE) {
      await this.flush();
    }
  }

  /**
   * Send an alert embed to #alerts channel.
   */
  private async sendAlert(event: OperationalEvent): Promise<void> {
    if (this.adapter === undefined || this.alertsChannelId === undefined) return;

    try {
      const embed = new EmbedBuilder()
        .setTitle(`${EVENT_EMOJI[event.type] ?? '⚠️'} ${event.type}`)
        .setColor(event.type === 'budget.exceeded' || event.type === 'error.occurred' ? 0xFF0000 : 0xFFA500)
        .addFields(
          { name: 'Agent', value: event.agentId, inline: true },
          { name: 'Message', value: this.redactSecrets(event.message).slice(0, 1024) },
        )
        .setTimestamp();

      if (event.details !== undefined) {
        embed.addFields({ name: 'Details', value: this.redactSecrets(event.details).slice(0, 1024) });
      }

      let content: string | undefined;
      if (this.ownerUserId !== undefined && (event.type === 'budget.exceeded' || event.type === 'error.occurred')) {
        content = `<@${this.ownerUserId}>`; // @mention owner
      }

      await this.adapter.sendToChannel(
        this.alertsChannelId,
        content ?? ''
      );
      await this.adapter.sendEmbed(this.alertsChannelId, [embed]);
    } catch (err) {
      log.warn({ err }, 'Failed to send alert');
    }
  }

  /**
   * Flush queued events to #system-log as a single message.
   */
  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    if (this.adapter === undefined || this.systemLogChannelId === undefined) {
      this.queue = [];
      return;
    }

    const batch = this.queue.splice(0, ActivityEventService.MAX_BATCH_SIZE);
    const text = batch.join('\n');

    try {
      await this.adapter.sendToChannel(this.systemLogChannelId, text);
    } catch (err) {
      log.warn({ err, batchSize: batch.length }, 'Failed to flush to #system-log');
    }
  }

  /**
   * Redact secrets from text.
   */
  private redactSecrets(text: string): string {
    let result = text;
    for (const pattern of SECRET_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  /**
   * Stop the flush timer.
   */
  dispose(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush
    void this.flush().catch(() => {});
  }
}
