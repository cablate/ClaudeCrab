import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK_PROMPT_FILES, type HookPromptId } from './runtimeConfig.js';

export { HOOK_PROMPT_FILES, type HookPromptId } from './runtimeConfig.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '../../..');

export const HOOK_PROMPT_ROOT = path.join(repoRoot, 'agents', '_foundation', 'hooks', 'prompts');

export function getHookPromptPath(promptId: HookPromptId): string {
  return path.join(HOOK_PROMPT_ROOT, HOOK_PROMPT_FILES[promptId]);
}

export function readHookPrompt(promptId: HookPromptId): string {
  const promptPath = getHookPromptPath(promptId);

  try {
    const text = readFileSync(promptPath, 'utf8').trimEnd();
    if (text.trim().length > 0) {
      return text;
    }
    return buildPromptLoadFailure(promptId, promptPath, 'file is empty');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return buildPromptLoadFailure(promptId, promptPath, reason);
  }
}

function buildPromptLoadFailure(promptId: HookPromptId, promptPath: string, reason: string): string {
  return [
    'HOOK_PROMPT_LOAD_FAILED',
    '',
    `Prompt id: ${promptId}`,
    `Expected file: ${promptPath}`,
    `Reason: ${reason}`,
    '',
    'Continue safely, but report this as a ClaudeCab hook prompt configuration issue.',
  ].join('\n');
}
