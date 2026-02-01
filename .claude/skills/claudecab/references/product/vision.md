# ClaudeCab 產品定位

> **核心理念**：輕量級多代理框架，讓 Claude Code 成為可被遠端操控的專業助手。

---

## 產品定位聲明

ClaudeCab 是一個**輕量級多代理 Telegram Bot 框架**，專注於：

1. **目錄即代理** - 每個 `agents/{id}/` 目錄是獨立的 Claude Code 工作區
2. **通訊介面** - Telegram 等通訊軟體作為使用者操作介面
3. **智慧記憶** - Agent 具備學習與記憶能力
4. **任務理解** - 支援主動與被動任務處理
5. **排程監控** - Cron 等定時任務支援

---

## 我們是什麼

| 特性 | 說明 |
|------|------|
| 輕量部署 | 一個 `npm start` 即可運行 |
| 工作區隔離 | 每個 Agent 有獨立的 MCP、Skills、Memory |
| 遠端控制 | 透過 Telegram 隨時隨地操控 Claude Code |
| 專注任務 | 每個 Agent 可專門化處理特定領域 |

## 我們不是什麼

| 不做 | 原因 |
|------|------|
| 全能 AI 平台 | 專注核心價值，不追求功能全包 |
| 瀏覽器自動化平台 | 交給專門工具（Moltbot、Playwright），透過 MCP 整合即可 |
| 即時通訊替代品 | Telegram 是介面，不是我們要重造的輪子 |
| 複雜基礎設施 | 保持簡單，降低部署與維護成本 |

---

## 核心架構

```
ClaudeCab
├── 🤖 多代理系統
│   └── agents/{id}/          # 目錄即代理
│       ├── agent.json        # 代理配置
│       ├── CLAUDE.md         # 工作區指令
│       ├── .mcp.json         # MCP servers（SDK 自動載入）
│       └── .claude/
│           ├── settings.local.json
│           └── skills/       # Skills（SDK 自動載入）
│
├── 💬 通訊層
│   ├── Telegram Bot（主要）
│   └── 未來擴展（Discord、Slack...）
│
├── 🧠 智慧層
│   ├── Memory System（記憶與學習）
│   ├── 任務理解（主動/被動）
│   └── Cron 排程（定時任務）
│
└── 🌐 WebUI
    └── Agent 管理介面
```

---

## 核心概念

### 目錄即代理

每個 `agents/{id}/` 是獨立的 Claude Code 專案，擁有：
- `.claude/settings.local.json` — 權限配置
- `.claude/skills/` — Agent Skills（協議、人格）
- `CLAUDE.md` — 系統提示詞
- `agent.json` — ClaudeCab 元資料
- Workspace 檔案（USER.md, MEMORY.md, memory/）

### SDKQueryManager 可獨立抽離

SDK 整合層只接收 `systemPrompt` + `cwd`，不注入任何業務邏輯。設計目標是可以從 ClaudeCab 整個帶走到其他專案使用。

### Agent 自主管理

記憶系統完全由 Agent 透過 CLAUDE.md 指令自行操作，引擎層（`src/`）零感知。不建立「組裝層」注入記憶內容到 systemPrompt。

---

## 功能開發原則

> 詳見 [principle.md](principle.md)

---

## 發展路線圖

### Phase 1：核心穩固 ✅
- [x] 目錄即代理架構
- [x] Telegram Bot 整合
- [x] Claude Agent SDK 整合
- [x] MCP + Skills 支援
- [x] Memory System
- [x] WebUI 管理介面

### Phase 2：智慧任務 ✅
- [x] Cron 排程系統（v1.10）
- [x] 主動通知（Agent → User）（v1.10）
- [x] Agent Skill 系統（v1.11）
- [ ] 任務 Queue 管理
- [ ] 事件驅動喚醒

### Phase 3：生態整合
- [ ] 更多通訊平台支援
- [ ] MCP Server 市集整合
- [ ] Skills 安裝簡化
- [ ] 多使用者支援

---

## 競品定位

| 項目 | 定位 | ClaudeCab 差異 |
|------|------|---------------|
| **Moltbot** | 全功能 AI Agent 平台 | 我們更輕量、專注 |
| **Claude Code** | 本地開發助手 | 我們讓它可被遠端操控 |
| **AutoGPT** | 自主 AI Agent | 我們更可控、更實用 |
| **n8n/Zapier** | 自動化工作流 | 我們以 AI 為核心 |

---

## 版本歷程

- **v1.0** - 基礎架構：目錄即代理、Telegram 整合
- **v1.5** - SDK 整合：Claude Agent SDK、Memory System
- **v1.8** - WebUI：Agent 管理介面
- **v1.9** - 專門化：MCP + Skills 支援
- **v1.10** - 排程系統：Agent-Driven Scheduling
- **v1.11** - Skill 系統：協議與人格模組化（當前）
- **v2.0** - 生態整合（規劃中）

---

*最後更新：2026-02-01*
