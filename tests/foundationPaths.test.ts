import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

function writeRuntimeConfig(root: string): void {
  const hooksDir = path.join(root, '_foundation', 'hooks');
  mkdirSync(path.join(hooksDir, 'prompts'), { recursive: true });
  writeFileSync(
    path.join(hooksDir, 'runtime-config.json'),
    JSON.stringify({
      promptFiles: { userPromptSubmit: 'user-prompt-submit.md' },
      userPromptSubmit: {
        displayName: 'User prompt',
        trivialPatterns: [],
        internalPromptPatterns: [],
        minLengthForInject: 1,
        skipMessages: { trivial: 'trivial', slashCommand: 'slash' },
        injectMessage: 'inject',
        promptId: 'userPromptSubmit',
      },
      preCompact: { displayName: 'Pre compact', message: 'compact' },
      queryPromptDecorationKeys: [],
      contextEconomy: {
        largeReadPreflight: { enabled: false, maxUnboundedBytes: 1, message: 'large' },
        mainContextBlockedTools: { enabled: false, tools: [], message: 'blocked' },
      },
    }),
  );
  writeFileSync(path.join(hooksDir, 'prompts', 'user-prompt-submit.md'), 'prompt');
}

describe('foundation runtime paths', () => {
  it('resolves hook runtime assets from AGENTS_DIR', async () => {
    const agentsDir = path.join(tmpdir(), `claudecab-agents-${Date.now()}`);
    writeRuntimeConfig(agentsDir);
    vi.resetModules();

    const agentPaths = await import('../src/core/agentPaths.ts');
    agentPaths.configureAgentPaths(agentsDir);
    const runtime = await import('../src/core/hooks/runtimeConfig.ts');
    const prompts = await import('../src/core/hooks/promptLoader.ts');

    expect(runtime.resolveHookRuntimeConfigPath()).toBe(
      path.join(agentsDir, '_foundation', 'hooks', 'runtime-config.json'),
    );
    expect(prompts.resolveHookPromptRoot()).toBe(
      path.join(agentsDir, '_foundation', 'hooks', 'prompts'),
    );
    expect(runtime.getHookRuntimeConfig().preCompact.message).toBe('compact');
  });
});
