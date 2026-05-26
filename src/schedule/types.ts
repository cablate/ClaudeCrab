/**
 * Schedule System Types
 *
 * Additional types for the scheduling system.
 */

import type { ScheduleSpec } from './schemas.js';

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
 * Execution record stored in database
 */
export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  startedAt: string;
  completedAt?: string | undefined;
  success?: boolean | undefined;
  durationMs?: number | undefined;
  resultSummary?: string | undefined;
  errorMessage?: string | undefined;
}

/**
 * Scheduled task record in database
 */
export interface ScheduledTask {
  id: string;
  agentId: string;
  name: string;
  description?: string | undefined;
  triggerType: string;
  triggerConfig: string; // JSON
  executionConfig: string; // JSON
  notificationConfig?: string | undefined; // JSON
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Schedule info for display
 */
export interface ScheduleInfo {
  spec: ScheduleSpec;
  agentId: string;
  nextRun?: Date | undefined;
  lastExecution?: ScheduleExecution | undefined;
  isRunning: boolean;
}

/**
 * Schedule creation options
 */
export interface CreateScheduleOptions {
  agentId: string;
  name: string;
  description?: string;
  cronExpression: string;
  timezone?: string;
  prompt: string;
  maxTurns?: number;
  timeout?: number;
  notifyOnComplete?: boolean;
  notifyOnError?: boolean;
  notifyChatId?: string;
  /** Notification delivery platform. Discord is the only supported value. */
  notifyPlatform?: 'discord';
  tags?: string[];
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
