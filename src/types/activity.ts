/**
 * Activity Event types for the "Characters Come Alive" system (v2.0).
 * All bot behaviors emit ActivityEvents for frontend rendering.
 */

/** Phases of agent activity lifecycle */
export type ActivityPhase =
  | 'task_received'
  | 'working'
  | 'tool_use'
  | 'completed'
  | 'error'
  | 'idle';

/** Agent mood states */
export type ActivityMood =
  | 'neutral'
  | 'excited'
  | 'annoyed'
  | 'tired'
  | 'focused'
  | 'bored';

/** Operational event types for system-level visibility (schedule, budget, errors) */
export type OperationalEventType =
  | 'chat.received'
  | 'chat.responded'
  | 'schedule.started'
  | 'schedule.completed'
  | 'schedule.failed'
  | 'budget.warning'
  | 'budget.exceeded'
  | 'task.created'
  | 'task.completed'
  | 'error.occurred'
  | 'session.silent_failure'
  | 'session.delivery_failed'
  | 'session.zombie_recovered'
  | 'session.zombie_retry_disabled'
  | 'session.empty_stream_retry_disabled'
  | 'session.resume_empty'
  | 'session.resume_lost'
  | 'session.error'
  | 'session.guard_timeout'
  | 'session.guard_switch'
  | 'session.cache_bust'
  | 'session.high_cost'
  | 'session.rate_limit'
  | 'session.keepalive_failed'
  | 'schedule.auto_paused'
  | 'system.adapter_failed'
  | 'system.message_error';

/** Structured operational event for logging and notification */
export interface OperationalEvent {
  type: OperationalEventType;
  agentId: string;
  message: string;
  details?: string;
  links?: Array<{ label: string; url: string }>;
  level?: 'info' | 'warn' | 'error';
  metadata?: Record<string, unknown> | undefined;
}

/** Structured activity event emitted by all agent behaviors */
export interface ActivityEvent {
  /** Unique event ID */
  id: string;
  /** Agent ID (e.g. 'general', 'coder', 'leader') */
  agentId: string;
  /** Agent display name */
  agentName: string;
  /** Event type */
  type: 'reaction' | 'mutter' | 'status_change' | 'workflow' | 'reply';
  /** Lifecycle phase */
  phase?: ActivityPhase;
  /** Personality-driven message (the "voice" of the agent) */
  message: string;
  /** Current mood */
  mood?: ActivityMood;
  /** ISO timestamp */
  timestamp: string;
  /** Additional context (tool name, error info, task content, etc.) */
  metadata?: Record<string, unknown>;
}
