#!/usr/bin/env npx tsx
/**
 * External Memory Stop Checkpoint Hook for Claude Code Stop event
 *
 * Reads hook input from stdin, checks stop_hook_active flag.
 * If agent already did memory check (stop_hook_active=true), allows stop.
 * Otherwise, blocks stop and injects memory checkpoint prompt.
 *
 * Usage in settings.local.json:
 * {
 *   "hooks": {
 *     "Stop": [{
 *       "matcher": "*",
 *       "hooks": [{
 *         "type": "command",
 *         "command": "npx tsx ../_shared/hooks/memory-stop-checkpoint.ts"
 *       }]
 *     }]
 *   }
 * }
 */

// --- Types ---

interface StopHookInput {
  stop_hook_active?: boolean;
}

// --- Constants ---

const MEMORY_STOP_CHECKPOINT =
  '【記憶檢查（靜默模式）】結束前，根據 memory-system 規範檢查這輪有沒有該記的內容。' +
  '有就寫入對應檔案，沒有就直接結束。' +
  '不要輸出任何檢查過程或結果——不要分析、不要列檢查項目、不要回報結果。靜默執行工具操作或直接結束。' +
  '\n\n' +
  '【系統更新（批次・靜默）】以下檢查全部靜默執行，不要在回覆中提及：\n' +
  '- 使用了 domain skill？→ 更新 .claude/skills/sys-proficiency/references/levels.md 的使用次數\n' +
  '- 人格有新發現？→ 依照 evolution-guide.md 原則更新 soul.md，並在 MEMORY.md Personality Journal 記錄\n' +
  '- 學到特定適應？→ 寫入 MEMORY.md 或 CLAUDE.md Lessons Learned';

// --- Main ---

async function main(): Promise<void> {
  // Read stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');

  let input: StopHookInput;
  try {
    input = JSON.parse(raw) as StopHookInput;
  } catch {
    // Cannot parse input — block (safe default: force memory check)
    process.stderr.write(
      JSON.stringify({
        decision: 'block',
        reason: MEMORY_STOP_CHECKPOINT,
      }),
    );
    process.exit(2);
  }

  // If agent already did memory check, allow stop
  if (input.stop_hook_active) {
    process.exit(0);
  }

  // Otherwise, block and inject memory checkpoint prompt
  process.stderr.write(
    JSON.stringify({
      decision: 'block',
      reason: MEMORY_STOP_CHECKPOINT,
    }),
  );
  process.exit(2);
}

main().catch(() => {
  // On error, block (safe default: force memory check)
  process.stderr.write(
    JSON.stringify({
      decision: 'block',
      reason: MEMORY_STOP_CHECKPOINT,
    }),
  );
  process.exit(2);
});
