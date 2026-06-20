import { describe, expect, it } from 'vitest';
import { decideCatchUp } from '../src/schedule/ScheduleCatchUp.ts';
import type { ScheduleSpec } from '../src/schedule/schemas.ts';
import type { ScheduleExecutionRecord } from '../src/persistence/ScheduleRepository.ts';

function spec(): ScheduleSpec {
  return {
    id: 'general/daily',
    name: 'Daily report',
    trigger: {
      type: 'cron',
      cron: '7 9 * * *',
      timezone: 'Asia/Taipei',
    },
    execution: {
      agent: 'general',
      prompt: 'Generate report',
    },
    metadata: {
      createdAt: '2026-06-19T00:00:00+08:00',
      createdBy: 'test',
      enabled: true,
    },
  };
}

function repository(records: ScheduleExecutionRecord[] = []) {
  return {
    listExecutions: () => records,
  };
}

const config = {
  graceMs: 30 * 60 * 1000,
  windowMs: 3 * 60 * 60 * 1000,
  staleRunningMs: 2 * 60 * 60 * 1000,
};

describe('decideCatchUp', () => {
  it('skips before the grace period has passed', () => {
    const decision = decideCatchUp(
      spec(),
      repository(),
      config,
      new Date('2026-06-20T01:20:00.000Z') // 09:20 Asia/Taipei
    );

    expect(decision).toMatchObject({ action: 'skip', reason: 'before_grace' });
  });

  it('catches up when the daily schedule has no execution in the window', () => {
    const decision = decideCatchUp(
      spec(),
      repository(),
      config,
      new Date('2026-06-20T01:50:00.000Z') // 09:50 Asia/Taipei
    );

    expect(decision).toMatchObject({ action: 'catch-up', reason: 'missing_execution' });
  });

  it('does not catch up when an execution already completed', () => {
    const decision = decideCatchUp(
      spec(),
      repository([
        {
          id: 'run-1',
          scheduleId: 'general/daily',
          startedAt: '2026-06-20T01:07:00.000Z',
          completedAt: '2026-06-20T01:08:00.000Z',
          success: 1,
        },
      ]),
      config,
      new Date('2026-06-20T01:50:00.000Z')
    );

    expect(decision).toMatchObject({ action: 'skip', reason: 'already_executed' });
  });

  it('does not catch up while the execution is still running', () => {
    const decision = decideCatchUp(
      spec(),
      repository([
        {
          id: 'run-1',
          scheduleId: 'general/daily',
          startedAt: '2026-06-20T01:45:00.000Z',
          completedAt: null,
          success: null,
        },
      ]),
      config,
      new Date('2026-06-20T01:50:00.000Z')
    );

    expect(decision).toMatchObject({ action: 'skip', reason: 'running_execution' });
  });

  it('warns but does not catch up stale running executions', () => {
    const decision = decideCatchUp(
      spec(),
      repository([
        {
          id: 'run-1',
          scheduleId: 'general/daily',
          startedAt: '2026-06-20T01:07:00.000Z',
          completedAt: null,
          success: null,
        },
      ]),
      config,
      new Date('2026-06-20T03:20:00.000Z') // 11:20 Asia/Taipei
    );

    expect(decision).toMatchObject({
      action: 'skip',
      reason: 'stale_running_execution',
      staleExecutionId: 'run-1',
    });
  });

  it('does not catch up after the window has passed', () => {
    const decision = decideCatchUp(
      spec(),
      repository(),
      config,
      new Date('2026-06-20T04:30:00.000Z') // 12:30 Asia/Taipei
    );

    expect(decision).toMatchObject({ action: 'skip', reason: 'outside_catchup_window' });
  });
});
