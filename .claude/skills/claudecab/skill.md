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

> **規格文件與決策紀錄已遷移至 `openspec/`**

| 類別 | 來源 |
|------|------|
| **規格（openspec/specs/）** | |
| 產品定位、核心概念 | `openspec/specs/product-vision/spec.md` |
| 功能開發原則、設計原則 | `openspec/specs/product-principles/spec.md` |
| 系統架構、模組說明、資料流 | `openspec/specs/system-architecture/spec.md` |
| 模組地圖、耦合分析 | `openspec/specs/module-map/spec.md` |
| 共享知識區架構 | `openspec/specs/shared-knowledge/spec.md` |
| 觸發機制全覽 | `openspec/specs/trigger-mechanisms/spec.md` |
| Skill-Based Character System | `openspec/specs/skill-character-system/spec.md` |
| MMORPG Skill 管理設計 | `openspec/specs/mmorpg-skill-system/spec.md` |
| **決策紀錄（openspec/changes/）** | |
| 已完成 ADR（34 個） | `openspec/changes/archive/adr-*` |
| 進行中的變更 | `openspec/changes/story-*` |
| **操作（references/）** | |
| 「做 X 功能看哪些檔案」對照表 | [operations/quick-nav.md](references/operations/quick-nav.md) |
| 已知問題、解決方案 | [operations/troubleshooting.md](references/operations/troubleshooting.md) |
| 版本歷史（v1.25+） | [operations/changelog.md](references/operations/changelog.md) |
| **研究（references/）** | |
| Agent Skill 設計原則 | [research/agent-skill/design.md](references/research/agent-skill/design.md) |
| Agent Skill 實踐指南 | [research/agent-skill/guide.md](references/research/agent-skill/guide.md) |

> **開發新功能前，先用 `spectra search` 查詢相關規格。**

## 文件治理規則

### 觸發條件

當專案有以下變更時，**必須同步更新此 skill 及 references/**：
- 新增/修改核心模組
- 變更目錄結構或 agent 配置格式
- 新增功能、指令、環境變數
- 遇到新問題並解決（更新 troubleshooting.md）
- 版本發布（更新 changelog.md）

### 活文件（references/ 內的現況文件）

- **程式碼是唯一事實來源** — 文件跟著程式碼走，不是反過來
- **修改必須有程式碼佐證** — 不能「看起來對」就過，模組名、函數名、資料流、型別定義須逐項核實
- **不存在的東西要刪除** — 已移除的功能從活文件中清掉，歷史價值的部分歸檔處理
- **發現不一致就修正文件** — 禁止未驗證就宣稱「已更新至當前狀態」

### 歷史文件（_archive/ 內的歸檔文件、ADR）

- **事實不改** — 當時的決策、考量照實呈現，不因今天的認知去「修正」歷史
- **品質要提升** — 去重複、補脈絡、統一格式，把隨手堆的整理成值得讀的
- **ADR 不可變** — 改決策建新 ADR + 舊的標 Superseded
- **統一結構** — 背景 → 決策 → 結果 → 學到什麼

### 品質檢查

每完成一份文件更新，自問：
- AI 讀了這份活文件去開發，會不會被誤導？
- 歷史文件 3 個月後回來看，能不能清楚理解當時發生了什麼？
