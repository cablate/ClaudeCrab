import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveFoundationDir } from '../agentPaths.js';

export const HOOK_PROMPT_IDS = [
  'userPromptSubmit',
] as const;

export type HookPromptId = typeof HOOK_PROMPT_IDS[number];

export interface RuntimeHookPattern {
  readonly pattern: string;
  readonly flags?: string;
}

export interface RuntimeHookConfig {
  readonly promptFiles: Record<HookPromptId, string>;
  readonly userPromptSubmit: {
    readonly displayName: string;
    readonly trivialPatterns: readonly RuntimeHookPattern[];
    readonly internalPromptPatterns: readonly RuntimeHookPattern[];
    readonly minLengthForInject: number;
    readonly skipMessages: {
      readonly trivial: string;
      readonly slashCommand: string;
    };
    readonly injectMessage: string;
    readonly promptId: HookPromptId;
  };
  readonly preCompact: {
    readonly displayName: string;
    readonly message: string;
  };
  readonly queryPromptDecorationKeys: readonly string[];
  readonly promptDecorations?: Record<string, {
    readonly tagName: string;
    readonly promptFile: string;
  }>;
  readonly contextEconomy: {
    readonly largeReadPreflight: {
      readonly enabled: boolean;
      readonly maxUnboundedBytes: number;
      readonly message: string;
    };
    readonly mainContextBlockedTools: {
      readonly enabled: boolean;
      readonly tools: readonly string[];
      readonly message: string;
    };
  };
}

export function resolveHookRuntimeConfigPath(): string {
  return path.join(
    resolveFoundationDir(),
    'hooks',
    'runtime-config.json',
  );
}

let cachedConfigPath: string | undefined;
let cachedConfig: RuntimeHookConfig | undefined;

export function getHookRuntimeConfig(): RuntimeHookConfig {
  const configPath = resolveHookRuntimeConfigPath();
  if (cachedConfigPath !== configPath || cachedConfig === undefined) {
    cachedConfig = JSON.parse(readFileSync(configPath, 'utf8')) as RuntimeHookConfig;
    cachedConfigPath = configPath;
  }
  return cachedConfig;
}

export function compileHookPatterns(patterns: readonly RuntimeHookPattern[]): readonly RegExp[] {
  return patterns.map(({ pattern, flags = '' }) => new RegExp(pattern, flags));
}
