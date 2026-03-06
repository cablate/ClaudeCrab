# 虛擬辦公室模式可行性評估與改進路線圖

## Why

OpenClaw 等產品展示了「虛擬辦公室」模式 — 多個 AI Agent 各有專長和人格，在同一個群組中像真實團隊一樣協作。ClaudeCab 基於 ADR-019 的 Context Injection 機制已建立多 Bot 群組協作的基礎（多 Bot 同群、@mention 路由、Bot 看到彼此回覆、增量注入、內容去重等），但距離「流暢的團隊協作」仍有三個核心缺失：群組記憶隔離、Agent 互相認識、被動觀察與記憶寫入。

## What Changes

1. **群組記憶採用目錄隔離方案** — 符合 ADR-008「Agent 自主管理」原則，以 `groups/{chatId_hash}/` 目錄結構隔離不同群組的記憶
2. **不重新引入 silent mode** — 透過記憶寫入提示解決「記住」問題，Bot 被 @mention 且有 injection context 時，注入提示讓 Bot 順便整理之前錯過的群組動態
3. **Agent 認識彼此** — 透過 DB 持久化 `group_members` 表 + ContextInjector 注入成員清單實現
4. **委派暫不自動化** — 先靠約定式的 @mention 建議，由用戶手動轉發

## Capabilities

- Agent 能區分「在哪個群組學到的」，群組間資訊不會交叉汙染
- Agent 能針對特定群組累積專屬知識（GROUP_MEMORY.md、GROUP_CONTEXT.md）
- Bot 知道群組裡有哪些其他 Bot，能在回覆中建議「你可以 @alex 來處理這件事」
- Bot 被喚醒時能順便整理之前錯過的群組動態，不需要額外的 SDK query
- 維持「Agent 自主管理」設計 — 引擎層只負責告訴 Agent 群組記憶路徑在哪
- Phase 2 路線圖涵蓋 Token 用量追蹤與 Agent 卡片 Dashboard
