/**
 * Base error class for ClaudeCab
 * All custom errors should extend this class
 */
export class ClaudeCabError extends Error {
  constructor(
    message: string,
    /** Error code for programmatic handling */
    public readonly code: string,
    /** Whether the error is recoverable */
    public readonly recoverable: boolean,
    /** User-friendly error message */
    public readonly userMessage?: string,
    /** Original error that caused this error */
    public override readonly cause?: Error
  ) {
    super(message);
    this.name = 'ClaudeCabError';

    // Maintains proper stack trace for where error was thrown
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      recoverable: this.recoverable,
      userMessage: this.userMessage,
      cause: this.cause?.message,
      stack: this.stack,
    };
  }
}

/**
 * Error thrown when agent loading fails
 */
export class AgentLoadError extends ClaudeCabError {
  constructor(
    public readonly agentId: string,
    cause: Error
  ) {
    super(
      `Failed to load agent "${agentId}": ${cause.message}`,
      'AGENT_LOAD_FAILED',
      true,
      '代理載入失敗，請檢查配置',
      cause
    );
    this.name = 'AgentLoadError';
  }
}

/**
 * Error thrown when agent configuration is invalid
 */
export class AgentConfigError extends ClaudeCabError {
  constructor(
    public readonly agentId: string,
    public readonly validationErrors: string[]
  ) {
    super(
      `Invalid configuration for agent "${agentId}": ${validationErrors.join(', ')}`,
      'AGENT_CONFIG_INVALID',
      true,
      '代理配置無效，請檢查 agent.json'
    );
    this.name = 'AgentConfigError';
  }
}

/**
 * Error thrown when agent is not found
 */
export class AgentNotFoundError extends ClaudeCabError {
  constructor(public readonly agentId: string) {
    super(
      `Agent "${agentId}" not found`,
      'AGENT_NOT_FOUND',
      true,
      `找不到代理 "${agentId}"`
    );
    this.name = 'AgentNotFoundError';
  }
}

/**
 * Session error codes
 */
export type SessionErrorCode = 'NOT_FOUND' | 'SDK_ERROR' | 'TIMEOUT' | 'LOCKED';

/**
 * Error thrown for session-related issues
 */
export class SessionError extends ClaudeCabError {
  constructor(
    public readonly sessionErrorCode: SessionErrorCode,
    message: string
  ) {
    super(
      message,
      `SESSION_${sessionErrorCode}`,
      sessionErrorCode !== 'SDK_ERROR',
      '對話處理失敗'
    );
    this.name = 'SessionError';
  }
}

/**
 * Error thrown when rate limited
 */
export class RateLimitError extends ClaudeCabError {
  constructor(
    /** Time to wait before retrying in milliseconds */
    public readonly retryAfter: number
  ) {
    super(
      `Rate limited, retry after ${retryAfter}ms`,
      'RATE_LIMITED',
      true,
      '請求過於頻繁，請稍後再試'
    );
    this.name = 'RateLimitError';
  }
}

/**
 * Error thrown when adapter operations fail
 */
export class AdapterError extends ClaudeCabError {
  constructor(
    public readonly platform: string,
    message: string,
    cause?: Error
  ) {
    super(
      `[${platform}] ${message}`,
      'ADAPTER_ERROR',
      true,
      '訊息傳送失敗',
      cause
    );
    this.name = 'AdapterError';
  }
}

export class STTError extends ClaudeCabError {
  constructor(message: string, cause?: Error) {
    super(
      message,
      'STT_TRANSCRIPTION_FAILED',
      true,
      '語音轉換失敗，請重新嘗試或改用文字輸入。',
      cause
    );
    this.name = 'STTError';
  }
}

export class TTSError extends ClaudeCabError {
  constructor(message: string, cause?: Error) {
    super(
      message,
      'TTS_SYNTHESIS_FAILED',
      true,
      '語音合成失敗，請重新嘗試。',
      cause
    );
    this.name = 'TTSError';
  }
}


/**
 * Error thrown for validation failures
 */
export class ValidationError extends ClaudeCabError {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message, 'VALIDATION_ERROR', true, '輸入驗證失敗');
    this.name = 'ValidationError';
  }
}

/**
 * Processing error codes
 */
export type ProcessingErrorCode =
  | 'PROCESSING_FAILED'
  | 'TIMEOUT'
  | 'SDK_ERROR'
  | 'INVALID_RESPONSE';

/**
 * Error thrown during message processing
 */
export class ProcessingError extends ClaudeCabError {
  constructor(
    public readonly processingErrorCode: ProcessingErrorCode,
    message: string,
    cause?: Error
  ) {
    super(
      message,
      `PROCESSING_${processingErrorCode}`,
      processingErrorCode !== 'SDK_ERROR',
      '訊息處理失敗',
      cause
    );
    this.name = 'ProcessingError';
  }
}

/**
 * Check if an error is a ClaudeCabError
 */
export function isClaudeCabError(error: unknown): error is ClaudeCabError {
  return error instanceof ClaudeCabError;
}

