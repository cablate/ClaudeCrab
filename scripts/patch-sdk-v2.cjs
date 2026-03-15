#!/usr/bin/env node
/**
 * patch-sdk-v2.cjs — Patch @anthropic-ai/claude-agent-sdk V2 createSession
 *
 * Patches the cQ class (SDKSession) constructor in sdk.mjs to accept
 * settingSources, systemPrompt, mcpServers, cwd, thinkingConfig, maxTurns, maxBudgetUsd.
 *
 * Without this patch, V2 createSession hardcodes these to empty/void values,
 * making persistent sessions unusable for production (no CLAUDE.md, no MCP, no system prompt).
 *
 * Anchor-based patching: uses stable string constants (not minified names) to locate targets.
 * See: _special-research/sdk-anchor-index-v76.md
 *
 * Run: node scripts/patch-sdk-v2.cjs
 * Auto: add to package.json postinstall
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SDK_PATH = path.join(__dirname, '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs');
const BACKUP_PATH = SDK_PATH + '.pre-patch';

// === Anchor-based patch definitions ===
// Each patch: { anchor, find, replace, description }
// anchor: stable string to locate the region (must be unique in file)
// find: exact string to replace (within ~2000 chars of anchor)
// replace: replacement string

const PATCHES = [
  {
    id: 'settingSources',
    anchor: 'Cannot send to closed session',
    find: 'settingSources:[]',
    replace: 'settingSources:Q.settingSources??[]',
    description: 'Allow V2 sessions to load CLAUDE.md and settings',
  },
  {
    id: 'cwd',
    anchor: 'Cannot send to closed session',
    find: 'abortController:this.abortController,pathToClaudeCodeExecutable:X',
    replace: 'cwd:Q.cwd,abortController:this.abortController,pathToClaudeCodeExecutable:X',
    description: 'Allow V2 sessions to specify working directory (needed for JSONL path resolution)',
  },
  // mcpServers: NOT patched in y9 (ProcessTransport) — SDK MCP instances have circular refs
  // that crash JSON serialization for --mcp-config CLI args.
  // Instead, MCP is handled in patch #5 (h9-initConfig-and-mcpServers) via sdkMcpMap in-process routing.
  {
    id: 'thinkingConfig',
    anchor: 'Cannot send to closed session',
    find: 'thinkingConfig:void 0,maxTurns:void 0,maxBudgetUsd:void 0',
    replace: 'thinkingConfig:Q.thinking??void 0,maxTurns:Q.maxTurns??void 0,maxBudgetUsd:Q.maxBudgetUsd??void 0',
    description: 'Allow V2 sessions to configure thinking, maxTurns, maxBudgetUsd',
  },
  {
    id: 'extraArgs',
    anchor: 'Cannot send to closed session',
    find: 'extraArgs:{}',
    replace: 'extraArgs:Q.extraArgs??{}',
    description: 'Allow V2 sessions to pass extra CLI args',
  },
  {
    id: 'h9-initConfig-and-mcpServers',
    anchor: 'Cannot send to closed session',
    // h9 constructor: (transport, isSingleUserTurn, canUseTool, hooks, abortController, sdkMcpMap, jsonSchema, initConfig, onElicitation)
    // Currently: new h9($,!1,Q.canUseTool,Q.hooks,this.abortController,new Map)
    // Need to: 1) build sdkMcpMap from Q.mcpServers (same logic as V1's r7 Map)
    //          2) pass initConfig for systemPrompt
    find: ',new Map),this.query.streamInput(this.inputStream)',
    replace: ',(()=>{let m=new Map;if(Q.mcpServers)for(let[k,v]of Object.entries(Q.mcpServers))if(v.type==="sdk"&&"instance"in v)m.set(k,v.instance);return m})(),void 0,Q.systemPrompt?{systemPrompt:Q.systemPrompt}:void 0,void 0),this.query.streamInput(this.inputStream)',
    description: 'Build sdkMcpMap from Q.mcpServers + pass systemPrompt via initConfig',
  },
];

function main() {
  // 1. Read sdk.mjs
  if (!fs.existsSync(SDK_PATH)) {
    console.log('[patch-sdk-v2] sdk.mjs not found, skipping (SDK not installed)');
    return;
  }

  const original = fs.readFileSync(SDK_PATH, 'utf-8');

  // 2. Verify anchor exists
  const anchorStr = 'Cannot send to closed session';
  if (!original.includes(anchorStr)) {
    console.error('[patch-sdk-v2] ERROR: Anchor string not found. SDK version may have changed.');
    console.error('[patch-sdk-v2] Expected anchor: "' + anchorStr + '"');
    console.error('[patch-sdk-v2] Please update patch script. See: _special-research/sdk-anchor-index-v76.md');
    process.exit(1);
  }

  // 3. Check if already patched
  if (original.includes('Q.settingSources??[]')) {
    console.log('[patch-sdk-v2] Already patched, skipping.');
    return;
  }

  // 4. Apply patches
  let patched = original;
  const results = [];

  for (const patch of PATCHES) {
    if (!patched.includes(patch.find)) {
      console.error(`[patch-sdk-v2] ERROR: Patch "${patch.id}" target not found: "${patch.find}"`);
      console.error('[patch-sdk-v2] SDK may have been updated. Aborting.');
      process.exit(1);
    }

    // Verify uniqueness — find should appear exactly once
    const count = patched.split(patch.find).length - 1;
    if (count !== 1) {
      console.error(`[patch-sdk-v2] ERROR: Patch "${patch.id}" target found ${count} times (expected 1). Aborting.`);
      process.exit(1);
    }

    patched = patched.replace(patch.find, patch.replace);
    results.push({ id: patch.id, description: patch.description });
  }

  // 5. Verify all patches applied
  if (patched === original) {
    console.log('[patch-sdk-v2] No changes needed.');
    return;
  }

  // 6. Backup original
  fs.writeFileSync(BACKUP_PATH, original, 'utf-8');

  // 7. Write patched file
  fs.writeFileSync(SDK_PATH, patched, 'utf-8');

  // 8. Report
  const originalHash = crypto.createHash('md5').update(original).digest('hex').slice(0, 8);
  const patchedHash = crypto.createHash('md5').update(patched).digest('hex').slice(0, 8);

  console.log(`[patch-sdk-v2] Patched sdk.mjs (${originalHash} → ${patchedHash})`);
  console.log(`[patch-sdk-v2] Backup: ${path.basename(BACKUP_PATH)}`);
  for (const r of results) {
    console.log(`  ✓ ${r.id}: ${r.description}`);
  }
}

main();
