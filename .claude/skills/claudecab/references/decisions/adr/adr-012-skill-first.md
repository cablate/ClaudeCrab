---
id: ADR-012
title: Agent Skill 系統設計原則
status: accepted
date: 2026-01-30
---

# ADR-012: Agent Skill 系統設計原則

## 背景

隨著 Agent 協議和人格定義變得複雜，原本將所有內容塞進 CLAUDE.md 的做法導致文件過長、難以維護。需要將協議模組化，同時保持可攜性和清晰的分層。

## 決策

採用 Claude Code 原生 Skills 機制，將協議和人格抽離為獨立 skills：

1. **Skill Metadata Description 是主要觸發機制**
   - 每個 skill 的 `description` 在 session 開始時自動載入
   - LLM 根據 description 決定是否調用該 skill
   - 「何時使用」的資訊必須放在 description，不能只放在 SKILL.md 正文

2. **CLAUDE.md 只負責引導**
   - CLAUDE.md 不再包含完整協議內容
   - 只需指示 agent「在回覆前，先調用 `/agent-protocols` skill」
   - 實際協議細節在 skill 的 `references/` 子目錄

3. **協議與人格分離**
   - `agent-protocols` skill：定義「怎麼做」— Startup Protocol、Memory System、Safety 等
   - `persona` skill：定義「是誰」— soul（價值觀、說話風格）、identity（名字、角色）

4. **人格可攜帶性**
   - `persona` skill 設計為可複製到其他 agent
   - 複製 `.claude/skills/persona/` 目錄即可快速部署相同人格
   - 環境狀態（USER.md、MEMORY.md、memory/）不放入 skill，屬於特定環境

5. **Hook 輔助強化注意力**
   - UserPromptSubmit hook 注入啟動協議提醒
   - 新 session 時提醒 agent 執行 Startup Protocol
   - 每次訊息時提醒檢查記憶寫入

## 設計原則總結

| 原則 | 說明 |
|------|------|
| **Description-Driven Triggering** | Skill 的 description 是 LLM 決定是否調用的關鍵，必須清楚說明觸發時機 |
| **CLAUDE.md 精簡化** | 只負責引導和強調，不堆疊內容 |
| **協議 vs 人格分離** | agent-protocols = how, persona = who |
| **可攜帶性優先** | persona skill 可獨立遷移，環境狀態留在原地 |
| **Hook 輔助** | 透過 SDK hook 注入提醒，強化 agent 對協議的注意力 |
| **References 子目錄** | 詳細內容放在 `references/`，SKILL.md 作為索引 |

## Skill Metadata 預載機制與引導成本優化

**核心洞察**：Claude Code 會在 session 開始時自動預載所有 skill 的 metadata（name, description），這些資訊會存在於對話 context 中，即使 agent 尚未調用該 skill。

**傳統做法的問題**：
```
CLAUDE.md
├── 「記得讀 SOUL.md」
├── 「記得讀 USER.md」
├── 「參考 Safety 規則在 xxx」
└── ... 窮舉所有文件路徑
```
CLAUDE.md 變成臃腫的導航頁，每多一個文件就要多一行引導，忘記寫就不會被讀到。

**優化後的架構**：

| 層級 | 機制 | 特性 | 作用 |
|------|------|------|------|
| Skill Description | 被動預載 | 自動存在於 context | 減輕 CLAUDE.md 引導負擔 |
| CLAUDE.md | 主動引導 | 權重確定 | 精簡強調，不需窮舉 |
| SKILL.md → references/ | 調用後展開 | 正常文件結構 | 詳細內容 |

**關鍵 Principle**：

1. **被動載入 > 主動引導** — 能透過 metadata 被動傳達的資訊，比需要層層引導才能讀到的更可靠
2. **Description + CLAUDE.md 互補，非取代** — 兩者形成分層冗餘
3. **Skill 內部展開是可信的** — 一旦調用，SKILL.md → references/ 的路徑會被正常執行
4. **Description 應包含觸發時機** — 不只描述「是什麼」，還要說「什麼時候該用」

## 實作位置

- `agents/general/.claude/skills/agent-protocols/` — 協議 skill
- `agents/general/.claude/skills/persona/` — 人格 skill
- `agents/general/CLAUDE.md` — 引導文件
- `src/core/constants.ts` — Hook 提醒常數
