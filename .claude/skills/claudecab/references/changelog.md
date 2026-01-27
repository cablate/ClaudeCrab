# ClaudeCab 版本歷史與架構決策

## 目錄

1. [版本歷史](#版本歷史)
2. [架構決策紀錄 (ADR)](#架構決策紀錄-adr)

---

## 版本歷史

### v1.2.0 - WebUI 管理介面（當前版本）

**發布日期**：2026-01-27

**重大變更**：
- 新增 `src/webui/` 模組 - Express + EJS 管理介面
- 支援密碼認證（JWT + httpOnly Cookie）
- Dashboard 系統狀態監控
- Agents 管理（列表、詳情、重載）
- Sessions 管理（列表、篩選、關閉、清理）
- Conversations 查看與匯出

**新增依賴**：
- express ^5.0.1
- ejs ^3.1.10
- cookie-parser ^1.4.7
- jsonwebtoken ^9.0.2
- tailwindcss ^3.4.17（開發依賴）

**新增環境變數**：
- `WEBUI_ENABLED` - 啟用 WebUI（預設 false）
- `WEBUI_PORT` - WebUI 埠號（預設 3001）
- `WEBUI_PASSWORD` - 登入密碼（必填）
- `WEBUI_JWT_SECRET` - JWT 密鑰
- `WEBUI_SESSION_EXPIRE` - Session 過期時間

**新增檔案**：
- `src/webui/WebUIServer.ts` - Express Server
- `src/webui/middleware/auth.ts` - JWT 認證
- `src/webui/routes/` - 頁面路由
- `src/webui/api/` - API 端點
- `src/webui/views/` - EJS 模板（元件化設計）
- `public/` - 靜態資源

**架構特點**：
- 元件化 EJS 模板（components/, partials/）
- 使用 `partials/start.ejs` + `partials/end.ejs` 包裹模式（EJS 不支援原生 layout）
- 依賴注入（透過 middleware 注入到 request）
- 服務層分離（StatsService）
- 啟動時預載所有 Agents（`loadAllAgents()`）

**已知修復**：
- 修正 EJS 模板結構（從錯誤的 JavaScript 模板字串語法改為正確的 EJS include）
- 修正 Agents 列表不完整問題（改用 `loadAllAgents()` 預載）

---

### v1.1.0 - SQLite 持久化

**發布日期**：2026-01-26

**重大變更**：
- 新增 `src/persistence/` 模組
- 支援 Session 持久化到 SQLite
- 重啟後可恢復 Session（SDK 模式透過 resume）
- WAL 模式提升並發效能

**新增環境變數**：
- `ENABLE_PERSISTENCE` - 啟用持久化（預設 false）
- `DB_PATH` - 資料庫路徑

**新增檔案**：
- `src/persistence/DatabaseManager.ts`
- `src/persistence/SessionRepository.ts`
- `src/persistence/ConversationRepository.ts`
- `src/persistence/types.ts`

---

### v1.0.0 - 生產環境就緒

**重大變更**：
- 完整的 Telegram Bot 功能
- 323 個測試，覆蓋率達標
- CLI 測試工具
- Docker 部署支援

**已實作功能**：
- AgentLoader + ConfigTransformer
- SessionManager（含並發控制、冪等性檢查）
- TelegramAdapter（含速率限制、長訊息分割）
- 指令系統（/start, /help, /list, /switch, /reset）
- 安全機制（用戶白名單、審計日誌、輸入驗證）

---

### v0.6.0 - 安全強化

**新增功能**：
- 用戶白名單（ALLOWED_USERS 環境變數）
- 審計日誌模組（src/utils/audit.ts）
- 訊息長度限制
- 基本 Prompt Injection 偵測
- 敏感指令確認機制

---

### v0.5.0 - Telegram 平台整合

**新增功能**：
- TelegramAdapter（使用 grammy）
- 訊息分割（4096 字元上限）
- 打字指示器
- 速率限制（35ms 最小間隔）
- 指令處理

---

### v0.4.0 - SessionManager

**新增功能**：
- 多用戶 Session 管理
- `platform::userId` 作為 session key
- 並發控制（async-mutex）
- 冪等性檢查
- 自動清理過期 Session

---

### v0.3.0 - AgentLoader

**新增功能**：
- 目錄掃描載入 Agent
- Zod Schema 驗證
- Agent 繼承（extends）
- hooks.ts 動態載入

---

### v0.2.0 - 型別定義

**新增功能**：
- 完整 TypeScript 型別系統
- Zod Schema 驗證
- 自訂錯誤類別

---

### v0.1.0 - 專案初始化

**建立項目**：
- TypeScript + ESM 配置
- ESLint + Prettier
- Vitest 測試框架
- pino 日誌系統

---

## 架構決策紀錄 (ADR)

### ADR-001: 選擇 Claude Agent SDK 而非直接使用 API

**背景**：需要實作多輪對話、工具使用、權限控制

**決策**：使用 @anthropic-ai/claude-agent-sdk

**理由**：
- SDK 內建 session 管理、對話歷史、工具執行
- 支援 hooks 系統（PreToolUse, PostToolUse 等）
- 支援 MCP 整合
- 減少重複造輪子

**後果**：
- 依賴 SDK 版本更新
- 需要理解 SDK 的 session/resume 機制

---

### ADR-002: Agent Isolation - 使用 settingSources + systemPrompt

**背景**：SDK 會遞迴向上搜尋父目錄的 CLAUDE.md，即使遇到 .git 也不會停止

**問題**：當 agent 目錄在專案內時，會載入專案根目錄的 CLAUDE.md 而非 agent 自己的

**決策**：
1. 使用 `settingSources: ['local']` - 只讀取 agent 的 `.claude/settings.local.json`
2. 透過 `systemPrompt` 參數明確傳遞 agent 的 CLAUDE.md 內容

**理由**：
- `'project'` source 會遞迴搜尋
- 明確傳遞確保隔離

**實作位置**：`src/core/SDKQueryManager.ts`

---

### ADR-003: 選擇 SQLite 而非 PostgreSQL

**背景**：需要持久化 Session 和對話歷史

**決策**：使用 SQLite + better-sqlite3 + WAL 模式

**理由**：
- 單機部署，零配置
- better-sqlite3 是同步 API，效能優秀
- WAL 模式支援讀寫並發
- 對於當前規模（< 1000 sessions）足夠

**後果**：
- 不適合多機器部署（未來可換 PostgreSQL）
- 需要處理 WAL 檔案清理

---

### ADR-004: 選擇 grammy 而非 node-telegram-bot-api

**背景**：需要 Telegram Bot 框架

**決策**：使用 grammy

**理由**：
- 原生 TypeScript 支援
- 內建中介軟體系統
- 更好的錯誤處理
- 活躍維護

---

### ADR-005: Session Key 使用雙冒號

**背景**：需要唯一識別不同平台的用戶

**決策**：使用 `${platform}::${userId}` 作為 session key

**理由**：
- 單冒號可能出現在 userId 中
- 雙冒號作為分隔符更安全

**實作位置**：`src/core/SessionManager.ts`

---

### ADR-006: SDK 模式 vs Legacy 模式

**背景**：開發過程中先實作了直接使用 @anthropic-ai/sdk 的版本

**決策**：保留兩種模式，透過環境變數切換

**理由**：
- SDK 模式功能更完整（resume, hooks）
- Legacy 模式可用於測試或特殊需求
- 平滑遷移

**環境變數**：`USE_CLAUDE_AGENT_SDK=true|false`
