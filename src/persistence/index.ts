/**
 * Persistence module exports
 */

export { DatabaseManager } from './DatabaseManager.js';
export type { DatabaseManagerOptions } from './DatabaseManager.js';

export { SessionRepository } from './SessionRepository.js';
export { ConversationRepository } from './ConversationRepository.js';
export { GroupMessageRepository } from './GroupMessageRepository.js';
export { InjectionStateRepository } from './InjectionStateRepository.js';
export { GroupMemberRepository } from './GroupMemberRepository.js';

export type {
  SessionRow,
  ConversationRow,
  GroupMessageRow,
  GroupMemberRow,
  InjectionStateRow,
  ISessionRepository,
  IConversationRepository,
  IGroupMessageRepository,
  IGroupMemberRepository,
  IInjectionStateRepository,
  PersistenceConfig,
} from './types.js';

export {
  DEFAULT_PERSISTENCE_CONFIG,
  serializeMessageIds,
  deserializeMessageIds,
  dateToString,
  stringToDate,
} from './types.js';
