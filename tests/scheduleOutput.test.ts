import { describe, expect, it } from 'vitest';
import type { ScheduleSpec } from '../src/schedule/schemas.ts';
import {
  buildThreadMapping,
  createPersistedScheduleThreadSession,
  formatScheduleResponse,
  formatScheduleStart,
  formatScheduleSummary,
  resolveScheduleNotifyUserIds,
  resolveScheduleTargets,
  resolveThreadChannelId,
  resolveThreadTitle,
} from '../src/schedule/ScheduleOutput.ts';

function schedule(overrides: Partial<ScheduleSpec> = {}): ScheduleSpec {
  return {
    id: 'general/daily',
    name: 'Daily report',
    trigger: {
      type: 'cron',
      cron: '0 9 * * *',
      timezone: 'Asia/Taipei',
    },
    execution: {
      agent: 'general',
      prompt: 'Generate report',
    },
    notification: {
      targets: [
        { platform: 'discord', chatId: 'chat-1' },
      ],
    },
    output: {
      mode: 'thread',
      threadTitle: '{{name}} / {{date}} / {{id}}',
      channelId: 'channel-1',
      autoArchive: 'never',
      persistSession: true,
      delivery: 'summary',
    },
    metadata: {
      createdAt: '2026-06-19T00:00:00+08:00',
      createdBy: 'test',
      enabled: true,
    },
    ...overrides,
  };
}

describe('ScheduleOutput', () => {
  it('resolves targets, thread title, and output channel from a schedule spec', () => {
    const spec = schedule();

    expect(resolveScheduleTargets(spec)).toEqual([{ platform: 'discord', chatId: 'chat-1' }]);
    expect(resolveThreadTitle(spec, new Date('2026-06-19T01:00:00.000Z'))).toBe(
      'Daily report / 2026-06-19 / general/daily'
    );
    expect(resolveThreadChannelId(spec, 'chat-1')).toBe('channel-1');
  });

  it('builds thread continuation records from one canonical helper', () => {
    const now = new Date('2026-06-19T00:00:00.000Z');
    const thread = { platform: 'discord' as const, chatId: 'chat-1', threadId: 'thread-1' };

    expect(buildThreadMapping({
      thread,
      agentId: 'general',
      scheduleId: 'general/daily',
      sdkSessionId: 'sdk-1',
      now,
    })).toMatchObject({
      threadId: 'thread-1',
      platform: 'discord',
      agentId: 'general',
      scheduleId: 'general/daily',
      sdkSessionId: 'sdk-1',
      chatId: 'chat-1',
      createdAt: now,
      lastActiveAt: now,
    });

    expect(createPersistedScheduleThreadSession({
      agentId: 'general',
      thread,
      sdkSessionId: 'sdk-1',
      now,
    })).toMatchObject({
      agent_id: 'general',
      platform: 'discord',
      user_id: 'schedule:thread:thread-1',
      state: 'idle',
      sdk_session_id: 'sdk-1',
      continuation_source: 'schedule',
      continuation_state: 'pending',
    });
  });

  it('formats summary output with a stable fallback response', () => {
    const spec = schedule();

    expect(formatScheduleResponse('')).toBe('Schedule execution completed.');
    expect(formatScheduleSummary(spec, ['first', 'second'], '')).toContain('2 intermediate messages:');
    expect(formatScheduleSummary(spec, ['first', 'second'], '')).toContain('**Final response**');
  });

  it('formats schedule start mentions from injected owner id', () => {
    const spec = schedule({
      output: {
        ...schedule().output,
        notifyUserIds: ['123', '456', '123'],
      },
    });

    expect(resolveScheduleNotifyUserIds(spec, '456')).toEqual(['123', '456']);
    expect(formatScheduleStart(spec, '456')).toContain('<@123> <@456>');
  });
});
