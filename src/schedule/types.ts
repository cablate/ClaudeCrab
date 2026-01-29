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
  tags?: string[];
}
