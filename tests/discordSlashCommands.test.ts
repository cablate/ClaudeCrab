import { describe, expect, it } from 'vitest';
import { buildSlashCommands, isOperatorUser } from '../src/adapters/discord/commands/_shared.js';

describe('Discord slash command surface', () => {
  it('keeps model query and switch command shape', () => {
    const modelCommand = buildSlashCommands()
      .map((command) => command.toJSON())
      .find((command) => command.name === 'model');

    expect(modelCommand).toBeDefined();
    expect(modelCommand?.description).toBe('查詢 / 切換模型');
    expect(modelCommand?.options?.map((option) => option.name)).toEqual(['agent', 'to']);
  });

  it('uses configured Discord owner as the operator gate', () => {
    expect(isOperatorUser('123', { ownerUserId: '123' })).toBe(true);
    expect(isOperatorUser('456', { ownerUserId: '123' })).toBe(false);
    expect(isOperatorUser('123', {})).toBe(false);
  });

  it('does not expose agent config reload wording through sync command', () => {
    const syncCommand = buildSlashCommands()
      .map((command) => command.toJSON())
      .find((command) => command.name === 'sync');

    expect(syncCommand).toBeDefined();
    expect(syncCommand?.description).toBe('同步當前 session 的子代理進度（需要管理員權限）');
  });
});
