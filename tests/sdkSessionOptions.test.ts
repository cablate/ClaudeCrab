import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSessionOptions } from '../src/core/session/SDKSessionOptions.ts';
import type { LoadedAgent } from '../src/types/agent.ts';

const tempRoots: string[] = [];

async function createAgent(settings: Record<string, unknown> = {
  model: 'provider-model-from-settings',
  env: {
    ANTHROPIC_API_KEY: 'agent-key',
    ANTHROPIC_BASE_URL: 'https://provider.example.com',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'provider-sonnet',
  },
}): Promise<LoadedAgent> {
  const root = await mkdtemp(path.join(tmpdir(), 'claudecab-sdk-options-'));
  tempRoots.push(root);
  const agentPath = path.join(root, 'agents', 'example');
  await mkdir(path.join(agentPath, '.claude'), { recursive: true });
  await writeFile(
    path.join(agentPath, '.claude', 'settings.local.json'),
    JSON.stringify(settings),
    'utf-8',
  );

  return {
    id: 'example',
    path: agentPath,
    config: { name: 'Example' },
    systemPrompt: '',
  };
}

describe('buildSessionOptions', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('forwards agent-local provider env and resolves provider model aliases', async () => {
    const agent = await createAgent({
      env: {
        ANTHROPIC_API_KEY: 'agent-key',
        ANTHROPIC_BASE_URL: 'https://provider.example.com',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'provider-sonnet',
      },
    });

    const { sessionOptions, resumeSessionId } = await buildSessionOptions('session-id', agent, {
      cwd: agent.path,
      resume: 'sdk-session-id',
    });

    expect(resumeSessionId).toBeUndefined();
    expect(sessionOptions.model).toBe('provider-sonnet');
    expect(sessionOptions.agents).toBeUndefined();
    expect(sessionOptions.env).toMatchObject({
      CLAUDE_CODE_REMOTE: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_ENABLE_TASKS: '0',
      ANTHROPIC_API_KEY: 'agent-key',
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://provider.example.com',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'provider-sonnet',
      CLAUDE_CONFIG_DIR: path.join(agent.path, '.claude'),
    });
  });

  it('uses settings.local.json model as the agent runtime model', async () => {
    const agent = await createAgent();

    const { sessionOptions } = await buildSessionOptions('session-id', agent, {
      cwd: agent.path,
    });

    expect(sessionOptions.model).toBe('provider-model-from-settings');
  });

  it('keeps explicit SDK overrides explicit', async () => {
    const agent = await createAgent();

    const { sessionOptions } = await buildSessionOptions('session-id', agent, {
      cwd: agent.path,
      model: 'explicit-model',
      additionalOptions: {
        agents: {
          reviewer: {
            description: 'Review focused changes',
            prompt: 'Review the current change.',
          },
        },
      },
    });

    expect(sessionOptions.model).toBe('explicit-model');
    expect(Object.keys(sessionOptions.agents ?? {})).toEqual(['reviewer']);
  });
});
