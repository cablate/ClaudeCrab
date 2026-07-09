import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import type { ExitPlanModeBridge } from './ExitPlanModeBridge.js';
import type { PermissionBridge } from './PermissionBridge.js';
import type { QuestionBridge } from './QuestionBridge.js';
import type { CanUseToolOptions, CanUseToolResult } from './InteractionTypes.js';
import { logger } from '../../utils/logger.js';

interface InteractionFlowContext {
  adapter: BaseAdapter;
  chatId: string;
  permissionBridge: PermissionBridge;
  questionBridge: QuestionBridge;
  exitPlanModeBridge: ExitPlanModeBridge;
  permissionRegistry: Map<string, PermissionBridge>;
  questionRegistry: Map<string, QuestionBridge>;
  exitPlanModeRegistry: Map<string, ExitPlanModeBridge>;
}

export async function handleAskUserQuestionFlow(
  ctx: InteractionFlowContext,
  toolInput: Record<string, unknown>,
  options: CanUseToolOptions,
): Promise<CanUseToolResult> {
  const questions = toolInput.questions as
    | Array<{
        question: string;
        header: string;
        options: Array<{ label: string; description: string }>;
        multiSelect: boolean;
      }>
    | undefined;

  if (questions === undefined || questions.length === 0) {
    return { behavior: 'allow', updatedInput: toolInput, toolUseID: options.toolUseID };
  }

  const answers: Record<string, string> = {};

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    if (question === undefined) continue;

    const { requestId, promise } = ctx.questionBridge.requestQuestion(
      question.question,
      question.header,
      question.options.map((opt) => opt.label),
      { signal: options.signal },
    );

    ctx.questionRegistry.set(requestId, ctx.questionBridge);
    void promise.finally(() => ctx.questionRegistry.delete(requestId));

    const questionIndicator = questions.length > 1 ? `(${i + 1}/${questions.length}) ` : '';
    const promptResult = await ctx.adapter.sendQuestionPrompt(ctx.chatId, {
      requestId,
      question: questionIndicator + question.question,
      header: question.header,
      options: question.options,
      multiSelect: question.multiSelect,
    });

    if (!promptResult.success) {
      logger.warn(
        { error: promptResult.error, chatId: ctx.chatId, toolName: 'AskUserQuestion' },
        'Failed to send question prompt, auto-cancelling',
      );
      ctx.questionBridge.resolveQuestion(requestId, { answer: null });
    }

    const questionAnswer = await promise;

    if (promptResult.messageId !== undefined && questionAnswer.answer !== null) {
      await ctx.adapter.updateQuestionPrompt(
        ctx.chatId,
        promptResult.messageId,
        `Selected: *${questionAnswer.answer}*`,
      );
    }

    if (questionAnswer.answer === null) {
      return {
        behavior: 'deny',
        message: `User cancelled question ${i + 1} of ${questions.length}`,
        toolUseID: options.toolUseID,
      };
    }

    answers[question.question] = questionAnswer.answer;
  }

  return {
    behavior: 'allow',
    updatedInput: { questions: toolInput.questions, answers },
    toolUseID: options.toolUseID,
  };
}

export async function handlePermissionFlow(
  ctx: InteractionFlowContext,
  toolName: string,
  toolInput: Record<string, unknown>,
  options: CanUseToolOptions,
): Promise<CanUseToolResult> {
  const bridgeOptions: {
    signal: AbortSignal;
    toolUseID: string;
    decisionReason?: string;
    blockedPath?: string;
  } = { signal: options.signal, toolUseID: options.toolUseID };
  if (options.decisionReason !== undefined) bridgeOptions.decisionReason = options.decisionReason;
  if (options.blockedPath !== undefined) bridgeOptions.blockedPath = options.blockedPath;

  const { requestId, promise } = ctx.permissionBridge.requestPermission(toolName, toolInput, bridgeOptions);

  ctx.permissionRegistry.set(requestId, ctx.permissionBridge);
  void promise.finally(() => ctx.permissionRegistry.delete(requestId));

  const promptOptions: {
    requestId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    decisionReason?: string;
    blockedPath?: string;
  } = { requestId, toolName, toolInput };
  if (options.decisionReason !== undefined) promptOptions.decisionReason = options.decisionReason;
  if (options.blockedPath !== undefined) promptOptions.blockedPath = options.blockedPath;

  const promptResult = await ctx.adapter.sendPermissionPrompt(ctx.chatId, promptOptions);

  if (!promptResult.success) {
    logger.warn(
      { error: promptResult.error, chatId: ctx.chatId, toolName },
      'Failed to send permission prompt, auto-denying',
    );
    ctx.permissionBridge.resolvePermission(requestId, {
      behavior: 'deny',
      message: 'Failed to send permission prompt',
    });
  }

  const decision = await promise;

  if (promptResult.messageId) {
    await ctx.adapter.updatePermissionPrompt(
      ctx.chatId,
      promptResult.messageId,
      formatPermissionStatus(toolName, decision),
    );
  }

  if (decision.behavior === 'allow') {
    const allowResult: CanUseToolResult = {
      behavior: 'allow',
      updatedInput: toolInput,
      toolUseID: options.toolUseID,
    };

    if (decision.alwaysAllow === true) {
      allowResult.updatedPermissions = [
        {
          type: 'addRules',
          rules: [{ toolName }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ];
    }

    return allowResult;
  }

  return {
    behavior: 'deny',
    message: decision.message ?? 'User denied permission',
    toolUseID: options.toolUseID,
  };
}

export async function handleExitPlanModeFlow(
  ctx: InteractionFlowContext,
  toolInput: Record<string, unknown>,
  options: CanUseToolOptions,
): Promise<CanUseToolResult> {
  const allowedPrompts = toolInput.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined;
  const { requestId, promise } = ctx.exitPlanModeBridge.requestReview(allowedPrompts, { signal: options.signal });

  ctx.exitPlanModeRegistry.set(requestId, ctx.exitPlanModeBridge);
  void promise.finally(() => ctx.exitPlanModeRegistry.delete(requestId));

  const promptResult = await ctx.adapter.sendExitPlanModePrompt(ctx.chatId, {
    requestId,
    allowedPrompts,
  });

  if (!promptResult.success) {
    logger.warn(
      { error: promptResult.error, chatId: ctx.chatId },
      'Failed to send plan review prompt, auto-rejecting',
    );
    ctx.exitPlanModeBridge.resolveReview(requestId, {
      approved: false,
      message: 'Failed to send plan review prompt',
    });
  }

  const decision = await promise;

  if (promptResult.messageId) {
    await ctx.adapter.updateExitPlanModePrompt(
      ctx.chatId,
      promptResult.messageId,
      decision.approved ? 'Plan approved' : 'Plan rejected',
    );
  }

  if (decision.approved) {
    return { behavior: 'allow', updatedInput: toolInput, toolUseID: options.toolUseID };
  }

  return {
    behavior: 'deny',
    message: decision.message ?? 'User rejected the plan',
    toolUseID: options.toolUseID,
  };
}

function formatPermissionStatus(
  toolName: string,
  decision: { behavior: 'allow' | 'deny'; alwaysAllow?: boolean; message?: string },
): string {
  if (decision.behavior === 'allow') {
    return decision.alwaysAllow === true
      ? `Always Allowed: \`${toolName}\``
      : `Allowed: \`${toolName}\``;
  }
  if (decision.message?.toLowerCase().includes('timed out')) {
    return `Timed out; auto-denied: \`${toolName}\``;
  }
  return `Denied: \`${toolName}\``;
}
