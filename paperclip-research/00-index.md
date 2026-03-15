# Paperclip vs ClaudeCab 深度研究報告

> 研究日期：2026-03-14
> 目標：評估 Paperclip 架構，萃取可借鑑的設計，規劃具體落地方案

## 目錄

| # | 文件 | 內容 |
|---|------|------|
| 01 | [summary.md](./01-summary.md) | 總結 & 結論（先看這個） |
| 02 | [heartbeat-vs-schedule.md](./02-heartbeat-vs-schedule.md) | 排程系統比對 |
| 03 | [cost-budget.md](./03-cost-budget.md) | 成本控管比對 |
| 04 | [session-persistence.md](./04-session-persistence.md) | Session 持久化比對 |
| 05 | [ticket-system.md](./05-ticket-system.md) | 任務管理系統比對 |
| 06 | [adapter-pattern.md](./06-adapter-pattern.md) | Adapter 抽象層比對 |
| 07 | [org-governance.md](./07-org-governance.md) | 組織架構 & 審計比對 |
| 08 | [skills-workspace.md](./08-skills-workspace.md) | Skills & Workspace 比對 |
| 09 | [database-schema.md](./09-database-schema.md) | 資料庫 Schema 比對 |
| 10 | [ui-monitoring.md](./10-ui-monitoring.md) | UI & 監控比對 |
| 11 | [borrowing-plan.md](./11-borrowing-plan.md) | 借鑑清單 & 落地規劃（原版，基於 Telegram）|
| **12** | **[discord-platform-reanalysis.md](./12-discord-platform-reanalysis.md)** | **🔄 Discord 載體重新分析（翻盤 5/8 項）** |
| **13** | **[discord-architecture-blueprint.md](./13-discord-architecture-blueprint.md)** | **🏗️ Discord 公司平台架構藍圖** |
| **14** | **[discord-implementation-plan.md](./14-discord-implementation-plan.md)** | **📋 Discord 落地實作計畫（Phase 0-5）** |
| **15** | **[discord-development-roadmap.md](./15-discord-development-roadmap.md)** | **🗺️ 完整規劃：場景分析 + 可行性評估 + Roadmap + 任務拆分 + 自我檢查** |

## 閱讀順序建議

**快速了解：** 01 → 12 → 14
**完整理解：** 01 → 02~10 → 11 → 12 → 13 → 14
**規劃視角：** 01 → 12 → 15（場景 + 可行性 + Roadmap + 自我檢查）

## Paperclip 概要

- **GitHub**: paperclipai/paperclip（22K stars, MIT）
- **定位**: 「零人公司」AI agent 編排平台
- **技術**: TypeScript + PostgreSQL + React + Express
- **核心概念**: 把 AI agent 當員工管理，有組織架構、heartbeat 打卡、預算控管、審批閘門
