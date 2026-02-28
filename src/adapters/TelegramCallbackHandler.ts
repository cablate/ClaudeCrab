import { type Context, type Bot, InlineKeyboard } from 'grammy';
import type {
  PermissionResolver,
  QuestionResolver,
  ExitPlanModeResolver,
} from './types.js';
import type { RateLimiter } from './RateLimiter.js';
import type { Logger } from 'pino';

/** Timeout for custom text input (60s) */
const CUSTOM_INPUT_TIMEOUT_MS = 60_000;

/** Dependencies injected from TelegramAdapter */
export interface CallbackHandlerDeps {
  rateLimiter: RateLimiter;
  getBot: () => Bot | null;
  getPermissionResolver: () => PermissionResolver | null;
  getQuestionResolver: () => QuestionResolver | null;
  getExitPlanModeResolver: () => ExitPlanModeResolver | null;
  log: Logger;
}

/**
 * Handles all inline keyboard callback queries for TelegramAdapter.
 * Manages state for custom text input and multi-select interactions.
 */
export class TelegramCallbackHandler {
  private readonly deps: CallbackHandlerDeps;

  /** Tracks chats awaiting custom text input for "Other" option */
  private readonly awaitingCustomInput = new Map<
    string,
    {
      requestId: string;
      promptMessageId: string;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /** Tracks multi-select toggle state per request */
  private readonly multiSelectState = new Map<
    string,
    {
      selectedIndices: Set<number>;
      messageId: string;
      chatId: string;
      options: Array<{ label: string; description: string }>;
    }
  >();

  constructor(deps: CallbackHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Main callback query handler — dispatches to appropriate sub-handler
   */
  async handle(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (data === undefined) return;

    this.deps.log.debug({ callbackData: data }, 'Received callback query');

    // Permission callbacks (perm_allow, perm_always, perm_deny)
    const permMatch = /^perm_(allow|always|deny):(.+)$/.exec(data);
    if (permMatch !== null) {
      await this.handlePermission(ctx, permMatch[1] as 'allow' | 'always' | 'deny', permMatch[2] as string);
      return;
    }

    // Question option callbacks (q_opt_<requestId>:<optionIndex>)
    const qMatch = /^q_opt_([^:]+):(\d+)$/.exec(data);
    if (qMatch !== null) {
      await this.handleQuestionOption(ctx, qMatch[1] as string, parseInt(qMatch[2] as string, 10));
      return;
    }

    // Question "Other" callbacks (q_other_<requestId>)
    const qOtherMatch = /^q_other_(.+)$/.exec(data);
    if (qOtherMatch !== null) {
      await this.handleQuestionOther(ctx, qOtherMatch[1] as string);
      return;
    }

    // Multi-select toggle callbacks (q_toggle_<requestId>:<optionIndex>)
    const qToggleMatch = /^q_toggle_([^:]+):(\d+)$/.exec(data);
    if (qToggleMatch !== null) {
      await this.handleMultiSelectToggle(ctx, qToggleMatch[1] as string, parseInt(qToggleMatch[2] as string, 10));
      return;
    }

    // Multi-select confirm callbacks (q_confirm_<requestId>)
    const qConfirmMatch = /^q_confirm_(.+)$/.exec(data);
    if (qConfirmMatch !== null) {
      await this.handleMultiSelectConfirm(ctx, qConfirmMatch[1] as string);
      return;
    }

    // ExitPlanMode callbacks (plan_approve, plan_reject)
    const planMatch = /^plan_(approve|reject):(.+)$/.exec(data);
    if (planMatch !== null) {
      await this.handlePlanDecision(ctx, planMatch[1] as 'approve' | 'reject', planMatch[2] as string);
      return;
    }

    this.deps.log.debug({ data }, 'Unknown callback query format, ignoring');
  }

  /**
   * Check if incoming text is a custom input response.
   * Returns true if handled (caller should stop processing).
   */
  tryHandleCustomInput(chatId: string, text: string, questionResolver: QuestionResolver | null, replyFn: (msg: string) => Promise<unknown>): boolean {
    const pending = this.awaitingCustomInput.get(chatId);
    if (pending === undefined) return false;

    clearTimeout(pending.timer);
    this.awaitingCustomInput.delete(chatId);

    const customAnswer = text.trim();
    this.deps.log.info(
      { requestId: pending.requestId, chatId, answerLength: customAnswer.length },
      'Custom input received for question'
    );

    if (questionResolver !== null) {
      questionResolver(pending.requestId, `__CUSTOM__:${customAnswer}`);
    }

    void replyFn('✅ 已收到您的答案');
    return true;
  }

  /**
   * Initialize multi-select state for a new question prompt
   */
  initMultiSelectState(
    requestId: string,
    messageId: string,
    chatId: string,
    options: Array<{ label: string; description: string }>
  ): void {
    this.multiSelectState.set(requestId, {
      selectedIndices: new Set(),
      messageId,
      chatId,
      options,
    });
  }

  /**
   * Clear all timers on dispose
   */
  dispose(): void {
    for (const entry of this.awaitingCustomInput.values()) {
      clearTimeout(entry.timer);
    }
    this.awaitingCustomInput.clear();
    this.multiSelectState.clear();
  }

  // --- Private handlers ---

  private async handlePermission(ctx: Context, decision: 'allow' | 'always' | 'deny', requestId: string): Promise<void> {
    const resolver = this.deps.getPermissionResolver();
    if (resolver === null) {
      this.deps.log.warn({ requestId }, 'Permission resolver not set, session may have expired');
      await ctx.answerCallbackQuery({ text: '⏳ Permission session expired' });
      return;
    }

    this.deps.log.info({ requestId, decision, toolUseID: requestId }, 'Permission decision received');
    resolver(requestId, decision);

    const answerText = decision === 'allow' ? '✅ Allowed'
      : decision === 'always' ? '✅ Always Allowed'
      : '❌ Denied';
    await ctx.answerCallbackQuery({ text: answerText });
  }

  private async handleQuestionOption(ctx: Context, requestId: string, optionIndex: number): Promise<void> {
    const resolver = this.deps.getQuestionResolver();
    if (resolver === null) {
      this.deps.log.warn({ requestId }, 'Question resolver not set, session may have expired');
      await ctx.answerCallbackQuery({ text: '⏳ Question session expired' });
      return;
    }

    this.deps.log.info({ requestId, optionIndex }, 'Question option selected');
    resolver(requestId, optionIndex.toString());
    await ctx.answerCallbackQuery({ text: '✅ Selected' });
  }

  private async handleQuestionOther(ctx: Context, requestId: string): Promise<void> {
    const chatId = ctx.chat?.id.toString();
    if (chatId === undefined) {
      await ctx.answerCallbackQuery({ text: '❌ 無法識別對話' });
      return;
    }

    const resolver = this.deps.getQuestionResolver();
    if (resolver === null) {
      this.deps.log.warn({ requestId }, 'Question resolver not set for custom input');
      await ctx.answerCallbackQuery({ text: '⏳ Question session expired' });
      return;
    }

    const timer = setTimeout(() => {
      const pending = this.awaitingCustomInput.get(chatId);
      if (pending?.requestId === requestId) {
        this.awaitingCustomInput.delete(chatId);
        this.deps.log.warn({ requestId, chatId }, 'Custom input timed out');
        const currentResolver = this.deps.getQuestionResolver();
        if (currentResolver !== null) {
          currentResolver(requestId, '__CANCELLED__');
        }
      }
    }, CUSTOM_INPUT_TIMEOUT_MS);

    const promptMessageId = ctx.callbackQuery?.message?.message_id?.toString() ?? '';
    this.awaitingCustomInput.set(chatId, { requestId, promptMessageId, timer });

    this.deps.log.info({ requestId, chatId }, 'Awaiting custom input for question');

    const replyToId = parseInt(promptMessageId, 10);
    await this.deps.rateLimiter.execute(async () => {
      const bot = this.deps.getBot();
      if (bot === null) return;
      if (!isNaN(replyToId) && replyToId > 0) {
        await bot.api.sendMessage(chatId, '📝 請輸入您的答案：', { reply_to_message_id: replyToId });
      } else {
        await bot.api.sendMessage(chatId, '📝 請輸入您的答案：');
      }
    });

    await ctx.answerCallbackQuery({ text: '請輸入您的答案' });
  }

  private async handleMultiSelectToggle(ctx: Context, requestId: string, optionIndex: number): Promise<void> {
    const state = this.multiSelectState.get(requestId);
    if (state === undefined) {
      await ctx.answerCallbackQuery({ text: '⏳ Session expired' });
      return;
    }

    if (state.selectedIndices.has(optionIndex)) {
      state.selectedIndices.delete(optionIndex);
    } else {
      state.selectedIndices.add(optionIndex);
    }

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

    const selectedCount = state.selectedIndices.size;
    await ctx.answerCallbackQuery({ text: `已選 ${selectedCount} 項` });

    this.deps.rateLimiter.execute(async () => {
      const bot = this.deps.getBot();
      if (bot === null) return;
      await bot.api.editMessageReplyMarkup(
        state.chatId,
        parseInt(state.messageId, 10),
        { reply_markup: keyboard }
      );
    }).catch((err) => {
      this.deps.log.warn({ err, requestId }, 'Failed to update keyboard');
    });
  }

  private async handleMultiSelectConfirm(ctx: Context, requestId: string): Promise<void> {
    const state = this.multiSelectState.get(requestId);
    if (state === undefined) {
      await ctx.answerCallbackQuery({ text: '⏳ Session expired' });
      return;
    }

    const resolver = this.deps.getQuestionResolver();
    if (resolver === null) {
      this.deps.log.warn({ requestId }, 'Question resolver not set for multi-select confirm');
      await ctx.answerCallbackQuery({ text: '⏳ Session expired' });
      return;
    }

    const selectedLabels = Array.from(state.selectedIndices)
      .sort((a, b) => a - b)
      .map((index) => state.options[index]?.label ?? '')
      .filter((label) => label !== '');

    if (selectedLabels.length === 0) {
      await ctx.answerCallbackQuery({ text: '請至少選擇一項' });
      return;
    }

    this.multiSelectState.delete(requestId);

    const answer = `__MULTISELECT__:${selectedLabels.join(',')}`;
    this.deps.log.info({ requestId, selectedLabels }, 'Multi-select confirmed');
    resolver(requestId, answer);

    await ctx.answerCallbackQuery({ text: `✅ 已選 ${selectedLabels.length} 項` });
  }

  private async handlePlanDecision(ctx: Context, decision: 'approve' | 'reject', requestId: string): Promise<void> {
    const resolver = this.deps.getExitPlanModeResolver();
    if (resolver === null) {
      this.deps.log.warn({ requestId }, 'ExitPlanMode resolver not set, session may have expired');
      await ctx.answerCallbackQuery({ text: '⏳ Plan review session expired' });
      return;
    }

    this.deps.log.info({ requestId, decision }, 'Plan review decision received');
    resolver(requestId, decision);

    const answerText = decision === 'approve' ? '✅ 已核准' : '❌ 已拒絕';
    await ctx.answerCallbackQuery({ text: answerText });
  }
}
