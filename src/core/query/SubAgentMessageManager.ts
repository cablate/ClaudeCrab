/**
 * SubAgentMessageManager — Discord UI for SDK Task tool sub-agent lifecycle events.
 *
 * Manages Discord messages that show sub-agent lifecycle:
 *   started → progress → completed / failed
 *
 * A query gets one aggregate Discord message that is edited in-place as
 * sub-agents progress through their lifecycle stages.
 */

import { readFile } from 'node:fs/promises';
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
  outputFile?: string;
}

/** Internal record for a tracked sub-agent */
interface SubAgentRecord {
  toolUseId: string;
  taskId?: string;
  lifecycles: SubAgentLifecycle[];
  createdAt: number;
  lastUpdatedAt: number;
  summary: string;
  resultPreview?: string;
  error?: string;
}

const MAX_AGENT_LINES = 6;
const MAX_RECORD_SUMMARY_LENGTH = 120;
const MAX_RECORD_ERROR_LENGTH = 180;

/**
 * Manages Discord UI for SDK Task tool sub-agent lifecycle events.
 * A query gets one aggregate Discord message that is edited in-place
 * as events arrive (started → progress → completed/failed).
 */
export class SubAgentMessageManager {
  private readonly adapter: BaseAdapter;
  private readonly chatId: string;
  private agents = new Map<string, SubAgentRecord>();
  private discordMessageId: string | null = null;
  private finalized = false;
  private disposed = false;

  constructor(adapter: BaseAdapter, chatId: string) {
    this.adapter = adapter;
    this.chatId = chatId;
  }

  /**
   * Handle a sub-agent event from the Task tool stream.
   * Creates/updates one aggregate Discord message for this query.
   */
  async handle(event: SubAgentEvent): Promise<boolean> {
    if (this.disposed) return false;
    const { toolUseId, lifecycle, summary, error, taskId } = event;

    if (this.finalized && !this.agents.has(toolUseId)) {
      this.resetBatch();
    }

    let record = this.agents.get(toolUseId);
    if (!record) {
      record = {
        toolUseId,
        lifecycles: [],
        createdAt: Date.now(),
        lastUpdatedAt: Date.now(),
        summary: '',
      };
      this.agents.set(toolUseId, record);
    }

    record.lifecycles.push(lifecycle);
    record.lastUpdatedAt = Date.now();

    if (taskId) record.taskId = taskId;

    const normalizedSummary = normalizeInlineText(summary);
    if (normalizedSummary) record.summary = normalizedSummary;

    const normalizedError = normalizeInlineText(error);
    if (normalizedError) record.error = normalizedError;

    if (lifecycle === 'completed') {
      const fileResult = await readTaskOutputFile(event.outputFile);
      const resultPreview = truncateInline(fileResult ?? event.result, MAX_RECORD_SUMMARY_LENGTH);
      if (resultPreview) record.resultPreview = resultPreview;
    }

    return this.sendOrUpdate(this.formatAggregateMessage());
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
    let changed = false;
    const now = Date.now();

    for (const record of this.agents.values()) {
      const lastLifecycle = this.latestLifecycle(record);
      if (lastLifecycle === 'started' || lastLifecycle === 'progress') {
        record.lifecycles.push('completed');
        record.lastUpdatedAt = now;
        changed = true;
      }
    }

    if (changed && this.discordMessageId !== null) {
      await this.sendOrUpdate(this.formatAggregateMessage());
    }
    if (this.agents.size > 0) {
      this.finalized = true;
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
    this.discordMessageId = null;
    this.finalized = false;
  }

  private resetBatch(): void {
    this.agents.clear();
    this.discordMessageId = null;
    this.finalized = false;
  }

  private async sendOrUpdate(content: string): Promise<boolean> {
    try {
      if (this.discordMessageId !== null) {
        const editResult = await this.adapter.editMessage(this.chatId, this.discordMessageId, content);
        if (editResult.success) return true;

        const fallbackResult = await this.adapter.sendMessage(this.chatId, content);
        if (fallbackResult.success && fallbackResult.messageId) {
          this.discordMessageId = fallbackResult.messageId;
        }
        return fallbackResult.success;
      }

      const sendResult = await this.adapter.sendMessage(this.chatId, content);
      if (sendResult.success && sendResult.messageId) {
        this.discordMessageId = sendResult.messageId;
      }
      return sendResult.success;
    } catch (err) {
      mLogger.warn({ err }, 'Failed to update aggregate sub-agent Discord message');
      return false;
    }
  }

  private formatAggregateMessage(): string {
    const records = Array.from(this.agents.values())
      .sort((a, b) => a.createdAt - b.createdAt);

    const activeRecords = records.filter((record) => this.isActive(record));
    const failedRecords = records.filter((record) => this.latestLifecycle(record) === 'failed');
    const completedRecords = records.filter((record) => this.latestLifecycle(record) === 'completed');

    const title = activeRecords.length > 0
      ? '**背景任務執行中**'
      : failedRecords.length > 0
        ? '**背景任務有失敗**'
        : '**背景任務完成**';

    const lines = [
      title,
      `進行中 ${activeRecords.length} 個，已完成 ${completedRecords.length} 個，失敗 ${failedRecords.length} 個`,
    ];

    if (activeRecords.length > 0) {
      lines.push('', '目前：', this.formatRecordList(activeRecords));
      if (completedRecords.length > 0) {
        lines.push('', `已完成：${completedRecords.length} 個`);
      }
    } else if (completedRecords.length > 0) {
      lines.push('', '已完成：', this.formatRecordList(completedRecords, { includeResultPreview: true }));
    }

    if (failedRecords.length > 0) {
      lines.push('', '失敗：', this.formatRecordList(failedRecords, { includeError: true }));
    }

    return truncateForDiscord(lines.join('\n'), 1900);
  }

  private formatRecordList(
    records: SubAgentRecord[],
    options?: { includeError?: boolean; includeResultPreview?: boolean },
  ): string {
    const visibleRecords = records
      .slice()
      .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
      .slice(0, MAX_AGENT_LINES);

    const lines = visibleRecords.map((record) => this.formatRecordLine(record, options));
    const hiddenCount = records.length - visibleRecords.length;
    if (hiddenCount > 0) {
      lines.push(`- 另有 ${hiddenCount} 個未顯示`);
    }
    return lines.join('\n');
  }

  private formatRecordLine(
    record: SubAgentRecord,
    options?: { includeError?: boolean; includeResultPreview?: boolean },
  ): string {
    const summary = record.summary
      || record.resultPreview
      || record.taskId
      || record.toolUseId;
    const lines = [`- ${truncateInline(summary, MAX_RECORD_SUMMARY_LENGTH)}`];

    if (options?.includeResultPreview && record.resultPreview && record.resultPreview !== record.summary) {
      lines.push(`  ${truncateInline(record.resultPreview, MAX_RECORD_SUMMARY_LENGTH)}`);
    }
    if (options?.includeError && record.error) {
      lines.push(`  錯誤：${truncateInline(record.error, MAX_RECORD_ERROR_LENGTH)}`);
    }

    return lines.join('\n');
  }

  private isActive(record: SubAgentRecord): boolean {
    const lifecycle = this.latestLifecycle(record);
    return lifecycle === 'started' || lifecycle === 'progress';
  }

  private latestLifecycle(record: SubAgentRecord): SubAgentLifecycle {
    return record.lifecycles[record.lifecycles.length - 1] ?? 'started';
  }
}

async function readTaskOutputFile(outputFile: string | undefined): Promise<string | undefined> {
  if (!outputFile) return undefined;
  try {
    const content = await readFile(outputFile, 'utf-8');
    return content.trim().length > 0 ? content : undefined;
  } catch (err) {
    mLogger.debug({ outputFile, err }, 'Task output file could not be read');
    return undefined;
  }
}

function truncateForDiscord(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 20)}\n...（已截斷）`;
}

function truncateInline(text: string | undefined, maxLength: number): string {
  const normalized = normalizeInlineText(text);
  if (normalized === undefined) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalizeInlineText(text: string | undefined): string | undefined {
  const normalized = text?.replace(/\s+/g, ' ').trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}
