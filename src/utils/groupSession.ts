/**
 * Group Session Utilities
 *
 * Centralized handling of the `group::` prefix convention for group chat sessions.
 * ADR-017/019: Group chats use a shared session key (`group::{chatId}`) instead of
 * individual user session keys to allow context sharing among all group members.
 */

export const GROUP_PREFIX = 'group::';

/**
 * Build a group userId from a chat ID.
 * This is used as the session key for group chats.
 *
 * @example buildGroupUserId('123456') => 'group::123456'
 */
export function buildGroupUserId(chatId: string): string {
  return `${GROUP_PREFIX}${chatId}`;
}

/**
 * Check if a userId is a group session key (starts with `group::`)
 */
export function isGroupUserId(userId: string): boolean {
  return userId.startsWith(GROUP_PREFIX);
}

/**
 * Extract the original chat ID from a group userId.
 * Throws if the userId is not a valid group session key.
 *
 * @example extractChatIdFromGroupUserId('group::123456') => '123456'
 */
export function extractChatIdFromGroupUserId(groupUserId: string): string {
  if (!isGroupUserId(groupUserId)) {
    throw new Error(`Not a group userId: ${groupUserId}`);
  }
  return groupUserId.slice(GROUP_PREFIX.length);
}
