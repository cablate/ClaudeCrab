import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import { PermissionBridge } from './PermissionBridge.js';
import { QuestionBridge } from './QuestionBridge.js';
import { ExitPlanModeBridge } from './ExitPlanModeBridge.js';
import type { CanUseToolOptions, CanUseToolResult } from './InteractionTypes.js';
import {
  handleAskUserQuestionFlow,
  handleExitPlanModeFlow,
  handlePermissionFlow,
} from './InteractionFlows.js';
import { resolveQuestionAnswer, wireInteractionResolvers } from './InteractionResolvers.js';
import { logger } from '../../utils/logger.js';

export type { CanUseToolOptions, CanUseToolResult } from './InteractionTypes.js';

export class InteractionHandler {
  static readonly permissionRegistry = new Map<string, PermissionBridge>();
  static readonly questionRegistry = new Map<string, QuestionBridge>();
  static readonly exitPlanModeRegistry = new Map<string, ExitPlanModeBridge>();

  static resolveQuestionFromAdapter(requestId: string, answer: string | null): void {
    const bridge = InteractionHandler.questionRegistry.get(requestId);
    if (bridge === undefined) {
      logger.warn({ requestId, answer }, 'Question resolve failed - no bridge for requestId');
      return;
    }
    const resolved = resolveQuestionAnswer(bridge, requestId, answer);
    if (!resolved) {
      logger.warn({ requestId, answer }, 'Question resolve failed - bridge rejected');
    }
  }

  private readonly adapter: BaseAdapter;
  private readonly chatId: string;
  private readonly permissionBridge: PermissionBridge;
  private readonly questionBridge: QuestionBridge;
  private readonly exitPlanModeBridge: ExitPlanModeBridge;

  constructor(adapter: BaseAdapter, chatId: string, timeoutMs = 120_000) {
    this.adapter = adapter;
    this.chatId = chatId;
    this.permissionBridge = new PermissionBridge(timeoutMs);
    this.questionBridge = new QuestionBridge(timeoutMs);
    this.exitPlanModeBridge = new ExitPlanModeBridge(timeoutMs);

    wireInteractionResolvers(adapter, {
      permissionRegistry: InteractionHandler.permissionRegistry,
      questionRegistry: InteractionHandler.questionRegistry,
      exitPlanModeRegistry: InteractionHandler.exitPlanModeRegistry,
    });
  }

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
      if (toolName === 'AskUserQuestion') {
        return handleAskUserQuestionFlow(this.flowContext(), toolInput, options);
      }
      if (toolName === 'ExitPlanMode') {
        return handleExitPlanModeFlow(this.flowContext(), toolInput, options);
      }
      return handlePermissionFlow(this.flowContext(), toolName, toolInput, options);
    };
  }

  dispose(): void {
    this.permissionBridge.cancelAll();
    this.questionBridge.cancelAll();
    this.exitPlanModeBridge.cancelAll();
  }

  private flowContext() {
    return {
      adapter: this.adapter,
      chatId: this.chatId,
      permissionBridge: this.permissionBridge,
      questionBridge: this.questionBridge,
      exitPlanModeBridge: this.exitPlanModeBridge,
      permissionRegistry: InteractionHandler.permissionRegistry,
      questionRegistry: InteractionHandler.questionRegistry,
      exitPlanModeRegistry: InteractionHandler.exitPlanModeRegistry,
    };
  }
}
