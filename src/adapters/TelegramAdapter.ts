import { Bot, Context, GrammyError, HttpError, InlineKeyboard, InputFile } from 'grammy';
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
  ExitPlanModePromptOptions,
  ExitPlanModePromptResult,
  ExitPlanModeResolver,
} from './types.js';
import { DEFAULT_RATE_LIMIT } from './types.js';
import {
  COMMAND_HANDLERS,
  routeGroupCommand,
  isGroupCommandProcessed,
  DESTRUCTIVE_COMMANDS,
  isTargetAll,
  type CommandDependencies,
} from './commands/index.js';
import {
  validateMessage,
  getSecurityErrorMessage,
  detectPromptInjection,
  type SecurityConfig,
} from '../utils/security.js';
import { auditLogger } from '../utils/audit.js';
import { getEventBus } from '../core/EventBus.js';
import type { GroupMessagePayload } from '../types/events.js';

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
        reject: (err: unknown) =>
          reject(err instanceof Error ? err : new Error(String(err))),
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

  /** Bot info (username, id) for group message filtering */
  private botInfo: { username: string; id: number } | null = null;
  private readonly rateLimiter: RateLimiter;
  private commandDeps: CommandDependencies | undefined;
  private readonly securityConfig: SecurityConfig;
  private permissionResolver: PermissionResolver | null = null;

  /** Callback for resolving AskUserQuestion responses */
  private questionResolver: QuestionResolver | null = null;

  /** Callback for resolving ExitPlanMode decisions */
  private exitPlanModeResolver: ExitPlanModeResolver | null = null;

  /**
   * Tracks chats awaiting custom input for AskUserQuestion "Other" option.
   * Key: chatId, Value: { requestId, promptMessageId, timer }
   */
  private readonly awaitingCustomInput = new Map<
    string,
    {
      requestId: string;
      promptMessageId: string;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /** Timeout for custom input (60 seconds) */
  private static readonly CUSTOM_INPUT_TIMEOUT_MS = 60_000;

  /**
   * Tracks multi-select state for AskUserQuestion with multiSelect: true.
   * Key: requestId, Value: { selectedIndices, messageId, chatId, options }
   */
  private readonly multiSelectState = new Map<
    string,
    {
      selectedIndices: Set<number>;
      messageId: string;
      chatId: string;
      options: Array<{ label: string; description: string }>;
    }
  >();

  /** Maximum message length for Telegram */
  static readonly MAX_MESSAGE_LENGTH = 4096;

  /**
   * Message debounce buffer (ADR: message-split mitigation).
   * When Telegram splits a long user message into multiple chunks,
   * each chunk triggers handleTextMessage independently. This buffer
   * aggregates messages from the same user+chat within DEBOUNCE_MS
   * and emits them as a single combined message.
   */
  private static readonly DEBOUNCE_MS = 600;
  private readonly messageBuffer = new Map<
    string,
    {
      messages: UnifiedMessage[];
      timer: ReturnType<typeof setTimeout>;
      /** For group chats, store the payload builder */
      groupPayloadBuilder?: (combined: UnifiedMessage) => GroupMessagePayload;
    }
  >();

  constructor(config: TelegramAdapterConfig) {
    super(config);
    this.rateLimiter = new RateLimiter(config.rateLimit ?? DEFAULT_RATE_LIMIT);
    // Cast from unknown to CommandDependencies (type is defined in commands module)
    this.commandDeps = config.commandDependencies as
      | CommandDependencies
      | undefined;

    // Initialize security config
    this.securityConfig = config.securityConfig
      ? {
          allowedUsers: config.securityConfig.allowedUsers,
          whitelistEnabled: config.securityConfig.whitelistEnabled,
          maxMessageLength: config.securityConfig.maxMessageLength,
          promptInjectionDetection:
            config.securityConfig.promptInjectionDetection,
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
   * Get bot info (username, id) for group message handling.
   * Returns null if bot is not initialized yet.
   */
  getBotInfo(): { username: string; id: number } | null {
    return this.botInfo;
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
      if (
        this.commandDeps !== undefined &&
        ctx.message?.text?.startsWith('/')
      ) {
        return;
      }
      void this.handleTextMessage(ctx).catch((error) => {
        this.log.error({ error }, 'Unhandled error in message handler');
      });
    });

    // Set up voice message handler (STT transcription)
    this.bot.on('message:voice', (ctx) => {
      void this.handleVoiceMessage(ctx).catch((error) => {
        this.log.error({ error }, 'Unhandled error in voice handler');
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
          this.log.warn(
            { requestId },
            'Permission resolver not set, session may have expired'
          );
          await ctx.answerCallbackQuery({
            text: '⏳ Permission session expired',
          });
          return;
        }

        this.log.info(
          { requestId, decision, toolUseID: requestId },
          'Permission decision received'
        );
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
          this.log.warn(
            { requestId },
            'Question resolver not set, session may have expired'
          );
          await ctx.answerCallbackQuery({
            text: '⏳ Question session expired',
          });
          return;
        }

        // Store the option index; actual label resolution happens in MessageProcessor
        this.log.info({ requestId, optionIndex }, 'Question option selected');
        this.questionResolver(requestId, optionIndex.toString());
        await ctx.answerCallbackQuery({ text: '✅ Selected' });
        return;
      }

      // Handle question "Other" callbacks (q_other_<requestId>)
      const qOtherMatch = /^q_other_(.+)$/.exec(data);
      if (qOtherMatch !== null) {
        const requestId = qOtherMatch[1] as string;
        const chatId = ctx.chat?.id.toString();

        if (chatId === undefined) {
          await ctx.answerCallbackQuery({ text: '❌ 無法識別對話' });
          return;
        }

        if (this.questionResolver === null) {
          this.log.warn(
            { requestId },
            'Question resolver not set for custom input'
          );
          await ctx.answerCallbackQuery({
            text: '⏳ Question session expired',
          });
          return;
        }

        // Set up awaiting custom input state
        const timer = setTimeout(() => {
          const pending = this.awaitingCustomInput.get(chatId);
          if (pending?.requestId === requestId) {
            this.awaitingCustomInput.delete(chatId);
            this.log.warn({ requestId, chatId }, 'Custom input timed out');
            // Resolve with null to cancel the question
            if (this.questionResolver !== null) {
              this.questionResolver(requestId, '__CANCELLED__');
            }
          }
        }, TelegramAdapter.CUSTOM_INPUT_TIMEOUT_MS);

        // Store the message ID from callback query message
        const promptMessageId = ctx.callbackQuery.message?.message_id?.toString() ?? '';

        this.awaitingCustomInput.set(chatId, {
          requestId,
          promptMessageId,
          timer,
        });

        this.log.info({ requestId, chatId }, 'Awaiting custom input for question');

        // Reply to prompt user for input
        const replyToId = parseInt(promptMessageId, 10);
        await this.rateLimiter.execute(async () => {
          if (!isNaN(replyToId) && replyToId > 0) {
            await this.bot!.api.sendMessage(
              chatId,
              '📝 請輸入您的答案：',
              { reply_to_message_id: replyToId }
            );
          } else {
            await this.bot!.api.sendMessage(chatId, '📝 請輸入您的答案：');
          }
        });

        await ctx.answerCallbackQuery({ text: '請輸入您的答案' });
        return;
      }

      // Handle multi-select toggle callbacks (q_toggle_<requestId>:<optionIndex>)
      const qToggleMatch = /^q_toggle_([^:]+):(\d+)$/.exec(data);
      if (qToggleMatch !== null) {
        const requestId = qToggleMatch[1] as string;
        const optionIndex = parseInt(qToggleMatch[2] as string, 10);

        const state = this.multiSelectState.get(requestId);
        if (state === undefined) {
          await ctx.answerCallbackQuery({ text: '⏳ Session expired' });
          return;
        }

        // Toggle selection
        if (state.selectedIndices.has(optionIndex)) {
          state.selectedIndices.delete(optionIndex);
        } else {
          state.selectedIndices.add(optionIndex);
        }

        // Update keyboard to show selected state
        const keyboard = new InlineKeyboard();
        state.options.forEach((opt, index) => {
          const isSelected = state.selectedIndices.has(index);
          const prefix = isSelected ? '✓ ' : '';
          keyboard.text(`${prefix}${opt.label}`, `q_toggle_${requestId}:${index}`);
          if ((index + 1) % 2 === 0 && index < state.options.length - 1) {
            keyboard.row();
          }
        });
        keyboard.row();
        keyboard.text('✅ 確認選擇', `q_confirm_${requestId}`);
        keyboard.row();
        keyboard.text('📝 其他', `q_other_${requestId}`);

        // Update the message keyboard
        await this.rateLimiter.execute(async () => {
          await this.bot!.api.editMessageReplyMarkup(
            state.chatId,
            parseInt(state.messageId, 10),
            { reply_markup: keyboard }
          );
        });

        const selectedCount = state.selectedIndices.size;
        await ctx.answerCallbackQuery({ text: `已選 ${selectedCount} 項` });
        return;
      }

      // Handle multi-select confirm callbacks (q_confirm_<requestId>)
      const qConfirmMatch = /^q_confirm_(.+)$/.exec(data);
      if (qConfirmMatch !== null) {
        const requestId = qConfirmMatch[1] as string;

        const state = this.multiSelectState.get(requestId);
        if (state === undefined) {
          await ctx.answerCallbackQuery({ text: '⏳ Session expired' });
          return;
        }

        if (this.questionResolver === null) {
          this.log.warn({ requestId }, 'Question resolver not set for multi-select confirm');
          await ctx.answerCallbackQuery({ text: '⏳ Session expired' });
          return;
        }

        // Get selected labels
        const selectedLabels = Array.from(state.selectedIndices)
          .sort((a, b) => a - b)
          .map((index) => state.options[index]?.label ?? '')
          .filter((label) => label !== '');

        if (selectedLabels.length === 0) {
          await ctx.answerCallbackQuery({ text: '請至少選擇一項' });
          return;
        }

        // Clean up state
        this.multiSelectState.delete(requestId);

        // Resolve with __MULTISELECT__: prefix and comma-separated labels
        const answer = `__MULTISELECT__:${selectedLabels.join(',')}`;
        this.log.info({ requestId, selectedLabels }, 'Multi-select confirmed');
        this.questionResolver(requestId, answer);

        await ctx.answerCallbackQuery({ text: `✅ 已選 ${selectedLabels.length} 項` });
        return;
      }

      // Handle ExitPlanMode callbacks (plan_approve, plan_reject)
      const planMatch = /^plan_(approve|reject):(.+)$/.exec(data);
      if (planMatch !== null) {
        const decision = planMatch[1] as 'approve' | 'reject';
        const requestId = planMatch[2] as string;

        if (this.exitPlanModeResolver === null) {
          this.log.warn(
            { requestId },
            'ExitPlanMode resolver not set, session may have expired'
          );
          await ctx.answerCallbackQuery({
            text: '⏳ Plan review session expired',
          });
          return;
        }

        this.log.info({ requestId, decision }, 'Plan review decision received');
        this.exitPlanModeResolver(requestId, decision);

        const answerText = decision === 'approve' ? '✅ 已核准' : '❌ 已拒絕';
        await ctx.answerCallbackQuery({ text: answerText });
        return;
      }

      // Unknown callback format — log and ignore
      this.log.debug({ data }, 'Unknown callback query format, ignoring');
    });

    // Verify bot token by getting bot info
    try {
      const me = await this.bot.api.getMe();
      this.botInfo = { username: me.username, id: me.id };
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
  private setupCommandHandlers(bot: Bot, deps: CommandDependencies): void {
    for (const [command, handler] of Object.entries(COMMAND_HANDLERS)) {
      bot.command(command, async (ctx: Context) => {
        const from = ctx.from;
        if (from === undefined) return;

        const userId = from.id.toString();
        const chatId = ctx.chat?.id.toString() ?? '';

        // Security: check user authorization
        const validation = validateMessage('', userId, this.securityConfig);
        if (!validation.valid && validation.error === 'unauthorized') {
          auditLogger.logUnauthorizedAccess('telegram', userId, chatId);
          this.log.warn({ userId, chatId, command }, 'Unauthorized command attempt');
          await ctx.reply(getSecurityErrorMessage('unauthorized'));
          return;
        }

        // ADR-024: Group command routing
        const isGroupChat = ctx.chat?.type !== 'private';
        if (isGroupChat) {
          const myUsername = ctx.me.username;
          const route = routeGroupCommand(ctx, myUsername);

          if (route === 'other_bot') return;

          const groupChatId = ctx.chat!.id.toString();
          const messageDate = ctx.message?.date ?? 0;

          if (route === 'bare') {
            if (DESTRUCTIVE_COMMANDS.has(command)) {
              // Bare destructive → prompt to specify target (dedup reply)
              if (!isGroupCommandProcessed(groupChatId, messageDate, userId, command)) {
                await ctx.reply(
                  `⚠️ 群組中請指定目標：/${command}@${myUsername} 或 /${command}@all`
                );
              }
              return;
            }
            // Bare read-only → dedup, only first bot responds
            if (isGroupCommandProcessed(groupChatId, messageDate, userId, command)) return;
          }

          // @all destructive → all bots execute silently, first bot sends combined reply
          if (isTargetAll(ctx) && DESTRUCTIVE_COMMANDS.has(command)) {
            const args = ctx.message?.text?.split(' ').slice(1).join(' ');
            auditLogger.logUserCommand('telegram', userId, command, args);

            try {
              await handler(ctx, deps);
            } catch (error) {
              this.log.error({ error, command }, 'Command handler error');
            }

            if (!isGroupCommandProcessed(groupChatId, messageDate, userId, command)) {
              if (command === 'reset') {
                await ctx.reply('🔄 所有 Bot 的對話記錄已清除。\n\n現在可以開始新的對話了！');
              } else if (command === 'stop') {
                await ctx.reply('🛑 已停止所有 Bot 的執行。');
              }
            }
            return;
          }
        }

        // Normal execution (private chat or targeted group command)
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
          this.log.info({ username: botInfo.username }, 'Bot started polling');
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
    // Clear debounce timers
    for (const entry of this.messageBuffer.values()) {
      clearTimeout(entry.timer);
    }
    this.messageBuffer.clear();

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

    // Filter out messages from other bots to prevent infinite loops
    if (from.is_bot === true) {
      this.log.debug({ botId: from.id }, 'Ignoring message from bot');
      return;
    }

    const userId = from.id.toString();
    const chatId = message.chat.id.toString();

    // Check if this chat is awaiting custom input for AskUserQuestion
    const pendingCustom = this.awaitingCustomInput.get(chatId);
    if (pendingCustom !== undefined) {
      // Clear the timeout and state
      clearTimeout(pendingCustom.timer);
      this.awaitingCustomInput.delete(chatId);

      const customAnswer = message.text.trim();
      this.log.info(
        { requestId: pendingCustom.requestId, chatId, answerLength: customAnswer.length },
        'Custom input received for question'
      );

      // Resolve the question with the custom answer
      // Use special prefix to indicate this is a custom answer, not an option index
      if (this.questionResolver !== null) {
        this.questionResolver(pendingCustom.requestId, `__CUSTOM__:${customAnswer}`);
      }

      // Acknowledge receipt
      await ctx.reply('✅ 已收到您的答案');
      return;
    }

    // Security validation
    const validation = validateMessage(
      message.text,
      userId,
      this.securityConfig
    );

    if (!validation.valid) {
      // Log security event
      if (validation.error === 'unauthorized') {
        auditLogger.logUnauthorizedAccess('telegram', userId, chatId);
        this.log.warn({ userId, chatId }, 'Unauthorized access attempt');
      } else if (validation.error === 'message_too_long') {
        auditLogger.logValidationFailed(
          'telegram',
          userId,
          'message_too_long',
          chatId
        );
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

    this.processIncomingMessage(ctx, message.text);
  }

  /**
   * Shared message routing logic for both text and voice messages.
   * Builds UnifiedMessage, logs, and routes to group or private pipeline.
   */
  private processIncomingMessage(
    ctx: Context,
    text: string,
    extraMetadata?: Record<string, unknown>,
  ): void {
    const message = ctx.message!;
    const from = message.from!;
    const userId = from.id.toString();
    const chatId = message.chat.id.toString();

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
      text,
      timestamp: new Date(message.date * 1000),
      metadata: {
        originalMessageId: message.message_id.toString(),
        displayName,
        isGroupChat,
        ...(from.username !== undefined ? { username: from.username } : {}),
        ...(chatTitle !== undefined ? { chatTitle } : {}),
        ...(replyToMessageId !== undefined ? { replyToMessageId } : {}),
        ...extraMetadata,
      },
    };

    // Log user message
    auditLogger.logUserMessage(unifiedMessage);

    // Group chat: emit group:message event for GroupBroadcaster to handle
    if (isGroupChat && this.botInfo !== null) {
      const isMentioned = text.includes(`@${this.botInfo.username}`);
      const isReplyToBot =
        message.reply_to_message?.from?.id === this.botInfo.id;

      // Extract FIRST mentioned bot username from message (e.g., "@bot_name" -> "bot_name")
      // ADR-019: Only the first @mentioned bot responds directly. Multiple @mentions
      // in a single message are handled by delegation (ADR-021/022), not by multi-responder routing.
      const mentionMatch = /@(\w+)/.exec(text);
      const mentionedBot = mentionMatch?.[1] ?? null;

      this.log.debug(
        { chatId, userId, isMentioned, isReplyToBot, mentionedBot },
        'Emitting group message event'
      );

      // Debounce: buffer group message and emit combined after delay
      this.bufferMessage(unifiedMessage, (combined) => {
        const payload: GroupMessagePayload = {
          message: combined,
          sourceAgentId: this.config.agentId,
          mentionedBot,
          isReplyToBot,
        };
        getEventBus().emit('group:message', payload);
      });
      return; // GroupBroadcaster will handle message processing
    }

    // Private chat: debounce then emitMessage
    this.bufferMessage(unifiedMessage, (combined) => {
      void this.emitMessage(combined).catch((error) => {
        this.log.error({ error }, 'Error emitting debounced message');
      });
    });
  }

  /**
   * Handle incoming voice messages: download OGG → STT transcribe → route as text.
   */
  private async handleVoiceMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (message?.voice === undefined) {
      return;
    }

    const from = message.from;
    if (from === undefined) {
      return;
    }

    // Filter out messages from other bots
    if (from.is_bot === true) {
      this.log.debug({ botId: from.id }, 'Ignoring voice from bot');
      return;
    }

    const userId = from.id.toString();
    const chatId = message.chat.id.toString();

    // Allowlist check (pass empty text — only authorization matters for voice)
    const validation = validateMessage('', userId, this.securityConfig);
    if (!validation.valid && validation.error === 'unauthorized') {
      auditLogger.logUnauthorizedAccess('telegram', userId, chatId);
      this.log.warn({ userId, chatId }, 'Unauthorized voice access attempt');
      await ctx.reply(getSecurityErrorMessage('unauthorized'));
      return;
    }

    // Check STT availability
    if (this.config.sttProvider === undefined) {
      this.log.debug({ chatId }, 'Voice message received but STT not configured');
      await ctx.reply('語音輸入功能未啟用，請使用文字輸入。');
      return;
    }

    // Download voice file
    let audioBuffer: Buffer;
    try {
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Voice download failed: ${response.status} ${response.statusText}`);
      }
      audioBuffer = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      this.log.error({ error, chatId, userId }, 'Failed to download voice file');
      await ctx.reply('語音下載失敗，請重新嘗試。');
      return;
    }

    // Transcribe via STT provider
    let text: string;
    let duration: number | undefined;
    let language: string | undefined;
    try {
      const result = await this.config.sttProvider.transcribe(audioBuffer, {
        fileName: 'voice.ogg',
      });
      text = result.text;
      duration = result.duration;
      language = result.language;
    } catch (error) {
      this.log.error({ error, chatId, userId }, 'STT transcription failed');
      await ctx.reply('語音轉換失敗，請重新嘗試或改用文字輸入。');
      return;
    }

    this.log.info(
      { chatId, userId, duration, textLength: text.length },
      'Voice message transcribed'
    );

    this.processIncomingMessage(ctx, text, {
      isVoiceTranscription: true,
      ...(duration !== undefined ? { voiceDuration: duration } : {}),
      ...(language !== undefined ? { voiceLanguage: language } : {}),
    });
  }

  /**
   * Buffer a message for debouncing. If another message from the same user+chat
   * arrives within DEBOUNCE_MS, texts are concatenated and emitted as one.
   * This mitigates Telegram's message splitting for long texts.
   */
  private bufferMessage(
    message: UnifiedMessage,
    onFlush: (combined: UnifiedMessage) => void
  ): void {
    const bufferKey = `${message.userId}:${message.chatId}`;
    const existing = this.messageBuffer.get(bufferKey);

    if (existing) {
      // Append to existing buffer and reset timer
      clearTimeout(existing.timer);
      existing.messages.push(message);
      this.log.debug(
        { bufferKey, count: existing.messages.length },
        'Message buffered (debounce: appending to existing)'
      );
    } else {
      // Start new buffer
      this.messageBuffer.set(bufferKey, {
        messages: [message],
        timer: setTimeout(() => {}, 0), // placeholder, replaced below
      });
      this.log.debug(
        { bufferKey },
        'Message buffered (debounce: new buffer)'
      );
    }

    const entry = this.messageBuffer.get(bufferKey)!;
    entry.timer = setTimeout(() => {
      this.messageBuffer.delete(bufferKey);
      const messages = entry.messages;

      if (messages.length === 1) {
        // Single message — emit as-is
        onFlush(messages[0]!);
        return;
      }

      // Combine multiple messages into one
      const first = messages[0]!;
      const combinedText = messages.map((m) => m.text).join('\n');
      const combined: UnifiedMessage = {
        ...first,
        text: combinedText,
        // Use first message's ID (for idempotency tracking)
        id: first.id,
      };

      this.log.info(
        {
          bufferKey,
          messageCount: messages.length,
          combinedLength: combinedText.length,
        },
        'Debounce: emitting combined message'
      );

      onFlush(combined);
    }, TelegramAdapter.DEBOUNCE_MS);
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
          sendOptions.reply_to_message_id = parseInt(
            options.replyToMessageId,
            10
          );
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
   * Send a local image file as a Telegram photo.
   */
  override async sendPhoto(
    chatId: string,
    filePath: string,
    caption?: string,
  ): Promise<SendResult> {
    if (this.bot === null) {
      return { success: false, error: 'Bot not initialized' };
    }

    try {
      const result = await this.rateLimiter.execute(async () => {
        const opts: Record<string, unknown> = {};
        if (caption) opts.caption = caption.substring(0, 1024);
        return this.bot!.api.sendPhoto(chatId, new InputFile(filePath), opts);
      });

      return { success: true, messageId: result.message_id.toString() };
    } catch (error) {
      const errorMessage = this.formatError(error);
      this.log.error({ error, chatId, filePath }, 'Failed to send photo');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send a document/file to a Telegram chat
   */
  override async sendDocument(
    chatId: string,
    filePath: string,
    caption?: string,
  ): Promise<SendResult> {
    if (this.bot === null) {
      return { success: false, error: 'Bot not initialized' };
    }

    try {
      const result = await this.rateLimiter.execute(async () => {
        const opts: Record<string, unknown> = {};
        if (caption) opts.caption = caption.substring(0, 1024);
        return this.bot!.api.sendDocument(chatId, new InputFile(filePath), opts);
      });

      return { success: true, messageId: result.message_id.toString() };
    } catch (error) {
      const errorMessage = this.formatError(error);
      this.log.error({ error, chatId, filePath }, 'Failed to send document');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send an audio file to a Telegram chat (displayed as playable audio)
   */
  override async sendAudio(
    chatId: string,
    audio: Buffer,
    options?: { duration?: number; caption?: string; filename?: string },
  ): Promise<SendResult> {
    if (this.bot === null) {
      return { success: false, error: 'Bot not initialized' };
    }

    try {
      const result = await this.rateLimiter.execute(async () => {
        const opts: Record<string, unknown> = {};
        if (options?.duration !== undefined) opts.duration = options.duration;
        if (options?.caption) opts.caption = options.caption.substring(0, 1024);
        const filename = options?.filename ?? 'audio.mp3';
        return this.bot!.api.sendAudio(chatId, new InputFile(audio, filename), opts);
      });

      return { success: true, messageId: result.message_id.toString() };
    } catch (error) {
      const errorMessage = this.formatError(error);
      this.log.error({ error, chatId }, 'Failed to send audio');
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
  async sendStatusMessage(
    chatId: string,
    initialText: string = '🔄 處理中...'
  ): Promise<string | null> {
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
  async updateStatusMessage(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<boolean> {
    if (this.bot === null) {
      return false;
    }

    try {
      await this.rateLimiter.execute(async () => {
        // Use plain text to avoid Markdown parsing issues with tool names
        await this.bot!.api.editMessageText(
          chatId,
          parseInt(messageId, 10),
          text
        );
      });
      return true;
    } catch (error) {
      // Ignore "message is not modified" errors
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes('message is not modified')) {
        this.log.warn(
          { error, chatId, messageId },
          'Failed to update status message'
        );
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
      const displayInput =
        inputStr.length > 500 ? inputStr.slice(0, 497) + '...' : inputStr;

      const text = [
        '🔐 *Permission Request*',
        '',
        `Tool: \`${options.toolName}\``,
        ...(options.decisionReason
          ? [`Reason: ${options.decisionReason}`]
          : []),
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
      const keyboard = new InlineKeyboard();

      if (options.multiSelect) {
        // Multi-select mode: use toggle buttons with confirm
        options.options.forEach((opt, index) => {
          keyboard.text(opt.label, `q_toggle_${options.requestId}:${index}`);
          // Add row break every 2 options for better layout
          if ((index + 1) % 2 === 0 && index < options.options.length - 1) {
            keyboard.row();
          }
        });

        // Add confirm and other buttons on new rows
        keyboard.row();
        keyboard.text('✅ 確認選擇', `q_confirm_${options.requestId}`);
        keyboard.row();
        keyboard.text('📝 其他', `q_other_${options.requestId}`);
      } else {
        // Single-select mode: original behavior
        options.options.forEach((opt, index) => {
          keyboard.text(opt.label, `q_opt_${options.requestId}:${index}`);
          // Add row break every 2 options for better layout
          if ((index + 1) % 2 === 0 && index < options.options.length - 1) {
            keyboard.row();
          }
        });

        // Add "Other" button on a new row (SDK says this is auto-provided)
        keyboard.row();
        keyboard.text('📝 其他', `q_other_${options.requestId}`);
      }

      // Format the question text
      const optionDescriptions = options.options
        .map((opt, i) => `${i + 1}. **${opt.label}**: ${opt.description}`)
        .join('\n');

      const multiSelectHint = options.multiSelect ? '\n_(可多選，選完後點「✅ 確認選擇」)_' : '';

      const text = [
        `❓ *${options.header}*`,
        '',
        options.question + multiSelectHint,
        '',
        optionDescriptions,
      ].join('\n');

      const result = await this.rateLimiter.execute(async () => {
        return this.bot!.api.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      });

      // Initialize multi-select state if needed
      if (options.multiSelect) {
        this.multiSelectState.set(options.requestId, {
          selectedIndices: new Set(),
          messageId: result.message_id.toString(),
          chatId,
          options: options.options,
        });
      }

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


  // ============================================================
  // ExitPlanMode Prompt (Plan Review UI)
  // ============================================================

  /**
   * Store the ExitPlanMode resolver callback for plan review handling.
   */
  override setExitPlanModeResolver(resolver: ExitPlanModeResolver): void {
    this.exitPlanModeResolver = resolver;
  }

  /**
   * Send a plan review prompt with inline keyboard buttons (Approve / Reject).
   */
  override async sendExitPlanModePrompt(
    chatId: string,
    options: ExitPlanModePromptOptions
  ): Promise<ExitPlanModePromptResult> {
    if (this.bot === null) {
      return { success: false, error: 'Bot not initialized' };
    }

    try {
      const keyboard = new InlineKeyboard()
        .text('✅ 核准', `plan_approve:${options.requestId}`)
        .text('❌ 拒絕', `plan_reject:${options.requestId}`);

      // Format allowed prompts for display
      const allowedList = options.allowedPrompts?.length
        ? options.allowedPrompts.map((p) => `• ${p.tool}: ${p.prompt}`).join('\n')
        : '（無特殊權限需求）';

      const text = [
        '📋 *Plan Review*',
        '',
        'Claude 已完成計畫，請審核：',
        '',
        '*執行時需要的權限：*',
        allowedList,
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
      this.log.error({ error, chatId }, 'Failed to send plan review prompt');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update a plan review prompt message after the user's decision.
   */
  override async updateExitPlanModePrompt(
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
        'Failed to update plan review prompt'
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
      if (
        splitIndex === -1 ||
        splitIndex < TelegramAdapter.MAX_MESSAGE_LENGTH / 2
      ) {
        splitIndex = remaining.lastIndexOf(
          ' ',
          TelegramAdapter.MAX_MESSAGE_LENGTH
        );
      }

      // If still no good split point, force split
      if (
        splitIndex === -1 ||
        splitIndex < TelegramAdapter.MAX_MESSAGE_LENGTH / 2
      ) {
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
