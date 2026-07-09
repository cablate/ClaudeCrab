import { describe, expect, it } from 'vitest';
import { CronScheduler } from '../src/schedule/CronScheduler.ts';
import type { ScheduleSpec } from '../src/schedule/schemas.ts';
import type { ScheduleExecutor } from '../src/schedule/ScheduleExecutor.ts';

function spec(): ScheduleSpec {
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
    metadata: {
      createdAt: '2026-06-19T00:00:00+08:00',
      createdBy: 'test',
      enabled: true,
    },
  };
}

describe('CronScheduler', () => {
  it('can execute a registered schedule immediately', async () => {
    const executed: string[] = [];
    const executor = {
      execute: async (_agentId: string, schedule: ScheduleSpec) => {
        executed.push(schedule.id);
        return { success: true, duration: 1 };
      },
    } as ScheduleExecutor;
    const scheduler = new CronScheduler(executor);

    scheduler.register('general', spec());
    await scheduler.executeNow('general/daily');
    scheduler.dispose();

    expect(executed).toEqual(['general/daily']);
  });
});
