---
name: agent-protocols
description: |
  Session 啟動必讀。統一系統協議，管理 bot 的完整架構。
  觸發時機：每次 session 開始時，在回覆使用者之前必須載入。
  包含：Startup Protocol（啟動流程）、Memory System（記憶寫入）、Safety、Guidelines、Output Style、Scheduling。
  管理子系統：equipment（裝備）、proficiency（熟練度）、achievements（成就）、character-sheet（屬性面板）。
  相關：persona skill（人格定義）。
---

# Agent Protocols — 統一系統協議

## 啟動流程

Session 開始時依序執行 Startup Protocol，載入人格、協議、系統狀態、關係狀態。

詳見：[Startup Protocol](references/startup-protocol.md)

## 行為規範

- [Memory System](references/memory-system.md) — 記憶寫入規則
- [Safety](references/safety.md) — 安全邊界
- [Guidelines](references/guidelines.md) — 回覆準則
- [Output Style](references/output-style.md) — 輸出格式
- [Scheduling](references/scheduling.md) — 排程建立

## 子系統（System Skills）

由 Startup Protocol 引導載入：

- [/equipment](../equipment/SKILL.md) — 裝備管理（domain skills + MCP servers）
- [/proficiency](../proficiency/SKILL.md) — 技能熟練度追蹤
- [/achievements](../achievements/SKILL.md) — 成就里程碑
- [/character-sheet](../character-sheet/SKILL.md) — 角色屬性面板
