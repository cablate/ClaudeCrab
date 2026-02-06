import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AgentLoader } from '../core/AgentLoader.js';
import type { SessionManager } from '../core/SessionManager.js';
import type { PlatformOrchestrator } from '../core/PlatformOrchestrator.js';
import type { DatabaseManager } from '../persistence/DatabaseManager.js';
import type { ISessionRepository, IConversationRepository } from '../persistence/types.js';
import type { ScheduleManager } from '../schedule/ScheduleManager.js';
import type { MonitoringService } from './services/MonitoringService.js';
import type { IQueryMetricsRepository } from '../persistence/types.js';

/**
 * WebUI Server configuration options
 */
export interface WebUIServerOptions {
  port: number;
  agentLoader: AgentLoader;
  sessionManager: SessionManager;
  platformOrchestrator: PlatformOrchestrator | undefined;
  databaseManager: DatabaseManager | undefined;
  sessionRepository: ISessionRepository | undefined;
  conversationRepository: IConversationRepository | undefined;
  scheduleManager: ScheduleManager | undefined;
  queryMetricsRepository: IQueryMetricsRepository | undefined;
}

/**
 * Dependencies injected into routes and controllers
 */
export interface WebUIDependencies {
  agentLoader: AgentLoader;
  sessionManager: SessionManager;
  platformOrchestrator: PlatformOrchestrator | undefined;
  databaseManager: DatabaseManager | undefined;
  sessionRepository: ISessionRepository | undefined;
  conversationRepository: IConversationRepository | undefined;
  scheduleManager: ScheduleManager | undefined;
  monitoringService: MonitoringService | undefined;
  queryMetricsRepository: IQueryMetricsRepository | undefined;
}

/**
 * Extended Express Request with dependencies
 */
export interface WebUIRequest extends Request {
  dependencies: WebUIDependencies;
}

/**
 * JWT Payload structure
 */
export interface JWTPayload {
  authenticated: boolean;
  iat: number;
  exp: number;
}

/**
 * Table column definition for reusable table component
 */
export interface TableColumn {
  key: string;
  label: string;
  component?: string;
  format?: (value: unknown) => string;
}

/**
 * Table action definition
 */
export interface TableAction {
  type: 'view' | 'delete' | 'custom';
  label?: string;
  href?: (row: Record<string, unknown>) => string;
  confirmMessage?: string;
}

/**
 * Card component props
 */
export interface CardProps {
  title: string;
  value: string | number;
  icon?: string;
  trend?: {
    direction: 'up' | 'down' | 'neutral';
    value: string;
  };
}

/**
 * Alert message for flash messages
 */
export interface AlertMessage {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

/**
 * Pagination info
 */
export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
}

/**
 * Dashboard statistics
 */
export interface DashboardStats {
  totalAgents: number;
  activeSessions: number;
  totalSessions: number;
  totalConversations: number;
  systemStatus: 'running' | 'error' | 'degraded';
}

/**
 * Async request handler type for cleaner error handling
 */
export type AsyncRequestHandler = (
  req: WebUIRequest,
  res: Response,
  next: NextFunction
) => Promise<void>;

/**
 * Wrap async handler to catch errors
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as WebUIRequest, res, next)).catch(next);
  };
}


/**
 * Request body for creating a new agent
 */
export interface CreateAgentRequest {
  id: string;
  name: string;
  description: string;
  model: 'sonnet' | 'opus' | 'haiku';
  telegramBotToken?: string;
  permissions?: {
    allow: string[];
    deny: string[];
  };
}

/**
 * Response for agent creation
 */
export interface CreateAgentResponse {
  success: boolean;
  agent?: {
    id: string;
    name: string;
    path: string;
  };
  error?: string;
}


/**
 * Request body for updating an existing agent
 */
export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  model?: 'sonnet' | 'opus' | 'haiku';
  telegramBotToken?: string | null; // null to remove

  // SDK permissions (settings.local.json level — auto-approve tools)
  permissions?: { allow: string[]; deny: string[] };

  // Model parameters
  maxTokens?: number | null;
  maxThinkingTokens?: number | null;

  // MCP config
  mcpConfigFile?: string | null;

  // Agent settings
  settings?: {
    permissionMode?: string | null;
    maxTurns?: number | null;
    delegation?: {
      inbound?: boolean;
      outbound?: boolean;
    } | null;
    initiative?: {
      enabled?: boolean;
      mode?: string;
      cooldown?: number;
      maxPerHour?: number;
    } | null;
  };
}

/**
 * Response for agent update
 */
export interface UpdateAgentResponse {
  success: boolean;
  agent?: {
    id: string;
    name: string;
    path: string;
  };
  error?: string;
}


/**
 * Memory file information
 */
export interface MemoryFile {
  name: string;
  path: string;
  description: string;
  modified: string | null;
  size: number;
}

/**
 * Response for listing memory files
 */
export interface MemoryListResponse {
  coreFiles: MemoryFile[];
  dailyLogs: MemoryFile[];
}

/**
 * Response for reading a memory file
 */
export interface MemoryContentResponse {
  filename: string;
  content: string;
  modified: string | null;
}

/**
 * Request for updating a memory file
 */
export interface UpdateMemoryRequest {
  content: string;
}

/**
 * Response for updating a memory file
 */
export interface UpdateMemoryResponse {
  success: boolean;
  modified?: string;
  error?: string;
}


/**
 * Skill information
 */
export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  modified: string | null;
}

/**
 * Response for listing skills
 */
export interface SkillListResponse {
  skills: SkillInfo[];
}

/**
 * Response for reading a skill
 */
export interface SkillContentResponse {
  name: string;
  content: string;
  modified: string | null;
}

/**
 * Request for updating a skill
 */
export interface UpdateSkillRequest {
  content: string;
}

/**
 * Response for skill operations
 */
export interface SkillOperationResponse {
  success: boolean;
  skill?: SkillInfo;
  error?: string;
}
