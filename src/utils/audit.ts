import { logger } from './logger.js';
import type { UnifiedMessage } from '../types/message.js';

/**
 * Audit event types
 */
export type AuditEventType =
  | 'user:message'
  | 'user:command'
  | 'user:unauthorized'
  | 'bot:response'
  | 'bot:error'
  | 'session:created'
  | 'session:switched'
  | 'session:reset'
  | 'security:validation_failed'
  | 'security:injection_detected'
  | 'tool:called'
  | 'tool:completed'
  | 'tool:failed';

/**
 * Base audit event structure
 */
export interface AuditEvent {
  /** Event type */
  type: AuditEventType;

  /** ISO timestamp */
  timestamp: string;

  /** Platform, currently discord */
  platform: string;

  /** User ID */
  userId: string;

  /** Session ID (if applicable) */
  sessionId?: string | undefined;

  /** Chat/conversation ID */
  chatId?: string | undefined;

  /** Event-specific data */
  data?: Record<string, unknown> | undefined;

  /** Event outcome */
  outcome?: 'success' | 'failure' | 'warning' | undefined;

  /** Error message (if applicable) */
  error?: string | undefined;
}

/**
 * Audit logger for security and compliance
 */
class AuditLogger {
  private enabled: boolean;

  constructor() {
    this.enabled = true;
  }

  configure(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Log an audit event
   */
  log(event: Omit<AuditEvent, 'timestamp'>): void {
    if (!this.enabled) {
      return;
    }

    const fullEvent: AuditEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    // Use structured logging with pino
    logger.info(
      {
        audit: true,
        event: fullEvent,
      },
      `[AUDIT] ${event.type}`
    );
  }

  /**
   * Log user message received
   */
  logUserMessage(message: UnifiedMessage, sessionId?: string): void {
    this.log({
      type: 'user:message',
      platform: message.platform,
      userId: message.userId,
      chatId: message.chatId,
      sessionId,
      data: {
        messageId: message.id,
        textLength: message.text.length,
        hasReplyTo: !!message.metadata?.replyToMessageId,
      },
      outcome: 'success',
    });
  }

  /**
   * Log user command
   */
  logUserCommand(
    platform: string,
    userId: string,
    command: string,
    args?: string,
    sessionId?: string
  ): void {
    this.log({
      type: 'user:command',
      platform,
      userId,
      sessionId,
      data: {
        command,
        args,
      },
      outcome: 'success',
    });
  }

  /**
   * Log unauthorized access attempt
   */
  logUnauthorizedAccess(
    platform: string,
    userId: string,
    chatId?: string
  ): void {
    this.log({
      type: 'user:unauthorized',
      platform,
      userId,
      chatId,
      outcome: 'failure',
    });
  }

  /**
   * Log bot response sent
   */
  logBotResponse(
    platform: string,
    userId: string,
    chatId: string,
    responseLength: number,
    sessionId?: string
  ): void {
    this.log({
      type: 'bot:response',
      platform,
      userId,
      chatId,
      sessionId,
      data: {
        responseLength,
      },
      outcome: 'success',
    });
  }

  /**
   * Log bot error
   */
  logBotError(
    platform: string,
    userId: string,
    error: string,
    sessionId?: string
  ): void {
    this.log({
      type: 'bot:error',
      platform,
      userId,
      sessionId,
      error,
      outcome: 'failure',
    });
  }

  /**
   * Log session created
   */
  logSessionCreated(
    platform: string,
    userId: string,
    sessionId: string,
    agentId: string
  ): void {
    this.log({
      type: 'session:created',
      platform,
      userId,
      sessionId,
      data: {
        agentId,
      },
      outcome: 'success',
    });
  }

  /**
   * Log session reset
   */
  logSessionReset(
    platform: string,
    userId: string,
    sessionId: string
  ): void {
    this.log({
      type: 'session:reset',
      platform,
      userId,
      sessionId,
      outcome: 'success',
    });
  }

  /**
   * Log security validation failure
   */
  logValidationFailed(
    platform: string,
    userId: string,
    reason: string,
    chatId?: string
  ): void {
    this.log({
      type: 'security:validation_failed',
      platform,
      userId,
      chatId,
      data: {
        reason,
      },
      outcome: 'failure',
    });
  }

  /**
   * Log prompt injection detected
   */
  logInjectionDetected(
    platform: string,
    userId: string,
    patterns: string[],
    chatId?: string
  ): void {
    this.log({
      type: 'security:injection_detected',
      platform,
      userId,
      chatId,
      data: {
        patternCount: patterns.length,
        patterns: patterns.slice(0, 3), // Only log first 3 patterns
      },
      outcome: 'warning',
    });
  }

  /**
   * Log tool call initiated
   */
  logToolCalled(
    platform: string,
    userId: string,
    sessionId: string,
    toolName: string,
    toolInput?: Record<string, unknown>
  ): void {
    this.log({
      type: 'tool:called',
      platform,
      userId,
      sessionId,
      data: {
        toolName,
        hasInput: !!toolInput,
      },
      outcome: 'success',
    });
  }

  /**
   * Log tool call completed
   */
  logToolCompleted(
    platform: string,
    userId: string,
    sessionId: string,
    toolName: string,
    durationMs: number
  ): void {
    this.log({
      type: 'tool:completed',
      platform,
      userId,
      sessionId,
      data: {
        toolName,
        durationMs,
      },
      outcome: 'success',
    });
  }

  /**
   * Log tool call failed
   */
  logToolFailed(
    platform: string,
    userId: string,
    sessionId: string,
    toolName: string,
    error: string
  ): void {
    this.log({
      type: 'tool:failed',
      platform,
      userId,
      sessionId,
      data: {
        toolName,
      },
      error,
      outcome: 'failure',
    });
  }
}

/**
 * Singleton audit logger instance
 */
export const auditLogger = new AuditLogger();
