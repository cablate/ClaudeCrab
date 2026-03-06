# 設計：Agent 專門化方案

## Decisions

### 方案 A — Skills 目錄整合（已採用）

利用 Claude Code 的 SKILL.md 標準，每個 Agent 在 `.claude/skills/` 下擁有專屬 skills。SDK 自動掃描載入，無需引擎層修改。確保 `"Skill"` 在 `settings.local.json` 的 allow 清單中。

### 方案 B — MCP Server 整合（已採用）

SDK 自動從 `.mcp.json` 讀取 MCP servers 配置。支援 `command`（stdio）、`sse`、`http` 三種連線方式。Token 和路徑隨 Agent 配置集中管理。

### 方案 C — Plugin 混合模式（規劃中）

結合 CLI 安裝與 SDK local 載入。Plugin 只能用 `{ type: 'local', path: '...' }` 模式，需手動管理。

### 方案 D — In-Process 自訂 Tools（規劃中）

使用 `createSdkMcpServer()` 建立 ClaudeCab 專屬工具（memory search、schedule reminder、call API），同進程執行可存取內部狀態。

### 方案 E — Agent Routing（規劃中）

類似 Moltbot bindings，讓單一 Telegram bot 根據 chatId/userId/command 路由到不同 Agent。需修改 TelegramAdapter 和 SessionManager。

## Risks / Trade-offs

- SDK 只支援 local plugins，無法像 Moltbot 從 marketplace 動態安裝
- CLI plugin 安裝是互動式的，自動化需找到非互動方式
- Agent Routing 改動範圍大（TelegramAdapter + SessionManager + WebUI）
- 與現有「每個 Agent 一個 Bot」的架構存在概念衝突

## Affected Components

- `agents/{id}/.claude/skills/` — Skills 存放位置
- `agents/{id}/.mcp.json` — MCP 配置
- `agents/{id}/.claude/settings.local.json` — 權限清單
- WebUI Skills 管理頁面
