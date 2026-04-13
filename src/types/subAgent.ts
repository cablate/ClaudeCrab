/**
 * Sub-agent (Task tool) lifecycle types.
 *
 * The CLI emits `system task_started/task_progress/task_notification` messages
 * inline in the main session stream while sub-agents run. SDKSessionManager
 * normalizes those raw SDK messages into `SubAgentEvent` and emits them via
 * the `onSubAgentEvent` callback. SubAgentMessageManager consumes the events
 * and maintains a per-task Discord/Telegram message that gets edited as the
 * sub-agent progresses, so users see one persistent message per sub-agent
 * instead of a stream of intermediate text messages.
 */

/** Lifecycle states of a sub-agent's status message. */
export type SubAgentLifecycle = 'started' | 'progress' | 'completed' | 'failed';

/**
 * Normalized event emitted by the SDK layer when a sub-agent message arrives.
 * Short-lived; consumed once by the manager and folded into the persistent record.
 */
export interface SubAgentEvent {
  taskId: string;
  lifecycle: SubAgentLifecycle;
  description: string;
  /** Tool name currently executing inside the sub-agent (progress events). */
  toolName?: string;
  /** Wall-clock duration since started, or duration_ms reported by the CLI. */
  durationMs?: number;
  totalTokens?: number;
  toolUses?: number;
  /** Path to the sub-agent's output file (notification only). */
  outputFile?: string;
  /** Sub-agent completion summary (notification only). */
  summary?: string;
}

/**
 * Persistent state held by SubAgentMessageManager — one record per sub-agent.
 * Updated by `merge`; rendered by the formatter.
 */
export interface SubAgentRecord {
  taskId: string;
  /** ID of the chat message we keep editing for this sub-agent. */
  messageId: string;
  description: string;
  startedAt: number;
  lastTool?: string;
  totalTokens?: number;
  toolUses?: number;
  lifecycle: SubAgentLifecycle;
  /** Last time we sent updateStatusMessage — used for debouncing. */
  lastEditAt: number;
  /** Notification-only fields, surfaced once available. */
  summary?: string;
  outputFile?: string;
}

/**
 * Renders a record into the chat-message string. Pulled out so display style
 * can be swapped without touching the manager's logic.
 */
export type SubAgentFormatter = (record: SubAgentRecord) => string;
