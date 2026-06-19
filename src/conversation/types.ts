/**
 * Conversation pipeline types.
 *
 * ConversationRequest is the unified entry point for Discord interactive messages.
 * Schedule execution has its own pipeline (ScheduleExecutor → SDKSessionManager)
 * due to fundamentally different semantics (thread pre-creation, custom retry,
 * streaming delivery modes).
 */

export type ConversationSource = 'discord_message';

export interface ConversationRequest {
  source: ConversationSource;
  agentId: string;
  chatId: string;
  userId: string;
  sessionUserId?: string;
  text: string;
  replyToMessageId?: string;
  parentConversationId?: string;
  taskId?: string;
  inheritedSdkSessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationResult {
  success: boolean;
  sessionId?: string;
  sdkSessionId?: string;
  responseText?: string;
  skipped?: boolean;
  error?: string;
}
