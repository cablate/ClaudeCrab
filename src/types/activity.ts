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

/** Structured activity event emitted by all agent behaviors */
export interface ActivityEvent {
  /** Unique event ID */
  id: string;
  /** Agent ID (e.g. 'general', 'coder', 'leader') */
  agentId: string;
  /** Agent display name */
  agentName: string;
  /** Event type */
  type: 'reaction' | 'mutter' | 'status_change' | 'workflow';
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

/** Agent display configuration (from agent.json) */
export interface AgentDisplayConfig {
  avatar: string;
  color: string;
}
