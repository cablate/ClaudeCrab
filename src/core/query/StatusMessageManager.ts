/**
 * Manages real-time status messages for tool execution feedback.
 *
 * Extracted from MessageProcessor.executeQueryWithSDK to isolate
 * the concern of tracking tool events, debouncing updates, and
 * managing status message lifecycle in Discord.
 */

/**
 * A single tool event entry for display in the status message.
 */
export interface ToolEventEntry {
  toolName: string;
  status: string;
  detail?: string;
  eventType?: 'tool_use' | 'tool_result' | 'tool_progress' | 'thinking';
  scope?: 'main' | 'subagent';
}

/**
 * Interface for adapters that support status messages.
 * Not all adapters implement this.
 */
export interface StatusCapableAdapter {
  sendStatusMessage(chatId: string, text?: string): Promise<string | null>;
  updateStatusMessage(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<boolean>;
  /**
   * Optional: send a message that should NOT be wrapped in a code fence
   * (subtitle / small-text marker that relies on raw markdown like Discord's
   * `-#`). Adapters that don't implement this are called via sendStatusMessage
   * as a fallback.
   */
  sendSubtitleMessage?(chatId: string, text: string): Promise<string | null>;
}

/**
 * Options for StatusMessageManager.
 */
export interface StatusMessageManagerOptions {
  /** Minimum milliseconds between status updates (avoid Discord rate limits) */
  debounceMs?: number;
  /** Maximum number of recent tool events to display */
  maxEventsDisplay?: number;
}

/**
 * Manages the lifecycle of status messages during SDK query execution.
 *
 * A status message shows real-time feedback about which tools are being used.
 * When an intermediate assistant message is sent, the current status message
 * is finalized and a new one is created for the next batch of tool events.
 */
export class StatusMessageManager {
  private readonly adapter: StatusCapableAdapter;
  private readonly chatId: string;
  private readonly debounceMs: number;
  private readonly maxEventsDisplay: number;

  private statusMessageId: string | null = null;
  private toolEvents: ToolEventEntry[] = [];
  private lastStatusUpdate = 0;
  private needNewStatusMessage = true;

  constructor(
    adapter: StatusCapableAdapter,
    chatId: string,
    options?: StatusMessageManagerOptions
  ) {
    this.adapter = adapter;
    this.chatId = chatId;
    this.debounceMs = options?.debounceMs ?? 2000;
    this.maxEventsDisplay = options?.maxEventsDisplay ?? 8;
  }

  /**
   * Add a tool event and update the status message (debounced).
   */
  async addToolEvent(event: ToolEventEntry): Promise<void> {
    // Create the status message before recording the first event. Otherwise
    // createNewMessage() resets the batch and the first tool event is lost.
    if (this.needNewStatusMessage || this.statusMessageId === null) {
      await this.createNewMessage();
    }

    this.toolEvents.push(event);
    // Cap memory: keep only the most recent events (display uses slice(-maxEventsDisplay) anyway)
    if (this.toolEvents.length > this.maxEventsDisplay * 10) {
      this.toolEvents = this.toolEvents.slice(-this.maxEventsDisplay * 5);
    }
    await this.updateDebounced();
  }

  /**
   * Mark that the next tool event should create a new status message.
   * Called after an intermediate assistant message is sent.
   */
  markNeedNewMessage(): void {
    this.needNewStatusMessage = true;
  }

  /**
   * Finalize the current status message batch before sending an assistant message.
   * Updates the status message with a completion summary if there were tool events.
   */
  async finalizeCurrentBatch(): Promise<void> {
    if (this.statusMessageId !== null && this.toolEvents.length > 0) {
      await this.adapter.updateStatusMessage(
        this.chatId,
        this.statusMessageId,
        this.formatCompletionSummary()
      );
    }
  }

  /**
   * Finalize after the entire query is complete.
   * Shows a completion summary or simple "done" marker.
   */
  async finalizeAll(): Promise<void> {
    if (this.statusMessageId === null) return;

    if (this.toolEvents.length > 0) {
      await this.adapter.updateStatusMessage(
        this.chatId,
        this.statusMessageId,
        this.formatCompletionSummary()
      );
    } else {
      await this.adapter.updateStatusMessage(
        this.chatId,
        this.statusMessageId,
        '✓ 完成'
      );
    }
  }

  // --- Private helpers ---

  private async updateDebounced(forceUpdate = false): Promise<void> {
    if (this.statusMessageId === null) return;

    const now = Date.now();
    if (!forceUpdate && now - this.lastStatusUpdate < this.debounceMs) return;
    this.lastStatusUpdate = now;

    // Build detailed status text from recent tool events
    const recentEvents = this.toolEvents.slice(-this.maxEventsDisplay);
    const eventLines = recentEvents.map((e) => {
      if (e.detail) {
        return `${e.status}\n   └ ${e.detail}`;
      }
      return e.status;
    });

    const hiddenCount = this.toolEvents.length - recentEvents.length;
    const header =
      hiddenCount > 0
        ? `🔄 處理中... (${this.toolEvents.length} 個操作)`
        : '🔄 處理中...';

    const statusText =
      eventLines.length > 0
        ? `${header}\n\n${eventLines.join('\n')}`
        : header;

    await this.adapter.updateStatusMessage(
      this.chatId,
      this.statusMessageId,
      statusText
    );
  }

  private async createNewMessage(): Promise<void> {
    // Finalize previous if exists
    if (this.statusMessageId !== null && this.toolEvents.length > 0) {
      await this.adapter.updateStatusMessage(
        this.chatId,
        this.statusMessageId,
        this.formatCompletionSummary()
      );
    }

    // Reset and create new
    this.toolEvents = [];
    this.statusMessageId = await this.adapter.sendStatusMessage(this.chatId);
    this.needNewStatusMessage = false;
  }

  private formatCompletionSummary(): string {
    const toolCounts = new Map<string, number>();
    for (const event of this.toolEvents) {
      if (event.scope === 'subagent') continue;
      if (event.eventType === 'tool_result') continue;
      if (event.eventType === 'tool_progress') continue;
      toolCounts.set(
        event.toolName,
        (toolCounts.get(event.toolName) ?? 0) + 1
      );
    }
    const toolSummary = Array.from(toolCounts.entries())
      .map(([name, count]) => `${name} (${count})`)
      .join(' | ');
    const completedCount = Array.from(toolCounts.values()).reduce((sum, count) => sum + count, 0);
    if (completedCount === 0) {
      return '✓ 已完成';
    }
    return `✓ 已完成 ${completedCount} 個操作\n   ${toolSummary}`;
  }
}

/**
 * Check if an adapter supports status messages.
 */
export function isStatusCapable(
  adapter: unknown
): adapter is StatusCapableAdapter {
  return (
    typeof adapter === 'object' &&
    adapter !== null &&
    'sendStatusMessage' in adapter &&
    typeof (adapter as { sendStatusMessage?: unknown }).sendStatusMessage ===
      'function' &&
    'updateStatusMessage' in adapter &&
    typeof (adapter as { updateStatusMessage?: unknown }).updateStatusMessage ===
      'function'
  );
}
