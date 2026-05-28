/**
 * Persistence module exports
 */

export { DatabaseManager } from './DatabaseManager.js';
export type { DatabaseManagerOptions } from './DatabaseManager.js';

export { SessionRepository } from './SessionRepository.js';
export { ConversationRepository } from './ConversationRepository.js';
export { QueryMetricsRepository } from './QueryMetricsRepository.js';
export { RateLimitRepository } from './RateLimitRepository.js';
export type { RateLimitSnapshotRow, RateLimitRecordParams, RateLimitSessionDelta, WeekOverWeekGrowth } from './RateLimitRepository.js';

export type {
  SessionRow,
  ConversationRow,
  QueryMetricRawRow,
  QueryMetricRow,
  AgentUsageStats,
  DailyUsageStats,
  KeepaliveStats,
  WeeklyUsageStats,
  WeekOverWeekQueryGrowth,
  ISessionRepository,
  IConversationRepository,
  IQueryMetricsRepository,
  PersistenceConfig,
} from './types.js';

export {
  DEFAULT_PERSISTENCE_CONFIG,
  serializeMessageIds,
  deserializeMessageIds,
  dateToString,
  stringToDate,
} from './types.js';
