# Agent Skill 系統設計原則

## Why

隨著 Agent 協議和人格定義變得複雜，原本將所有內容塞進 CLAUDE.md 的做法導致文件過長、難以維護。需要將協議模組化，同時保持可攜性和清晰的分層。

## What Changes

採用 Claude Code 原生 Skills 機制，將協議和人格抽離為獨立 skills：

1. **Skill Metadata Description 是主要觸發機制** — 每個 skill 的 `description` 在 session 開始時自動載入，LLM 根據 description 決定是否調用該 skill
2. **CLAUDE.md 只負責引導** — 不再包含完整協議內容，只需指示 agent 調用對應 skill
3. **協議與人格分離** — `agent-protocols` skill 定義「怎麼做」，`persona` skill 定義「是誰」
4. **人格可攜帶性** — `persona` skill 設計為可複製到其他 agent，環境狀態不放入 skill
5. **Hook 輔助強化注意力** — UserPromptSubmit hook 注入啟動協議提醒

## Capabilities

- Description-Driven Triggering：Skill 的 description 是 LLM 決定是否調用的關鍵
- CLAUDE.md 精簡化：只負責引導和強調，不堆疊內容
- 協議 vs 人格分離：agent-protocols = how, persona = who
- 可攜帶性優先：persona skill 可獨立遷移，環境狀態留在原地
- Skill Metadata 預載機制：被動載入 > 主動引導，減輕 CLAUDE.md 引導負擔
