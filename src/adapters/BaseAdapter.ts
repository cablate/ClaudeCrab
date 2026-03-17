import type {
  AdapterConfig,
  AdapterState,
  UnifiedMessage,
  SendOptions,
  SendResult,
  MessageHandler,
  PermissionPromptOptions,
  PermissionPromptResult,
  PermissionResolver,
  QuestionPromptOptions,
  QuestionPromptResult,
  QuestionResolver,
  ExitPlanModePromptOptions,
  ExitPlanModePromptResult,
  ExitPlanModeResolver,
} from './types.js';
import { getEventBus } from '../core/EventBus.js';
import { logger } from '../utils/logger.js';

/**
 * Abstract base class for all platform adapters
 * Provides common lifecycle management and message handling infrastructure
 */
export abstract class BaseAdapter<TConfig extends AdapterConfig = AdapterConfig> {
  /** Platform identifier */
  readonly platform: string;

  /** Agent identifier this adapter is bound to */
  readonly agentId: string;

  /** Current adapter state */
  protected _state: AdapterState = 'uninitialized';

  /** Configuration */
  protected readonly config: TConfig;

  /** Message handlers */
  protected readonly messageHandlers: Set<MessageHandler> = new Set();

  /** Child logger for this adapter */
  protected readonly log: typeof logger;

  constructor(config: TConfig) {
    this.config = config;
    this.platform = config.platform;
    this.agentId = config.agentId;
    this.log = logger.child({ adapter: this.platform, agentId: this.agentId });
  }

  /**
   * Get current adapter state
   */
  get state(): AdapterState {
    return this._state;
  }

  /**
   * Check if adapter is ready to send/receive messages
   */
  isReady(): boolean {
    return this._state === 'running';
  }

  /**
   * Initialize the adapter (connect to platform, authenticate, etc.)
   * Must be called before start()
   */
  async initialize(): Promise<void> {
    if (this._state !== 'uninitialized') {
      this.log.warn(
        { currentState: this._state },
        'Adapter already initialized'
      );
      return;
    }

    this._state = 'initializing';
    this.log.info('Initializing adapter');

    try {
      await this.doInitialize();
      this._state = 'ready';
      this.log.info('Adapter initialized');
    } catch (error) {
      this._state = 'error';
      this.log.error({ error }, 'Failed to initialize adapter');
      throw error;
    }
  }

  /**
   * Start the adapter (begin receiving messages)
   */
  async start(): Promise<void> {
    if (this._state === 'running') {
      this.log.warn('Adapter already running');
      return;
    }

    if (this._state !== 'ready' && this._state !== 'stopped') {
      throw new Error(
        `Cannot start adapter in state: ${this._state}. Must be 'ready' or 'stopped'.`
      );
    }

    this._state = 'starting';
    this.log.info('Starting adapter');

    try {
      await this.doStart();
      this._state = 'running';
      this.log.info('Adapter started');
    } catch (error) {
      this._state = 'error';
      this.log.error({ error }, 'Failed to start adapter');
      throw error;
    }
  }

  /**
   * Stop the adapter (stop receiving messages, but keep connection)
   */
  async stop(): Promise<void> {
    if (this._state === 'stopped' || this._state === 'uninitialized') {
      this.log.warn({ currentState: this._state }, 'Adapter not running');
      return;
    }

    this._state = 'stopping';
    this.log.info('Stopping adapter');

    try {
      await this.doStop();
      this._state = 'stopped';
      this.log.info('Adapter stopped');
    } catch (error) {
      this._state = 'error';
      this.log.error({ error }, 'Failed to stop adapter');
      throw error;
    }
  }

  /**
   * Dispose of the adapter (cleanup all resources)
   */
  async dispose(): Promise<void> {
    this.log.info('Disposing adapter');

    if (this._state === 'running') {
      await this.stop();
    }

    try {
      await this.doDispose();
      this._state = 'uninitialized';
      this.messageHandlers.clear();
      this.log.info('Adapter disposed');
    } catch (error) {
      this.log.error({ error }, 'Error during adapter disposal');
      throw error;
    }
  }

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Send a message to a chat
   */
  abstract sendMessage(
    chatId: string,
    text: string,
    options?: SendOptions
  ): Promise<SendResult>;

  /**
   * Send a message with platform-aware markdown formatting.
   * Each adapter handles its own conversion (e.g. Telegram MarkdownV2, Discord native markdown).
   * Default implementation: sends raw text via sendMessage() — subclasses override as needed.
   */
  async sendFormattedMessage(
    chatId: string,
    text: string,
    options?: SendOptions
  ): Promise<SendResult> {
    return this.sendMessage(chatId, text, options);
  }

  /**
   * Get bot identity info (username, id). Override in platform-specific adapters.
   * Used for group chat context injection and display.
   */
  getBotInfo(): { username: string; id: number } | null {
    return null;
  }

  /**
   * Send a photo (image file) to the chat. Default no-op — subclasses override.
   */
  async sendPhoto(
    _chatId: string,
    _filePath: string,
    _caption?: string,
  ): Promise<SendResult> {
    return { success: false, error: 'sendPhoto not implemented' };
  }

  /**
   * Send a document/file to a chat
   * @param chatId - The chat to send to
   * @param filePath - Path to the file
   * @param caption - Optional caption
   * @returns SendResult with success status
   */
  async sendDocument(
    _chatId: string,
    _filePath: string,
    _caption?: string,
  ): Promise<SendResult> {
    return { success: false, error: 'sendDocument not implemented' };
  }

  /**
   * Send an audio file to a chat (playable audio message)
   * @param chatId - The chat to send to
   * @param audio - Audio buffer (MP3, OGG, etc.)
   * @param options - Optional settings (duration, caption)
   * @returns SendResult with success status
   */
  async sendAudio(
    _chatId: string,
    _audio: Buffer,
    _options?: { duration?: number; caption?: string; filename?: string },
  ): Promise<SendResult> {
    return { success: false, error: 'sendAudio not implemented' };
  }

  /**
   * Send a video to a chat (displayed as playable video).
   * Override in platform-specific adapters.
   */
  async sendVideo(
    _chatId: string,
    _filePath: string,
    _caption?: string,
  ): Promise<SendResult> {
    return { success: false, error: 'sendVideo not implemented' };
  }

  /**
   * Send typing indicator
   */
  abstract sendTypingIndicator(chatId: string): Promise<void>;

  /**
   * Send a permission prompt to the user.
   * Default implementation sends a text-only message (no interactive buttons).
   * Subclasses should override for interactive prompts (e.g., Telegram InlineKeyboard).
   */
  async sendPermissionPrompt(
    chatId: string,
    options: PermissionPromptOptions
  ): Promise<PermissionPromptResult> {
    const text = `🔐 Permission Request\nTool: ${options.toolName}\nReason: ${options.decisionReason ?? 'N/A'}`;
    const result = await this.sendMessage(chatId, text);
    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    };
  }

  /**
   * Update a previously sent permission prompt (e.g., mark as resolved).
   * Default: no-op. Subclasses override to edit the message.
   */
  async updatePermissionPrompt(
    _chatId: string,
    _messageId: string,
    _text: string
  ): Promise<void> {
    // Default: no-op
  }

  /**
   * Register a callback for permission decision results from the platform.
   * Default: no-op. Subclasses override to wire platform-specific callback routing.
   */
  setPermissionResolver(_resolver: PermissionResolver): void {
    // Default: no-op
  }

  /**
   * Send a question prompt to the user (for AskUserQuestion tool).
   * Default implementation sends a text-only message (no interactive buttons).
   * Subclasses should override for interactive prompts (e.g., Telegram InlineKeyboard).
   */
  async sendQuestionPrompt(
    chatId: string,
    options: QuestionPromptOptions
  ): Promise<QuestionPromptResult> {
    const optionsList = options.options
      .map((opt, i) => `${i + 1}. ${opt.label}: ${opt.description}`)
      .join('\n');
    const text = `❓ ${options.header}\n\n${options.question}\n\n${optionsList}`;
    const result = await this.sendMessage(chatId, text);
    const response: QuestionPromptResult = { success: result.success };
    if (result.messageId !== undefined) {
      response.messageId = result.messageId;
    }
    if (result.error !== undefined) {
      response.error = result.error;
    }
    return response;
  }

  /**
   * Update a previously sent question prompt (e.g., mark as answered).
   * Default: no-op. Subclasses override to edit the message.
   */
  async updateQuestionPrompt(
    _chatId: string,
    _messageId: string,
    _text: string
  ): Promise<void> {
    // Default: no-op
  }

  /**
   * Register a callback for question answer results from the platform.
   * Default: no-op. Subclasses override to wire platform-specific callback routing.
   */
  setQuestionResolver(_resolver: QuestionResolver): void {
    // Default: no-op
  }

  // ============================================================
  // ExitPlanMode Prompt (Plan Review UI)
  // ============================================================

  /**
   * Send an ExitPlanMode prompt to the user (Plan Review).
   * Default implementation sends a text-only message (no interactive buttons).
   * Subclasses should override for interactive prompts (e.g., Telegram InlineKeyboard).
   */
  async sendExitPlanModePrompt(
    chatId: string,
    options: ExitPlanModePromptOptions
  ): Promise<ExitPlanModePromptResult> {
    const allowedList = options.allowedPrompts?.length
      ? options.allowedPrompts.map((p) => `• ${p.tool}: ${p.prompt}`).join('\n')
      : '（無特殊權限）';

    const text = [
      '📋 Plan Review',
      '',
      'Claude 已完成計畫，請審核：',
      '',
      '需要的權限：',
      allowedList,
    ].join('\n');

    const result = await this.sendMessage(chatId, text);
    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    };
  }

  /**
   * Update an ExitPlanMode prompt message after the user's decision.
   * Default: no-op. Subclasses override to edit the original message.
   */
  async updateExitPlanModePrompt(
    _chatId: string,
    _messageId: string,
    _text: string
  ): Promise<void> {
    // Default: no-op
  }

  /**
   * Register a callback for ExitPlanMode decisions from the platform.
   * Default: no-op. Subclasses override to wire platform-specific callback routing.
   */
  setExitPlanModeResolver(_resolver: ExitPlanModeResolver): void {
    // Default: no-op
  }

  /**
   * Platform-specific initialization
   */
  protected abstract doInitialize(): Promise<void>;

  /**
   * Platform-specific start
   */
  protected abstract doStart(): Promise<void>;

  /**
   * Platform-specific stop
   */
  protected abstract doStop(): Promise<void>;

  /**
   * Platform-specific disposal
   */
  protected abstract doDispose(): Promise<void>;

  /**
   * Emit a received message to all handlers and EventBus
   */
  protected async emitMessage(message: UnifiedMessage): Promise<void> {
    this.log.debug(
      { messageId: message.id, userId: message.userId },
      'Message received'
    );

    // Emit to EventBus
    getEventBus().emitSync('message:received', message);

    // Call all registered handlers
    const handlers = Array.from(this.messageHandlers);
    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler(message);
        } catch (error) {
          this.log.error(
            { error, messageId: message.id },
            'Error in message handler'
          );
        }
      })
    );
  }

  /**
   * Log and emit sent message event
   */
  protected emitMessageSent(
    chatId: string,
    text: string,
    userId: string
  ): void {
    getEventBus().emitSync('message:sent', {
      chatId,
      text,
      platform: this.platform,
      userId,
      agentId: this.agentId,
    });
  }
}
