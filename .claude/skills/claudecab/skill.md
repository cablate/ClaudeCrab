---
name: claudecab
description: ClaudeCab 專案開發助手 - 多代理 Telegram Bot 框架。使用時機：(1) 開發或修改專案程式碼, (2) 理解架構與模組關係, (3) 繼續未完成的開發任務, (4) 排查問題與已知坑。核心概念：「目錄即代理」- 每個 agents/ 子目錄是獨立的 Claude Code 專案。**自我迭代：當專案有任何變更（新增模組、修改架構、版本發布、解決問題），或發現 skill 內容與專案現況不符時，必須觸發此 skill 並同步更新 references/ 對應文件。**
---

# ClaudeCab 專案開發助手

## 產品定位

ClaudeCab 是**輕量級多代理框架**，讓 Claude Code 成為可被遠端操控的專業助手。

**核心價值**：
- **目錄即代理** - 清晰分割 Claude Code 工作區
- **通訊介面** - Telegram 作為使用者操作介面
- **智慧記憶** - Agent 具備學習與記憶能力
- **任務理解** - 支援主動與被動任務處理
- **排程監控** - Cron 等定時任務支援（規劃中）

> 詳見 [product-vision.md](references/product-vision.md)

## 核心概念

**「目錄即代理」**：`agents/` 下每個子目錄代表一個獨立的 Claude Code 專案，擁有：
- `.claude/settings.local.json` - 權限配置（model, permissions）
- `CLAUDE.md` - 系統提示詞（含記憶協議）
- `agent.json` - ClaudeCab 元資料（name, description）
- Workspace 檔案（SOUL.md, USER.md, IDENTITY.md, MEMORY.md, memory/）— Agent 自主管理

**SDKQueryManager 可獨立抽離**：SDK 整合層只接收 systemPrompt + cwd，不注入任何業務邏輯。記憶系統完全由 Agent 透過 CLAUDE.md 指令自行操作，引擎層（`src/`）零感知。

## 技術棧

| 類別 | 技術 | 版本 |
|------|------|------|
| 語言 | TypeScript | 5.x (strict) |
| 執行環境 | Node.js | >= 20 |
| AI SDK | @anthropic-ai/claude-agent-sdk | ^0.2.19 |
| Telegram | grammy | ^1.39.3 |
| 驗證 | Zod | ^4.3.6 |
| 持久化 | better-sqlite3 | ^12.6.2 |
| WebUI | Express + EJS | ^5.2.1 |
| CSS | TailwindCSS (CDN) | ^3.4.19 |
| 測試 | Vitest | ^4.0.18 |

## 目錄結構

```
claudecab/
├── src/
│   ├── index.ts           # 主入口（Telegram Bot + WebUI）
│   ├── core/              # AgentLoader, SessionManager, SDKQueryManager, EventBus, PlatformOrchestrator
│   ├── persistence/       # SQLite 持久化層
│   ├── adapters/          # TelegramAdapter, BaseAdapter
│   ├── webui/             # Express + EJS 管理介面
│   │   ├── WebUIServer.ts
│   │   ├── routes/        # 頁面路由
│   │   ├── api/           # API 端點
│   │   ├── services/      # 業務邏輯
│   │   └── views/         # EJS 模板（元件化）
│   ├── types/             # TypeScript 型別定義
│   └── utils/             # logger, security, audit, retry
├── public/                # 靜態資源 (JS)
├── agents/                # Agent 配置（每個子目錄 = 一個代理）
│   ├── general/           # 通用助手（含記憶系統 workspace）
│   │   ├── CLAUDE.md      # 系統提示（含記憶協議 + Lessons Learned）
│   │   ├── BOOTSTRAP.md   # 首次啟動儀式（完成後自動刪除）
│   │   ├── SOUL.md        # 人格定義
│   │   ├── USER.md        # 使用者檔案
│   │   ├── IDENTITY.md    # AI 身份
│   │   ├── MEMORY.md      # 長期記憶
│   │   └── memory/        # 每日日誌
│   └── coder/             # 程式碼助手
├── tests/                 # 284 tests, 19 files
└── data/                  # SQLite 資料庫
```

## 導航索引

| 需求 | 參考文件 |
|------|----------|
| **產品定位、功能開發原則、路線圖** | **[product-vision.md](references/product-vision.md)** |
| 詳細架構設計、模組說明、資料流 | [architecture.md](references/architecture.md) |
| 版本歷史、重大變更、架構決策 (ADR) | [changelog.md](references/changelog.md) |
| 已知問題、踩過的坑、解決方案 | [troubleshooting.md](references/troubleshooting.md) |
| 「做 X 功能看哪些檔案」對照表 | [quick-nav.md](references/quick-nav.md) |
| Moltbot 官方文件對照、機制取捨 | [moltbot-gap-analysis.md](references/moltbot-gap-analysis.md) |

> **開發新功能前，請先閱讀 [product-vision.md](references/product-vision.md) 確認符合產品定位。**

## 常用指令

```bash
npm run dev          # 啟動開發伺服器
npm test             # 執行測試 (284 tests)
npm run typecheck    # TypeScript 型別檢查
```

## 環境變數

| 變數 | 說明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 金鑰（必填）|
| `ENABLE_PERSISTENCE` | 啟用 SQLite 持久化，預設 false |
| `DB_PATH` | 資料庫路徑，預設 ./data/claudecab.db |
| `WEBUI_ENABLED` | 啟用 WebUI 管理介面，預設 false |
| `WEBUI_PORT` | WebUI 埠號，預設 3001 |
| `WEBUI_PASSWORD` | WebUI 登入密碼（必填，若啟用 WebUI）|
| `DB_RETENTION_MS` | DB session 保留時間（毫秒），預設 30 天（2592000000）|

## 自動更新規則

當專案有以下變更時，**必須同步更新此 skill 及 references/**：
- 新增/修改核心模組
- 變更目錄結構或 agent 配置格式
- 新增功能、指令、環境變數
- 遇到新問題並解決（更新 troubleshooting.md）
- 版本發布（更新 changelog.md）
