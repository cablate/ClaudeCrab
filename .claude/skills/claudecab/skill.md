---
name: claudecab
description: >
  ClaudeCab 專案開發助手 - 多代理 Telegram Bot 框架。
  使用時機：(1) 開發或修改專案程式碼, (2) 理解架構與模組關係, (3) 繼續未完成的開發任務, (4) 排查問題與已知坑。
  核心概念：「目錄即代理」- 每個 agents/ 子目錄是獨立的 Claude Code 專案。
  關鍵索引：功能開發原則（principle）、Agent Skill 設計（Metadata 預載、Description-Driven Triggering、協議與人格分離）、ADR 決策紀錄、troubleshooting。
  **自我迭代：當專案有任何變更（新增模組、修改架構、版本發布、解決問題），或發現 skill 內容與專案現況不符時，必須觸發此 skill 並同步更新 references/ 對應文件。**
---

# ClaudeCab 專案開發助手

## 產品定位

ClaudeCab 是**輕量級多代理框架**，讓 Claude Code 成為可被遠端操控的專業助手。

**核心價值**：
- **目錄即代理** - 清晰分割 Claude Code 工作區
- **通訊介面** - Telegram 作為使用者操作介面
- **智慧記憶** - Agent 具備學習與記憶能力
- **任務理解** - 支援主動與被動任務處理
- **排程監控** - Cron 定時任務（v1.10 已實現）

> 詳見 [product/vision.md](references/product/vision.md)、[product/principle.md](references/product/principle.md)

## 核心概念

> 詳見 [product/vision.md](references/product/vision.md)

- **目錄即代理** — 每個 `agents/{id}/` 是獨立的 Claude Code 專案
- **SDKQueryManager 可獨立抽離** — SDK 整合層零業務邏輯，可帶走使用
- **Agent 自主管理** — 記憶系統由 Agent 自行操作，引擎層零感知

## 導航索引

> 完整導讀：[references/_index.md](references/_index.md)

| 類別 | 參考文件 |
|------|----------|
| **產品** | |
| 產品定位、核心概念、路線圖 | [product/vision.md](references/product/vision.md) |
| 功能開發原則、設計原則 | [product/principle.md](references/product/principle.md) |
| **系統** | |
| 詳細架構設計、模組說明、資料流 | [system/overview.md](references/system/overview.md) |
| 共享知識區架構（跨 bot 知識共享） | [system/shared-knowledge.md](references/system/shared-knowledge.md) |
| **決策** | |
| 決策追蹤（ADR + 功能故事） | [decisions/_index.md](references/decisions/_index.md) |
| **操作** | |
| 「做 X 功能看哪些檔案」對照表 | [operations/quick-nav.md](references/operations/quick-nav.md) |
| 已知問題、踩過的坑、解決方案 | [operations/troubleshooting.md](references/operations/troubleshooting.md) |
| 版本歷史、重大變更 | [operations/changelog.md](references/operations/changelog.md) |
| **研究** | |
| Agent Skill 設計原則、核心洞察 | [research/agent-skill/design.md](references/research/agent-skill/design.md) |
| Agent Skill 實踐指南 | [research/agent-skill/guide.md](references/research/agent-skill/guide.md) |
| Moltbot 記憶系統差距分析 | [research/moltbot-gap.md](references/research/moltbot-gap.md) |

> **開發新功能前，請先閱讀 [product/vision.md](references/product/vision.md) 確認符合產品定位。**

## 自動更新規則

當專案有以下變更時，**必須同步更新此 skill 及 references/**：
- 新增/修改核心模組
- 變更目錄結構或 agent 配置格式
- 新增功能、指令、環境變數
- 遇到新問題並解決（更新 troubleshooting.md）
- 版本發布（更新 changelog.md）
