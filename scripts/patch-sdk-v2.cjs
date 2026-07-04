#!/usr/bin/env node
/**
 * patch-sdk-v2.cjs — Patch @anthropic-ai/claude-agent-sdk V2 createSession
 *
 * Target SDK version: 0.2.119 (upstream fixed settingSources + cwd natively in 0.2.110).
 *
 * Remaining holes patched here:
 *   - extraArgs, thinkingConfig, maxTurns, maxBudgetUsd (still hardcoded empty/void in cQ)
 *   - mcpServers (sdkMcpMap injection) + systemPrompt / agents (via F9 initConfig)
 *
 * Without this patch, V2 createSession can't pass thinking/budget/extraArgs/MCP/systemPrompt/agents,
 * making persistent sessions unusable for production.
 *
 * Anchor-based patching: uses stable string constants (not minified names) to locate targets.
 *
 * See:
 *   - docs/sop-sdk-cli-upgrade.md
 *
 * Run: node scripts/patch-sdk-v2.cjs
 * Lab: set CLAUDECAB_SDK_PATCH_DIR=<copied claude-agent-sdk dir> before running.
 * Auto: add to package.json postinstall
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SDK_DIR = path.join(__dirname, '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
const SUPPORTED_SDK_VERSION = '0.2.119';
// Use CLAUDECAB_SDK_PATCH_DIR (or SDK_PATCH_DIR) for sandbox/lab verification.
// Default stays production node_modules because package.json postinstall depends on it.
const SDK_DIR = path.resolve(process.env.CLAUDECAB_SDK_PATCH_DIR || process.env.SDK_PATCH_DIR || DEFAULT_SDK_DIR);
const IS_DEFAULT_TARGET = SDK_DIR === path.resolve(DEFAULT_SDK_DIR);
const SDK_PATH = path.join(SDK_DIR, 'sdk.mjs');
const CHECK_ONLY = process.argv.includes('--check');
// Ephemeral pre-patch backup (next to sdk.mjs). Wiped by `rm -rf node_modules`.
const BACKUP_PATH = SDK_PATH + '.pre-patch';

// === Anchor-based patch definitions ===
// Each patch: { anchor, find, replace, description }
// anchor: stable string to locate the region (must be unique in file)
// find: exact string to replace (within ~2000 chars of anchor)
// replace: replacement string

const PATCHES = [
  {
    // Combines former patches #3 (thinkingConfig/maxTurns/maxBudgetUsd) and #4 (extraArgs).
    // The 4 fields appear contiguously in the D9 options literal inside cQ's constructor,
    // so a single replace is simpler and only needs one uniqueness check.
    // In 0.2.119, the cQ constructor parameter is `$` (was `Q` in 0.2.76).
    //
    // Origin: SDK 0.2.119 V2 createSession options audit.
    // Last-modified: 2026-04-24
    id: 'thinking-and-extraArgs',
    anchor: 'Cannot send to closed session',
    find: 'extraArgs:{},thinkingConfig:void 0,maxTurns:void 0,maxBudgetUsd:void 0,',
    replace: 'extraArgs:$.extraArgs??{},thinkingConfig:$.thinking??void 0,maxTurns:$.maxTurns??void 0,maxBudgetUsd:$.maxBudgetUsd??void 0,',
    description: 'Allow V2 sessions to pass extraArgs, thinking, maxTurns, maxBudgetUsd',
  },
  {
    // Same bug class as the 0.2.110 fixes (cwd/settingSources): cQ builds a D9
    // options literal for ProcessTransport but forgets to forward includeHookEvents
    // (0.2.89+), includePartialMessages (0.2.108+), and agentProgressSummaries
    // (0.2.72+) from its own options.
    //
    // Origin: SDK 0.2.119 V2 forwarded-flags audit.
    // Last-modified: 2026-04-24
    id: 'cq-forwarded-flags',
    anchor: 'Cannot send to closed session',
    find: 'includePartialMessages:!1,forkSession:!1,',
    replace: 'includeHookEvents:$.includeHookEvents??!1,includePartialMessages:$.includePartialMessages??!1,agentProgressSummaries:$.agentProgressSummaries??!1,forkSession:!1,',
    description: 'Forward includeHookEvents + includePartialMessages + agentProgressSummaries from cQ options into D9 (same bug class as 0.2.110-fixed cwd/settingSources)',
  },
  {
    // Former patch #5 (h9-initConfig-and-mcpServers) rewritten for 0.2.119's F9 constructor.
    // Signature: new F9(transport, isSingleUserTurn, canUseTool, hooks, abortController,
    //                   sdkMcpMap, jsonSchema, initConfig, onElicitation?)
    //
    // 0.2.119 default call: new F9(Q,!1,$.canUseTool,$.hooks,this.abortController,
    //                              new Map, void 0, {planModeInstructions:$.planModeInstructions})
    //
    // We replace the `new Map` with an IIFE that builds the map from $.mcpServers
    // (same logic as V1's r7 Map), and extend the initConfig object to also carry
    // systemPrompt. planModeInstructions is preserved — don't break 0.2.119's plan-mode path.
    //
    // mcpServers is NOT patched into D9 options (kept {}) because SDK MCP instances have
    // circular refs that crash JSON serialization for --mcp-config CLI args. The SDK path
    // routes MCP through sdkMcpMap in-process instead.
    //
    // Origin: SDK 0.2.119 F9 initConfig/MCP bridge audit.
    // Last-modified: 2026-04-25 (extended initConfig with agentProgressSummaries —
    //   SDK reads `this.initConfig?.agentProgressSummaries` to decide whether to
    //   emit ~30s progress summaries; the cq-forwarded-flags D9 patch alone was
    //   cosmetic because agentProgressSummaries is NOT a CLI flag, it flows
    //   through the control_request initialize payload carried by F9.initConfig.)
    id: 'F9-initConfig-and-mcpServers',
    anchor: 'Cannot send to closed session',
    find: 'new F9(Q,!1,$.canUseTool,$.hooks,this.abortController,new Map,void 0,{planModeInstructions:$.planModeInstructions})',
    previousFinds: [
      'new F9(Q,!1,$.canUseTool,$.hooks,this.abortController,(()=>{let m=new Map;if($.mcpServers)for(let[k,v]of Object.entries($.mcpServers))if(v.type==="sdk"&&"instance"in v)m.set(k,v.instance);return m})(),void 0,{planModeInstructions:$.planModeInstructions,systemPrompt:$.systemPrompt,agentProgressSummaries:$.agentProgressSummaries})',
    ],
    replace: 'new F9(Q,!1,$.canUseTool,$.hooks,this.abortController,(()=>{let m=new Map;if($.mcpServers)for(let[k,v]of Object.entries($.mcpServers))if(v.type==="sdk"&&"instance"in v)m.set(k,v.instance);return m})(),void 0,{planModeInstructions:$.planModeInstructions,systemPrompt:$.systemPrompt,agentProgressSummaries:$.agentProgressSummaries,agents:$.agents,skills:$.skills,forwardSubagentText:$.forwardSubagentText})',
    description: 'Build sdkMcpMap from $.mcpServers + pass systemPrompt, agentProgressSummaries, agents, skills, and forwardSubagentText via initConfig',
  },
];

function hashContent(content, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(content).digest('hex');
}

function readSdkVersion() {
  try {
    const sdkPkg = JSON.parse(fs.readFileSync(path.join(SDK_DIR, 'package.json'), 'utf-8'));
    return sdkPkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function assertSupportedSdkVersion(version) {
  if (version === SUPPORTED_SDK_VERSION) return;
  console.error(`[patch-sdk-v2] ERROR: Unsupported SDK version ${version}.`);
  console.error(`[patch-sdk-v2] This patch is pinned to @anthropic-ai/claude-agent-sdk@${SUPPORTED_SDK_VERSION}.`);
  console.error('[patch-sdk-v2] Follow docs/SDK_TOUCHPOINTS.md and docs/sop-sdk-cli-upgrade.md before changing SDK versions.');
  process.exit(1);
}

function patchState(source) {
  const applied = PATCHES.filter(patch => source.includes(patch.replace)).map(patch => patch.id);
  const unpatched = PATCHES
    .filter(patch => source.includes(patch.find) || (patch.previousFinds || []).some(find => source.includes(find)))
    .map(patch => patch.id);
  return {
    applied,
    unpatched,
    isFullyPatched: applied.length === PATCHES.length,
    isPartial: applied.length > 0 && applied.length < PATCHES.length,
  };
}

function main() {
  // 1. Read sdk.mjs
  if (!fs.existsSync(SDK_PATH)) {
    console.log('[patch-sdk-v2] sdk.mjs not found, skipping (SDK not installed)');
    if (CHECK_ONLY) {
      process.exit(1);
    }
    return;
  }

  console.log(`[patch-sdk-v2] Target SDK dir: ${SDK_DIR}${IS_DEFAULT_TARGET ? '' : ' (override)'}`);

  const original = fs.readFileSync(SDK_PATH, 'utf-8');
  const version = readSdkVersion();
  console.log(`[patch-sdk-v2] Target SDK version: ${version}`);
  assertSupportedSdkVersion(version);

  // 2. Verify anchor exists
  const anchorStr = 'Cannot send to closed session';
  if (!original.includes(anchorStr)) {
    console.error('[patch-sdk-v2] ERROR: Anchor string not found. SDK version may have changed.');
    console.error('[patch-sdk-v2] Expected anchor: "' + anchorStr + '"');
    console.error('[patch-sdk-v2] Update scripts/patch-sdk-v2.cjs for this SDK version before retrying.');
    process.exit(1);
  }

  // 3. Check patch state
  const state = patchState(original);
  if (state.isFullyPatched) {
    console.log('[patch-sdk-v2] Already fully patched, skipping.');
    return;
  }
  if (CHECK_ONLY) {
    console.error(`[patch-sdk-v2] ERROR: SDK is not fully patched. Applied: ${state.applied.join(', ') || '(none)'}`);
    console.error('[patch-sdk-v2] Run npm install or node scripts/patch-sdk-v2.cjs before setup:verify.');
    process.exit(1);
  }
  const isPatchableMixedState = state.applied.length + state.unpatched.length === PATCHES.length;
  if (state.isPartial && !isPatchableMixedState) {
    console.error(`[patch-sdk-v2] ERROR: SDK is partially patched. Applied: ${state.applied.join(', ')}`);
    console.error('[patch-sdk-v2] Reinstall the SDK or restore sdk.mjs.pre-patch before retrying.');
    process.exit(1);
  }

  // 4. Apply patches
  let patched = original;
  const results = [];

  for (const patch of PATCHES) {
    if (patched.includes(patch.replace)) {
      results.push({ id: patch.id, description: `${patch.description} (already applied)` });
      continue;
    }

    const candidates = [patch.find, ...(patch.previousFinds || [])];
    const target = candidates.find(find => patched.includes(find));
    if (!target) {
      console.error(`[patch-sdk-v2] ERROR: Patch "${patch.id}" target not found: "${patch.find}"`);
      console.error('[patch-sdk-v2] SDK may have been updated. Aborting.');
      process.exit(1);
    }

    // Verify uniqueness — find should appear exactly once
    const count = patched.split(target).length - 1;
    if (count !== 1) {
      console.error(`[patch-sdk-v2] ERROR: Patch "${patch.id}" target found ${count} times (expected 1). Aborting.`);
      process.exit(1);
    }

    patched = patched.replace(target, patch.replace);
    results.push({ id: patch.id, description: patch.description });
  }

  // 5. Verify all patches applied
  if (patched === original) {
    console.log('[patch-sdk-v2] No changes needed.');
    return;
  }

  // 6. Backup original next to sdk.mjs for same-install rollback.
  fs.writeFileSync(BACKUP_PATH, original, 'utf-8');

  // 7. Write patched file
  fs.writeFileSync(SDK_PATH, patched, 'utf-8');

  // 8. Report
  const originalHash = hashContent(original, 'md5').slice(0, 8);
  const patchedHash = hashContent(patched, 'md5').slice(0, 8);

  console.log(`[patch-sdk-v2] Patched sdk.mjs (${originalHash} -> ${patchedHash})`);
  console.log(`[patch-sdk-v2] Backup: ${path.basename(BACKUP_PATH)}`);
  for (const r of results) {
    console.log(`  - ${r.id}: ${r.description}`);
  }
}

main();
