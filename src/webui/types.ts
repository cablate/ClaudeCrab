import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AgentLoader } from '../core/AgentLoader.js';
import type { SessionManager } from '../core/SessionManager.js';
import type { PlatformOrchestrator } from '../core/PlatformOrchestrator.js';
import type { DatabaseManager } from '../persistence/DatabaseManager.js';
import type { ISessionRepository, IConversationRepository } from '../persistence/types.js';

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
