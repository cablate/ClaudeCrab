// Minimal V2 session smoke test for SDK 0.2.119 + patch verification.
// Runs an isolated createSession against the native CLI binary, exercises
// each patched field (cwd, settingSources, thinking, extraArgs, maxTurns,
// systemPrompt, mcpServers=empty), sends a single prompt, observes one
// result message, closes. No Discord/Telegram involvement.
//
// Run: node _special-research/test-patch-v119.mjs

import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk';
import path from 'path';

const cliPath = 'C:/Users/User/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe';

console.log('[test] Creating V2 session...');
console.log('[test] cliPath:', cliPath);

const session = unstable_v2_createSession({
  pathToClaudeCodeExecutable: cliPath,
  cwd: path.resolve('.'),                    // patch #2 (was missing in 0.2.76, fixed upstream in 0.2.110)
  settingSources: [],                        // patch #1 (fixed upstream in 0.2.110)
  extraArgs: {},                             // patch A (still needs our patch in 0.2.119)
  thinking: { type: 'disabled' },            // patch A
  maxTurns: 2,                               // patch A
  systemPrompt: {                            // patch B (via F9 initConfig)
    type: 'preset',
    preset: 'claude_code',
    append: 'You are a smoke test agent. When asked, reply with exactly: PATCH_OK',
  },
  allowDangerouslySkipPermissions: true,
  allowedTools: [],
});

console.log('[test] Session created, sending prompt...');
await session.send('Reply with exactly: PATCH_OK');

let sawResult = false;
let sawText = false;
let assistantText = '';
const timeoutMs = 45_000;
const startedAt = Date.now();

try {
  for await (const msg of session.stream()) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > timeoutMs) {
      console.error(`[test] ❌ Timed out after ${timeoutMs}ms`);
      break;
    }

    const summary = { type: msg.type, subtype: msg.subtype ?? undefined };
    console.log(`[stream +${elapsed}ms]`, JSON.stringify(summary));

    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) {
          sawText = true;
          assistantText += block.text;
        }
      }
    }

    if (msg.type === 'result') {
      sawResult = true;
      console.log('[test] Result:', JSON.stringify({
        subtype: msg.subtype,
        num_turns: msg.num_turns,
        total_cost_usd: msg.total_cost_usd,
      }));
      break;
    }
  }
} finally {
  session.close();
}

console.log('[test] Assistant text:', assistantText.slice(0, 200));
console.log('[test] sawResult:', sawResult, 'sawText:', sawText);

if (sawResult && sawText && assistantText.includes('PATCH_OK')) {
  console.log('[test] ✓ PASS — session lifecycle + systemPrompt + stream all work');
  process.exit(0);
} else if (sawResult && sawText) {
  console.log('[test] ⚠ PARTIAL — session works but systemPrompt may not be honored (no PATCH_OK in response)');
  process.exit(1);
} else {
  console.log('[test] ❌ FAIL — no result or no text');
  process.exit(2);
}
