# 設計：Agent Skill 系統設計原則

## Decisions

### Description-Driven Triggering

每個 skill 的 `description` 在 session 開始時自動載入，LLM 根據 description 決定是否調用該 skill。「何時使用」的資訊必須放在 description，不能只放在 SKILL.md 正文。

### CLAUDE.md 精簡化

CLAUDE.md 不再包含完整協議內容，只需指示 agent「在回覆前，先調用對應 skill」。實際協議細節在 skill 的 `references/` 子目錄。

### 協議與人格分離

- `agent-protocols` skill：定義「怎麼做」— Startup Protocol、Memory System、Safety 等
- `persona` skill：定義「是誰」— soul（價值觀、說話風格）、identity（名字、角色）

### 人格可攜帶性

`persona` skill 設計為可複製到其他 agent。複製 `.claude/skills/persona/` 目錄即可快速部署相同人格。環境狀態（USER.md、MEMORY.md、memory/）不放入 skill，屬於特定環境。

### Skill Metadata 預載機制與引導成本優化

Claude Code 在 session 開始時自動預載所有 skill 的 metadata（name, description），被動載入 > 主動引導。Description + CLAUDE.md 互補形成分層冗餘。

### Hook 輔助強化注意力

UserPromptSubmit hook 注入啟動協議提醒。新 session 時提醒 agent 執行 Startup Protocol，每次訊息時提醒檢查記憶寫入。

## Risks / Trade-offs

- Skill 的觸發依賴 LLM 對 description 的理解，可能偶爾未觸發
- 分層架構增加了檔案數量，需要維護 skill metadata 與實際內容的一致性

## Affected Components

- `agents/general/.claude/skills/agent-protocols/` — 協議 skill
- `agents/general/.claude/skills/persona/` — 人格 skill
- `agents/general/CLAUDE.md` — 引導文件
- `src/core/constants.ts` — Hook 提醒常數
