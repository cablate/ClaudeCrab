export interface ConversationRuntimeContext {
  platform?: string;
  agentId?: string;
  chatId?: string;
  userId?: string;
  guildId?: string;
  parentConversationId?: string;
  originalMessageId?: string;
  sourceMessageChannelId?: string;
}

export function buildDiscordChannelUrl(
  guildId: string | undefined,
  channelId: string | undefined,
): string | undefined {
  if (!guildId || !channelId) return undefined;
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export function buildDiscordMessageUrl(
  guildId: string | undefined,
  channelId: string | undefined,
  messageId: string | undefined,
): string | undefined {
  if (!guildId || !channelId || !messageId) return undefined;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
