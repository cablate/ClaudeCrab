/**
 * ContextInjector handles injecting group chat history into SDK queries
 * for multi-bot collaboration (ADR-019)
 */

import type {
  IGroupMessageRepository,
  IInjectionStateRepository,
  GroupMessageRow,
} from '../persistence/types.js';
import { logger } from '../utils/logger.js';

/**
 * Result of getting injection context
 */
export interface InjectionContext {
  /** Formatted history text to inject into prompt */
  formattedHistory: string;
  /** Number of messages included in the injection */
  messageCount: number;
  /** Last message ID (for updating cursor after successful query) */
  lastMessageId: string | null;
}

/**
 * Options for getting injection context
 */
export interface InjectionOptions {
  /** Maximum number of messages to inject (default: 50) */
  limit?: number;
}

/**
 * ContextInjector manages group chat history injection for SDK queries.
 *
 * When a bot in a group chat calls the SDK, this class:
 * 1. Retrieves messages since the bot's last query (using cursor)
 * 2. Formats them as conversation history
 * 3. Provides the formatted history to be prepended to the prompt
 * 4. Updates the cursor after successful query
 */
export class ContextInjector {
  private readonly groupMessageRepository: IGroupMessageRepository;
  private readonly injectionStateRepository: IInjectionStateRepository;
  private readonly log = logger.child({ module: 'ContextInjector' });

  constructor(
    groupMessageRepository: IGroupMessageRepository,
    injectionStateRepository: IInjectionStateRepository
  ) {
    this.groupMessageRepository = groupMessageRepository;
    this.injectionStateRepository = injectionStateRepository;
  }

  /**
   * Get injection context for a bot in a group chat.
   * Returns formatted history of messages since the bot's last query.
   */
  getInjectionContext(
    agentId: string,
    chatId: string,
    platform: string,
    options?: InjectionOptions
  ): InjectionContext {
    const limit = options?.limit ?? 50;

    // Get injection state
    const state = this.injectionStateRepository.getState(agentId, chatId, platform);

    this.log.info(
      { agentId, chatId, platform, hasState: !!state, state },
      'getInjectionContext: checking injection state'
    );

    if (!state) {
      this.log.debug(
        { agentId, chatId, platform },
        'No injection state found - bot has not seen this group yet'
      );
      return { formattedHistory: '', messageCount: 0, lastMessageId: null };
    }

    // Determine the starting point for injection
    // Priority: last_injected_msg_id > joined_msg_id
    const startFrom = state.last_injected_msg_id ?? state.joined_msg_id;

    this.log.info(
      {
        agentId,
        chatId,
        platform,
        lastInjectedMsgId: state.last_injected_msg_id,
        joinedMsgId: state.joined_msg_id,
        startFrom,
      },
      'getInjectionContext: determined startFrom cursor'
    );

    // Get messages after the cursor, excluding this bot's own messages
    this.log.info(
      { agentId, chatId, platform, startFrom, limit },
      'getInjectionContext: calling getMessagesAfter'
    );

    const messages = this.groupMessageRepository.getMessagesAfter(
      platform,
      chatId,
      startFrom,
      agentId,
      limit
    );

    this.log.info(
      {
        agentId,
        chatId,
        platform,
        startFrom,
        messageCount: messages.length,
        messages: messages.map((m) => ({
          msgId: m.platform_msg_id,
          senderType: m.sender_type,
          senderId: m.sender_id,
          contentPreview: m.content.substring(0, 50),
        })),
      },
      'getInjectionContext: getMessagesAfter results'
    );

    if (messages.length === 0) {
      this.log.debug(
        { agentId, chatId, platform, startFrom },
        'No new messages to inject'
      );
      return { formattedHistory: '', messageCount: 0, lastMessageId: null };
    }

    // Format the history
    const formattedHistory = this.formatHistory(messages);
    // Safe to access: we already checked messages.length > 0 above
    // Use autoincrement id (not platform_msg_id) for cursor tracking,
    // because regular Telegram groups give each bot different message_ids.
    const lastMessage = messages[messages.length - 1];
    const lastMessageId = lastMessage?.id?.toString() ?? null;

    this.log.info(
      { agentId, chatId, platform, messageCount: messages.length, lastMessageId },
      'Prepared injection context'
    );

    return {
      formattedHistory,
      messageCount: messages.length,
      lastMessageId,
    };
  }

  /**
   * Update the injection cursor after a successful SDK query.
   * This should be called ONLY after the SDK query succeeds to avoid
   * losing messages if the query fails.
   */
  updateCursor(
    agentId: string,
    chatId: string,
    platform: string,
    lastMsgId: string
  ): void {
    this.injectionStateRepository.updateCursor(agentId, chatId, platform, lastMsgId);
    this.log.debug(
      { agentId, chatId, platform, lastMsgId },
      'Injection cursor updated'
    );
  }

  /**
   * Format messages as conversation history for injection.
   * The framing must be explicit enough for the LLM to understand that
   * these are REAL messages that already happened in the group chat,
   * including actual responses from other bots.
   */
  private formatHistory(messages: GroupMessageRow[]): string {
    const lines = messages.map((msg) => {
      const date = new Date(msg.created_at);
      const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      return `[${time}] ${msg.sender_label}: ${msg.content}`;
    });

    return [
      '[SYSTEM: 以下是此群組中已發生的真實聊天紀錄。',
      '標記為 [@...] 的訊息是群組中其他機器人的實際回覆，這些都是事實。',
      '請在回答時參考這些對話內容。]',
      '---',
      ...lines,
      '---',
      '[以下是使用者現在發送的新訊息]',
    ].join('\n');
  }
}
