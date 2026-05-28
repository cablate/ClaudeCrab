/**
 * StreamResponseRouter — Handles intermediate message routing and final response delivery.
 *
 * Extracted from MessageProcessor / QueryExecutor to isolate streaming concerns:
 * - Status message management (StatusMessageManager integration)
 * - Sub-agent message handling (SubAgentMessageManager)
 * - HookMessageManager integration
 * - Tool event tracking for status messages
 * - The onIntermediateMessage callback implementation
 * - Send response logic (final response delivery to adapter)
 */

import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import type { ActivityService } from '../../types/interfaces.js';
import { HookMessageManager } from '../interaction/HookMessageManager.js';
import {
  StatusMessageManager,
  isStatusCapable,
  type ToolEventEntry,
} from './StatusMessageManager.js';
import { SubAgentMessageManager } from './SubAgentMessageManager.js';
import { SDKSessionManager } from '../session/SDKSessionManager.js';
import { isNoiseResponse, sendFinalResponse } from './ResponseSender.js';
import { logger } from '../../utils/logger.js';
import type { SendOptions, ToolEvent } from '../../types/message.js';

const srrLogger = logger.child({ module: 'StreamResponseRouter' });

/** Debounce delay for status message updates */
export const STATUS_DEBOUNCE_MS = 2000;
/** Maximum tool events shown in status messages */
export const MAX_EVENTS_DISPLAY = 8;

export interface StreamRouterOptions {
  replyToMessageId?: string;
}

/**
 * State managed during a single query's streaming lifecycle.
 */
export interface StreamState {
  intermediateMessages: string[];
  failedMessages: string[];
  lastSentMessageId: string | undefined;
  toolUseReacted: boolean;
  deliveredAssistantTexts: Set<string>;
}

/**
 * Creates a fresh StreamState for a new query.
 */
export function createStreamState(): StreamState {
  return {
    intermediateMessages: [],
    failedMessages: [],
    lastSentMessageId: undefined,
    toolUseReacted: false,
    deliveredAssistantTexts: new Set(),
  };
}

function shouldSkipDuplicateAssistantText(state: StreamState, text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) return true;
  if (state.deliveredAssistantTexts.has(normalized)) return true;
  state.deliveredAssistantTexts.add(normalized);
  return false;
}

/**
 * Build status/sub-agent/hook managers for a query.
 */
export function buildQueryManagers(
  adapter: BaseAdapter,
  chatId: string,
  sessionId: string,
  sdkSessionManager: SDKSessionManager,
  showStatusMessages = true
): {
  statusManager: StatusMessageManager | null;
  subAgentManager: SubAgentMessageManager | null;
  hookManager: HookMessageManager | null;
} {
  const statusCapable = isStatusCapable(adapter) && showStatusMessages;

  const statusManager = statusCapable
    ? new StatusMessageManager(adapter, chatId, {
        debounceMs: STATUS_DEBOUNCE_MS,
        maxEventsDisplay: MAX_EVENTS_DISPLAY,
      })
    : null;

  // Reuse existing sub-agent manager if this chat already has a V2 session
  const existingSubAgentManager = sdkSessionManager.getSubAgentManager(sessionId);
  const subAgentManager = existingSubAgentManager ?? (statusCapable ? new SubAgentMessageManager(adapter, chatId) : null);

  const hookManager = statusCapable ? new HookMessageManager(adapter, chatId) : null;

  return { statusManager, subAgentManager, hookManager };
}

/**
 * Build the onIntermediateMessage callback for V2 path (SDKSessionManager).
 */
export function buildV2IntermediateMessageCallback(
  state: StreamState,
  adapter: BaseAdapter,
  chatId: string,
  agentId: string,
  statusManager: StatusMessageManager | null,
  activityService: ActivityService | undefined,
  options: StreamRouterOptions
): (text: string) => Promise<void> {
  return async (text: string): Promise<void> => {
    if (isNoiseResponse(text)) return;
    if (shouldSkipDuplicateAssistantText(state, text)) {
      srrLogger.debug({ chatId, agentId, text: text.substring(0, 80) }, 'Suppressed duplicate intermediate assistant message');
      return;
    }
    await statusManager?.finalizeCurrentBatch();
    await adapter.sendTypingIndicator(chatId);
    const sendOpts: SendOptions = {};
    if (options.replyToMessageId) {
      sendOpts.replyToMessageId = options.replyToMessageId;
    }
    const sendResult = await adapter.sendFormattedMessage(chatId, text, sendOpts);
    if (sendResult.success && sendResult.messageId) {
      state.lastSentMessageId = sendResult.messageId;
    } else if (!sendResult.success) {
      state.failedMessages.push(text);
    }
    state.intermediateMessages.push(text);
    activityService?.emitReply(agentId, text);
    statusManager?.markNeedNewMessage();
  };
}

/**
 * Build the onIntermediateMessage callback for V1 path (SDKQueryManager).
 */
export function buildV1IntermediateMessageCallback(
  state: StreamState,
  adapter: BaseAdapter,
  chatId: string,
  agentId: string,
  statusManager: StatusMessageManager | null,
  activityService: ActivityService | undefined,
  options: StreamRouterOptions
): (text: string) => Promise<void> {
  return async (text: string): Promise<void> => {
    // Filter noise responses (SDK placeholders, stop-hook outputs)
    if (isNoiseResponse(text)) {
      srrLogger.debug({ chatId, agentId, text: text.substring(0, 80) }, 'Suppressed noise intermediate message');
      return;
    }
    if (shouldSkipDuplicateAssistantText(state, text)) {
      srrLogger.debug({ chatId, agentId, text: text.substring(0, 80) }, 'Suppressed duplicate intermediate assistant message');
      return;
    }

    // Finalize current status message before sending assistant message
    await statusManager?.finalizeCurrentBatch();

    await adapter.sendTypingIndicator(chatId);

    // Build send options
    const sendOpts: SendOptions = {};
    if (options.replyToMessageId) {
      sendOpts.replyToMessageId = options.replyToMessageId;
    }

    const sendResult = await adapter.sendFormattedMessage(chatId, text, sendOpts);

    if (!sendResult.success) {
      srrLogger.warn(
        { error: sendResult.error, chatId },
        'Failed to send intermediate message'
      );
      state.failedMessages.push(text);
    } else if (sendResult.messageId) {
      state.lastSentMessageId = sendResult.messageId;
    }
    state.intermediateMessages.push(text);

    // Stream reply to Web UI in real-time (not just at the end)
    activityService?.emitReply(agentId, text);

    // Mark that next tool event should create new status message
    statusManager?.markNeedNewMessage();
  };
}

/**
 * Build the onToolEvent callback shared by both V2 and V1 paths.
 */
export function buildToolEventCallback(
  state: StreamState,
  agentId: string,
  statusManager: StatusMessageManager | null,
  activityService: ActivityService | undefined,
  hookManager?: HookMessageManager | null
): (event: ToolEvent) => Promise<void> {
  return async (event): Promise<void> => {
    if (event.type === 'tool_result' && event.toolName === 'tool') return;

    // v2.0: Status change only for tool_use (no Haiku, just update phase)
    if (event.type === 'tool_use' && !state.toolUseReacted) {
      state.toolUseReacted = true;
      activityService?.emitStatusChange(agentId, 'tool_use', 'focused');
    }

    if (statusManager === null) return;

    // Build tool event entry for status display
    let statusLine: string;
    let detail: string | undefined;

    if (event.type === 'tool_use') {
      statusLine = `🔧 ${event.toolName}`;
      if (event.summary) {
        detail = event.summary.substring(0, 80);
      }
    } else if (event.type === 'tool_result') {
      statusLine = `✓ ${event.toolName} 完成`;
      if (event.summary) {
        const cleanSummary = event.summary
          .replace(/\n/g, ' ')
          .substring(0, 60);
        detail = cleanSummary;
      }
    } else if (event.type === 'tool_progress') {
      statusLine = `⏳ ${event.toolName}`;
      if (event.elapsedSeconds !== undefined) {
        statusLine += ` (${Math.round(event.elapsedSeconds)}s)`;
      }
    } else if (event.type === 'thinking') {
      statusLine = '💭 思考中';
      if (event.summary) {
        detail = event.summary.replace(/\n/g, ' ').substring(0, 120);
      }
    } else {
      statusLine = `• ${event.toolName}`;
    }

    const toolEvent: ToolEventEntry = {
      toolName: event.toolName,
      status: statusLine,
      eventType: event.type,
      scope: event.scope ?? 'main',
    };
    if (detail !== undefined) {
      toolEvent.detail = detail;
    }
    await statusManager.addToolEvent(toolEvent);
    await hookManager?.flushPendingGovernance();
  };
}

/**
 * Send the final response and handle delivery failures.
 * Returns the lastSentMessageId (may be updated from failedMessages resend).
 */
export async function deliverFinalResponse(
  state: StreamState,
  result: { response: string; sessionDegraded?: boolean; numTurns?: number },
  adapter: BaseAdapter,
  chatId: string,
  agentId: string,
  sessionId: string,
  options?: { replyToMessageId?: string }
): Promise<void> {
  // Send final response and track message ID
  // Prepend agent call tag if no intermediate messages carried it
  const finalResponseText = result.response;
  if (finalResponseText.trim().length > 0 && state.deliveredAssistantTexts.has(finalResponseText.trim())) {
    srrLogger.debug({ chatId, agentId }, 'Suppressed duplicate final assistant message');
    return;
  }
  const finalMessageId = await sendFinalResponse(
    finalResponseText, adapter, chatId, agentId, options
  );
  if (finalMessageId !== undefined) {
    state.lastSentMessageId = finalMessageId;
  } else if (finalResponseText.length > 0 && !isNoiseResponse(finalResponseText)) {
    state.failedMessages.push(result.response);
  }

  // Post-query delivery audit: resend any messages that failed to deliver
  if (state.failedMessages.length > 0) {
    srrLogger.info(
      { chatId, agentId, failedCount: state.failedMessages.length },
      'Delivery audit: resending failed messages'
    );
    for (const msg of state.failedMessages) {
      try {
        const retryResult = await adapter.sendFormattedMessage(chatId, msg);
        if (retryResult.success) {
          if (retryResult.messageId) state.lastSentMessageId = retryResult.messageId;
          srrLogger.debug({ chatId, agentId }, 'Delivery audit: message resent successfully');
        } else {
          srrLogger.warn({ chatId, agentId, error: retryResult.error }, 'Delivery audit: resend also failed');
        }
      } catch (resendError) {
        srrLogger.warn({ chatId, agentId, error: resendError }, 'Delivery audit: resend threw error');
      }
    }
  }

  // Silent failure detection: query completed but user received nothing.
  if (state.lastSentMessageId === undefined && state.intermediateMessages.length === 0) {
    srrLogger.warn(
      { sessionId, chatId, agentId, numTurns: result.numTurns, responseLength: result.response.length, sessionDegraded: result.sessionDegraded },
      'Silent failure detected: query completed but no messages delivered to user'
    );
    const fallbackMsg = result.sessionDegraded
      ? '⚠️ 對話 session 異常，已自動重建。請重新發送訊息。'
      : '⚠️ 模型回應為空，請重新發送訊息。若持續發生，請稍後再試。';
    await adapter.sendFormattedMessage(chatId, fallbackMsg);
  }
}
