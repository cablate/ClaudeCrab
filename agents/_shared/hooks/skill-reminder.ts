/**
 * UserPromptSubmit Hook: Skill 主動調用提醒
 * 
 * 每輪提醒 agent 檢查是否有適用的 skill
 */

const reminder = `【Skill 檢查】這輪任務有適用的 skill 嗎？符合觸發時機就主動調用。`;

// 輸出提醒（會被注入到 context）
console.log(JSON.stringify({
  decision: "approve",
  reason: reminder
}));
