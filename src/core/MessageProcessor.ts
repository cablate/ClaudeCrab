import Anthropic from '@anthropic-ai/sdk';
import type { UnifiedMessage } from '../adapters/types.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import { SessionManager } from './SessionManager.js';
import { SDKQueryManager } from './SDKQueryManager.js';
import { logger } from '../utils/logger.js';
import { ProcessingError } from '../types/errors.js';
import {
  retryAsync,
  API_RETRY_OPTIONS,
  isRateLimitError,
  isTransientError,
} from '../utils/retry.js';
import type { IConversationRepository } from '../persistence/types.js';

/**
 * Conversation message for Claude API (legacy mode)
 */
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Options for MessageProcessor
 */
export interface MessageProcessorOptions {
  /** Session manager instance */
  sessionManager: SessionManager;

  /** Adapter registry to get adapters for sending responses */
  getAdapter: (platform: string, agentId: string) => BaseAdapter | undefined;

  /** Whether to send typing indicators */
  sendTypingIndicators?: boolean;

  /** Interval for typing indicators in ms */
  typingIndicatorIntervalMs?: number;

  /** Anthropic API key (defaults to ANTHROPIC_API_KEY env var) - used in legacy mode */
  apiKey?: string;

  /** Optional conversation repository for persistence - used in legacy mode */
  conversationRepository?: IConversationRepository | undefined;

  /**
   * Use Claude Agent SDK instead of direct Anthropic API.
   * When enabled:
   * - Uses SDK's query() function with automatic setting loading
   * - Conversation history managed by SDK (resume option)
   * - ConversationRepository is not used
   *
   * @default true (can be overridden by USE_CLAUDE_AGENT_SDK env var)
   */
  useClaudeAgentSDK?: boolean;
}

/**
 * Result of processing a message
 */
export interface ProcessingResult {
  /** Whether processing was successful */
  success: boolean;

  /** Response text sent to user */
  response?: string;

  /** Error message if failed */
  error?: string;

  /** Whether the message was skipped (duplicate) */
  skipped?: boolean;

  /** Session ID used for processing */
  sessionId?: string;
}

/**
 * Internal session data with conversation history (legacy mode)
 */
interface SessionConversation {
  messages: ConversationMessage[];
}

/**
 * Processes incoming messages and sends responses via adapters.
 *
 * Supports two modes:
 * 1. SDK Mode (default): Uses Claude Agent SDK with automatic setting loading
 *    and SDK-managed conversation history (via resume option)
 * 2. Legacy Mode: Uses direct Anthropic API with manual conversation management
 */
export class MessageProcessor {
  private readonly sessionManager: SessionManager;
  private readonly getAdapter: (platform: string, agentId: string) => BaseAdapter | undefined;
  private readonly sendTypingIndicators: boolean;
  private readonly typingIndicatorIntervalMs: number;
  private readonly useClaudeAgentSDK: boolean;

  // SDK mode
  private readonly sdkQueryManager: SDKQueryManager | null;

  // Legacy mode
  private readonly client: Anthropic | null;
  private readonly conversationRepository: IConversationRepository | undefined;
  private readonly conversations: Map<string, SessionConversation> = new Map();
  private readonly maxConversationLength = 20;

  constructor(options: MessageProcessorOptions) {
    this.sessionManager = options.sessionManager;
    this.getAdapter = options.getAdapter;
    this.sendTypingIndicators = options.sendTypingIndicators ?? true;
    this.typingIndicatorIntervalMs = options.typingIndicatorIntervalMs ?? 5000;

    // Determine mode from option or environment variable
    const envSetting = process.env.USE_CLAUDE_AGENT_SDK;
    this.useClaudeAgentSDK = options.useClaudeAgentSDK ??
      (envSetting === undefined ? true : envSetting !== 'false');

    if (this.useClaudeAgentSDK) {
      // SDK mode
      this.sdkQueryManager = new SDKQueryManager();
      this.client = null;
      this.conversationRepository = undefined;

      logger.info('MessageProcessor initialized in SDK mode');
    } else {
      // Legacy mode
      this.sdkQueryManager = null;
      this.client = new Anthropic({
        apiKey: options.apiKey,
      });
      this.conversationRepository = options.conversationRepository;

      logger.info('MessageProcessor initialized in legacy mode');
    }
  }

  /**
   * Process an incoming message
   */
  async processMessage(message: UnifiedMessage, agentId: string): Promise<ProcessingResult> {
    const { platform, userId, chatId, text, id: messageId } = message;

    logger.debug(
      { platform, userId, agentId, messageId },
      'Processing message'
    );

    // Check for duplicate message (idempotency)
    if (this.sessionManager.isMessageProcessed(platform, agentId, userId, messageId)) {
      logger.debug({ messageId }, 'Skipping duplicate message');
      return { success: true, skipped: true };
    }

    // Get or create session
    let session;
    try {
      session = await this.sessionManager.getOrCreateSession({
        platform,
        userId,
        agentId,
      });
    } catch (error) {
      logger.error({ error, platform, userId, agentId }, 'Failed to get/create session');
      return {
        success: false,
        error: `Failed to create session: ${(error as Error).message}`,
      };
    }

    // Get adapter for sending response
    const adapter = this.getAdapter(platform, agentId);
    if (adapter === undefined) {
      logger.error({ platform, agentId }, 'No adapter found for platform and agent');
      return { success: false, error: `No adapter for platform: ${platform}, agent: ${agentId}` };
    }

    // Process with lock to prevent concurrent processing
    try {
      const result = await this.sessionManager.withLock(
        platform,
        agentId,
        userId,
        async () => {
          // Mark message as processed (before processing to prevent duplicates)
          this.sessionManager.markMessageProcessed(platform, agentId, userId, messageId);

          // Update session state
          this.sessionManager.updateState(platform, agentId, userId, 'processing');

          try {
            // Process the message using appropriate mode
            const response = this.useClaudeAgentSDK
              ? await this.executeQueryWithSDK(session.sessionId, text, adapter, chatId, platform, agentId, userId)
              : await this.executeQueryLegacy(session.sessionId, text, adapter, chatId);

            // Update session state back to idle
            this.sessionManager.updateState(platform, agentId, userId, 'idle');

            return {
              success: true,
              response,
              sessionId: session.sessionId,
            };
          } catch (error) {
            // Update session state to error
            this.sessionManager.updateState(platform, agentId, userId, 'error');
            throw error;
          }
        }
      );

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const errorDetails = {
        message: err.message,
        name: err.name,
        stack: err.stack,
        // Handle API errors which may have additional properties
        ...(typeof error === 'object' && error !== null && 'status' in error
          ? { status: (error as { status: number }).status }
          : {}),
        ...(typeof error === 'object' && error !== null && 'error' in error
          ? { apiError: (error as { error: unknown }).error }
          : {}),
      };

      logger.error({ err: errorDetails, platform, userId, agentId }, 'Failed to process message');

      // Send error message to user
      await this.sendErrorToUser(adapter, chatId, err);

      return {
        success: false,
        error: err.message,
        sessionId: session.sessionId,
      };
    }
  }

  /**
   * Execute query using Claude Agent SDK (SDK mode)
   */
  private async executeQueryWithSDK(
    sessionId: string,
    prompt: string,
    adapter: BaseAdapter,
    chatId: string,
    platform: string,
    agentId: string,
    userId: string
  ): Promise<string> {
    if (!this.sdkQueryManager) {
      throw new ProcessingError('PROCESSING_FAILED', 'SDK mode not initialized');
    }

    // Get internal session for agent info
    const internalSession = this.sessionManager.getInternalSession(platform, agentId, userId);

    if (internalSession === undefined || internalSession.agent === undefined) {
      throw new ProcessingError('PROCESSING_FAILED', 'Session or agent not found');
    }

    const agent = internalSession.agent;

    // Start typing indicator
    let typingInterval: ReturnType<typeof setInterval> | null = null;
    if (this.sendTypingIndicators) {
      await adapter.sendTypingIndicator(chatId);
      typingInterval = setInterval(() => {
        void adapter.sendTypingIndicator(chatId);
      }, this.typingIndicatorIntervalMs);
    }

    try {
      // Execute query with SDK
      // Use resume option if we have a previous SDK session ID
      const result = await retryAsync(
        async () => {
          return await this.sdkQueryManager!.executeQuery(
            sessionId,
            prompt,
            agent,
            {
              cwd: agent.path,
              // Pass system prompt explicitly to ensure agent isolation
              // This prevents SDK from loading parent directory's CLAUDE.md
              systemPrompt: agent.systemPrompt,
              // Allow multiple turns for tool usage (agent can use tools and respond)
              maxTurns: 10,
              resume: internalSession.sdkSessionId,
            }
          );
        },
        {
          ...API_RETRY_OPTIONS,
          isRetryable: (error) =>
            isRateLimitError(error) || isTransientError(error),
          onRetry: (attempt, error, delayMs) => {
            logger.warn(
              {
                sessionId,
                attempt,
                delayMs,
                error: error instanceof Error ? error.message : String(error),
              },
              'Retrying SDK query'
            );
          },
        }
      );

      // Save SDK session ID for future resume
      if (result.sdkSessionId && result.sdkSessionId !== internalSession.sdkSessionId) {
        this.sessionManager.setSdkSessionId(platform, agentId, userId, result.sdkSessionId);
        logger.debug(
          { sessionId, sdkSessionId: result.sdkSessionId },
          'Updated SDK session ID'
        );
      }

      // Send response to user
      if (result.response.length > 0) {
        const sendResult = await adapter.sendMessage(chatId, result.response, {
          parseMode: 'Markdown',
        });

        if (!sendResult.success) {
          logger.warn(
            { error: sendResult.error, chatId },
            'Failed to send response'
          );
        }
      }

      return result.response;
    } finally {
      // Stop typing indicator
      if (typingInterval !== null) {
        clearInterval(typingInterval);
      }
    }
  }

  /**
   * Execute query using direct Anthropic API (Legacy mode)
   */
  private async executeQueryLegacy(
    sessionId: string,
    prompt: string,
    adapter: BaseAdapter,
    chatId: string
  ): Promise<string> {
    if (!this.client) {
      throw new ProcessingError('PROCESSING_FAILED', 'Legacy mode not initialized');
    }

    // Get internal session for SDK options
    const ids = this.getSessionIdentifiers(sessionId);
    const internalSession = this.sessionManager.getInternalSession(
      ids.platform,
      ids.agentId,
      ids.userId
    );

    if (internalSession === undefined) {
      throw new ProcessingError('PROCESSING_FAILED', 'Session not found');
    }

    // Get or create conversation history
    let conversation = this.conversations.get(sessionId);
    if (conversation === undefined) {
      conversation = { messages: [] };
      this.conversations.set(sessionId, conversation);
    }

    // Add user message to history
    conversation.messages.push({
      role: 'user',
      content: prompt,
    });

    // Persist user message
    if (this.conversationRepository !== undefined) {
      this.conversationRepository.appendMessage(sessionId, 'user', prompt);
    }

    // Start typing indicator
    let typingInterval: ReturnType<typeof setInterval> | null = null;
    if (this.sendTypingIndicators) {
      await adapter.sendTypingIndicator(chatId);
      typingInterval = setInterval(() => {
        void adapter.sendTypingIndicator(chatId);
      }, this.typingIndicatorIntervalMs);
    }

    try {
      // Get agent config for system prompt and model
      const agentConfig = internalSession.agent?.config;
      const systemPrompt = internalSession.agent?.systemPrompt ?? '';
      const model = agentConfig?.model === 'opus'
        ? 'claude-opus-4-20250514'
        : agentConfig?.model === 'haiku'
          ? 'claude-haiku-3-5-20241022'
          : 'claude-sonnet-4-20250514';

      // Execute streaming query with retry
      const fullResponse = await retryAsync(
        async () => {
          const responseChunks: string[] = [];

          const stream = this.client!.messages.stream({
            model,
            max_tokens: agentConfig?.maxTokens ?? 4096,
            system: systemPrompt,
            messages: conversation.messages,
          });

          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              responseChunks.push(event.delta.text);
            }
          }

          return responseChunks.join('');
        },
        {
          ...API_RETRY_OPTIONS,
          isRetryable: (error) =>
            isRateLimitError(error) || isTransientError(error),
          onRetry: (attempt, error, delayMs) => {
            logger.warn(
              {
                sessionId,
                attempt,
                delayMs,
                error: error instanceof Error ? error.message : String(error),
              },
              'Retrying Claude API call'
            );
          },
        }
      );

      // Add assistant response to history
      conversation.messages.push({
        role: 'assistant',
        content: fullResponse,
      });

      // Persist assistant response
      if (this.conversationRepository !== undefined) {
        this.conversationRepository.appendMessage(sessionId, 'assistant', fullResponse);
      }

      // Trim conversation history if too long
      if (conversation.messages.length > this.maxConversationLength) {
        conversation.messages = conversation.messages.slice(-this.maxConversationLength);

        // Trim in database as well
        if (this.conversationRepository !== undefined) {
          this.conversationRepository.trimConversation(sessionId, this.maxConversationLength);
        }
      }

      // Send response to user
      if (fullResponse.length > 0) {
        const sendResult = await adapter.sendMessage(chatId, fullResponse, {
          parseMode: 'Markdown',
        });

        if (!sendResult.success) {
          logger.warn(
            { error: sendResult.error, chatId },
            'Failed to send response'
          );
        }
      }

      return fullResponse;
    } finally {
      // Stop typing indicator
      if (typingInterval !== null) {
        clearInterval(typingInterval);
      }
    }
  }

  /**
   * Get platform, agentId, and userId from sessionId
   */
  private getSessionIdentifiers(sessionId: string): {
    platform: string;
    agentId: string;
    userId: string;
  } {
    // Find session in all sessions
    const allSessions = this.sessionManager.getAllSessions();
    const session = allSessions.find((s) => s.sessionId === sessionId);

    if (session === undefined) {
      throw new ProcessingError('PROCESSING_FAILED', 'Session not found');
    }

    return { platform: session.platform, agentId: session.agentId, userId: session.userId };
  }

  /**
   * Send error message to user
   */
  private async sendErrorToUser(
    adapter: BaseAdapter,
    chatId: string,
    error: Error
  ): Promise<void> {
    const userMessage = this.getUserFriendlyError(error);

    try {
      await adapter.sendMessage(chatId, userMessage);
    } catch (sendError) {
      logger.error(
        { error: sendError, chatId },
        'Failed to send error message to user'
      );
    }
  }

  /**
   * Convert error to user-friendly message
   */
  private getUserFriendlyError(error: Error): string {
    const message = error.message.toLowerCase();

    // Check for rate limit errors
    if (isRateLimitError(error)) {
      return '抱歉，目前請求過於頻繁，請稍後再試。';
    }

    // Check for timeout errors
    if (message.includes('timeout') || message.includes('etimedout')) {
      return '抱歉，處理超時，請重新發送您的訊息。';
    }

    // Check for network/connection errors
    if (isTransientError(error) && !message.includes('500')) {
      return '抱歉，網路連線發生問題，請檢查網路後重試。';
    }

    // Check for authentication errors
    if (
      message.includes('auth') ||
      message.includes('401') ||
      message.includes('403')
    ) {
      return '抱歉，服務授權發生問題，請聯繫管理員。';
    }

    // Check for server errors
    if (
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503')
    ) {
      return '抱歉，服務暫時無法使用，請稍後再試。';
    }

    // Check for invalid request errors
    if (message.includes('invalid') || message.includes('400')) {
      return '抱歉，您的請求無法處理，請嘗試修改訊息內容。';
    }

    // Check for content filtering
    if (message.includes('content') || message.includes('filter')) {
      return '抱歉，您的訊息內容無法處理，請嘗試修改訊息內容。';
    }

    // Check for context length errors
    if (message.includes('context') || message.includes('token')) {
      return '抱歉，對話過長，請使用 /reset 指令重置對話。';
    }

    // Generic error message
    return '抱歉，處理您的訊息時發生錯誤。請稍後再試。';
  }

  /**
   * Clear conversation history for a session.
   * In SDK mode, this clears the SDK session ID to start fresh.
   * In legacy mode, this clears the local conversation history.
   */
  clearConversation(sessionId: string): void {
    if (this.useClaudeAgentSDK) {
      // In SDK mode, clear the SDK session ID
      // This will cause a new session to be created on the next message
      const { platform, agentId, userId } = this.getSessionIdentifiers(sessionId);
      this.sessionManager.setSdkSessionId(platform, agentId, userId, undefined);
      logger.debug({ sessionId }, 'Cleared SDK session ID for conversation reset');
    } else {
      // Legacy mode: clear local conversation
      this.conversations.delete(sessionId);

      // Clear from database as well
      if (this.conversationRepository !== undefined) {
        this.conversationRepository.clearConversation(sessionId);
      }
    }
  }

  /**
   * Clear all conversation histories (legacy mode only)
   */
  clearAllConversations(): void {
    if (!this.useClaudeAgentSDK) {
      this.conversations.clear();
    }
  }

  /**
   * Restore conversations from database for given session IDs (legacy mode only)
   */
  restoreConversations(sessionIds: string[]): number {
    if (this.useClaudeAgentSDK || this.conversationRepository === undefined) {
      return 0;
    }

    let restored = 0;

    for (const sessionId of sessionIds) {
      // Skip if already loaded
      if (this.conversations.has(sessionId)) {
        continue;
      }

      const rows = this.conversationRepository.findBySessionId(sessionId);
      if (rows.length === 0) {
        continue;
      }

      const messages: ConversationMessage[] = rows.map((row) => ({
        role: row.role as 'user' | 'assistant',
        content: row.content,
      }));

      this.conversations.set(sessionId, { messages });
      restored++;

      logger.debug(
        { sessionId, messageCount: messages.length },
        'Conversation restored from database'
      );
    }

    if (restored > 0) {
      logger.info({ count: restored }, 'Conversations restored from database');
    }

    return restored;
  }

  /**
   * Get conversation history for a session (legacy mode only)
   */
  getConversation(sessionId: string): ConversationMessage[] | undefined {
    if (this.useClaudeAgentSDK) {
      return undefined;
    }
    return this.conversations.get(sessionId)?.messages;
  }

  /**
   * Check if persistence is enabled (legacy mode only)
   */
  isPersistenceEnabled(): boolean {
    if (this.useClaudeAgentSDK) {
      // SDK mode always has persistence via SDK's session mechanism
      return true;
    }
    return this.conversationRepository !== undefined;
  }

  /**
   * Check if using Claude Agent SDK mode
   */
  isUsingClaudeAgentSDK(): boolean {
    return this.useClaudeAgentSDK;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.sdkQueryManager) {
      this.sdkQueryManager.dispose();
    }
  }
}
