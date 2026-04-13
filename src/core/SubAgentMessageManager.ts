/**
 * SubAgentMessageManager — one persistent chat message per sub-agent (Task tool).
 *
 * Why this exists:
 *   The CLI inlines `system task_started/task_progress/task_notification` messages
 *   into the main session stream while sub-agents run. Pushing each event to the
 *   user as a separate intermediate text would spam the chat. Instead, this class
 *   keeps one editable message per `task_id` and rewrites it as the sub-agent
 *   advances — same UX pattern as Claude Code CLI's tool-use display.
 *
 * Lifecycle:
 *   started   → adapter.sendStatusMessage; record created
 *   progress  → debounced adapter.updateStatusMessage; record merged
 *   completed → final adapter.updateStatusMessage (always immediate, no debounce)
 *   failed    → same as completed; or finalizeAll marks still-running records as
 *               failed when the main session ends before the sub-agent reports back
 *               (see issue anthropics/claude-agent-sdk-python#577 — main-result-too-early case)
 *
 * Concurrency:
 *   One record per task_id; concurrent sub-agents each get their own message.
 *   Records are entirely in-memory; dispose() clears the map.
 */

import { logger } from '../utils/logger.js';
import type {
  SubAgentEvent,
  SubAgentFormatter,
  SubAgentRecord,
} from '../types/subAgent.js';
import type { StatusCapableAdapter } from './StatusMessageManager.js';

export interface SubAgentMessageManagerOptions {
  /** Minimum ms between updateStatusMessage calls for the same record. */
  debounceMs?: number;
  /** Override the default formatter (display style). */
  formatter?: SubAgentFormatter;
}

/** Default rendering. Plain text + minimal emoji to mark lifecycle status. */
const defaultFormatter: SubAgentFormatter = (r) => {
  const elapsedSec = ((Date.now() - r.startedAt) / 1000).toFixed(1);
  const tool = r.lastTool ? ` · ${r.lastTool}` : '';
  const tokens = r.totalTokens !== undefined ? ` · ${r.totalTokens.toLocaleString()} tokens` : '';
  const uses = r.toolUses !== undefined ? ` · ${r.toolUses} tools` : '';
  const meta = `${elapsedSec}s${tokens}${uses}`;

  switch (r.lifecycle) {
    case 'started':
      return `🚀 子代理：${r.description}`;
    case 'progress':
      return `⏳ 子代理：${r.description}${tool} · ${meta}`;
    case 'completed':
      return `✓ 子代理完成：${r.summary ?? r.description} · ${meta}`;
    case 'failed':
      return `✗ 子代理中斷：${r.description} · ${meta}（main session 已結束或 SDK 未回報完成）`;
  }
};

export class SubAgentMessageManager {
  private readonly records = new Map<string, SubAgentRecord>();
  private readonly debounceMs: number;
  private readonly formatter: SubAgentFormatter;

  constructor(
    private readonly adapter: StatusCapableAdapter,
    private readonly chatId: string,
    options: SubAgentMessageManagerOptions = {}
  ) {
    this.debounceMs = options.debounceMs ?? 2000;
    this.formatter = options.formatter ?? defaultFormatter;
  }

  /**
   * Single entry point. Routes by lifecycle:
   *   - 'started': create message + record
   *   - others: merge into existing record (silent no-op if started was missed)
   */
  async handle(event: SubAgentEvent): Promise<void> {
    if (event.lifecycle === 'started') {
      await this.handleStarted(event);
      return;
    }
    const record = this.records.get(event.taskId);
    if (!record) {
      // Started message was lost (race / earlier filter / restart). Silent skip
      // — better than emitting a half-formed update with no context.
      logger.debug(
        { chatId: this.chatId, taskId: event.taskId, lifecycle: event.lifecycle },
        'SubAgentMessageManager: event for unknown task_id, skipping'
      );
      return;
    }
    this.merge(record, event);
    if (this.shouldEdit(record, event)) {
      await this.editSafely(record);
      record.lastEditAt = Date.now();
    }
  }

  /**
   * Mark every still-running record as failed and write the final state to chat.
   * Call this when the main query ends — any record still in 'started'/'progress'
   * means the CLI never delivered a notification (main result fired too early,
   * see SDK issue #577).
   */
  async finalizeAll(): Promise<void> {
    for (const record of this.records.values()) {
      if (record.lifecycle === 'started' || record.lifecycle === 'progress') {
        record.lifecycle = 'failed';
        await this.editSafely(record);
      }
    }
  }

  /** Drop in-memory state. Idempotent. */
  dispose(): void {
    this.records.clear();
  }

  // --- internals ---

  private async handleStarted(event: SubAgentEvent): Promise<void> {
    const startedAt = Date.now();
    // Build a provisional record so the formatter can render the very first message
    // — keep it in scope; we only commit it after sendStatusMessage succeeds.
    const provisional: SubAgentRecord = {
      taskId: event.taskId,
      messageId: '',
      description: event.description,
      startedAt,
      lifecycle: 'started',
      lastEditAt: startedAt,
    };
    let messageId: string | null = null;
    try {
      messageId = await this.adapter.sendStatusMessage(
        this.chatId,
        this.formatter(provisional)
      );
    } catch (err) {
      logger.warn(
        { chatId: this.chatId, taskId: event.taskId, err: err instanceof Error ? err.message : String(err) },
        'SubAgentMessageManager: sendStatusMessage failed'
      );
    }
    if (!messageId) return; // No anchor message → nothing to edit later → don't track
    provisional.messageId = messageId;
    this.records.set(event.taskId, provisional);
  }

  private merge(record: SubAgentRecord, event: SubAgentEvent): void {
    record.lifecycle = event.lifecycle;
    if (event.toolName !== undefined) record.lastTool = event.toolName;
    if (event.totalTokens !== undefined) record.totalTokens = event.totalTokens;
    if (event.toolUses !== undefined) record.toolUses = event.toolUses;
    if (event.summary !== undefined) record.summary = event.summary;
    if (event.outputFile !== undefined) record.outputFile = event.outputFile;
    if (event.description) record.description = event.description;
  }

  /**
   * Terminal events (completed/failed) always edit immediately so the user
   * sees the final state without lag. Progress events respect debounceMs.
   */
  private shouldEdit(record: SubAgentRecord, event: SubAgentEvent): boolean {
    if (event.lifecycle === 'completed' || event.lifecycle === 'failed') return true;
    return Date.now() - record.lastEditAt >= this.debounceMs;
  }

  private async editSafely(record: SubAgentRecord): Promise<void> {
    try {
      await this.adapter.updateStatusMessage(
        this.chatId,
        record.messageId,
        this.formatter(record)
      );
    } catch (err) {
      logger.warn(
        {
          chatId: this.chatId,
          taskId: record.taskId,
          messageId: record.messageId,
          err: err instanceof Error ? err.message : String(err),
        },
        'SubAgentMessageManager: updateStatusMessage failed'
      );
    }
  }
}
