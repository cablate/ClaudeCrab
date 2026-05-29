/**
 * Handles interactive tool approval (permissions) and user questions
 * during SDK query execution.
 *
 * Extracted from MessageProcessor.executeQueryWithSDK to isolate the
 * concern of user interaction bridging (PermissionBridge + QuestionBridge).
 */

import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import { PermissionBridge } from './PermissionBridge.js';
import { QuestionBridge } from './QuestionBridge.js';
import { ExitPlanModeBridge } from './ExitPlanModeBridge.js';
import { logger } from '../../utils/logger.js';

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

  static resolveQuestionFromAdapter(requestId: string, answer: string | null): void {
    const bridge = InteractionHandler.questionRegistry.get(requestId);
    if (bridge === undefined) {
      logger.warn({ requestId, answer }, 'Question resolve failed - no bridge for requestId');
      return;
    }
    let resolved: boolean;
    if (answer === null || answer === '__CANCELLED__') {
      resolved = bridge.resolveQuestion(requestId, { answer: null });
    } else if (answer.startsWith('__CUSTOM__:')) {
      resolved = bridge.resolveQuestion(requestId, { answer: answer.slice('__CUSTOM__:'.length) });
    } else if (answer.startsWith('__MULTISELECT__:')) {
      resolved = bridge.resolveQuestion(requestId, { answer: answer.slice('__MULTISELECT__:'.length) });
    } else {
      const optionLabels = bridge.getOptionLabels(requestId);
      const optionIndex = parseInt(answer, 10);
      resolved = bridge.resolveQuestion(requestId, { answer: optionLabels?.[optionIndex] ?? answer });
    }
    if (!resolved) {
      logger.warn({ requestId, answer }, 'Question resolve failed - bridge rejected');
    }
  }

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

    // Wire up adapter resolvers via the static registries — NOT via
    // `this.<bridge>`. Reason: a V2 SDK session's canUseTool callback closes
    // over the InteractionHandler instance that was active when the session
    // was created. When a later query starts and a new InteractionHandler
    // overwrites this resolver, button clicks would land on the new bridge,
    // which doesn't know the requestId opened on the old bridge — clicks
    // silently fall through and the user sees nothing happen until the old
    // bridge's 120s setTimeout auto-denies. Registry lookup decouples
    // resolution from instance identity: handle*() registers
    // `requestId → bridge` so any active resolver can find the right owner.
    adapter.setPermissionResolver((requestId, decision) => {
      const bridge = InteractionHandler.permissionRegistry.get(requestId);
      if (bridge === undefined) {
        logger.warn({ requestId, decision }, 'Permission resolve failed — no bridge for requestId (expired or unknown)');
        return;
      }
      let resolved: boolean;
      if (decision === 'always') {
        resolved = bridge.resolvePermission(requestId, { behavior: 'allow', alwaysAllow: true });
      } else if (decision === 'allow') {
        resolved = bridge.resolvePermission(requestId, { behavior: 'allow' });
      } else {
        resolved = bridge.resolvePermission(requestId, { behavior: 'deny', message: 'User denied permission' });
      }
      if (!resolved) {
        logger.warn({ requestId, decision }, 'Permission resolve failed — bridge rejected (race or already resolved)');
      }
    });

    adapter.setQuestionResolver((requestId, answer) => {
      const bridge = InteractionHandler.questionRegistry.get(requestId);
      if (bridge === undefined) {
        logger.warn({ requestId, answer }, 'Question resolve failed — no bridge for requestId (expired or unknown)');
        return;
      }
      let resolved: boolean;
      if (answer === null) {
        resolved = bridge.resolveQuestion(requestId, { answer: null });
      } else if (answer === '__CANCELLED__') {
        resolved = bridge.resolveQuestion(requestId, { answer: null });
      } else if (answer.startsWith('__CUSTOM__:')) {
        const customAnswer = answer.slice('__CUSTOM__:'.length);
        resolved = bridge.resolveQuestion(requestId, { answer: customAnswer });
      } else if (answer.startsWith('__MULTISELECT__:')) {
        const selectedLabels = answer.slice('__MULTISELECT__:'.length);
        resolved = bridge.resolveQuestion(requestId, { answer: selectedLabels });
      } else {
        const optionLabels = bridge.getOptionLabels(requestId);
        const optionIndex = parseInt(answer, 10);
        const selectedLabel = optionLabels?.[optionIndex] ?? answer;
        resolved = bridge.resolveQuestion(requestId, { answer: selectedLabel });
      }
      if (!resolved) {
        logger.warn({ requestId, answer }, 'Question resolve failed — bridge rejected (race or already resolved)');
      }
    });

    adapter.setExitPlanModeResolver((requestId, decision) => {
      const bridge = InteractionHandler.exitPlanModeRegistry.get(requestId);
      if (bridge === undefined) {
        logger.warn({ requestId, decision }, 'PlanMode resolve failed — no bridge for requestId (expired or unknown)');
        return;
      }
      const resolved = bridge.resolveReview(requestId, {
        approved: decision === 'approve',
        message: decision === 'approve' ? undefined : 'User rejected the plan',
      });
      if (!resolved) {
        logger.warn({ requestId, decision }, 'PlanMode resolve failed — bridge rejected (race or already resolved)');
      }
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

        // (EventBus removed — no subscribers)

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

      // (EventBus removed — no subscribers)

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
      } else if (decision.message?.toLowerCase().includes('timed out')) {
        statusText = `⏱ Timed out — auto-denied: \`${toolName}\``;
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

      // (EventBus removed — no subscribers)

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
