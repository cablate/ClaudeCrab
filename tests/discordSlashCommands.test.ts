import { describe, expect, it } from 'vitest';
import { buildSlashCommands } from '../src/adapters/discord/commands/_shared.js';

describe('Discord slash command surface', () => {
  it('keeps model command read-only', () => {
    const modelCommand = buildSlashCommands()
      .map((command) => command.toJSON())
      .find((command) => command.name === 'model');

    expect(modelCommand).toBeDefined();
    expect(modelCommand?.description).toBe('查詢模型設定');
    expect(modelCommand?.options?.map((option) => option.name)).toEqual(['agent']);
  });

  it('does not expose agent config reload wording through sync command', () => {
    const syncCommand = buildSlashCommands()
      .map((command) => command.toJSON())
      .find((command) => command.name === 'sync');

    expect(syncCommand).toBeDefined();
    expect(syncCommand?.description).toBe('同步當前 session 的子代理進度（需要管理員權限）');
  });
});
