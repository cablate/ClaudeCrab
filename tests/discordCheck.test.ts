import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readOptions, resolveDiscordCheckConfig } from '../scripts/discord-check.ts';

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'claudecab-discord-check-'));
  tempRoots.push(root);
  return root;
}

async function writeAgent(root: string, data: Record<string, unknown>): Promise<void> {
  const filePath = path.join(root, 'agents', 'example', 'agent.json');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

describe('discord-check', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('reads CLI options with env fallback', () => {
    const options = readOptions(['--thread'], { AGENTS_DIR: './custom-agents' });

    expect(options).toEqual({
      agentId: 'example',
      agentsDir: './custom-agents',
      createThread: true,
    });
  });

  it('resolves a valid agent Discord config', async () => {
    const root = await createTempRoot();
    await writeAgent(root, {
      name: 'Example',
      discordBotToken: 'token.part.signature',
      discordChannelId: '123456789012345678',
    });

    const config = resolveDiscordCheckConfig({
      agentId: 'example',
      agentsDir: path.join(root, 'agents'),
      createThread: false,
    });

    expect(config.agent.discordBotToken).toBe('token.part.signature');
    expect(config.agent.discordChannelId).toBe('123456789012345678');
  });

  it('rejects placeholder bot tokens', async () => {
    const root = await createTempRoot();
    await writeAgent(root, {
      discordBotToken: 'replace-with-agent-bot-token',
      discordChannelId: '123456789012345678',
    });

    expect(() => resolveDiscordCheckConfig({
      agentId: 'example',
      agentsDir: path.join(root, 'agents'),
      createThread: false,
    })).toThrow(/no usable discordBotToken/);
  });

  it('rejects Discord IDs pasted into token fields', async () => {
    const root = await createTempRoot();
    await writeAgent(root, {
      discordBotToken: '123456789012345678',
      discordChannelId: '223456789012345678',
    });

    expect(() => resolveDiscordCheckConfig({
      agentId: 'example',
      agentsDir: path.join(root, 'agents'),
      createThread: false,
    })).toThrow(/looks like a Discord ID/);
  });

  it('rejects invalid channel IDs', async () => {
    const root = await createTempRoot();
    await writeAgent(root, {
      discordBotToken: 'token.part.signature',
      discordChannelId: 'target-channel-id',
    });

    expect(() => resolveDiscordCheckConfig({
      agentId: 'example',
      agentsDir: path.join(root, 'agents'),
      createThread: false,
    })).toThrow(/valid numeric discordChannelId/);
  });
});
