# ClaudeCab 快速導航

「做 X 功能看哪些檔案」對照表

---

## 核心功能

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 新增 Agent | `agents/<name>/` | `agent.json`, `CLAUDE.md`, `.claude/settings.local.json` |
| 修改 Agent 載入邏輯 | `src/core/AgentLoader.ts` | `src/types/agent.ts` |
| 修改 SDK 呼叫方式 | `src/core/SDKQueryManager.ts` | - |
| 修改訊息處理流程 | `src/core/MessageProcessor.ts` | `SDKQueryManager.ts`, `SessionManager.ts` |
| 修改 Session 管理 | `src/core/SessionManager.ts` | `src/types/session.ts` |
| 管理平台 Adapter 生命週期 | `src/core/PlatformOrchestrator.ts` | `src/core/AdapterRegistry.ts`, `src/adapters/TelegramAdapter.ts` |

---

## Telegram 相關

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 新增 Telegram 指令 | `src/adapters/commands/TelegramCommands.ts` | `TelegramAdapter.ts` |
| 修改訊息發送邏輯 | `src/adapters/TelegramAdapter.ts` | - |
| 修改訊息分割邏輯 | `src/adapters/TelegramAdapter.ts` | `splitMessage()` 方法 |
| 新增其他平台 Adapter | 繼承 `src/adapters/BaseAdapter.ts` | `src/core/AdapterRegistry.ts` |

---

## 權限審批系統

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改權限橋接邏輯（timeout、cancelAll） | `src/core/PermissionBridge.ts` | `tests/unit/PermissionBridge.test.ts` |
| 修改權限 UI（按鈕文字、InlineKeyboard） | `src/adapters/TelegramAdapter.ts` | `sendPermissionPrompt`、`callback_query` handler |
| 修改權限型別定義 | `src/adapters/types.ts` | `PermissionPromptOptions`、`PermissionPromptResult`、`PermissionResolver` |
| 新增平台的權限 UI | 繼承 `src/adapters/BaseAdapter.ts` | Override `sendPermissionPrompt`、`updatePermissionPrompt`、`setPermissionResolver` |
| 修改 canUseTool 閉包組裝 | `src/core/MessageProcessor.ts` | `PermissionBridge.ts` |
| 調整 Agent 預設允許的工具 | `agents/general/.claude/settings.local.json` | `permissions.allow` 陣列 |

> **注意**：grammy message handler 必須 fire-and-forget，否則 callback_query 會死鎖。詳見 troubleshooting。

---

## WebUI 管理介面

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改 WebUI 伺服器設定 | `src/webui/WebUIServer.ts` | `src/webui/types.ts` |
| 新增/修改頁面路由 | `src/webui/routes/*.ts` | `src/webui/views/` |
| 新增/修改 API 端點 | `src/webui/api/*.ts` | - |
| 修改認證邏輯 | `src/webui/middleware/auth.ts` | - |
| 修改頁面模板 | `src/webui/views/` | 使用 `partials/start.ejs` + `partials/end.ejs` 包裹 |
| 新增 UI 元件 | `src/webui/views/components/` | `card.ejs`, `status-badge.ejs`, `empty-state.ejs` |
| 修改統計服務 | `src/webui/services/StatsService.ts` | - |

---

## Agent 記憶系統

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改 Agent 記憶協議 | `agents/general/CLAUDE.md` | Startup Protocol、Memory System 區段 |
| 修改 Agent 人格 | `agents/general/SOUL.md` | Core Truths、Boundaries、Vibe、Voice Guide |
| 修改使用者檔案 | `agents/general/USER.md` | — |
| 修改 AI 身份 | `agents/general/IDENTITY.md` | — |
| 查看/修改長期記憶 | `agents/general/MEMORY.md` | Agent 自行維護 |
| 查看每日日誌 | `agents/general/memory/YYYY-MM-DD.md` | Agent 自行產生 |
| 理解記憶設計原理 | `docs/moltbot-blueprint.md` | Moltbot Phase 0 純檔案架構 |

> **注意**：記憶系統不涉及 `src/` 任何程式碼。修改只需調整 agent workspace 檔案。

---

## 持久化相關

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改資料庫 Schema | `src/persistence/DatabaseManager.ts` | `SCHEMA_SQL` 常數 |
| 修改 Session 存儲 | `src/persistence/SessionRepository.ts` | `src/persistence/types.ts` |
| 修改對話歷史存儲 | `src/persistence/ConversationRepository.ts` | - |

---

## 安全相關

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改用戶白名單 | `src/utils/security.ts` | `ALLOWED_USERS` 環境變數 |
| 修改審計日誌 | `src/utils/audit.ts` | - |
| 修改輸入驗證 | `src/utils/security.ts` | - |

---

## 型別定義

| 型別 | 檔案位置 |
|------|----------|
| AgentConfig, LoadedAgent | `src/types/agent.ts` |
| UserSession, SessionState | `src/types/session.ts` |
| EventMap | `src/types/events.ts` |
| AgentHooks | `src/types/hooks.ts` |
| ClaudeCabError 及子類 | `src/types/errors.ts` |
| UnifiedMessage, SendOptions | `src/adapters/types.ts` |
| PermissionPromptOptions, PermissionPromptResult, PermissionResolver | `src/adapters/types.ts` |

---

## 測試

| 要測試什麼 | 測試檔案位置 |
|------------|--------------|
| AgentLoader | `tests/unit/AgentLoader.test.ts` |
| SessionManager | `tests/unit/SessionManager.test.ts` |
| SDKQueryManager | `tests/unit/SDKQueryManager.test.ts` |
| MessageProcessor | `tests/unit/MessageProcessor.test.ts` |
| TelegramAdapter | `tests/unit/TelegramAdapter.test.ts` |
| PermissionBridge | `tests/unit/PermissionBridge.test.ts` |
| 持久化 | `tests/unit/persistence/` |
| 整合測試 | `tests/integration/` |

---

## 入口點

| 用途 | 檔案 |
|------|------|
| Telegram Bot + WebUI 主程式 | `src/index.ts` |
| WebUI 伺服器 | `src/webui/WebUIServer.ts` |

---

## 配置檔案

| 配置 | 檔案 |
|------|------|
| 環境變數 | `.env`（參考 `.env.example`）|
| TypeScript | `tsconfig.json` |
| ESLint | `eslint.config.mjs` |
| Vitest | `vitest.config.ts` |
| Package | `package.json` |
