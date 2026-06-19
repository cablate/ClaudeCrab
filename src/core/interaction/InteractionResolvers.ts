import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import type { ExitPlanModeBridge } from './ExitPlanModeBridge.js';
import type { PermissionBridge } from './PermissionBridge.js';
import type { QuestionBridge } from './QuestionBridge.js';
import { logger } from '../../utils/logger.js';

export interface InteractionRegistries {
  permissionRegistry: Map<string, PermissionBridge>;
  questionRegistry: Map<string, QuestionBridge>;
  exitPlanModeRegistry: Map<string, ExitPlanModeBridge>;
}

export function resolveQuestionAnswer(
  bridge: QuestionBridge,
  requestId: string,
  answer: string | null,
): boolean {
  if (answer === null || answer === '__CANCELLED__') {
    return bridge.resolveQuestion(requestId, { answer: null });
  }
  if (answer.startsWith('__CUSTOM__:')) {
    return bridge.resolveQuestion(requestId, { answer: answer.slice('__CUSTOM__:'.length) });
  }
  if (answer.startsWith('__MULTISELECT__:')) {
    return bridge.resolveQuestion(requestId, { answer: answer.slice('__MULTISELECT__:'.length) });
  }

  const optionLabels = bridge.getOptionLabels(requestId);
  const optionIndex = parseInt(answer, 10);
  return bridge.resolveQuestion(requestId, { answer: optionLabels?.[optionIndex] ?? answer });
}

export function wireInteractionResolvers(
  adapter: BaseAdapter,
  registries: InteractionRegistries,
): void {
  adapter.setPermissionResolver((requestId, decision) => {
    const bridge = registries.permissionRegistry.get(requestId);
    if (bridge === undefined) {
      logger.warn({ requestId, decision }, 'Permission resolve failed: no bridge for requestId (expired or unknown)');
      return;
    }

    const resolved = decision === 'always'
      ? bridge.resolvePermission(requestId, { behavior: 'allow', alwaysAllow: true })
      : decision === 'allow'
        ? bridge.resolvePermission(requestId, { behavior: 'allow' })
        : bridge.resolvePermission(requestId, { behavior: 'deny', message: 'User denied permission' });

    if (!resolved) {
      logger.warn({ requestId, decision }, 'Permission resolve failed: bridge rejected (race or already resolved)');
    }
  });

  adapter.setQuestionResolver((requestId, answer) => {
    const bridge = registries.questionRegistry.get(requestId);
    if (bridge === undefined) {
      logger.warn({ requestId, answer }, 'Question resolve failed: no bridge for requestId (expired or unknown)');
      return;
    }

    const resolved = resolveQuestionAnswer(bridge, requestId, answer);
    if (!resolved) {
      logger.warn({ requestId, answer }, 'Question resolve failed: bridge rejected (race or already resolved)');
    }
  });

  adapter.setExitPlanModeResolver((requestId, decision) => {
    const bridge = registries.exitPlanModeRegistry.get(requestId);
    if (bridge === undefined) {
      logger.warn({ requestId, decision }, 'PlanMode resolve failed: no bridge for requestId (expired or unknown)');
      return;
    }

    const resolved = bridge.resolveReview(requestId, {
      approved: decision === 'approve',
      message: decision === 'approve' ? undefined : 'User rejected the plan',
    });
    if (!resolved) {
      logger.warn({ requestId, decision }, 'PlanMode resolve failed: bridge rejected (race or already resolved)');
    }
  });
}
