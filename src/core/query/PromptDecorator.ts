import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveHookPromptRoot } from '../hooks/promptLoader.js';
import { compileHookPatterns, getHookRuntimeConfig } from '../hooks/runtimeConfig.js';

export type PromptDecorationKey = string;
export type PromptDecorationSkipReason = 'min_length' | 'slash_command' | 'trivial_pattern';

export interface PromptDecorationDecision {
  readonly shouldDecorate: boolean;
  readonly reason?: PromptDecorationSkipReason;
  readonly promptLength: number;
  readonly keys: readonly PromptDecorationKey[];
  readonly tagNames: readonly string[];
}

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
  return decoratePrompt(prompt, getHookRuntimeConfig().queryPromptDecorationKeys);
}

export function getPromptDecorationDecision(prompt: string): PromptDecorationDecision {
  const config = getHookRuntimeConfig();
  const trimmed = prompt.trim();
  const keys = config.queryPromptDecorationKeys;
  const tagNames = keys.map((key) => {
    const def = config.promptDecorations?.[key];
    return def?.tagName ?? key;
  });

  if (trimmed.length < config.userPromptSubmit.minLengthForInject) {
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
  const queryPromptTrivialPatterns = compileHookPatterns(
    config.userPromptSubmit.trivialPatterns,
  );
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
  const def = getHookRuntimeConfig().promptDecorations?.[key];
  if (def === undefined) {
    throw new Error(`Unknown prompt decoration key: ${key}`);
  }

  const promptPath = path.join(resolveHookPromptRoot(), def.promptFile);
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
