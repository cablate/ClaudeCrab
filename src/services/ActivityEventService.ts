/**
 * ActivityEventService — operational event logging with pluggable notification.
 *
 * Logs structured events and sends formatted messages via an injected notifier.
 * The notifier is platform-agnostic — Discord implementation lives in
 * adapters/discord/services/DiscordActivityReporter.ts.
 *
 * NOT the same as ActivityService (WebUI personality reactions).
 * This is for operational visibility: schedule results, budget alerts, errors.
 */

import { logger } from '../utils/logger.js';
import type { IActivityEventService } from '../types/interfaces.js';

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

export const EVENT_EMOJI: Record<string, string> = {
  'chat.received': '\u{1F4E9}',
  'chat.responded': '\u{1F4AC}',
  'schedule.started': '\u23F0',
  'schedule.completed': '\u2705',
  'schedule.failed': '\u274C',
  'agent_call.sent': '\u{1F4E4}',
  'agent_call.received': '\u{1F4E5}',
  'budget.warning': '\u26A0\uFE0F',
  'budget.exceeded': '\u{1F534}',
  'task.created': '\u{1F4CB}',
  'task.completed': '\u2705',
  'error.occurred': '\u{1F6A8}',
};

/**
 * Notifier interface — platform-specific implementations handle the actual message delivery.
 */
export interface ActivityNotifier {
  /** Send a batch of log lines to the system log channel */
  sendSystemLog(text: string): Promise<void>;
  /** Send an alert (structured event data for rich formatting) */
  sendAlert(event: OperationalEvent, formattedMessage: string): Promise<void>;
}

export interface ActivityEventServiceOptions {
  /** Platform-specific notifier for sending events */
  notifier?: ActivityNotifier;
  /** Owner user ID for @mention in alerts */
  ownerUserId?: string;
}

export class ActivityEventService implements IActivityEventService {
  private readonly notifier: ActivityNotifier | undefined;
  private readonly ownerUserId: string | undefined;

  /** Batch queue: accumulate events, flush periodically */
  private queue: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly FLUSH_INTERVAL_MS = 3000;
  private static readonly MAX_BATCH_SIZE = 10;

  constructor(options: ActivityEventServiceOptions) {
    this.notifier = options.notifier;
    this.ownerUserId = options.ownerUserId;

    // Start batch flush timer
    if (this.notifier !== undefined) {
      this.flushTimer = setInterval(() => {
        void this.flush().catch((err) => {
          log.warn({ err }, 'Failed to flush activity events');
        });
      }, ActivityEventService.FLUSH_INTERVAL_MS);
      this.flushTimer.unref();
    }
  }

  /**
   * Log an operational event. Sends via notifier if configured.
   */
  async log(event: OperationalEvent): Promise<void> {
    const emoji = EVENT_EMOJI[event.type] ?? '\u{1F4CC}';
    const line = `${emoji} **${event.agentId}** ${event.message}`;

    // Determine routing
    const level = event.level ?? (event.type.includes('error') || event.type.includes('failed') || event.type === 'budget.exceeded' ? 'error' : 'info');

    if (level === 'error' || level === 'warn') {
      // Alerts go immediately (not batched)
      await this.sendAlert(event);
    }

    // Queue for system-log batch
    this.queue.push(this.redactSecrets(line));

    if (this.queue.length >= ActivityEventService.MAX_BATCH_SIZE) {
      await this.flush();
    }
  }

  /**
   * Send an alert via notifier.
   */
  private async sendAlert(event: OperationalEvent): Promise<void> {
    if (this.notifier === undefined) return;

    try {
      const redactedMessage = this.redactSecrets(event.message).slice(0, 1024);
      const shouldMention = this.ownerUserId !== undefined &&
        (event.type === 'budget.exceeded' || event.type === 'error.occurred');

      const formattedMessage = shouldMention ? `<@${this.ownerUserId}>` : '';

      await this.notifier.sendAlert(event, formattedMessage);
    } catch (err) {
      log.warn({ err }, 'Failed to send alert');
    }
  }

  /**
   * Flush queued events to system-log as a single message.
   */
  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    if (this.notifier === undefined) {
      this.queue = [];
      return;
    }

    const batch = this.queue.splice(0, ActivityEventService.MAX_BATCH_SIZE);
    const text = batch.join('\n');

    try {
      await this.notifier.sendSystemLog(text);
    } catch (err) {
      log.warn({ err, batchSize: batch.length }, 'Failed to flush to system-log');
    }
  }

  /**
   * Redact secrets from text.
   */
  redactSecrets(text: string): string {
    let result = text;
    for (const pattern of SECRET_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  /**
   * Stop the flush timer and flush remaining events.
   */
  async dispose(): Promise<void> {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
