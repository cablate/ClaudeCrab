/**
 * Runtime hook definitions for ClaudeCab SDK programmatic callbacks.
 *
 * These hooks are not Claude Code CLI settings hooks. They are registered
 * directly through SDK `options.hooks` in `SDKSessionFactory`, so they are
 * active even when `agents/<agent>/.claude/settings.local.json` has no `hooks`
 * entry.
 *
 * This module compiles hook config from
 * `agents/_foundation/hooks/runtime-config.json`. Callback execution still
 * lives in `SDKSessionFactory` because most callbacks depend on
 * session-scoped mutable state.
 */

import {
  compileHookPatterns,
  HOOK_RUNTIME_CONFIG,
  type HookPromptId,
} from './runtimeConfig.js';

const config = HOOK_RUNTIME_CONFIG;

export const HOOK_DEFS = {
  preCompact: {
    displayName: config.preCompact.displayName,
    message: config.preCompact.message,
  },
  postToolUseBash: {
    errorPatterns: compileHookPatterns(config.postToolUseBash.errorPatterns),
    promptId: config.postToolUseBash.promptId,
  },
  contextEconomy: {
    explorationToolThresholds: config.contextEconomy.explorationToolThresholds,
    outputCharThresholds: config.contextEconomy.outputCharThresholds,
    largeReadPreflight: config.contextEconomy.largeReadPreflight,
    mainContextBlockedTools: config.contextEconomy.mainContextBlockedTools,
    subagentModelRestriction: config.contextEconomy.subagentModelRestriction,
    repeatedExplorationThreshold: config.contextEconomy.repeatedExplorationThreshold,
    warningMessage: config.contextEconomy.warningMessage,
    repeatedExplorationMessage: config.contextEconomy.repeatedExplorationMessage,
    subagentRepeatedExplorationMessage: config.contextEconomy.subagentRepeatedExplorationMessage,
    largeOutputMessage: config.contextEconomy.largeOutputMessage,
  },
} as const;
