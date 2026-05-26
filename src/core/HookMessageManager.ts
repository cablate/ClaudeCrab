/**
 * HookMessageManager — Discord visibility for SDK callback hooks.
 *
 * Pure view layer: renders every `HookEvent` as
 *
 *   `-# 🪝 Hook - <name>: <message>`
 *   `-# 🛡 Governance: <message>`
 *
 * (or `-# 🪝 Hook - <name>` when `message` is empty). `name` and `message`
 * are decided by the emit site — this class never inspects `kind` or
 * `phase` to derive display text.
 *
 * Sent via the adapter's `sendSubtitleMessage` (Discord renders `-# ...`
 * as small grey text).
 * No follow-up edit — the line shows up once and stays as final output.
 */

import { logger } from '../utils/logger.js';
import type { HookEvent } from '../types/hookEvent.js';
import type { StatusCapableAdapter } from './StatusMessageManager.js';

const HOOK_EMOJI = '🪝';
const GOVERNANCE_EMOJI = '🛡';
const MAX_MESSAGE_LEN = 50;
const MAX_GOVERNANCE_MESSAGE_LEN = 140;

function truncate(raw: string, max: number): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max) + '…' : cleaned;
}

function formatLine(evt: HookEvent, maxMessageLen: number): string {
  const name = evt.name.trim();
  const messageLimit = evt.kind === 'governance'
    ? MAX_GOVERNANCE_MESSAGE_LEN
    : maxMessageLen;
  const message = truncate(evt.message ?? '', messageLimit);
  if (evt.kind === 'governance') {
    return message ? `-# ${GOVERNANCE_EMOJI} Governance: ${message}` : `-# ${GOVERNANCE_EMOJI} Governance`;
  }
  return message ? `-# ${HOOK_EMOJI} Hook - ${name}: ${message}` : `-# ${HOOK_EMOJI} Hook - ${name}`;
}

export interface HookMessageManagerOptions {
  /** Override message-portion truncation length (default 50). */
  maxMessageLen?: number;
}

export class HookMessageManager {
  private readonly maxMessageLen: number;
  private readonly pendingGovernanceEvents: HookEvent[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly adapter: StatusCapableAdapter,
    private readonly chatId: string,
    options: HookMessageManagerOptions = {}
  ) {
    this.maxMessageLen = options.maxMessageLen ?? MAX_MESSAGE_LEN;
  }

  async handle(event: HookEvent): Promise<void> {
    if (event.kind === 'governance') {
      return;
    }
    return this.enqueue(async () => {
      await this.handleLocked(event);
    });
  }

  async flushPendingGovernance(): Promise<void> {
    return this.enqueue(async () => {
      await this.flushPendingGovernanceLocked();
    });
  }

  async flushPending(): Promise<void> {
    return this.enqueue(async () => {
      await this.flushPendingGovernanceLocked();
    });
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => {});
    return run;
  }

  private async handleLocked(event: HookEvent): Promise<void> {
    if (event.kind === 'governance') {
      this.pendingGovernanceEvents.push(event);
      return;
    }

    await this.sendEvent(event);
  }

  private async flushPendingGovernanceLocked(): Promise<void> {
    while (this.pendingGovernanceEvents.length > 0) {
      const event = this.pendingGovernanceEvents.shift()!;
      await this.sendEvent(event);
    }
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

  dispose(): void {
    this.pendingGovernanceEvents.length = 0;
  }
}
