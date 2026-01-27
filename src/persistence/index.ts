/**
 * Persistence module exports
 */

export { DatabaseManager } from './DatabaseManager.js';
export type { DatabaseManagerOptions } from './DatabaseManager.js';

export { SessionRepository } from './SessionRepository.js';
export { ConversationRepository } from './ConversationRepository.js';

export type {
  SessionRow,
  ConversationRow,
  ISessionRepository,
  IConversationRepository,
  PersistenceConfig,
} from './types.js';

export {
  DEFAULT_PERSISTENCE_CONFIG,
  serializeMessageIds,
  deserializeMessageIds,
  dateToString,
  stringToDate,
} from './types.js';
