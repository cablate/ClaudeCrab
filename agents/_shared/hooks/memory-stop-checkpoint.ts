#!/usr/bin/env npx tsx
/**
 * External Memory Stop Checkpoint Hook for Claude Code Stop event
 *
 * NOTE: This command hook is NOT used by ClaudeCab's managed sessions.
 * The Stop hook is now injected programmatically in MessageProcessor
 * for interactive sessions only. Scheduled sessions have no Stop hook.
 *
 * This file is kept as a reference for direct CLI usage:
 * npx tsx ../_shared/hooks/memory-stop-checkpoint.ts
 */

// --- Types ---

interface StopHookInput {
  stop_hook_active?: boolean;
}

// --- Constants ---

const MEMORY_STOP_CHECKPOINT =
  '⚠️【系統任務：記憶檢查】這不是對話延續——禁止回覆使用者、禁止重複上輪內容。\\n\\n' +
  '靜默執行：有該記的→寫檔；沒有→直接結束（不輸出文字）。\\n\\n' +
  '檢查項（靜默）：\\n' +
  '• 重要對話/決策/偏好 → memory/{date}.md 或 MEMORY.md\\n' +
  '• 對使用者的觀察 → USER.md Observations（思考模式/偏好/盲點/成長/感受/murmur）\\n' +
  '• domain skill使用 → sys-proficiency/levels.md\\n' +
  '• 人格發現 → soul.md + MEMORY.md Personality Journal\\n' +
  '• 操作規則 → CLAUDE.md Lessons Learned\\n' +
  '• 方法論/領域知識 → 建獨立 Skill\\n' +
  '• 【Admin】員工操作 → agent-changes-log.md';

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
