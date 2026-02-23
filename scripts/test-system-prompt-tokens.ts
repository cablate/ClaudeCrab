#!/usr/bin/env npx tsx
/**
 * Test Script: System Prompt Token Usage Comparison
 *
 * Compares token usage between different system prompt configurations:
 * - Config A: settingSources: ['project', 'local'] + manual CLAUDE.md append (current)
 * - Config B: settingSources: ['project', 'local'] only (SDK auto-loads CLAUDE.md)
 * - Config C: settingSources: ['local'] + manual CLAUDE.md append (no SDK auto-load)
 *
 * Usage: npx tsx scripts/test-system-prompt-tokens.ts [agentPath]
 * Example: npx tsx scripts/test-system-prompt-tokens.ts agents/coder
 */

import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

interface TestResult {
  configName: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalInputTokens: number;
  costUsd: number;
  response: string;
}

async function runTest(
  configName: string,
  cwd: string,
  settingSources: Array<'user' | 'project' | 'local'>,
  systemPrompt?: string
): Promise<TestResult> {
  console.log(`\n🔄 Running: ${configName}...`);

  const options: Options = {
    cwd,
    settingSources,
    maxTurns: 1, // Single turn to minimize variance
    // Use a simple prompt that triggers minimal processing
    ...(systemPrompt
      ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: systemPrompt } }
      : {}),
  };

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let costUsd = 0;
  let response = '';

  try {
    const testPrompt = `請回答以下問題，用簡潔的格式：
1. 你的系統提示詞中，有載入哪些 CLAUDE.md？請列出你看到的「來源路徑」標記（格式如 <!-- 來源路徑: xxx -->）
2. 如果沒有看到任何「來源路徑」標記，請回覆「沒有看到來源路徑標記」
3. 你看到的 CLAUDE.md 內容開頭是什麼？（前 50 個字）
4. 你的系統提示詞中是否有提到「Claude Code」或「Anthropic's official CLI」或「software engineering tasks」？這是 Claude Code 預設提示詞的特徵。請回答有或沒有，並引用你看到的相關句子（如果有的話）。

只需要回答這些問題，不要做其他事。`;

    for await (const event of query({ prompt: testPrompt, options })) {
      if (event.type === 'result') {
        // Extract usage from result.modelUsage (same as SDKQueryManager)
        const resultMsg = event as unknown as {
          total_cost_usd?: number;
          modelUsage?: Record<string, {
            inputTokens?: number;
            outputTokens?: number;
            cacheReadInputTokens?: number;
            cacheCreationInputTokens?: number;
            costUSD?: number;
          }>;
        };

        if (resultMsg.modelUsage) {
          for (const mu of Object.values(resultMsg.modelUsage)) {
            inputTokens += mu.inputTokens ?? 0;
            outputTokens += mu.outputTokens ?? 0;
            cacheReadTokens += mu.cacheReadInputTokens ?? 0;
            cacheCreationTokens += mu.cacheCreationInputTokens ?? 0;
            costUsd += mu.costUSD ?? 0;
          }
        }
      } else if (event.type === 'assistant') {
        const msg = event as unknown as { message?: { content?: Array<{ type: string; text?: string }> } };
        if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text) {
              response += block.text;
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`  ❌ Error: ${(error as Error).message}`);
    throw error;
  }

  const totalInputTokens = inputTokens + cacheReadTokens + cacheCreationTokens;

  console.log(`  ✅ Input: ${inputTokens.toLocaleString()} | Cache Read: ${cacheReadTokens.toLocaleString()} | Cache Create: ${cacheCreationTokens.toLocaleString()} | Total: ${totalInputTokens.toLocaleString()}`);
  console.log(`  📝 Response: ${response.substring(0, 500).replace(/\n/g, ' | ')}`);

  return {
    configName,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalInputTokens,
    costUsd,
    response,
  };
}

async function main() {
  const projectRoot = resolve(process.cwd());
  const agentPath = process.argv[2] || 'agents/coder';
  const agentDir = resolve(projectRoot, agentPath);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  System Prompt Token Usage Comparison Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Project Root: ${projectRoot}`);
  console.log(`  Agent Path: ${agentDir}`);

  // Read CLAUDE.md for manual append tests
  const claudeMdPath = join(agentDir, 'CLAUDE.md');
  let claudeMdContent = '';
  if (existsSync(claudeMdPath)) {
    claudeMdContent = readFileSync(claudeMdPath, 'utf-8');
    console.log(`  CLAUDE.md: ${claudeMdContent.length.toLocaleString()} chars`);
  } else {
    console.log(`  ⚠️ CLAUDE.md not found at ${claudeMdPath}`);
  }

  console.log('═══════════════════════════════════════════════════════════════');

  const results: TestResult[] = [];

  // Config A: Current setup - settingSources includes 'project' + manual append
  // This should load CLAUDE.md TWICE (SDK auto + manual)
  results.push(await runTest(
    'A: project+local + manual append (DOUBLE LOAD)',
    agentDir,
    ['project', 'local'],
    claudeMdContent
  ));

  // Wait a bit to avoid rate limiting
  await new Promise(r => setTimeout(r, 2000));

  // Config B: Only settingSources, no manual append
  // SDK should auto-load CLAUDE.md once
  results.push(await runTest(
    'B: project+local only (SDK auto-load)',
    agentDir,
    ['project', 'local'],
    undefined
  ));

  await new Promise(r => setTimeout(r, 2000));

  // Config C: No 'project' in settingSources + manual append
  // Manual load only, no SDK auto-load
  results.push(await runTest(
    'C: local only + manual append (SINGLE LOAD)',
    agentDir,
    ['local'],
    claudeMdContent
  ));

  // Print comparison
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  RESULTS COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('┌─────────────────────────────────────────┬────────────┬────────────┬────────────┬────────────┐');
  console.log('│ Config                                  │ Input      │ Cache Read │ Cache New  │ Total      │');
  console.log('├─────────────────────────────────────────┼────────────┼────────────┼────────────┼────────────┤');

  for (const r of results) {
    const name = r.configName.padEnd(39);
    const input = r.inputTokens.toLocaleString().padStart(10);
    const cacheRead = r.cacheReadTokens.toLocaleString().padStart(10);
    const cacheNew = r.cacheCreationTokens.toLocaleString().padStart(10);
    const total = r.totalInputTokens.toLocaleString().padStart(10);
    console.log(`│ ${name} │ ${input} │ ${cacheRead} │ ${cacheNew} │ ${total} │`);
  }

  console.log('└─────────────────────────────────────────┴────────────┴────────────┴────────────┴────────────┘');

  // Analysis
  const configA = results.find(r => r.configName.startsWith('A'))!;
  const configB = results.find(r => r.configName.startsWith('B'))!;
  const configC = results.find(r => r.configName.startsWith('C'))!;

  console.log('\n📊 ANALYSIS:');
  console.log('─────────────────────────────────────────────────────────────────');

  const diffAB = configA.totalInputTokens - configB.totalInputTokens;
  const diffAC = configA.totalInputTokens - configC.totalInputTokens;
  const diffBC = configB.totalInputTokens - configC.totalInputTokens;

  console.log(`  A vs B (double vs SDK-only): ${diffAB > 0 ? '+' : ''}${diffAB.toLocaleString()} tokens`);
  console.log(`  A vs C (double vs manual-only): ${diffAC > 0 ? '+' : ''}${diffAC.toLocaleString()} tokens`);
  console.log(`  B vs C (SDK-only vs manual-only): ${diffBC > 0 ? '+' : ''}${diffBC.toLocaleString()} tokens`);

  console.log('\n💡 RECOMMENDATION:');
  console.log('─────────────────────────────────────────────────────────────────');

  if (diffAB > 100) {
    console.log(`  ⚠️  Config A 比 Config B 多了 ${diffAB.toLocaleString()} tokens`);
    console.log('  → 建議移除手動 append，讓 SDK 自動載入 CLAUDE.md');
  } else if (diffAB < -100) {
    console.log(`  ⚠️  Config B 比 Config A 多了 ${Math.abs(diffAB).toLocaleString()} tokens`);
    console.log('  → 可能有其他因素影響，需要進一步調查');
  } else {
    console.log('  ✅ Config A 和 B 差異不大，可能 SDK 有去重機制');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
