import type { LoadedAgent } from './agent.js';
import type { UserSession } from './session.js';
import type { ClaudeCabError } from './errors.js';
import type { UnifiedMessage } from '../adapters/types.js';

/**
 * Event map defining all system events and their payloads
 */
export interface EventMap {
  /** Fired when a message is received from any adapter */
  'message:received': UnifiedMessage;

  /** Fired when a message is sent to a user */
  'message:sent': MessageSentPayload;

  /** Fired when a new session is created */
  'session:created': UserSession;

  /** Fired when a session is closed */
  'session:closed': SessionClosedPayload;

  /** Fired when a user switches to a different agent */
  'session:switched': SessionSwitchedPayload;

  /** Fired when session state changes */
  'session:stateChanged': SessionStateChangedPayload;

  /** Fired when an agent is loaded */
  'agent:loaded': LoadedAgent;

  /** Fired when an agent is reloaded (hot reload) */
  'agent:reloaded': LoadedAgent;

  /** Fired when a system error occurs */
  error: ClaudeCabError;
}

/**
 * Payload for message:sent event
 */
export interface MessageSentPayload {
  chatId: string;
  text: string;
  platform: string;
  userId: string;
}

/**
 * Payload for session:closed event
 */
export interface SessionClosedPayload {
  sessionId: string;
  reason: 'timeout' | 'user_request' | 'error' | 'agent_switch';
  platform: string;
  userId: string;
}

/**
 * Payload for session:switched event
 */
export interface SessionSwitchedPayload {
  oldAgentId: string;
  newAgentId: string;
  sessionId: string;
  platform: string;
  userId: string;
}

/**
 * Payload for session:stateChanged event
 */
export interface SessionStateChangedPayload {
  sessionId: string;
  previousState: 'idle' | 'processing' | 'error';
  newState: 'idle' | 'processing' | 'error';
}

/**
 * Event handler type
 */
export type EventHandler<K extends keyof EventMap> = (
  payload: EventMap[K]
) => void | Promise<void>;

/**
 * All event names as a type
 */
export type EventName = keyof EventMap;

/**
 * List of all event names
 */
export const EVENT_NAMES: EventName[] = [
  'message:received',
  'message:sent',
  'session:created',
  'session:closed',
  'session:switched',
  'session:stateChanged',
  'agent:loaded',
  'agent:reloaded',
  'error',
];
