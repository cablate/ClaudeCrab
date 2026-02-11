# 決策紀錄索引

> ClaudeCab 專案的架構決策與功能故事

---

## 架構決策紀錄 (ADR)

| ADR | 標題 | 狀態 | 日期 |
|-----|------|------|------|
| [ADR-001](adr/adr-001-claude-agent-sdk.md) | 選擇 Claude Agent SDK | ✅ accepted | 2026-01-26 |
| [ADR-002](adr/adr-002-agent-isolation.md) | Agent Isolation (settingSources + systemPrompt) | ✅ accepted | 2026-01-26 |
| [ADR-003](adr/adr-003-sqlite.md) | 選擇 SQLite | ✅ accepted | 2026-01-26 |
| [ADR-004](adr/adr-004-grammy.md) | 選擇 grammy | ✅ accepted | 2026-01-26 |
| [ADR-005](adr/adr-005-session-key.md) | Session Key 三段式雙冒號 | ✅ accepted | 2026-01-27 |
| [ADR-006](adr/adr-006-legacy-mode.md) | SDK vs Legacy 模式 | ⚠️ deprecated | 2026-01-26 |
| [ADR-007](adr/adr-007-multi-bot.md) | 多機器人架構 | ✅ accepted | 2026-01-27 |
| [ADR-008](adr/adr-008-memory-system.md) | Agent 記憶系統（零程式碼） | ✅ accepted | 2026-01-28 |
| [ADR-009](adr/adr-009-can-use-tool.md) | canUseTool callback vs Hook | ✅ accepted | 2026-01-28 |
| [ADR-010](adr/adr-010-fire-and-forget.md) | grammy fire-and-forget | ✅ accepted | 2026-01-28 |
| [ADR-011](adr/adr-011-permission-result-workaround.md) | SDK PermissionResult 不一致 | ⚠️ workaround | 2026-01-28 |
| [ADR-012](adr/adr-012-skill-first.md) | Agent Skill 系統設計原則 | ✅ accepted | 2026-01-30 |
| [ADR-013](adr/adr-013-keyword-index.md) | Skill Description 關鍵詞索引 | ✅ accepted | 2026-01-30 |
| [ADR-014](adr/adr-014-equip-v2-design.md) | Equip-v2 Skill 設計決策 | ✅ accepted | 2026-02-01 |
| [ADR-015](adr/adr-015-shared-knowledge.md) | 共享知識區架構 | ✅ accepted | 2026-02-01 |
| [ADR-016](adr/adr-016-path-validator.md) | PathValidator 路徑權限強制執行 | ✅ accepted | 2026-02-02 |
| [ADR-017](adr/adr-017-group-chat.md) | Telegram 群組對話支援設計 | ✅ accepted | 2026-02-02 |
| [ADR-018](adr/adr-018-multi-bot-group.md) | 多 Bot 群組協作設計 | ✅ accepted | 2026-02-02 |
| [ADR-019](adr/adr-019-multi-agent-group.md) | 群組對話架構重設計 - Multi-Agent 協作生態系統 | ✅ accepted | 2026-02-03 |
| [ADR-020](adr/adr-020-virtual-office.md) | 虛擬辦公室模式可行性評估與改進路線圖 | ✅ accepted (Phase 1+2) | 2026-02-04 |
| [ADR-021](adr/adr-021-auto-delegation.md) | 群組自動委派（Auto-Delegation） | ✅ accepted | 2026-02-04 |
| [ADR-022](adr/adr-022-delegation-enhancement.md) | 委派機制增強（多重委派 + 可配置） | ✅ accepted | 2026-02-04 |
| [ADR-023](adr/adr-023-bot-initiative.md) | Bot 主動互動模式 | ✅ implemented (v1 work) | 2026-02-05 |
| [ADR-024](adr/adr-024-group-commands.md) | 群組命令支援 | ✅ accepted | 2026-02-04 |
| [ADR-025](adr/adr-025-dashboard-group-analytics.md) | Dashboard 群組分析與委派統計 | 📋 proposed | 2026-02-04 |
| [ADR-026](adr/adr-026-group-infra-stabilization.md) | 群組協作基礎設施穩定化 | ✅ implemented | 2026-02-05 |
| [ADR-027](adr/adr-027-dashboard-config-management.md) | Dashboard 完整設定管理 | ✅ implemented | 2026-02-06 |
| [ADR-028](adr/adr-028-schedule-trigger-types.md) | 排程 Trigger 類型支援策略 | ✅ implemented | 2026-02-06 |
| [ADR-029](adr/adr-029-agent-structure-sync.md) | Agent 架構同步機制 | 📋 proposed | 2026-02-06 |
| [ADR-030](adr/adr-030-agent-team-mode.md) | Agent Team Mode — 多 Agent 並行協作 | ✅ implemented (Tier 1 + 1.1~1.3) | 2026-02-06 |
| [ADR-031](adr-031-hook-decoupling.md) | Hook 系統解耦 — 引擎硬編轉原生 Claude Code Hooks | 📋 proposed | 2026-02-11 |

---

## 功能故事 (stories/)

| 文件 | 描述 |
|------|------|
| [agent-specialization.md](stories/agent-specialization.md) | Agent 專門化支援（MCP + Skills）提案 |
| [webui-character-sheet-integration.md](stories/webui-character-sheet-integration.md) | WebUI 角色面板整合（RPG 風格 Bot 狀態視覺化） |
| [next-evolution-plan.md](stories/next-evolution-plan.md) | 下一階段演化規劃（人格升級 + 群組 UX + 社交模式） |
