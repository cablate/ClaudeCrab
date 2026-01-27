import type {
  AdapterConfig,
  AdapterState,
  UnifiedMessage,
  SendOptions,
  SendResult,
  MessageHandler,
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
    this.log = logger.child({ adapter: this.platform });
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
   * Send typing indicator
   */
  abstract sendTypingIndicator(chatId: string): Promise<void>;

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
    });
  }
}
