import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScheduleLoader } from '../src/schedule/ScheduleLoader.ts';

const tempRoots: string[] = [];

async function createTempAgentsDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'claudecab-schedule-loader-'));
  tempRoots.push(root);
  return root;
}

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

describe('ScheduleLoader', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('loads valid YAML schedules with filename-based canonical IDs', async () => {
    const agentsDir = await createTempAgentsDir();
    await writeText(
      path.join(agentsDir, 'general', 'schedules', 'daily.yaml'),
      [
        'id: not-the-canonical-id',
        'name: Daily report',
        'trigger:',
        '  type: cron',
        '  cron: "0 9 * * *"',
        'execution:',
        '  agent: general',
        '  prompt: Generate the daily report.',
        'output:',
        '  mode: message',
        '  delivery: summary',
        'metadata:',
        '  createdAt: "2026-06-19T00:00:00+08:00"',
        '  createdBy: test',
        '  enabled: true',
        '',
      ].join('\n'),
    );

    const loader = new ScheduleLoader(agentsDir);
    const schedules = await loader.loadForAgent('general');

    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.id).toBe('general/daily');
    expect(schedules[0]?.output).toMatchObject({ mode: 'message', delivery: 'summary' });
  });

  it('skips invalid schedule YAML files without failing the whole agent load', async () => {
    const agentsDir = await createTempAgentsDir();
    await writeText(
      path.join(agentsDir, 'general', 'schedules', 'valid.yaml'),
      [
        'id: valid',
        'name: Valid report',
        'trigger:',
        '  type: cron',
        '  cron: "0 10 * * *"',
        'execution:',
        '  agent: general',
        '  prompt: Generate a report.',
        'output:',
        '  mode: message',
        'metadata:',
        '  createdAt: "2026-06-19T00:00:00+08:00"',
        '  createdBy: test',
        '  enabled: true',
        '',
      ].join('\n'),
    );
    await writeText(
      path.join(agentsDir, 'general', 'schedules', 'invalid.yaml'),
      [
        'id: invalid',
        'name: Invalid report',
        'trigger:',
        '  type: cron',
        '  cron: "0 11 * * *"',
        'execution:',
        '  agent: general',
        '  prompt: Generate a report.',
        'output:',
        '  mode: file',
        '  path: output/reports',
        'metadata:',
        '  createdAt: "2026-06-19T00:00:00+08:00"',
        '  createdBy: test',
        '  enabled: true',
        '',
      ].join('\n'),
    );

    const loader = new ScheduleLoader(agentsDir);
    const schedules = await loader.loadForAgent('general');

    expect(schedules.map((schedule) => schedule.id)).toEqual(['general/valid']);
  });

});
