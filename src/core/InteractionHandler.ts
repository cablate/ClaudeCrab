/**
 * Handles interactive tool approval (permissions) and user questions
 * during SDK query execution.
 *
 * Extracted from MessageProcessor.executeQueryWithSDK to isolate the
 * concern of user interaction bridging (PermissionBridge + QuestionBridge).
 */

import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import { PermissionBridge } from './PermissionBridge.js';
import { QuestionBridge } from './QuestionBridge.js';
import { ExitPlanModeBridge } from './ExitPlanModeBridge.js';
import { getEventBus } from './EventBus.js';
import { logger } from '../utils/logger.js';

/**
 * The result type expected by the SDK's canUseTool callback.
 */
export type CanUseToolResult =
  | {
      behavior: 'allow';
      updatedInput: Record<string, unknown>;
      toolUseID: string;
      updatedPermissions?: Array<{
        type: 'addRules';
        rules: Array<{ toolName: string }>;
        behavior: 'allow';
        destination: 'localSettings';
      }>;
    }
  | {
      behavior: 'deny';
      message: string;
      toolUseID: string;
    };

/**
 * Options passed to the canUseTool callback from the SDK.
 */
export interface CanUseToolOptions {
  signal: AbortSignal;
  blockedPath?: string;
  decisionReason?: string;
  toolUseID: string;
}

/**
 * Manages user interaction bridges for permission prompts and question prompts.
 *
 * Lifecycle:
 * 1. Create instance with adapter and chatId
 * 2. Use `buildCanUseTool()` to get the callback for SDK
 * 3. Call `dispose()` in the finally block to clean up pending requests
 */
export class InteractionHandler {
  // Static registries — allow Web UI API to resolve bridges by requestId
  static readonly permissionRegistry = new Map<string, PermissionBridge>();
  static readonly questionRegistry = new Map<string, QuestionBridge>();
  static readonly exitPlanModeRegistry = new Map<string, ExitPlanModeBridge>();

  private readonly adapter: BaseAdapter;
  private readonly chatId: string;
  private readonly agentId: string;
  private readonly permissionBridge: PermissionBridge;
  private readonly questionBridge: QuestionBridge;
  private readonly exitPlanModeBridge: ExitPlanModeBridge;

  constructor(adapter: BaseAdapter, chatId: string, timeoutMs = 120_000, agentId = '') {
    this.adapter = adapter;
    this.chatId = chatId;
    this.agentId = agentId;
    this.permissionBridge = new PermissionBridge(timeoutMs);
    this.questionBridge = new QuestionBridge(timeoutMs);
    this.exitPlanModeBridge = new ExitPlanModeBridge(timeoutMs);

    // Wire up adapter resolvers to bridges
    adapter.setPermissionResolver((requestId, decision) => {
      if (decision === 'always') {
        this.permissionBridge.resolvePermission(requestId, {
          behavior: 'allow',
          alwaysAllow: true,
        });
      } else if (decision === 'allow') {
        this.permissionBridge.resolvePermission(requestId, {
          behavior: 'allow',
        });
      } else {
        this.permissionBridge.resolvePermission(requestId, {
          behavior: 'deny',
          message: 'User denied permission',
        });
      }
    });

    adapter.setQuestionResolver((requestId, answer) => {
      if (answer === null) {
        this.questionBridge.resolveQuestion(requestId, { answer: null });
      } else if (answer === '__CANCELLED__') {
        // Custom input timed out or cancelled
        this.questionBridge.resolveQuestion(requestId, { answer: null });
      } else if (answer.startsWith('__CUSTOM__:')) {
        // Custom input from "Other" option
        const customAnswer = answer.slice('__CUSTOM__:'.length);
        this.questionBridge.resolveQuestion(requestId, {
          answer: customAnswer,
        });
      } else if (answer.startsWith('__MULTISELECT__:')) {
        // Multi-select: comma-separated labels
        const selectedLabels = answer.slice('__MULTISELECT__:'.length);
        this.questionBridge.resolveQuestion(requestId, {
          answer: selectedLabels,
        });
      } else {
        // Normal option selection by index
        const optionLabels = this.questionBridge.getOptionLabels(requestId);
        const optionIndex = parseInt(answer, 10);
        const selectedLabel = optionLabels?.[optionIndex] ?? answer;
        this.questionBridge.resolveQuestion(requestId, {
          answer: selectedLabel,
        });
      }
    });

    adapter.setExitPlanModeResolver((requestId, decision) => {
      this.exitPlanModeBridge.resolveReview(requestId, {
        approved: decision === 'approve',
        message: decision === 'approve' ? undefined : 'User rejected the plan',
      });
    });
  }

  /**
   * Build the canUseTool callback for the SDK.
   * This is the main entry point — pass the returned function to SDK options.
   */
  buildCanUseTool(): (
    toolName: string,
    toolInput: Record<string, unknown>,
    options: CanUseToolOptions
  ) => Promise<CanUseToolResult> {
    return async (
      toolName: string,
      toolInput: Record<string, unknown>,
      options: CanUseToolOptions
    ): Promise<CanUseToolResult> => {
      // Handle AskUserQuestion tool
      if (toolName === 'AskUserQuestion') {
        return this.handleAskUserQuestion(toolInput, options);
      }

      // Handle ExitPlanMode tool with dedicated UI
      if (toolName === 'ExitPlanMode') {
        return this.handleExitPlanMode(toolInput, options);
      }

      // Normal permission flow for other tools
      return this.handlePermission(toolName, toolInput, options);
    };
  }

  /**
   * Clean up: deny any pending requests and reset adapter resolvers.
   */
  dispose(): void {
    this.permissionBridge.cancelAll();
    this.questionBridge.cancelAll();
    this.exitPlanModeBridge.cancelAll();
    this.adapter.setPermissionResolver(() => {});
    this.adapter.setQuestionResolver(() => {});
    this.adapter.setExitPlanModeResolver(() => {});
  }

  // --- Private handlers ---

  private async handleAskUserQuestion(
    toolInput: Record<string, unknown>,
    options: CanUseToolOptions
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
      return {
        behavior: 'allow',
        updatedInput: toolInput,
        toolUseID: options.toolUseID,
      };
    }

    const answers: Record<string, string> = {};

    // Process each question sequentially
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      if (question === undefined) continue;

      const optionLabels = question.options.map((opt) => opt.label);

      const { requestId, promise } = this.questionBridge.requestQuestion(
        question.question,
        question.header,
        optionLabels,
        { signal: options.signal }
      );

      // Register bridge for Web UI resolution + broadcast via SSE
      InteractionHandler.questionRegistry.set(requestId, this.questionBridge);
      void promise.finally(() => InteractionHandler.questionRegistry.delete(requestId));

      getEventBus().emitSync('interaction', {
        type: 'question_request',
        requestId,
        agentId: this.agentId,
        question: question.question,
        header: question.header,
        options: question.options,
        multiSelect: question.multiSelect,
      });

      // Add question number indicator for multi-question flows
      const questionIndicator = questions.length > 1 ? `(${i + 1}/${questions.length}) ` : '';

      const promptResult = await this.adapter.sendQuestionPrompt(this.chatId, {
        requestId,
        question: questionIndicator + question.question,
        header: question.header,
        options: question.options,
        multiSelect: question.multiSelect,
      });

      if (!promptResult.success) {
        logger.warn(
          { error: promptResult.error, chatId: this.chatId, toolName: 'AskUserQuestion' },
          'Failed to send question prompt, auto-cancelling'
        );
        this.questionBridge.resolveQuestion(requestId, { answer: null });
      }

      const questionAnswer = await promise;

      // Update the prompt message with the selection
      if (promptResult.messageId !== undefined && questionAnswer.answer !== null) {
        const statusText = `✅ Selected: *${questionAnswer.answer}*`;
        await this.adapter.updateQuestionPrompt(
          this.chatId,
          promptResult.messageId,
          statusText
        );
      }

      // If user cancels any question, abort the entire flow
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

  private async handlePermission(
    toolName: string,
    toolInput: Record<string, unknown>,
    options: CanUseToolOptions
  ): Promise<CanUseToolResult> {
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

    const { requestId, promise } = this.permissionBridge.requestPermission(
      toolName,
      toolInput,
      bridgeOptions
    );

    // Register bridge for Web UI resolution + broadcast via SSE
    InteractionHandler.permissionRegistry.set(requestId, this.permissionBridge);
    void promise.finally(() => InteractionHandler.permissionRegistry.delete(requestId));

    getEventBus().emitSync('interaction', {
      type: 'permission_request' as const,
      requestId,
      agentId: this.agentId,
      toolName,
      ...(options.decisionReason !== undefined ? { decisionReason: options.decisionReason } : {}),
    });

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

    const promptResult = await this.adapter.sendPermissionPrompt(
      this.chatId,
      promptOptions
    );

    if (!promptResult.success) {
      logger.warn(
        { error: promptResult.error, chatId: this.chatId, toolName },
        'Failed to send permission prompt, auto-denying'
      );
      this.permissionBridge.resolvePermission(requestId, {
        behavior: 'deny',
        message: 'Failed to send permission prompt',
      });
    }

    const decision = await promise;

    // Update the prompt message with the decision
    if (promptResult.messageId) {
      let statusText: string;
      if (decision.behavior === 'allow') {
        statusText =
          decision.alwaysAllow === true
            ? `✅ Always Allowed: \`${toolName}\``
            : `✅ Allowed: \`${toolName}\``;
      } else {
        statusText = `❌ Denied: \`${toolName}\``;
      }
      await this.adapter.updatePermissionPrompt(
        this.chatId,
        promptResult.messageId,
        statusText
      );
    }

    if (decision.behavior === 'allow') {
      const allowResult: CanUseToolResult = {
        behavior: 'allow',
        updatedInput: toolInput,
        toolUseID: options.toolUseID,
      };

      if (decision.alwaysAllow === true) {
        (
          allowResult as {
            updatedPermissions?: Array<{
              type: 'addRules';
              rules: Array<{ toolName: string }>;
              behavior: 'allow';
              destination: 'localSettings';
            }>;
          }
        ).updatedPermissions = [
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


  private async handleExitPlanMode(
    toolInput: Record<string, unknown>,
    options: CanUseToolOptions
  ): Promise<CanUseToolResult> {
    const allowedPrompts = toolInput.allowedPrompts as
      | Array<{ tool: string; prompt: string }>
      | undefined;

    const { requestId, promise } = this.exitPlanModeBridge.requestReview(
      allowedPrompts,
      { signal: options.signal }
    );

    // Register bridge for Web UI resolution + broadcast via SSE
    InteractionHandler.exitPlanModeRegistry.set(requestId, this.exitPlanModeBridge);
    void promise.finally(() => InteractionHandler.exitPlanModeRegistry.delete(requestId));

    getEventBus().emitSync('interaction', {
      type: 'plan_review_request' as const,
      requestId,
      agentId: this.agentId,
      allowedPrompts,
    });

    const promptResult = await this.adapter.sendExitPlanModePrompt(this.chatId, {
      requestId,
      allowedPrompts,
    });

    if (!promptResult.success) {
      logger.warn(
        { error: promptResult.error, chatId: this.chatId },
        'Failed to send plan review prompt, auto-rejecting'
      );
      this.exitPlanModeBridge.resolveReview(requestId, {
        approved: false,
        message: 'Failed to send plan review prompt',
      });
    }

    const decision = await promise;

    // Update the prompt message with the decision
    if (promptResult.messageId) {
      const statusText = decision.approved
        ? '✅ 計畫已核准'
        : '❌ 計畫已拒絕';
      await this.adapter.updateExitPlanModePrompt(
        this.chatId,
        promptResult.messageId,
        statusText
      );
    }

    if (decision.approved) {
      return {
        behavior: 'allow',
        updatedInput: toolInput,
        toolUseID: options.toolUseID,
      };
    }

    return {
      behavior: 'deny',
      message: decision.message ?? 'User rejected the plan',
      toolUseID: options.toolUseID,
    };
  }
}
