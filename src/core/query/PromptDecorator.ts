import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HOOK_PROMPT_ROOT } from '../hooks/promptLoader.js';
import { compileHookPatterns, HOOK_RUNTIME_CONFIG } from '../hooks/runtimeConfig.js';

export type PromptDecorationKey = string;
export type PromptDecorationSkipReason = 'min_length' | 'slash_command' | 'trivial_pattern';

export interface PromptDecorationDecision {
  readonly shouldDecorate: boolean;
  readonly reason?: PromptDecorationSkipReason;
  readonly promptLength: number;
  readonly keys: readonly PromptDecorationKey[];
  readonly tagNames: readonly string[];
}

const queryPromptTrivialPatterns = compileHookPatterns(
  HOOK_RUNTIME_CONFIG.userPromptSubmit.trivialPatterns,
);

interface ResolvedPromptDecoration {
  readonly key: string;
  readonly body: string;
  readonly firstLine: string;
}

export function decoratePrompt(
  prompt: string,
  keys: readonly PromptDecorationKey[],
): string {
  const blocks = keys
    .filter((key, index) => keys.indexOf(key) === index)
    .map((key) => resolveDecoration(key))
    .filter((decoration) => !hasDecoration(prompt, decoration.firstLine))
    .map(formatDecoration);

  return blocks.length > 0
    ? `${prompt}\n\n${blocks.join('\n\n')}`
    : prompt;
}

export function decoratePromptWithConfiguredDecorations(prompt: string): string {
  if (!getPromptDecorationDecision(prompt).shouldDecorate) return prompt;
  return decoratePrompt(prompt, HOOK_RUNTIME_CONFIG.queryPromptDecorationKeys);
}

export function getPromptDecorationDecision(prompt: string): PromptDecorationDecision {
  const trimmed = prompt.trim();
  const keys = HOOK_RUNTIME_CONFIG.queryPromptDecorationKeys;
  const tagNames = keys.map((key) => {
    const def = HOOK_RUNTIME_CONFIG.promptDecorations?.[key];
    return def?.tagName ?? key;
  });

  if (trimmed.length < HOOK_RUNTIME_CONFIG.userPromptSubmit.minLengthForInject) {
    return {
      shouldDecorate: false,
      reason: 'min_length',
      promptLength: trimmed.length,
      keys,
      tagNames,
    };
  }
  if (trimmed.startsWith('/')) {
    return {
      shouldDecorate: false,
      reason: 'slash_command',
      promptLength: trimmed.length,
      keys,
      tagNames,
    };
  }
  if (queryPromptTrivialPatterns.some((pattern) => pattern.test(trimmed))) {
    return {
      shouldDecorate: false,
      reason: 'trivial_pattern',
      promptLength: trimmed.length,
      keys,
      tagNames,
    };
  }

  return {
    shouldDecorate: true,
    promptLength: trimmed.length,
    keys,
    tagNames,
  };
}

function resolveDecoration(key: PromptDecorationKey): ResolvedPromptDecoration {
  const def = HOOK_RUNTIME_CONFIG.promptDecorations?.[key];
  if (def === undefined) {
    throw new Error(`Unknown prompt decoration key: ${key}`);
  }

  const promptPath = path.join(HOOK_PROMPT_ROOT, def.promptFile);
  const body = readFileSync(promptPath, 'utf8').trimEnd();
  const firstLine = body.split('\n')[0] ?? body;
  return { key, body, firstLine };
}

function hasDecoration(prompt: string, firstLine: string): boolean {
  return prompt.includes(firstLine);
}

function formatDecoration(decoration: ResolvedPromptDecoration): string {
  return `---\n${decoration.body}`;
}
