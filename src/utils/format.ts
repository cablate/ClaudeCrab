/**
 * Shared formatting utilities for sender labels across the codebase.
 * Shared sender label formatting.
 */

/**
 * Format a user sender label from display name, username, and fallback ID.
 * Used in group chat messages to identify the sender.
 *
 * Examples:
 * - `[John (@john_doe)]` — both display name and username
 * - `[John]` — display name only
 * - `[@john_doe]` — username only
 * - `[user:12345]` — fallback ID
 */
export function formatUserLabel(options: {
  displayName?: string | undefined;
  username?: string | undefined;
  fallbackId: string;
}): string {
  const { displayName, username, fallbackId } = options;
  if (displayName && username) return `[${displayName} (@${username})]`;
  if (displayName) return `[${displayName}]`;
  if (username) return `[@${username}]`;
  return `[${fallbackId}]`;
}

/**
 * Format a bot sender label from bot info.
 * Used in group chat messages and conversation persistence.
 *
 * Examples:
 * - `[@general_bot]` — bot with username
 * - `[bot:general]` — fallback with agent ID
 */
export function formatBotLabel(
  botInfo: { username: string } | null | undefined,
  agentId: string
): string {
  return botInfo?.username ? `[@${botInfo.username}]` : `[bot:${agentId}]`;
}
