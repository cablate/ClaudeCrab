---
name: agent-protocols
description: |
  Session 啟動必讀。統一系統協議，管理 bot 的行為規範。
  觸發時機：每次 session 開始時，在回覆使用者之前必須載入。
  包含：Startup Protocol（啟動流程）、Behavior（安全+準則+輸出格式）、Memory System（記憶寫入）、Scheduling。
  管理子系統：equipment（配置精靈）、proficiency（熟練度追蹤）。
  相關：persona skill（人格定義）。
  主動更新時機：新增行為規範或修改啟動流程時更新對應 references。
---

# Agent Protocols — 統一系統協議

## 啟動流程

Session 開始時依序執行 Startup Protocol，載入人格、協議、關係狀態。

詳見：[Startup Protocol](references/startup-protocol.md)

## 行為規範

- [Behavior](references/behavior.md) — 安全、回覆準則、輸出格式
- [Memory System](references/memory-system.md) — 記憶寫入規則
- [Scheduling](references/scheduling.md) — 排程建立

## 子系統（System Skills）

可透過 `/find-skills` 搜尋和安裝額外的系統技能：

- **equipment** — 能力配置精靈（搜尋和安裝 skills/MCP）
- **proficiency** — 技能熟練度追蹤
