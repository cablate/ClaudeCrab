import { randomUUID } from 'node:crypto';
import type { ScheduleSpec } from './schemas.js';
import type { ScheduleThreadMapping } from './types.js';

export interface ScheduleTarget {
  platform: 'discord';
  chatId: string;
}

export interface CreatedScheduleThread extends ScheduleTarget {
  threadId: string;
}

export function resolveScheduleTargets(spec: ScheduleSpec): ScheduleTarget[] {
  return spec.notification?.targets ?? [];
}

export function resolveThreadTitle(spec: ScheduleSpec, now = new Date()): string {
  const template = spec.output?.threadTitle ?? '{{name}} - {{date}}';
  const dateStr = now.toISOString().slice(0, 10);
  return template
    .replace(/\{\{name\}\}/g, spec.name)
    .replace(/\{\{date\}\}/g, dateStr)
    .replace(/\{\{id\}\}/g, spec.id);
}

export function resolveThreadChannelId(spec: ScheduleSpec, fallbackChatId: string): string {
  const output = spec.output;
  if (!output) return fallbackChatId;
  return output.forumChannelId ?? output.channelId ?? fallbackChatId;
}

export function buildThreadMapping(params: {
  thread: CreatedScheduleThread;
  agentId: string;
  scheduleId: string;
  sdkSessionId: string;
  now: Date;
}): ScheduleThreadMapping {
  return {
    threadId: params.thread.threadId,
    platform: params.thread.platform,
    agentId: params.agentId,
    scheduleId: params.scheduleId,
    sdkSessionId: params.sdkSessionId,
    chatId: params.thread.chatId,
    createdAt: params.now,
    lastActiveAt: params.now,
  };
}

export function createScheduleThreadUserId(threadId: string): string {
  return `schedule:thread:${threadId}`;
}

export function createPersistedScheduleThreadSession(params: {
  agentId: string;
  thread: CreatedScheduleThread;
  sdkSessionId: string;
  now: Date;
}): {
  session_id: string;
  agent_id: string;
  platform: 'discord';
  user_id: string;
  state: 'idle';
  created_at: string;
  last_active_at: string;
  sdk_session_id: string;
  processed_message_ids: string;
  is_active: 1;
  continuation_source: 'schedule';
  continuation_state: 'pending';
} {
  const nowIso = params.now.toISOString();
  return {
    session_id: randomUUID(),
    agent_id: params.agentId,
    platform: params.thread.platform,
    user_id: createScheduleThreadUserId(params.thread.threadId),
    state: 'idle',
    created_at: nowIso,
    last_active_at: nowIso,
    sdk_session_id: params.sdkSessionId,
    processed_message_ids: '[]',
    is_active: 1,
    continuation_source: 'schedule',
    continuation_state: 'pending',
  };
}

export function formatScheduleSummary(spec: ScheduleSpec, messages: string[], finalResponse: string): string {
  const lines: string[] = [
    `Schedule summary: ${spec.name}`,
    '',
  ];

  if (messages.length > 1) {
    lines.push(`${messages.length} intermediate messages:`);
    lines.push('');
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] ?? '';
      const preview = msg.length > 200 ? msg.slice(0, 200) + '...' : msg;
      lines.push(`**Step ${i + 1}:**`);
      lines.push(preview);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  lines.push('**Final response**');
  lines.push(formatScheduleResponse(finalResponse));

  return lines.join('\n');
}

export function formatScheduleStart(spec: ScheduleSpec, ownerUserId?: string): string {
  const notifyUserIds = resolveScheduleNotifyUserIds(spec, ownerUserId);
  const mentionLine = notifyUserIds.length > 0
    ? `${notifyUserIds.map((id) => `<@${id}>`).join(' ')}`
    : undefined;

  return [
    mentionLine,
    `Schedule started: ${spec.name}`,
    '',
    `Schedule ID: ${spec.id}`,
    `Delivery: ${spec.output?.mode ?? 'message'} / ${spec.output?.delivery ?? 'last-only'}`,
    `Started at: ${new Date().toISOString()}`,
  ].filter((line): line is string => line !== undefined).join('\n');
}

export function formatScheduleResponse(response: string): string {
  return response || 'Schedule execution completed.';
}

export function resolveScheduleNotifyUserIds(spec: ScheduleSpec, ownerUserId?: string): string[] {
  const explicit = spec.output?.notifyUserIds ?? [];
  const ids = [...explicit, ...(ownerUserId ? [ownerUserId] : [])]
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id));
  return Array.from(new Set(ids));
}

export function summarizeScheduleResult(response: string): string {
  return response || 'Execution completed';
}
