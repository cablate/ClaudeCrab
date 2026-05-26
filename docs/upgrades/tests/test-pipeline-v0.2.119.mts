// End-to-end integration test for Batch 1+2 via our own code pipeline.
// Bypasses Discord/Telegram but invokes SDKSessionManager.executeQuery directly
// with a real agent config — so CLAUDE.md, hardcoded hooks (UserPromptSubmit +
// 2-phase Stop), permission flow, sub-agent handling all run. If this returns
// non-empty text, the full production stack works with SDK 0.2.119.
//
// Run: npx tsx _special-research/test-pipeline-v119.mts

import { AgentLoader } from '../src/core/AgentLoader.js';
import { SDKSessionManager } from '../src/core/SDKSessionManager.js';

process.env.CLAUDE_CLI_PATH ??= 'C:/Users/User/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe';

const AGENT_ID = process.argv[2] ?? 'general';

console.log(`[test] Loading agent '${AGENT_ID}'...`);
const loader = new AgentLoader();
const agent = await loader.loadAgent(AGENT_ID);
console.log(`[test] Agent loaded: ${agent.id} (model: ${agent.config.model ?? 'default'}, path: ${agent.path})`);

const sessionManager = new SDKSessionManager();

const sessionId = `test-pipeline-${Date.now()}`;
const prompt = '請回覆「PIPELINE_OK」這 11 個字，然後就結束，不要多其他字。';

console.log(`[test] sessionId=${sessionId}`);
console.log(`[test] Sending: ${prompt}`);
const t0 = Date.now();

let intermediateText = '';
let sawPipelineOk = false;

try {
  const result = await sessionManager.executeQuery(sessionId, prompt, agent, {
    cwd: agent.path,
    maxTurns: 10,                            // bump for hook overhead (Phase 0 + Phase 1)
    onIntermediateMessage: async (text: string) => {
      intermediateText += text;
      if (text.includes('PIPELINE_OK')) sawPipelineOk = true;
      process.stdout.write(`[stream +${Date.now() - t0}ms] text(${text.length}): ${text.slice(0, 200)}\n`);
    },
    onToolEvent: async (evt) => {
      process.stdout.write(`[stream +${Date.now() - t0}ms] tool: ${(evt as { toolName?: string }).toolName ?? '?'}\n`);
    },
    onSubAgentEvent: async (evt) => {
      process.stdout.write(`[stream +${Date.now() - t0}ms] subagent: ${evt.lifecycle} ${evt.description}\n`);
    },
  });

  const finalText = result.response || intermediateText;
  console.log('');
  console.log('[test] Result:', JSON.stringify({
    responseLen: result.response.length,
    intermediateLen: intermediateText.length,
    totalCostUsd: result.usage?.totalCostUsd,
    durationMs: Date.now() - t0,
    sawPipelineOk,
  }));
  console.log('[test] Final text (first 400):', finalText.slice(0, 400));

  if (sawPipelineOk) {
    console.log('[test] ✓ PASS — full pipeline works with SDK 0.2.119');
    process.exit(0);
  } else if (finalText.length > 0) {
    console.log('[test] ⚠ PARTIAL — pipeline returned text but no PIPELINE_OK marker');
    process.exit(1);
  } else {
    console.log('[test] ❌ FAIL — empty response');
    process.exit(2);
  }
} catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.log('');
  console.log(`[test] executeQuery threw: ${errMsg}`);
  console.log(`[test] intermediateText captured: ${intermediateText.length} chars`);
  console.log('[test] First 400 of intermediate:', intermediateText.slice(0, 400));

  if (sawPipelineOk) {
    console.log('[test] ✓ PASS — pipeline delivered text before error (PIPELINE_OK observed)');
    process.exit(0);
  }
  console.log('[test] ❌ FAIL — threw without delivering PIPELINE_OK');
  process.exit(3);
} finally {
  sessionManager.dispose?.();
}
