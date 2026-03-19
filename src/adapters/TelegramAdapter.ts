/**
 * TelegramAdapter — Telegram platform adapter using grammy.
 *
 * Handles message receiving/routing, message sending (text/photo/audio/document/video),
 * interactive UI (Permission/Question/ExitPlanMode prompts via InlineKeyboard),
 * and connection health monitoring.
 *
 * Uses RateLimiter for all Telegram API calls to prevent 429 errors.
 * Supports group chat routing via GroupBroadcaster integration.
 */

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
import { ConnectionHealthMonitor, type ConnectionState } from './ConnectionHealthMonitor.js';
import {
  COMMAND_HANDLERS,
  routeGroupCommand,
  isGroupCommandProcessed,
  DESTRUCTIVE_COMMANDS,
  isTargetAll,
  applyModelChange,
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
import { RateLimiter, computeLatencyStats, type LatencyStats } from './RateLimiter.js';
import { TelegramCallbackHandler } from './TelegramCallbackHandler.js';
import { convertToTelegramMarkdown } from '../utils/telegramMarkdown.js';

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

  private callbackHandler: TelegramCallbackHandler | null = null;

  /**
   * Message arrival latency tracking (message.date vs receive time)
   */
  private readonly messageLatencyHistory: number[] = [];
  private static readonly MAX_LATENCY_HISTORY = 100;
  /** Ignore message latency above 10 min (clock skew) */
  private static readonly MAX_REASONABLE_LATENCY_MS = 600_000;

  /** Connection health monitor for proactive alerting */
  private readonly connectionHealth = new ConnectionHealthMonitor();
  /** Last active chat ID for proactive alerts */
  private lastActiveChatId: string | null = null;
  /** Cooldown to prevent alert spam (epoch ms) */
  private alertCooldownUntil = 0;
  private static readonly ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

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
    this.rateLimiter = new RateLimiter(config.rateLimit ?? DEFAULT_RATE_LIMIT, this.connectionHealth);
    this.setupConnectionHealthAlerts();
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
   * Assert that bot is initialized and return it.
   * Throws if called before start().
   */
  private assertBot(): Bot<Context> {
    if (this.bot === null) {
      throw new Error('TelegramAdapter: bot not initialized. Call start() first.');
    }
    return this.bot;
  }

  /**
   * Assert that callbackHandler is initialized and return it.
   * Throws if called before start().
   */
  private assertCallbackHandler(): TelegramCallbackHandler {
    if (this.callbackHandler === null) {
      throw new Error('TelegramAdapter: callbackHandler not initialized. Call start() first.');
    }
    return this.callbackHandler;
  }

  /**
   * Get bot info (username, id) for group message handling.
   * Returns null if bot is not initialized yet.
   */
  override getBotInfo(): { username: string; id: number } | null {
    return this.botInfo;
  }

  /**
   * Initialize the bot instance
   */
  protected async doInitialize(): Promise<void> {
    this.bot = new Bot(this.config.token, {
      client: {
        timeoutSeconds: 60, // default 500s is too long; 60s covers long-poll + API response
      },
    });

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
      // Only skip messages that match a registered bot command (e.g. /help, /reset).
      // Unrecognized slash commands (e.g. /commit, /review-pr) should pass through
      // to the AI — they may be Claude Code skills or slash commands.
      if (
        this.commandDeps !== undefined &&
        ctx.message?.text?.startsWith('/')
      ) {
        const commandName = ctx.message.text.split(/[\s@]/)[0]?.slice(1);
        if (commandName !== undefined && (commandName in COMMAND_HANDLERS || commandName === 'apistats')) {
          return; // Handled by bot.command() — don't double-process
        }
        // Unknown command (e.g. /commit) — fall through to AI processing
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

    // Set up document message handler (extract text from .txt/.md attachments)
    // Telegram auto-converts long pasted text into .txt file attachments.
    this.bot.on('message:document', (ctx) => {
      void this.handleDocumentMessage(ctx).catch((error) => {
        this.log.error({ error }, 'Unhandled error in document handler');
      });
    });

    // Set up callback query handler (delegated to TelegramCallbackHandler)
    this.callbackHandler = new TelegramCallbackHandler({
      rateLimiter: this.rateLimiter,
      getBot: () => this.bot,
      getPermissionResolver: () => this.permissionResolver,
      getQuestionResolver: () => this.questionResolver,
      getExitPlanModeResolver: () => this.exitPlanModeResolver,
      log: this.log,
    });
    this.bot.on('callback_query:data', (ctx) => {
      const data = ctx.callbackQuery?.data;

      // Model selection callback — handle here since it needs agentLoader
      if (data?.startsWith('model_set:') && this.commandDeps) {
        void this.handleModelCallback(ctx, data).catch((error) => {
          this.log.error({ error }, 'Unhandled error in model callback');
        });
        return;
      }

      void this.assertCallbackHandler().handle(ctx).catch((error) => {
        this.log.error({ error }, 'Unhandled error in callback handler');
      });
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

    // Set command menu for Telegram UI (fire-and-forget, non-fatal)
    // Keep in sync with COMMAND_HANDLERS + adapter-internal commands (apistats)
    void this.bot.api.setMyCommands([
      { command: 'start', description: '開始使用' },
      { command: 'help', description: '顯示幫助訊息' },
      { command: 'reset', description: '清除對話記錄' },
      { command: 'stop', description: '停止執行中的回應' },
      { command: 'model', description: '切換 AI 模型' },
      { command: 'schedule', description: '管理排程任務' },
      { command: 'status', description: '顯示 Bot 狀態' },
      { command: 'members', description: '群組成員列表' },
      { command: 'restart', description: '重啟 Bot' },
      { command: 'apistats', description: '查看連線延遲統計' },
    ]).catch((err) => {
      this.log.warn({ err }, 'Failed to set bot commands (non-fatal)');
    });
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

    // Internal /apistats command for latency monitoring
    bot.command('apistats', async (ctx: Context) => {
      const apiStats = this.rateLimiter.getLatencyStats();
      const msgStats = this.getMessageLatencyStats();
      const retryStats = this.rateLimiter.getRetryStats();
      const healthInfo = this.connectionHealth.getHealthInfo();

      const stateLabel = healthInfo.state === 'healthy' ? '✅ 正常' : healthInfo.state === 'degraded' ? '⚠️ 緩慢' : '❌ 異常';
      const durationMin = Math.round(healthInfo.stateDurationMs / 60_000);

      const text = [
        '📊 *Telegram 連線狀態*',
        '',
        `🔗 *連線品質：* ${stateLabel}（已維持 ${durationMin} 分鐘）`,
        ...(healthInfo.consecutiveFailures > 0
          ? [`   連續失敗 ${healthInfo.consecutiveFailures} 次`]
          : []),
        '',
        `📤 *發送延遲*（${apiStats.count} 次呼叫）`,
        `   一般: ${apiStats.avgMs}ms｜多數: ${apiStats.p50Ms}ms｜最慢 5%: ${apiStats.p95Ms}ms`,
        `   重試: ${retryStats.retries} 次｜失敗: ${retryStats.failures} 次｜排隊中: ${this.rateLimiter.queueSize}`,
        '',
        `📥 *收訊延遲*（${msgStats.count} 則訊息）`,
        `   一般: ${msgStats.avgMs}ms｜多數: ${msgStats.p50Ms}ms｜最慢 5%: ${msgStats.p95Ms}ms`,
      ].join('\n');
      await ctx.reply(text, { parse_mode: 'Markdown' });
    });
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
      this.bot.start({
        allowed_updates: ['message', 'callback_query'],
        timeout: 30, // explicit long-poll timeout (grammY default is 30, but make it auditable)
        onStart: (botInfo) => {
          this.log.info({ username: botInfo.username }, 'Bot started polling');
        },
      }).catch(async (err) => {
        this.log.error({ err }, 'Polling loop crashed — attempting auto-recovery');

        // Wait before retry to avoid tight loop
        const retryDelay = 5000;
        this.log.info({ retryDelay }, 'Waiting before polling restart');
        await new Promise(r => setTimeout(r, retryDelay));

        try {
          if (!this.bot) return; // adapter disposed during wait
          // Stop the bot cleanly, then restart polling
          try { await this.bot.stop(); } catch { /* ignore stop errors */ }
          this.log.info('Restarting polling loop');
          this.bot!.start({
            allowed_updates: ['message', 'callback_query'],
            timeout: 30,
            onStart: (botInfo) => {
              this.log.info({ username: botInfo.username }, 'Bot re-started polling after crash recovery');
            },
          }).catch((retryErr) => {
            this.log.error({ err: retryErr }, 'Polling loop crashed again after recovery — giving up on this adapter');
            // Don't process.exit — let other adapters keep running
          });
        } catch (recoveryErr) {
          this.log.error({ err: recoveryErr }, 'Polling crash recovery failed');
        }
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

    this.callbackHandler?.dispose();
    this.callbackHandler = null;
    this.bot = null;
  }

  /**
   * Handle model selection callback from inline keyboard
   */
  private async handleModelCallback(ctx: Context, data: string): Promise<void> {
    const MODEL_LABELS: Record<string, string> = {
      opus: '🟣 Opus',
      sonnet: '🔵 Sonnet',
      haiku: '🟢 Haiku',
    };

    const parts = data.split(':');
    const agentId = parts[1];
    const model = parts[2];

    if (agentId === undefined || model === undefined || !['opus', 'sonnet', 'haiku'].includes(model)) {
      await ctx.answerCallbackQuery({ text: '❌ 無效的選擇' });
      return;
    }

    try {
      const result = await applyModelChange(agentId, model, this.commandDeps!.agentLoader);
      if (!result.success) {
        await ctx.answerCallbackQuery({ text: `❌ ${result.error}` });
        return;
      }

      // Update the message to show the new selection
      const keyboard = new InlineKeyboard();
      for (const m of ['opus', 'sonnet', 'haiku']) {
        const label = m === model
          ? `${MODEL_LABELS[m]} ✓`
          : MODEL_LABELS[m]!;
        keyboard.text(label, `model_set:${agentId}:${m}`);
      }

      await ctx.editMessageText(
        `🤖 目前模型：**${MODEL_LABELS[model]}**\n\n選擇要切換的模型：`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
      await ctx.answerCallbackQuery({ text: `✅ 已切換至 ${MODEL_LABELS[model]}` });

      this.log.info({ agentId, model }, 'Model changed via Telegram command');
    } catch (error) {
      this.log.error({ error, agentId, model }, 'Failed to change model');
      await ctx.answerCallbackQuery({ text: '❌ 切換失敗' });
    }
  }

  /**
   * Handle incoming text message
   */
  private async handleTextMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (message === undefined || message.text === undefined) {
      return;
    }

    // Track message arrival latency (message.date is Unix timestamp in seconds)
    if (message.date !== undefined) {
      const messageTimestamp = message.date * 1000; // Convert to ms
      const arrivalLatency = Date.now() - messageTimestamp;
      if (arrivalLatency >= 0 && arrivalLatency < TelegramAdapter.MAX_REASONABLE_LATENCY_MS) {
        // Ignore negative or >10min (clock skew)
        this.messageLatencyHistory.push(arrivalLatency);
        if (this.messageLatencyHistory.length > TelegramAdapter.MAX_LATENCY_HISTORY) {
          this.messageLatencyHistory.shift();
        }
      }
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

    // Track last active chat for proactive alerts
    this.lastActiveChatId = chatId;

    // Check if this chat is awaiting custom input for AskUserQuestion
    if (this.callbackHandler?.tryHandleCustomInput(
      chatId,
      message.text,
      this.questionResolver,
      (msg: string) => ctx.reply(msg),
    )) {
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
   * Handle incoming document messages: extract text from .txt/.md attachments.
   * Telegram auto-converts long pasted text (>4096 chars) into .txt file attachments.
   */
  private async handleDocumentMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (message?.document === undefined) {
      return;
    }

    const doc = message.document;
    const fileName = doc.file_name ?? '';
    const mimeType = doc.mime_type ?? '';

    // Only handle text-based files that are likely pasted long messages
    const isTextFile =
      fileName.endsWith('.txt') || fileName.endsWith('.md');
    const isTextMime = mimeType.startsWith('text/');
    if (!isTextFile && !isTextMime) {
      return;
    }

    const from = message.from;
    if (from === undefined) {
      return;
    }

    // Filter out messages from other bots
    if (from.is_bot === true) {
      this.log.debug({ botId: from.id }, 'Ignoring document from bot');
      return;
    }

    const userId = from.id.toString();
    const chatId = message.chat.id.toString();

    // Track last active chat for proactive alerts
    this.lastActiveChatId = chatId;

    // Allowlist check (pass empty text — only authorization matters for document)
    const validation = validateMessage('', userId, this.securityConfig);
    if (!validation.valid && validation.error === 'unauthorized') {
      auditLogger.logUnauthorizedAccess('telegram', userId, chatId);
      this.log.warn({ userId, chatId }, 'Unauthorized document access attempt');
      await ctx.reply(getSecurityErrorMessage('unauthorized'));
      return;
    }

    // Download and read file content
    let text: string;
    try {
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Document download failed: ${response.status} ${response.statusText}`);
      }
      text = await response.text();
    } catch (error) {
      this.log.error({ error, chatId, userId, fileName }, 'Failed to download document file');
      await ctx.reply('檔案下載失敗，請重新嘗試。');
      return;
    }

    if (text.trim().length === 0) {
      return;
    }

    // Prepend caption if present (user may add context before the file)
    if (message.caption !== undefined && message.caption.length > 0) {
      text = `${message.caption}\n\n${text}`;
    }

    this.log.info(
      { userId, chatId, fileName, size: doc.file_size, textLength: text.length },
      'Extracted text from document attachment'
    );

    // Skip maxMessageLength validation — this is intentionally long text.
    // Check for prompt injection (warning only)
    const patterns = detectPromptInjection(text, this.securityConfig);
    if (patterns.length > 0) {
      auditLogger.logInjectionDetected('telegram', userId, patterns, chatId);
      this.log.warn(
        { userId, chatId, patternCount: patterns.length },
        'Potential prompt injection detected in document'
      );
    }

    this.processIncomingMessage(ctx, text);
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
          return this.assertBot().api.sendMessage(chatId, chunk, sendOptions);
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
   * Platform-aware formatted send: MarkdownV2 → Markdown → plaintext fallback.
   */
  override async sendFormattedMessage(
    chatId: string,
    text: string,
    options?: SendOptions
  ): Promise<SendResult> {
    const converted = convertToTelegramMarkdown(text);
    let result: SendResult = converted
      ? await this.sendMessage(chatId, converted, {
          parseMode: 'MarkdownV2',
          ...options,
        })
      : { success: false as const, error: 'Conversion failed' };

    if (!result.success) {
      result = await this.sendMessage(chatId, text, {
        parseMode: 'Markdown',
        ...options,
      });
    }

    // Final fallback: plain text to ensure delivery
    if (!result.success) {
      result = await this.sendMessage(chatId, text, options);
    }

    return result;
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
        return this.assertBot().api.sendPhoto(chatId, new InputFile(filePath), opts);
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
        return this.assertBot().api.sendDocument(chatId, new InputFile(filePath), opts);
      });

      return { success: true, messageId: result.message_id.toString() };
    } catch (error) {
      const errorMessage = this.formatError(error);
      this.log.error({ error, chatId, filePath }, 'Failed to send document');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send a video to a Telegram chat (displayed as playable video)
   */
  override async sendVideo(
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
        return this.assertBot().api.sendVideo(chatId, new InputFile(filePath), opts);
      });

      return { success: true, messageId: result.message_id.toString() };
    } catch (error) {
      const errorMessage = this.formatError(error);
      this.log.error({ error, chatId, filePath }, 'Failed to send video');
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
        return this.assertBot().api.sendAudio(chatId, new InputFile(audio, filename), opts);
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
        await this.assertBot().api.sendChatAction(chatId, 'typing');
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
        return await this.assertBot().api.sendMessage(chatId, initialText);
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
        await this.assertBot().api.editMessageText(
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
        return this.assertBot().api.sendMessage(chatId, text, {
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
        await this.assertBot().api.editMessageText(
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
        return this.assertBot().api.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      });

      // Initialize multi-select state if needed
      if (options.multiSelect) {
        this.assertCallbackHandler().initMultiSelectState(
          options.requestId,
          result.message_id.toString(),
          chatId,
          options.options,
        );
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
        await this.assertBot().api.editMessageText(
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
        return this.assertBot().api.sendMessage(chatId, text, {
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
        await this.assertBot().api.editMessageText(
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

  /**
   * Get message arrival latency statistics (polling delay)
   */
  getMessageLatencyStats(): LatencyStats {
    return computeLatencyStats(this.messageLatencyHistory);
  }

  /**
   * Set up connection health change alerts.
   * When state degrades, sends a warning to the last active chat.
   * When state recovers, sends a recovery notice.
   */
  private setupConnectionHealthAlerts(): void {
    this.connectionHealth.onStateChange = (prev: ConnectionState, next: ConnectionState, info) => {

      // Emit event for EventBus consumers
      getEventBus().emit('connection:healthChanged', {
        agentId: this.config.agentId,
        previousState: prev,
        newState: next,
        details: {
          consecutiveFailures: info.consecutiveFailures,
          recentP95Ms: info.recentP95Ms,
        },
      });

      // Send user-facing alert if we have a chat to notify
      if (this.lastActiveChatId === null || this.bot === null) return;

      const now = Date.now();
      if (now < this.alertCooldownUntil) return;
      this.alertCooldownUntil = now + TelegramAdapter.ALERT_COOLDOWN_MS;

      let alertText: string;
      if (next === 'healthy') {
        alertText = `✅ Telegram 連線已恢復正常（延遲 ${info.recentP95Ms}ms）`;
      } else {
        const icon = next === 'unhealthy' ? '❌' : '⚠️';
        const label = next === 'unhealthy' ? '連線異常' : '連線變慢';
        alertText = `${icon} ${label}（延遲 ${info.recentP95Ms}ms，連續失敗 ${info.consecutiveFailures} 次）`;
      }

      // Fire-and-forget alert
      void this.bot.api.sendMessage(this.lastActiveChatId, alertText).catch((err) => {
        this.log.warn({ error: err }, 'Failed to send connection health alert');
      });
    };
  }
}
