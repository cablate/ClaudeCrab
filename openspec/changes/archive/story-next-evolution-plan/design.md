# 設計：ClaudeCab Next Evolution

## Decisions

### 人格架構：七層世界觀驅動

新 soul.md 從規則清單改為七層架構：Who I Am → What Drives Me → My Lens → How I Think → How I Sound（含範例對話）→ My Quirks → Drift Detection。共享內容（Boundaries、Continuity）移到 behavior.md，soul.md 只放差異化人格。

### 群組狀態消息策略

採用模式切換方案：群組中 StatusMessageManager 只發 `sendChatAction("typing")`，不發文字狀態消息；私聊保持現有詳細狀態更新。

### 社交模式架構：獨立 SocialHandler

選擇獨立 SocialHandler 而非擴展 InitiativeHandler，原因：社交評估邏輯與工作模式完全不同、防迴圈機制不同（社交需要 energy decay）、可獨立開關與配置。

### 社交發言決策機制

五步流程：Gate 檢查 → 候選 Bot 篩選 → LLM 評估（Haiku，per bot）→ 選擇 + 隨機延遲 → 執行。energy 1-5 分制，threshold ≥ 3 才發言。

### 三層防迴圈防護

- Soft：energy threshold（≥ 3 才發言）
- Medium：rate limiting（cooldown 600s、每分鐘 ≤ 2 則）
- Hard：系統級硬切（連續 N 則無人類 → 全體靜默、bot-to-bot ≤ 3 輪、每小時 ≤ 10 則）
- Energy decay：每輪 bot-to-bot energy -= 2，人類新消息重置為 5

### 社交模式與委派模式隔離

`isSocial` flag 標記社交回覆，DelegationHandler 遇到 isSocial 直接跳過。@mention → Delegation Mode，無 mention → Initiative + Social 共同評估，Initiative 優先。

## Risks / Trade-offs

- Bot-to-bot 無限迴圈（三層防護 + energy decay 緩解）
- 人格化可能降低任務精確性（「有觀點 ≠ 有情緒」原則）
- 社交模式 token 成本（Haiku evaluator + 嚴格 rate limit）
- Persona drift 在社交中加劇（社交回覆也注入人格摘要）
- 使用者覺得 bot 太吵（保守初始參數 + quiet hours）

## Affected Components

- `agents/*/. claude/skills/persona/references/soul.md` — 人格重寫
- `agents/*/.claude/skills/sys-agent-protocols/references/behavior.md` — 行為規範更新
- `agents/*/.claude/skills/sys-agent-protocols/references/memory-system.md` — Personality Journal
- `src/core/StatusMessageManager.ts` — 群組模式
- `src/core/MessageProcessor.ts` — buildPromptContext 強化
- `src/core/SocialHandler.ts` — 新建
- `src/core/SocialEvaluator.ts` — 新建
- `src/core/GroupBroadcaster.ts` — 新增 social 評估入口
- `src/core/DelegationHandler.ts` — isSocial 跳過
- `src/types/events.ts` — BotRepliedPayload 新增 isSocial
- `src/types/agent.ts` — AgentConfig 新增 social 設定
