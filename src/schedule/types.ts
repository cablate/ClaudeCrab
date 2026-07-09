/**
 * Schedule System Types
 *
 * Additional types for the scheduling system.
 */

// Re-export ScheduleSpec for convenience
export type { ScheduleSpec } from './schemas.js';

/**
 * Result of a schedule execution
 */
export interface ExecutionResult {
  success: boolean;
  duration: number; // ms
  result?: unknown;
  error?: unknown;
}

/**
 * Thread mapping for schedule output threads.
 * Maps a Discord thread ID to its schedule session for follow-up conversations.
 */
export interface ScheduleThreadMapping {
  /** Discord thread ID */
  threadId: string;
  /** Platform name. Retained for persisted records and logs. */
  platform: 'discord';
  /** Agent that executed the schedule */
  agentId: string;
  /** Schedule spec ID */
  scheduleId: string;
  /** SDK session ID for resuming conversation */
  sdkSessionId: string;
  /** Chat ID where the thread lives */
  chatId: string;
  /** When the thread was created */
  createdAt: Date;
  /** Last interaction timestamp */
  lastActiveAt: Date;
}
