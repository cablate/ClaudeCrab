import { Bot, Context, GrammyError, HttpError, InlineKeyboard } from 'grammy';
import { BaseAdapter } from './BaseAdapter.js';
import type {
  TelegramAdapterConfig,
  UnifiedMessage,
  SendOptions,
  SendResult,
  RateLimitConfig,
  PermissionPromptOptions,
  PermissionPromptResult,
  PermissionResolver,
  QuestionPromptOptions,
  QuestionPromptResult,
  QuestionResolver,
} from './types.js';
import { DEFAULT_RATE_LIMIT } from './types.js';
import {
  COMMAND_HANDLERS,
  type CommandDependencies,
} from './commands/index.js';
import {
  validateMessage,
  getSecurityErrorMessage,
  detectPromptInjection,
  type SecurityConfig,
} from '../utils/security.js';
import { auditLogger } from '../utils/audit.js';

/**
 * Rate limiter for Telegram API requests
 */
class RateLimiter {
  private readonly config: RateLimitConfig;
  private lastRequestTime: number = 0;
  private readonly queue: Array<{
    fn: () => Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private processing: boolean = false;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error('Rate limit queue full');
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        fn: async () => {
          try {
            const result = await fn();
            resolve(result);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        resolve: () => {},
        reject: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
      });

      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      const waitTime = Math.max(0, this.config.minIntervalMs - elapsed);

      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      const item = this.queue.shift();
      if (item !== undefined) {
        this.lastRequestTime = Date.now();
        try {
          await item.fn();
        } catch (error) {
          item.reject(error);
        }
      }
    }

    this.processing = false;
  }

  get queueSize(): number {
    return this.queue.length;
  }
}

/**
 * Default security configuration
 */
const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  allowedUsers: [],
  whitelistEnabled: false,
  maxMessageLength: 10000,
  promptInjectionDetection: true,
};

/**
 * Telegram platform adapter using grammy
 */
export class TelegramAdapter extends BaseAdapter<TelegramAdapterConfig> {
  private bot: Bot | null = null;
  private readonly rateLimiter: RateLimiter;
  private commandDeps: CommandDependencies | undefined;
  private readonly securityConfig: SecurityConfig;
  private permissionResolver: PermissionResolver | null = null;

  /** Callback for resolving AskUserQuestion responses */
  private questionResolver: QuestionResolver | null = null;

  /** Maximum message length for Telegram */
  static readonly MAX_MESSAGE_LENGTH = 4096;

  constructor(config: TelegramAdapterConfig) {
    super(config);
    this.rateLimiter = new RateLimiter(config.rateLimit ?? DEFAULT_RATE_LIMIT);
    // Cast from unknown to CommandDependencies (type is defined in commands module)
    this.commandDeps = config.commandDependencies as CommandDependencies | undefined;

    // Initialize security config
    this.securityConfig = config.securityConfig
      ? {
          allowedUsers: config.securityConfig.allowedUsers,
          whitelistEnabled: config.securityConfig.whitelistEnabled,
          maxMessageLength: config.securityConfig.maxMessageLength,
          promptInjectionDetection: config.securityConfig.promptInjectionDetection,
        }
      : DEFAULT_SECURITY_CONFIG;

    if (this.securityConfig.whitelistEnabled) {
      this.log.info(
        { allowedUserCount: this.securityConfig.allowedUsers.length },
        'Security: User whitelist enabled'
      );
    }
  }

  /**
   * Set command dependencies after construction.
   * This allows for deferred initialization when there are circular dependencies
   * (e.g., MessageProcessor needs adapter, but commands need MessageProcessor).
   *
   * Must be called before initialize() if commands are needed.
   */
  setCommandDependencies(deps: CommandDependencies): void {
    this.commandDeps = deps;
  }

  /**
   * Initialize the bot instance
   */
  protected async doInitialize(): Promise<void> {
    this.bot = new Bot(this.config.token);

    // Set up error handler
    this.bot.catch((err) => {
      const ctx = err.ctx;
      this.log.error(
        {
          error: err.error,
          updateId: ctx.update.update_id,
        },
        'Error in bot update handler'
      );
    });

    // Set up command handlers if dependencies are provided
    if (this.commandDeps !== undefined) {
      this.setupCommandHandlers(this.bot, this.commandDeps);
    }

    // Set up message handler (for non-command text messages)
    // IMPORTANT: Fire-and-forget (void) to avoid blocking grammy's polling loop.
    // If the handler blocks, grammy can't poll for new updates (e.g. callback_query
    // from permission inline keyboards), causing a deadlock.
    this.bot.on('message:text', (ctx) => {
      // Skip if this is a command message and we have command handlers
      if (this.commandDeps !== undefined && ctx.message?.text?.startsWith('/')) {
        return;
      }
      void this.handleTextMessage(ctx).catch((error) => {
        this.log.error({ error }, 'Unhandled error in message handler');
      });
    });

    // Set up callback query handler (inline keyboard buttons)
    // Use bot.on("callback_query:data") for reliable update type detection in polling
    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      this.log.debug({ callbackData: data }, 'Received callback query');

      // Handle permission callbacks (perm_allow, perm_always, perm_deny)
      const permMatch = /^perm_(allow|always|deny):(.+)$/.exec(data);
      if (permMatch !== null) {
        const decision = permMatch[1] as 'allow' | 'always' | 'deny';
        const requestId = permMatch[2] as string;

        if (this.permissionResolver === null) {
          this.log.warn({ requestId }, 'Permission resolver not set, session may have expired');
          await ctx.answerCallbackQuery({ text: '⏳ Permission session expired' });
          return;
        }

        this.log.info({ requestId, decision, toolUseID: requestId }, 'Permission decision received');
        this.permissionResolver(requestId, decision);

        const answerText =
          decision === 'allow'
            ? '✅ Allowed'
            : decision === 'always'
              ? '✅ Always Allowed'
              : '❌ Denied';
        await ctx.answerCallbackQuery({ text: answerText });
        return;
      }

      // Handle question option callbacks (q_opt_<requestId>:<optionIndex>)
      const qMatch = /^q_opt_([^:]+):(\d+)$/.exec(data);
      if (qMatch !== null) {
        const requestId = qMatch[1] as string;
        const optionIndex = parseInt(qMatch[2] as string, 10);

        if (this.questionResolver === null) {
          this.log.warn({ requestId }, 'Question resolver not set, session may have expired');
          await ctx.answerCallbackQuery({ text: '⏳ Question session expired' });
          return;
        }

        // Store the option index; actual label resolution happens in MessageProcessor
        this.log.info({ requestId, optionIndex }, 'Question option selected');
        this.questionResolver(requestId, optionIndex.toString());
        await ctx.answerCallbackQuery({ text: '✅ Selected' });
        return;
      }

      // Unknown callback format — log and ignore
      this.log.debug({ data }, 'Unknown callback query format, ignoring');
    });

    // Verify bot token by getting bot info
    try {
      const me = await this.bot.api.getMe();
      this.log.info(
        { botUsername: me.username, botId: me.id },
        'Bot authenticated'
      );
    } catch (error) {
      if (error instanceof GrammyError) {
        throw new Error(`Failed to authenticate bot: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Set up command handlers for the bot
   */
  private setupCommandHandlers(
    bot: Bot,
    deps: CommandDependencies
  ): void {
    // deps is already CommandDependencies - no conversion needed
    // This is the proper decoupled architecture: commands module defines its dependencies,
    // and adapters simply provide actual instances.

    // Register all command handlers with security middleware
    for (const [command, handler] of Object.entries(COMMAND_HANDLERS)) {
      bot.command(command, async (ctx: Context) => {
        const from = ctx.from;
        if (from === undefined) {
          return;
        }

        const userId = from.id.toString();
        const chatId = ctx.chat?.id.toString() ?? '';

        // Check user authorization for commands
        const validation = validateMessage('', userId, this.securityConfig);
        if (!validation.valid && validation.error === 'unauthorized') {
          auditLogger.logUnauthorizedAccess('telegram', userId, chatId);
          this.log.warn({ userId, chatId, command }, 'Unauthorized command attempt');
          await ctx.reply(getSecurityErrorMessage('unauthorized'));
          return;
        }

        // Log command usage
        const args = ctx.message?.text?.split(' ').slice(1).join(' ');
        auditLogger.logUserCommand('telegram', userId, command, args);

        try {
          await handler(ctx, deps);
        } catch (error) {
          this.log.error({ error, command }, 'Command handler error');
          await ctx.reply('抱歉，處理指令時發生錯誤。');
        }
      });
    }

    this.log.info(
      { commands: Object.keys(COMMAND_HANDLERS) },
      'Command handlers registered'
    );
  }

  /**
   * Start polling for updates
   */
  protected async doStart(): Promise<void> {
    if (this.bot === null) {
      throw new Error('Bot not initialized');
    }

    if (this.config.useWebhook === true) {
      // Webhook mode - not implemented yet
      throw new Error('Webhook mode not implemented yet');
    } else {
      // Polling mode
      this.log.info('Starting bot in polling mode');
      void this.bot.start({
        allowed_updates: ['message', 'callback_query'],
        onStart: (botInfo) => {
          this.log.info(
            { username: botInfo.username },
            'Bot started polling'
          );
        },
      });
    }
  }

  /**
   * Stop polling
   */
  protected async doStop(): Promise<void> {
    if (this.bot !== null) {
      await this.bot.stop();
    }
  }

  /**
   * Dispose bot instance
   */
  protected async doDispose(): Promise<void> {
    this.bot = null;
  }

  /**
   * Handle incoming text message
   */
  private async handleTextMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (message === undefined || message.text === undefined) {
      return;
    }

    const from = message.from;
    if (from === undefined) {
      return;
    }

    const userId = from.id.toString();
    const chatId = message.chat.id.toString();

    // Security validation
    const validation = validateMessage(message.text, userId, this.securityConfig);

    if (!validation.valid) {
      // Log security event
      if (validation.error === 'unauthorized') {
        auditLogger.logUnauthorizedAccess('telegram', userId, chatId);
        this.log.warn({ userId, chatId }, 'Unauthorized access attempt');
      } else if (validation.error === 'message_too_long') {
        auditLogger.logValidationFailed('telegram', userId, 'message_too_long', chatId);
      }

      // Send rejection message
      const errorMessage = getSecurityErrorMessage(validation.error!);
      await ctx.reply(errorMessage);
      return;
    }

    // Check for prompt injection (warning only)
    if (validation.warnings?.includes('potential_prompt_injection')) {
      const patterns = detectPromptInjection(message.text, this.securityConfig);
      auditLogger.logInjectionDetected('telegram', userId, patterns, chatId);
      this.log.warn(
        { userId, chatId, patternCount: patterns.length },
        'Potential prompt injection detected'
      );
      // Continue processing but with warning logged
    }

    const displayName = [from.first_name, from.last_name]
      .filter(Boolean)
      .join(' ');
    const isGroupChat = message.chat.type !== 'private';
    const chatTitle = isGroupChat
      ? (message.chat as { title?: string }).title
      : undefined;
    const replyToMessageId = message.reply_to_message?.message_id.toString();

    const unifiedMessage: UnifiedMessage = {
      id: `telegram:${message.message_id}:${message.chat.id}`,
      platform: 'telegram',
      userId,
      chatId,
      text: message.text,
      timestamp: new Date(message.date * 1000),
      metadata: {
        originalMessageId: message.message_id.toString(),
        displayName,
        isGroupChat,
        ...(from.username !== undefined ? { username: from.username } : {}),
        ...(chatTitle !== undefined ? { chatTitle } : {}),
        ...(replyToMessageId !== undefined ? { replyToMessageId } : {}),
      },
    };

    // Log user message
    auditLogger.logUserMessage(unifiedMessage);

    await this.emitMessage(unifiedMessage);
  }

  /**
   * Send a message to a chat
   */
  async sendMessage(
    chatId: string,
    text: string,
    options?: SendOptions
  ): Promise<SendResult> {
    if (this.bot === null) {
      return { success: false, error: 'Bot not initialized' };
    }

    try {
      // Split long messages
      const chunks = this.splitMessage(text);
      let lastMessageId: string = '';

      for (const chunk of chunks) {
        // Build options object conditionally
        const sendOptions: Parameters<typeof this.bot.api.sendMessage>[2] = {};

        if (options?.parseMode !== undefined) {
          sendOptions.parse_mode = options.parseMode;
        }
        if (options?.replyToMessageId !== undefined) {
          sendOptions.reply_to_message_id = parseInt(options.replyToMessageId, 10);
        }
        if (options?.disableLinkPreview === true) {
          sendOptions.link_preview_options = { is_disabled: true };
        }
        if (options?.disableNotification !== undefined) {
          sendOptions.disable_notification = options.disableNotification;
        }

        const result = await this.rateLimiter.execute(async () => {
          return this.bot!.api.sendMessage(chatId, chunk, sendOptions);
        });

        lastMessageId = result.message_id.toString();
      }

      // Emit message sent event (use first chunk for userId extraction - we don't have it here)
      this.emitMessageSent(chatId, text, chatId);

      return {
        success: true,
        messageId: lastMessageId,
      };
    } catch (error) {
      const errorMessage = this.formatError(error);
      this.log.error({ error, chatId }, 'Failed to send message');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(chatId: string): Promise<void> {
    if (this.bot === null) {
      return;
    }

    try {
      await this.rateLimiter.execute(async () => {
        await this.bot!.api.sendChatAction(chatId, 'typing');
      });
    } catch (error) {
      this.log.warn({ error, chatId }, 'Failed to send typing indicator');
    }
  }


  /**
   * Send an initial status message that will be updated with tool events.
   * Used for real-time feedback during query execution.
   */
  async sendStatusMessage(chatId: string, initialText: string = '🔄 處理中...'): Promise<string | null> {
    if (this.bot === null) {
      return null;
    }

    try {
      const result = await this.rateLimiter.execute(async () => {
        // Use plain text to avoid Markdown parsing issues with tool names
        return await this.bot!.api.sendMessage(chatId, initialText);
      });
      return String(result.message_id);
    } catch (error) {
      this.log.warn({ error, chatId }, 'Failed to send status message');
      return null;
    }
  }

  /**
   * Update an existing status message with new content.
   * Used for real-time feedback during query execution.
   */
  async updateStatusMessage(chatId: string, messageId: string, text: string): Promise<boolean> {
    if (this.bot === null) {
      return false;
    }

    try {
      await this.rateLimiter.execute(async () => {
        // Use plain text to avoid Markdown parsing issues with tool names
        await this.bot!.api.editMessageText(chatId, parseInt(messageId, 10), text);
      });
      return true;
    } catch (error) {
      // Ignore "message is not modified" errors
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes('message is not modified')) {
        this.log.warn({ error, chatId, messageId }, 'Failed to update status message');
      }
      return false;
    }
  }

  /**
   * Store the permission resolver callback for inline keyboard handling.
   */
  override setPermissionResolver(resolver: PermissionResolver): void {
    this.permissionResolver = resolver;
  }

  /**
   * Send a permission prompt with inline keyboard buttons (Allow / Deny).
   */
  override async sendPermissionPrompt(
    chatId: string,
    options: PermissionPromptOptions
  ): Promise<PermissionPromptResult> {
    if (this.bot === null) {
      return { success: false, error: 'Bot not initialized' };
    }

    try {
      const keyboard = new InlineKeyboard()
        .text('✅ Allow', `perm_allow:${options.requestId}`)
        .text('✅ Always', `perm_always:${options.requestId}`)
        .text('❌ Deny', `perm_deny:${options.requestId}`);

      // Format tool input for display (truncate if too long)
      const inputStr = JSON.stringify(options.toolInput, null, 2);
      const displayInput = inputStr.length > 500
        ? inputStr.slice(0, 497) + '...'
        : inputStr;

      const text = [
        '🔐 *Permission Request*',
        '',
        `Tool: \`${options.toolName}\``,
        ...(options.decisionReason ? [`Reason: ${options.decisionReason}`] : []),
        'Input:',
        '```',
        displayInput,
        '```',
      ].join('\n');

      const result = await this.rateLimiter.execute(async () => {
        return this.bot!.api.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      });

      return {
        success: true,
        messageId: result.message_id.toString(),
      };
    } catch (error) {
      const errorMessage = this.formatError(error);
      this.log.error({ error, chatId }, 'Failed to send permission prompt');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update a permission prompt message after the user's decision.
   */
  override async updatePermissionPrompt(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    if (this.bot === null) {
      return;
    }

    try {
      await this.rateLimiter.execute(async () => {
        await this.bot!.api.editMessageText(
          chatId,
          parseInt(messageId, 10),
          text,
          { parse_mode: 'Markdown' }
        );
      });
    } catch (error) {
      this.log.warn(
        { error, chatId, messageId },
        'Failed to update permission prompt'
      );
    }
  }

  /**
   * Store the question resolver callback for AskUserQuestion handling.
   */
  override setQuestionResolver(resolver: QuestionResolver): void {
    this.questionResolver = resolver;
  }

  /**
   * Send a question prompt with inline keyboard buttons for each option.
   */
  override async sendQuestionPrompt(
    chatId: string,
    options: QuestionPromptOptions
  ): Promise<QuestionPromptResult> {
    if (this.bot === null) {
      return { success: false, error: 'Bot not initialized' };
    }

    try {
      // Build keyboard with one button per option
      const keyboard = new InlineKeyboard();
      options.options.forEach((opt, index) => {
        keyboard.text(opt.label, `q_opt_${options.requestId}:${index}`);
        // Add row break every 2 options for better layout
        if ((index + 1) % 2 === 0 && index < options.options.length - 1) {
          keyboard.row();
        }
      });

      // Format the question text
      const optionDescriptions = options.options
        .map((opt, i) => `${i + 1}. **${opt.label}**: ${opt.description}`)
        .join('\n');

      const text = [
        `❓ *${options.header}*`,
        '',
        options.question,
        '',
        optionDescriptions,
      ].join('\n');

      const result = await this.rateLimiter.execute(async () => {
        return this.bot!.api.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      });

      return {
        success: true,
        messageId: result.message_id.toString(),
      };
    } catch (error) {
      const errorMessage = this.formatError(error);
      this.log.error({ error, chatId }, 'Failed to send question prompt');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update a question prompt message after the user's selection.
   */
  override async updateQuestionPrompt(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    if (this.bot === null) {
      return;
    }

    try {
      await this.rateLimiter.execute(async () => {
        await this.bot!.api.editMessageText(
          chatId,
          parseInt(messageId, 10),
          text,
          { parse_mode: 'Markdown' }
        );
      });
    } catch (error) {
      this.log.warn(
        { error, chatId, messageId },
        'Failed to update question prompt'
      );
    }
  }

  /**
   * Split a long message into chunks
   */
  private splitMessage(text: string): string[] {
    if (text.length <= TelegramAdapter.MAX_MESSAGE_LENGTH) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= TelegramAdapter.MAX_MESSAGE_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // Try to split at newline
      let splitIndex = remaining.lastIndexOf(
        '\n',
        TelegramAdapter.MAX_MESSAGE_LENGTH
      );

      // If no newline found, try space
      if (splitIndex === -1 || splitIndex < TelegramAdapter.MAX_MESSAGE_LENGTH / 2) {
        splitIndex = remaining.lastIndexOf(
          ' ',
          TelegramAdapter.MAX_MESSAGE_LENGTH
        );
      }

      // If still no good split point, force split
      if (splitIndex === -1 || splitIndex < TelegramAdapter.MAX_MESSAGE_LENGTH / 2) {
        splitIndex = TelegramAdapter.MAX_MESSAGE_LENGTH;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).trimStart();
    }

    return chunks;
  }

  /**
   * Format error for user display
   */
  private formatError(error: unknown): string {
    if (error instanceof GrammyError) {
      return `Telegram API error: ${error.message}`;
    }
    if (error instanceof HttpError) {
      return `Network error: ${error.message}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error';
  }

  /**
   * Get the underlying bot instance (for advanced usage)
   */
  getBot(): Bot | null {
    return this.bot;
  }
}
