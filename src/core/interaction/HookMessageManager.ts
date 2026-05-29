/**
 * HookMessageManager — Discord visibility for SDK callback hooks.
 *
 * Pure view layer: renders every `HookEvent` as
 *
 *   `-# 🪝 Hook - <name>: <message>`
 *
 * (or `-# 🪝 Hook - <name>` when `message` is empty). `name` and `message`
 * are decided by the emit site — this class never inspects `kind` or
 * `phase` to derive display text.
 *
 * Sent via the adapter's `sendSubtitleMessage` (Discord renders `-# ...`
 * as small grey text).
 * No follow-up edit — the line shows up once and stays as final output.
 */

import { logger } from '../../utils/logger.js';
import type { HookEvent } from '../../types/hookEvent.js';
import type { StatusCapableAdapter } from '../query/StatusMessageManager.js';

const HOOK_EMOJI = '🪝';
const MAX_MESSAGE_LEN = 50;

function truncate(raw: string, max: number): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max) + '…' : cleaned;
}

function formatLine(evt: HookEvent, maxMessageLen: number): string {
  const name = evt.name.trim();
  const message = truncate(evt.message ?? '', maxMessageLen);
  return message ? `-# ${HOOK_EMOJI} Hook - ${name}: ${message}` : `-# ${HOOK_EMOJI} Hook - ${name}`;
}

export interface HookMessageManagerOptions {
  /** Override message-portion truncation length (default 50). */
  maxMessageLen?: number;
}

export class HookMessageManager {
  private readonly maxMessageLen: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly adapter: StatusCapableAdapter,
    private readonly chatId: string,
    options: HookMessageManagerOptions = {}
  ) {
    this.maxMessageLen = options.maxMessageLen ?? MAX_MESSAGE_LEN;
  }

  async handle(event: HookEvent): Promise<void> {
    return this.enqueue(async () => {
      await this.sendEvent(event);
    });
  }

  /** Drain queued hook sends — ordering barrier before final response. */
  async flushPending(): Promise<void> {
    return this.enqueue(async () => {});
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => {});
    return run;
  }

  private async sendEvent(event: HookEvent): Promise<void> {
    const text = formatLine(event, this.maxMessageLen);
    try {
      if (this.adapter.sendSubtitleMessage) {
        await this.adapter.sendSubtitleMessage(this.chatId, text);
      } else {
        await this.adapter.sendStatusMessage(this.chatId, text);
      }
    } catch (err) {
      logger.warn(
        { chatId: this.chatId, kind: event.kind, err: err instanceof Error ? err.message : String(err) },
        'HookMessageManager: send failed'
      );
    }
  }
}
