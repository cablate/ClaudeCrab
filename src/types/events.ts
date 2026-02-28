import type { LoadedAgent } from './agent.js';
import type { UserSession } from './session.js';
import type { ClaudeCabError } from './errors.js';
import type { UnifiedMessage } from '../adapters/types.js';

// ADR-019: ObserveMode removed - only @mentioned bot processes, no silent mode

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

  /** Fired when a group message is received (for multi-bot broadcast) */
  'group:message': GroupMessagePayload;

  /** Fired when a bot replies in a group chat (for broadcasting to other bots) */
  'bot:replied': BotRepliedPayload;

  /** Fired when an agent activity occurs (v2.0 Characters Come Alive) */
  'activity': import('./activity.js').ActivityEvent;

  /** Fired when an interactive prompt needs user response (ADR-033) */
  'interaction': InteractionEvent;
}

/**
 * Payload for group:message event (multi-bot broadcast)
 */
export interface GroupMessagePayload {
  /** The unified message */
  message: UnifiedMessage;

  /** Agent ID that received this message from Telegram */
  sourceAgentId: string;

  /** Bot username mentioned in the message (without @), or null */
  mentionedBot: string | null;

  /** Whether this message is a reply to the source bot */
  isReplyToBot: boolean;
}

/**
 * Payload for bot:replied event (for broadcasting bot replies to other bots)
 */
export interface BotRepliedPayload {
  /** Chat ID where the reply was sent */
  chatId: string;

  /** Agent ID of the bot that replied */
  agentId: string;

  /** The response text (already labeled with [@bot_username]) */
  response: string;

  /** Platform (e.g., 'telegram') */
  platform: string;

  /** Platform-specific message ID of the reply (for context injection tracking) */
  replyMessageId?: string;

  /** Current delegation depth (0 = user-initiated, 1+ = auto-delegated) (ADR-021) */
  delegationDepth?: number;

  /** Chain of agentIds in this delegation sequence, for cycle detection (ADR-021) */
  delegationChain?: string[];

  /** ADR-023: Whether this reply was triggered by bot initiative */
  isInitiative?: boolean;

  /** ADR-030: Whether this reply is a synthesis of parallel delegation results */
  isSynthesis?: boolean;

  /** ADR-030: Whether this reply was triggered by social mode (no delegation) */
  isSocial?: boolean;
}

/**
 * Payload for message:sent event
 */
export interface MessageSentPayload {
  chatId: string;
  text: string;
  platform: string;
  userId: string;
  agentId?: string;
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
 * Interactive prompt event (ADR-033: Web UI galgame-style choices)
 */
export interface InteractionEvent {
  type: 'permission_request' | 'question_request' | 'plan_review_request';
  requestId: string;
  agentId: string;
  // Permission fields
  toolName?: string;
  decisionReason?: string;
  // Question fields
  question?: string;
  header?: string;
  options?: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
  // Plan review fields
  allowedPrompts?: Array<{ tool: string; prompt: string }> | undefined;
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
  'group:message',
  'bot:replied',
  'interaction',
];
