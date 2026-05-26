import type { LoadedAgent } from './agent.js';
import type { UserSession } from './session.js';
import type { ClaudeCabError } from './errors.js';
import type { UnifiedMessage } from './message.js';
import type { ConnectionState } from './message.js';

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

  /** Fired when Discord connection health state changes */
  'connection:healthChanged': {
    agentId: string;
    previousState: ConnectionState;
    newState: ConnectionState;
    details: { consecutiveFailures: number; recentP95Ms: number };
  };
}

/**
 * Payload for group:message event (multi-bot broadcast)
 */
export interface GroupMessagePayload {
  /** The unified message */
  message: UnifiedMessage;

  /** Agent ID that received this message from Discord */
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

  /** Platform, currently 'discord' */
  platform: string;

  /** Platform-specific message ID of the reply (for context injection tracking) */
  replyMessageId?: string;
}

/**
 * Payload for message:sent event
 */
interface MessageSentPayload {
  chatId: string;
  text: string;
  platform: string;
  userId: string;
  agentId?: string;
}

/**
 * Payload for session:closed event
 */
interface SessionClosedPayload {
  sessionId: string;
  reason: 'timeout' | 'user_request' | 'error' | 'agent_switch';
  platform: string;
  userId: string;
}

/**
 * Payload for session:switched event
 */
interface SessionSwitchedPayload {
  oldAgentId: string;
  newAgentId: string;
  sessionId: string;
  platform: string;
  userId: string;
}

/**
 * Payload for session:stateChanged event
 */
interface SessionStateChangedPayload {
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
const EVENT_NAMES: EventName[] = [
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
  'connection:healthChanged',
];
