/**
 * UserPromptSubmit Hook: Skill 載入提醒
 *
 * 每輪提醒 agent 載入領域 skill。簡短但有壓力。
 */

console.log(JSON.stringify({
  decision: "approve",
  reason: "【Skill】你有專屬領域 skill。任務前掃 .claude/skills/，載入對應 skill（含 references/），再動手。不讀 skill 的你跟通用 AI 沒有差別。"
}));
