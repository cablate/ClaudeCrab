import type { UnifiedMessage } from '../adapters/types.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import type { IConversationRepository } from '../persistence/types.js';
import { SessionManager } from './SessionManager.js';
import { SDKQueryManager } from './SDKQueryManager.js';
import { PermissionBridge } from './PermissionBridge.js';
import { QuestionBridge } from './QuestionBridge.js';
import { buildPromptContext } from './constants.js';
import { logger } from '../utils/logger.js';
import { ProcessingError } from '../types/errors.js';
import {
  retryAsync,
  API_RETRY_OPTIONS,
  isRateLimitError,
  isTransientError,
} from '../utils/retry.js';

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

  /** Conversation repository for persisting SDK messages to database */
  conversationRepository?: IConversationRepository;

  /**
   * Read the current system prompt from disk for the given agent.
   * When provided, this is called on every query to get the latest systemPrompt,
   * allowing agents that self-update their CLAUDE.md to see changes reflected immediately.
   * Falls back to the cached agent.systemPrompt if not provided.
   */
  getSystemPrompt?: (agentId: string) => Promise<string>;
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
 * Processes incoming messages and sends responses via adapters.
 * Uses Claude Agent SDK with automatic setting loading
 * and SDK-managed conversation history (via resume option).
 */
export class MessageProcessor {
  private readonly sessionManager: SessionManager;
  private readonly getAdapter: (platform: string, agentId: string) => BaseAdapter | undefined;
  private readonly sendTypingIndicators: boolean;
  private readonly typingIndicatorIntervalMs: number;
  private readonly sdkQueryManager: SDKQueryManager;
  private readonly conversationRepository: IConversationRepository | undefined;
  private readonly getSystemPrompt: ((agentId: string) => Promise<string>) | undefined;

  constructor(options: MessageProcessorOptions) {
    this.sessionManager = options.sessionManager;
    this.getAdapter = options.getAdapter;
    this.sendTypingIndicators = options.sendTypingIndicators ?? true;
    this.typingIndicatorIntervalMs = options.typingIndicatorIntervalMs ?? 5000;
    this.sdkQueryManager = new SDKQueryManager();
    this.conversationRepository = options.conversationRepository;
    this.getSystemPrompt = options.getSystemPrompt;

    logger.info('MessageProcessor initialized');
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
            // Process the message using SDK
            const response = await this.executeQueryWithSDK(
              session.sessionId, text, adapter, chatId, platform, agentId, userId
            );

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
   * Execute query using Claude Agent SDK
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
    // Get internal session for agent info
    const internalSession = this.sessionManager.getInternalSession(platform, agentId, userId);

    if (internalSession === undefined || internalSession.agent === undefined) {
      throw new ProcessingError('PROCESSING_FAILED', 'Session or agent not found');
    }

    const agent = internalSession.agent;

    // Read fresh system prompt from disk (agent may have updated CLAUDE.md at runtime)
    const systemPrompt = this.getSystemPrompt !== undefined
      ? await this.getSystemPrompt(agent.id)
      : agent.systemPrompt;

    // Start typing indicator
    let typingInterval: ReturnType<typeof setInterval> | null = null;
    if (this.sendTypingIndicators) {
      await adapter.sendTypingIndicator(chatId);
      typingInterval = setInterval(() => {
        void adapter.sendTypingIndicator(chatId);
      }, this.typingIndicatorIntervalMs);
    }

    // Set up permission bridge for interactive tool approval via Telegram
    const permissionBridge = new PermissionBridge(120_000);
    adapter.setPermissionResolver((requestId, decision) => {
      if (decision === 'always') {
        permissionBridge.resolvePermission(requestId, {
          behavior: 'allow',
          alwaysAllow: true,
        });
      } else if (decision === 'allow') {
        permissionBridge.resolvePermission(requestId, { behavior: 'allow' });
      } else {
        permissionBridge.resolvePermission(requestId, {
          behavior: 'deny',
          message: 'User denied permission',
        });
      }
    });

    // Set up question bridge for AskUserQuestion tool
    const questionBridge = new QuestionBridge(120_000);
    adapter.setQuestionResolver((requestId, answer) => {
      if (answer === null) {
        questionBridge.resolveQuestion(requestId, { answer: null });
      } else {
        // answer is the option index as string
        const optionLabels = questionBridge.getOptionLabels(requestId);
        const optionIndex = parseInt(answer, 10);
        const selectedLabel = optionLabels?.[optionIndex] ?? answer;
        questionBridge.resolveQuestion(requestId, { answer: selectedLabel });
      }
    });

    try {
      // Track intermediate messages sent via streaming callback
      const intermediateMessages: string[] = [];

      // Build canUseTool closure for SDK permission callback
      const canUseTool = async (
        toolName: string,
        toolInput: Record<string, unknown>,
        options: {
          signal: AbortSignal;
          blockedPath?: string;
          decisionReason?: string;
          toolUseID: string;
        }
      ) => {
        // Handle AskUserQuestion tool - present options to user via Telegram
        if (toolName === 'AskUserQuestion') {
          const questions = toolInput.questions as Array<{
            question: string;
            header: string;
            options: Array<{ label: string; description: string }>;
            multiSelect: boolean;
          }> | undefined;

          if (questions === undefined || questions.length === 0) {
            // No questions - just allow the tool
            return {
              behavior: 'allow' as const,
              updatedInput: toolInput,
              toolUseID: options.toolUseID,
            };
          }

          // Phase 2: Only handle first question, single-select only
          const firstQuestion = questions[0];
          if (firstQuestion === undefined) {
            // Empty questions array - just allow the tool
            return {
              behavior: 'allow' as const,
              updatedInput: toolInput,
              toolUseID: options.toolUseID,
            };
          }
          const optionLabels = firstQuestion.options.map(opt => opt.label);

          const { requestId, promise } = questionBridge.requestQuestion(
            firstQuestion.question,
            firstQuestion.header,
            optionLabels,
            { signal: options.signal }
          );

          const promptResult = await adapter.sendQuestionPrompt(chatId, {
            requestId,
            question: firstQuestion.question,
            header: firstQuestion.header,
            options: firstQuestion.options,
            multiSelect: firstQuestion.multiSelect,
          });

          if (!promptResult.success) {
            logger.warn(
              { error: promptResult.error, chatId, toolName },
              'Failed to send question prompt, auto-cancelling'
            );
            questionBridge.resolveQuestion(requestId, { answer: null });
          }

          const questionAnswer = await promise;

          // Update the question prompt message with the selection
          if (promptResult.messageId !== undefined && questionAnswer.answer !== null) {
            const statusText = `✅ Selected: *${questionAnswer.answer}*`;
            await adapter.updateQuestionPrompt(chatId, promptResult.messageId, statusText);
          }

          // If user cancelled or timed out, deny the tool
          if (questionAnswer.answer === null) {
            return {
              behavior: 'deny' as const,
              message: 'User cancelled the question',
              toolUseID: options.toolUseID,
            };
          }

          // Build answers object for SDK
          const answers: Record<string, string> = {};
          answers[firstQuestion.question] = questionAnswer.answer;

          return {
            behavior: 'allow' as const,
            updatedInput: {
              questions: toolInput.questions,
              answers,
            },
            toolUseID: options.toolUseID,
          };
        }

        // Normal permission flow for other tools
        const bridgeOptions: {
          signal: AbortSignal;
          toolUseID: string;
          decisionReason?: string;
          blockedPath?: string;
        } = { signal: options.signal, toolUseID: options.toolUseID };
        if (options.decisionReason !== undefined) {
          bridgeOptions.decisionReason = options.decisionReason;
        }
        if (options.blockedPath !== undefined) {
          bridgeOptions.blockedPath = options.blockedPath;
        }

        const { requestId, promise } = permissionBridge.requestPermission(
          toolName, toolInput, bridgeOptions
        );

        const promptOptions: {
          requestId: string;
          toolName: string;
          toolInput: Record<string, unknown>;
          decisionReason?: string;
          blockedPath?: string;
        } = { requestId, toolName, toolInput };
        if (options.decisionReason !== undefined) {
          promptOptions.decisionReason = options.decisionReason;
        }
        if (options.blockedPath !== undefined) {
          promptOptions.blockedPath = options.blockedPath;
        }

        const promptResult = await adapter.sendPermissionPrompt(chatId, promptOptions);

        if (!promptResult.success) {
          logger.warn(
            { error: promptResult.error, chatId, toolName },
            'Failed to send permission prompt, auto-denying'
          );
          permissionBridge.resolvePermission(requestId, {
            behavior: 'deny',
            message: 'Failed to send permission prompt',
          });
        }

        const decision = await promise;

        // Update the permission prompt message with the decision
        if (promptResult.messageId) {
          let statusText: string;
          if (decision.behavior === 'allow') {
            statusText = decision.alwaysAllow === true
              ? `✅ Always Allowed: \`${toolName}\``
              : `✅ Allowed: \`${toolName}\``;
          } else {
            statusText = `❌ Denied: \`${toolName}\``;
          }
          await adapter.updatePermissionPrompt(chatId, promptResult.messageId, statusText);
        }

        if (decision.behavior === 'allow') {
          const allowResult: {
            behavior: 'allow';
            updatedInput: Record<string, unknown>;
            toolUseID: string;
            updatedPermissions?: Array<{
              type: 'addRules';
              rules: Array<{ toolName: string }>;
              behavior: 'allow';
              destination: 'localSettings';
            }>;
          } = {
            behavior: 'allow' as const,
            updatedInput: toolInput,
            toolUseID: options.toolUseID,
          };

          if (decision.alwaysAllow === true) {
            allowResult.updatedPermissions = [{
              type: 'addRules' as const,
              rules: [{ toolName }],
              behavior: 'allow' as const,
              destination: 'localSettings' as const,
            }];
          }

          return allowResult;
        }
        return {
          behavior: 'deny' as const,
          message: decision.message ?? 'User denied permission',
          toolUseID: options.toolUseID,
        };
      };

      // Helper: execute SDK query with retry for rate limit / transient errors
      const executeWithRetry = async (resumeId: string | undefined) => {
        return await retryAsync(
          async () => {
            return await this.sdkQueryManager.executeQuery(
              sessionId,
              prompt,
              agent,
              {
                cwd: agent.path,
                systemPrompt,
                maxTurns: agent.config.settings?.maxTurns ?? 10,
                resume: resumeId,
                onIntermediateMessage: async (text: string): Promise<void> => {
                  await adapter.sendTypingIndicator(chatId);
                  const sendResult = await adapter.sendMessage(chatId, text, {
                    parseMode: 'Markdown',
                  });
                  if (!sendResult.success) {
                    logger.warn(
                      { error: sendResult.error, chatId },
                      'Failed to send intermediate message'
                    );
                  }
                  intermediateMessages.push(text);
                },
                additionalOptions: {
                  canUseTool,
                  hooks: {
                    UserPromptSubmit: [{
                      hooks: [async () => ({
                        continue: true,
                        hookSpecificOutput: {
                          hookEventName: 'UserPromptSubmit' as const,
                          additionalContext: buildPromptContext(),
                        },
                      })],
                    }],
                  },
                },
              }
            );
          },
          {
            ...API_RETRY_OPTIONS,
            isRetryable: (err) =>
              isRateLimitError(err) || isTransientError(err),
            onRetry: (attempt, err, delayMs) => {
              intermediateMessages.length = 0;
              logger.warn(
                {
                  sessionId,
                  attempt,
                  delayMs,
                  error: err instanceof Error ? err.message : String(err),
                },
                'Retrying SDK query'
              );
            },
          }
        );
      };

      // Execute query — if resume fails, retry without resume (new conversation)
      let result;
      try {
        result = await executeWithRetry(internalSession.sdkSessionId);
      } catch (error) {
        if (internalSession.sdkSessionId !== undefined) {
          logger.warn(
            {
              sessionId,
              sdkSessionId: internalSession.sdkSessionId,
              error: error instanceof Error ? error.message : String(error),
            },
            'SDK resume failed, retrying without resume (new conversation)'
          );
          this.sessionManager.setSdkSessionId(platform, agentId, userId, undefined);
          result = await executeWithRetry(undefined);
        } else {
          throw error;
        }
      }

      // Save SDK session ID for future resume
      if (result.sdkSessionId && result.sdkSessionId !== internalSession.sdkSessionId) {
        this.sessionManager.setSdkSessionId(platform, agentId, userId, result.sdkSessionId);
        logger.debug(
          { sessionId, sdkSessionId: result.sdkSessionId },
          'Updated SDK session ID'
        );
      }

      // Persist messages to database for WebUI visibility
      if (this.conversationRepository !== undefined) {
        try {
          this.conversationRepository.appendMessage(sessionId, 'user', prompt);
          // Store intermediate messages individually (matches what user saw in Telegram)
          for (const msg of intermediateMessages) {
            this.conversationRepository.appendMessage(sessionId, 'assistant', msg);
          }
          // Store remaining response if any (when no callback was used, or residual text)
          if (result.response.length > 0) {
            this.conversationRepository.appendMessage(sessionId, 'assistant', result.response);
          }
        } catch (persistError) {
          logger.warn(
            { error: persistError, sessionId },
            'Failed to persist conversation messages'
          );
        }
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
      // Clean up permission bridge (deny any pending requests)
      permissionBridge.cancelAll();
      adapter.setPermissionResolver(() => {});

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
   * Clear conversation for a session.
   * Clears the SDK session ID and persisted conversation records.
   */
  clearConversation(sessionId: string): void {
    const { platform, agentId, userId } = this.getSessionIdentifiers(sessionId);
    this.sessionManager.setSdkSessionId(platform, agentId, userId, undefined);

    if (this.conversationRepository !== undefined) {
      this.conversationRepository.clearConversation(sessionId);
    }

    logger.debug({ sessionId }, 'Cleared conversation (SDK session + persisted messages)');
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.sdkQueryManager.dispose();
  }
}
