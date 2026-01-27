---
name: claudecab
description: ClaudeCab 專案開發助手 - 多代理 Telegram Bot 框架。使用時機：(1) 開發或修改專案程式碼, (2) 理解架構與模組關係, (3) 繼續未完成的開發任務, (4) 排查問題與已知坑。核心概念：「目錄即代理」- 每個 agents/ 子目錄是獨立的 Claude Code 專案。**自我迭代：當專案有任何變更（新增模組、修改架構、版本發布、解決問題），或發現 skill 內容與專案現況不符時，必須觸發此 skill 並同步更新 references/ 對應文件。**
---

# ClaudeCab 專案開發助手

## 核心概念

ClaudeCab 是基於 Claude Agent SDK 的多代理 Telegram Bot 框架。

**「目錄即代理」**：`agents/` 下每個子目錄代表一個獨立的 Claude Code 專案，擁有：
- `.claude/settings.local.json` - 權限配置（model, permissions）
- `CLAUDE.md` - 系統提示詞
- `agent.json` - ClaudeCab 元資料（name, description）

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
│   ├── cli.ts             # CLI 測試工具
│   ├── core/              # AgentLoader, SessionManager, SDKQueryManager, EventBus
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
│   ├── general/           # 通用助手
│   └── coder/             # 程式碼助手
├── tests/                 # 323 tests, 19 files
└── data/                  # SQLite 資料庫
```

## 導航索引

| 需求 | 參考文件 |
|------|----------|
| 詳細架構設計、模組說明、資料流 | [architecture.md](references/architecture.md) |
| 版本歷史、重大變更、架構決策 (ADR) | [changelog.md](references/changelog.md) |
| 已知問題、踩過的坑、解決方案 | [troubleshooting.md](references/troubleshooting.md) |
| 「做 X 功能看哪些檔案」對照表 | [quick-nav.md](references/quick-nav.md) |

## 常用指令

```bash
npm run dev          # 啟動開發伺服器
npm run cli          # CLI 測試工具
npm test             # 執行測試 (323 tests)
npm run typecheck    # TypeScript 型別檢查
```

## 環境變數

| 變數 | 說明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 金鑰（必填）|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token（必填）|
| `USE_CLAUDE_AGENT_SDK` | SDK 模式 (true) 或 Legacy 模式 (false)，預設 true |
| `ENABLE_PERSISTENCE` | 啟用 SQLite 持久化，預設 false |
| `DB_PATH` | 資料庫路徑，預設 ./data/claudecab.db |
| `WEBUI_ENABLED` | 啟用 WebUI 管理介面，預設 false |
| `WEBUI_PORT` | WebUI 埠號，預設 3001 |
| `WEBUI_PASSWORD` | WebUI 登入密碼（必填，若啟用 WebUI）|

## 自動更新規則

當專案有以下變更時，**必須同步更新此 skill 及 references/**：
- 新增/修改核心模組
- 變更目錄結構或 agent 配置格式
- 新增功能、指令、環境變數
- 遇到新問題並解決（更新 troubleshooting.md）
- 版本發布（更新 changelog.md）
