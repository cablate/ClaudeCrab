/**
 * SubAgentMessageManager — Discord UI for SDK Task tool sub-agent lifecycle events.
 *
 * Manages Discord messages that show sub-agent lifecycle:
 *   started → progress → completed / failed
 *
 * Each sub-agent gets a single Discord message that is edited in-place as
 * the sub-agent progresses through its lifecycle stages.
 */

import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import { logger } from '../../utils/logger.js';

const mLogger = logger.child({ module: 'SubAgentMessageManager' });

/** Lifecycle stage of a sub-agent task */
export type SubAgentLifecycle = 'started' | 'progress' | 'completed' | 'failed';

/** A sub-agent event from the SDK Task tool stream */
export interface SubAgentEvent {
  toolUseId: string;
  lifecycle: SubAgentLifecycle;
  taskId?: string;
  summary?: string;
  result?: string;
  error?: string;
}

/** Internal record for a tracked sub-agent */
interface SubAgentRecord {
  toolUseId: string;
  lifecycles: SubAgentLifecycle[];
  discordMessageId: string | null;
  createdAt: number;
  lastUpdatedAt: number;
  summary: string;
}

/**
 * Manages Discord UI for SDK Task tool sub-agent lifecycle events.
 * Each sub-agent gets a single Discord message that is edited in-place
 * as events arrive (started → progress → completed/failed).
 */
export class SubAgentMessageManager {
  private readonly adapter: BaseAdapter;
  private readonly chatId: string;
  private agents = new Map<string, SubAgentRecord>();
  private disposed = false;

  constructor(adapter: BaseAdapter, chatId: string) {
    this.adapter = adapter;
    this.chatId = chatId;
  }

  /**
   * Handle a sub-agent event from the Task tool stream.
   * Creates/updates the Discord message for this sub-agent.
   */
  async handle(event: SubAgentEvent): Promise<void> {
    if (this.disposed) return;
    const { toolUseId, lifecycle, summary, result, error } = event;

    let record = this.agents.get(toolUseId);
    if (!record) {
      record = {
        toolUseId,
        lifecycles: [],
        discordMessageId: null,
        createdAt: Date.now(),
        lastUpdatedAt: Date.now(),
        summary: '',
      };
      this.agents.set(toolUseId, record);
    }

    record.lifecycles.push(lifecycle);
    record.lastUpdatedAt = Date.now();

    if (summary) record.summary = summary;

    const content = this.formatMessage(record, lifecycle, result, error);

    try {
      if (record.discordMessageId) {
        await this.adapter.editMessage(this.chatId, record.discordMessageId, content);
      } else {
        const sendResult = await this.adapter.sendFormattedMessage(this.chatId, content);
        if (sendResult.success && sendResult.messageId) {
          record.discordMessageId = sendResult.messageId;
        }
      }
    } catch (err) {
      mLogger.warn({ toolUseId, lifecycle, err }, 'Failed to update sub-agent Discord message');
    }
  }

  /**
   * Number of sub-agents currently in started or progress state.
   */
  activeCount(): number {
    let count = 0;
    for (const record of this.agents.values()) {
      const lastLifecycle = record.lifecycles[record.lifecycles.length - 1];
      if (lastLifecycle === 'started' || lastLifecycle === 'progress') {
        count++;
      }
    }
    return count;
  }

  /**
   * Finalize all active sub-agents (mark as completed).
   */
  async finalizeAll(): Promise<void> {
    for (const [toolUseId, record] of this.agents) {
      const lastLifecycle = record.lifecycles[record.lifecycles.length - 1];
      if (lastLifecycle === 'started' || lastLifecycle === 'progress') {
        await this.handle({
          toolUseId,
          lifecycle: 'completed',
          summary: record.summary,
        });
      }
    }
  }

  /**
   * Clean up stale sub-agent entries that haven't been updated recently.
   */
  cleanupStale(maxAgeMs = 300_000): void {
    const now = Date.now();
    for (const [toolUseId, record] of this.agents) {
      if (now - record.lastUpdatedAt > maxAgeMs) {
        this.agents.delete(toolUseId);
      }
    }
  }

  /**
   * Dispose the manager, cleaning up all state.
   */
  dispose(): void {
    this.disposed = true;
    this.agents.clear();
  }

  private formatMessage(
    record: SubAgentRecord,
    lifecycle: SubAgentLifecycle,
    result?: string,
    error?: string,
  ): string {
    const emoji = lifecycle === 'completed' ? '✅' :
      lifecycle === 'failed' ? '❌' :
      lifecycle === 'progress' ? '🔄' : '🚀';

    let msg = `${emoji} **Sub-Agent**`;

    if (record.summary) {
      msg += `\n${record.summary}`;
    }

    if (lifecycle === 'completed' && result) {
      msg += `\n\`\`\`\n${result.substring(0, 500)}\n\`\`\``;
    }

    if (lifecycle === 'failed' && error) {
      msg += `\n⚠️ ${error.substring(0, 200)}`;
    }

    return msg;
  }
}
