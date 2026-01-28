# ClaudeCab 版本歷史與架構決策

## 目錄

1. [版本歷史](#版本歷史)
2. [架構決策紀錄 (ADR)](#架構決策紀錄-adr)

---

## 版本歷史

### v1.6.0 - 中間訊息即時串流（當前版本）

**發布日期**：2026-01-28

**背景**：SDK 多輪 agent 處理期間會產生多個 assistant 訊息（「讓我查看檔案」→ 工具執行 →「找到了」→ 最終回答），但原本所有訊息收集後一次性發送，使用者在處理期間完全沒有反饋。

**變更**：
- **Callback-based Streaming**：`ExecuteQueryOptions` 新增 `onIntermediateMessage` optional callback，SDK for-await 迴圈中每收到 assistant 訊息即呼叫 callback 即時送出
- **MessageProcessor 串流注入**：`executeQueryWithSDK()` 注入 callback 閉包，透過 adapter 即時發送中間訊息到 Telegram
- **DB 分段持久化**：中間訊息獨立存入 DB，WebUI 對話記錄與 Telegram 看到的一致
- **QueryResult 擴充**：新增 `intermediateMessageCount` 欄位追蹤已串流的訊息數量
- **向後相容**：不提供 callback 時行為完全不變，既有 284 tests 零修改全部通過

**設計原則維持**：
- SDKQueryManager 保持解耦 — callback 是 optional 函式，不知道消費者身份
- 零 Adapter 改動 — TelegramAdapter 既有的 RateLimiter 自動處理多次呼叫

**修改檔案**：
- `src/core/SDKQueryManager.ts` — `ExecuteQueryOptions` + `QueryResult` 介面擴充、for-await 迴圈 callback 邏輯、移除未使用 import
- `src/core/MessageProcessor.ts` — `executeQueryWithSDK()` callback 注入、DB 分段持久化

**測試**：284 tests, 19 files 全部通過

---

### v1.5.2 - Moltbot Gap Analysis 實作

**發布日期**：2026-01-28

**背景**：根據 Moltbot 官方文件（docs.molt.bot）逐項對照，補齊 agents/general/ 缺少的機制。

**變更**：
- **教訓路由修正**：寫入規則從 SOUL.md 改為 CLAUDE.md 自身的 Lessons Learned 區段（符合官方 AGENTS.md 模板）
- **BOOTSTRAP.md**：新增首次啟動儀式，agent 第一次對話時自動執行 onboarding（認識使用者、定義自己），完成後刪除檔案
- **對話保護規則**：CLAUDE.md 新增 Auto-flush 行為規則，agent 在長對話中主動保存記憶
- **Lessons Learned 區段**：CLAUDE.md 尾部新增空區段，供 agent 自行寫入從經驗學到的操作規則

**決定不做**：
- **HEARTBEAT.md**：需要 Gateway 排程器配套才能實現定期巡邏，純 CLAUDE.md 指令無法達成
- **TOOLS.md**：general agent 不需要環境特定備註

**修改檔案**：
- `agents/general/CLAUDE.md` — 教訓路由 + Startup Protocol + 對話保護 + Lessons Learned
- `agents/general/BOOTSTRAP.md` — 新增
- `docs/moltbot-gap-analysis.md` — 新增（差距分析文件）

**設計原則維持**：零引擎改動，所有變更都在 agent 層

---

### v1.5.1 - Dynamic SystemPrompt

**發布日期**：2026-01-28

**問題**：AgentLoader 在啟動時讀取 CLAUDE.md 並快取為 `LoadedAgent.systemPrompt` 靜態字串。Agent 若在對話中透過 Write 工具自主更新 CLAUDE.md（記憶協議允許），後續 query 仍使用舊的快取值。

**修復**：
- **AgentLoader.readSystemPrompt(agentId)** — 新增方法，每次從磁碟重新讀取 CLAUDE.md（保持原有優先序：config.systemPrompt > systemPromptFile > CLAUDE.md）
- **MessageProcessorOptions.getSystemPrompt** — 新增可選的函式注入點，每次 query 前呼叫以取得最新 systemPrompt
- **MessageProcessor.executeQueryWithSDK()** — 使用注入的 `getSystemPrompt(agent.id)` 取代快取的 `agent.systemPrompt`
- **index.ts** — 連接 `agentLoader.readSystemPrompt()` 到 MessageProcessor

**設計原則維持**：
- SDKQueryManager 零改動 — 仍然只接收 systemPrompt 字串
- 依賴注入 — MessageProcessor 透過函式接收，不直接依賴 AgentLoader
- 向下相容 — `getSystemPrompt` 為 optional，未提供時 fallback 到 `agent.systemPrompt` 快取值

**修改檔案**：
- `src/core/AgentLoader.ts` — 新增 `readSystemPrompt()` 方法
- `src/core/MessageProcessor.ts` — 新增 `getSystemPrompt` 注入、每次 query 前讀取最新
- `src/index.ts` — 連接 agentLoader 到 messageProcessor

**測試**：284 tests, 19 files 全部通過

---

### v1.5.0 - Agent 記憶系統

**發布日期**：2026-01-28

**重大變更**：
- **Moltbot 風格記憶系統**：`agents/general/` 整合自主記憶能力，採用 Moltbot 純檔案記憶架構
- **零程式碼改動**：不動 `src/` 任何一行，記憶邏輯完全由 Agent 透過 CLAUDE.md 指令自行管理
- **SDKQueryManager 完全解耦**：記憶系統不污染 SDK 整合層，SDKQueryManager 可獨立抽離做其他開發

**設計原則**：
- Agent 自主管理 — CLAUDE.md 定義記憶協議，Agent 用 Read/Write 工具自行讀寫 workspace 檔案
- 不建立「組裝層」— 不在 MessageProcessor 或任何中間層把記憶內容注入 systemPrompt
- SDKQueryManager 只接收 systemPrompt 字串 + cwd 路徑，完全不知道記憶系統的存在

**新增檔案**（`agents/general/`）：
- `CLAUDE.md`（改寫）— 從 9 行簡單提示改為完整記憶協議（Startup Protocol + Memory System + Safety）
- `SOUL.md` — 人格定義（Core Truths、Boundaries、Vibe、Continuity、Voice Guide）
- `USER.md` — 使用者檔案模板
- `IDENTITY.md` — AI 身份模板
- `MEMORY.md` — 長期記憶空結構
- `memory/.gitkeep` — 每日日誌目錄

**Agent 啟動協議**（CLAUDE.md 定義）：
1. 讀 SOUL.md — 知道自己是誰
2. 讀 USER.md — 知道對面是誰
3. 讀 IDENTITY.md — 知道自己的名字和風格
4. 讀 MEMORY.md — 知道過去的重要事實
5. 讀 memory/今天.md — 知道今天發生了什麼
6. 讀 memory/昨天.md — 知道昨天的 context

**記憶寫入規則**：
| 內容 | 寫到哪裡 |
|------|----------|
| 決定、偏好、持久事實 | MEMORY.md |
| 日常筆記、進行中 context | memory/YYYY-MM-DD.md |
| 學到的教訓、犯的錯 | SOUL.md |
| 人格上的自我發現 | SOUL.md（修改必須通知使用者）|

**參考設計**：[Moltbot 純檔案記憶架構](../../docs/moltbot-blueprint.md)（Phase 0）

---

### v1.4.1 - 對話連續性修復

**發布日期**：2026-01-27

**問題**：伺服器重啟後對話永遠從零開始，日誌顯示 `resume: "(new session)"`

**根因**：Session 過期→DB 刪除→ON DELETE CASCADE 刪除對話歷史→新 session 無 sdkSessionId→SDK 開啟全新對話

**修復**：
- **保留 DB 行**：`cleanupExpired()` 只從記憶體移除，DB 行保留供對話延續
- **restoreSessions()** 僅清理超過 `dbRetentionMs`（預設 30 天）的古老 session，過期 session 不載入記憶體但保留在 DB
- **createSession() 繼承 sdkSessionId**：建立新 session 前查 DB 取回先前 `session_id` + `sdk_session_id`，重用舊 session ID（保持 conversations FK 關聯）
- **Resume 失敗自動重試**：`executeQueryWithSDK()` 帶 resume 呼叫 SDK 失敗時，清除 sdkSessionId 並不帶 resume 重試一次（優雅降級）
- **Server crash 恢復**：`restoreSessions()` 自動重置卡住的 `processing` 狀態為 `idle`

**新增設定**：
- `SessionStoreConfig.dbRetentionMs` — DB 保留期（預設 30 天），超過此期限的 session 在啟動時清除
- `DB_RETENTION_MS` 環境變數

**修改檔案**：
- `src/core/SessionManager.ts` — cleanupExpired、restoreSessions、createSession
- `src/core/MessageProcessor.ts` — executeQueryWithSDK resume 重試邏輯
- `src/types/session.ts` — dbRetentionMs 配置
- `src/persistence/types.ts` — IConversationRepository 補 getLastMessages
- `src/index.ts` — DB_RETENTION_MS 環境變數
- `tests/unit/SessionManager.test.ts` — 新增 4 個對話連續性測試

**測試**：284 tests, 19 files 全部通過

---

### v1.4.0 - 設計債清理與架構對齊

**發布日期**：2026-01-27

**重大變更**：
- **移除 Legacy 模式**：SDK 為唯一模式，移除 `USE_CLAUDE_AGENT_SDK` 環境變數、Legacy 執行路徑、直接使用 @anthropic-ai/sdk 的程式碼
- **移除 CLI**：刪除 `src/cli.ts` 與 `npm run cli` script
- **SDK 訊息持久化**：SDK query 完成後自動將 user/assistant 訊息存入 ConversationRepository，供 WebUI 查看對話歷史
- **agent.json 配置生效**：`maxTurns` 等設定值從 agent 配置讀取（原先硬寫為 10）
- **清理安全框架**：移除未使用的 `ConfirmationManager`、`SensitiveCommandConfig`、`PendingConfirmation`、`DEFAULT_SENSITIVE_COMMANDS`
- **清理 ConversationRepository**：移除 Legacy 專用方法（`trimConversation`、`bulkInsert`、`cleanupOrphaned`）

**移除檔案**：
- `src/cli.ts`

**修改檔案**：
- `src/core/MessageProcessor.ts` — 移除 Legacy 分支、讀取 agent maxTurns、新增 SDK 訊息持久化
- `src/index.ts` — 移除 Legacy 初始化、連接 conversationRepository 到 MessageProcessor
- `src/persistence/ConversationRepository.ts` — 移除 Legacy 方法
- `src/persistence/types.ts` — 移除 `trimConversation` 介面方法
- `src/utils/security.ts` — 移除 ConfirmationManager 相關程式碼
- `src/utils/index.ts` — 移除 ConfirmationManager exports
- `package.json` — 移除 cli script

**測試**：280 tests, 19 files 全部通過

---

### v1.3.0 - 多機器人架構

**發布日期**：2026-01-27

**重大變更**：
- **每個 Agent 獨立 Bot**：從「單一 Bot + `/switch` 切換」改為「一個 Agent 一個 Bot」
- 新增 `PlatformOrchestrator` — 統一管理所有平台 Adapter 的生命週期
- 新增 `AdapterRegistry` — `platform::agentId` 複合鍵管理 Adapter 實例
- Session Key 從 `platform::userId` 改為 `platform::agentId::userId`
- DB Schema v2 — UNIQUE 約束加入 `agent_id`，含自動 migration
- 移除 `/switch`、`/list` Telegram 指令
- 移除 `switchAgent()` 方法
- 移除 `TELEGRAM_BOT_TOKEN` 環境變數

**新增欄位**：
- `agent.json` 新增 `telegramBotToken` 欄位

**新增檔案**：
- `src/core/PlatformOrchestrator.ts`
- `src/core/AdapterRegistry.ts`

**修改檔案**：
- `src/types/agent.ts` — AgentConfigSchema 新增 telegramBotToken
- `src/types/session.ts` — getSessionKey 改為三段式
- `src/persistence/DatabaseManager.ts` — Schema v2 migration
- `src/persistence/SessionRepository.ts` — 查詢加入 agentId
- `src/core/SessionManager.ts` — 所有方法加入 agentId 參數
- `src/core/MessageProcessor.ts` — 接收外部傳入 agentId
- `src/core/AgentLoader.ts` — 新增 getAgentsWithPlatformTokens()
- `src/adapters/TelegramAdapter.ts` — 建構綁定 agentId
- `src/adapters/commands/TelegramCommands.ts` — 移除 switch/list
- `src/index.ts` — 使用 PlatformOrchestrator 啟動
- `src/webui/types.ts` — 注入 PlatformOrchestrator
- `src/webui/routes/agents.ts` — 顯示 Bot 狀態
- `src/webui/api/agents.api.ts` — Bot 重載使用 Orchestrator
- `src/webui/views/agents/list.ejs` — Bot Status 欄位
- `src/webui/views/agents/detail.ejs` — Bot Status 區塊

**WebUI 增強**：
- Agents 列表頁顯示各 Bot 運行狀態（綠色/黃色 badge）
- Agent 詳情頁顯示 Bot 狀態資訊
- Agent 重載透過 Orchestrator 同時重啟 config 與 Adapter

**測試**：312 tests, 19 files 全部通過（v1.4.0 後降為 280 tests）

---

### v1.2.0 - WebUI 管理介面

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
- CLI 測試工具（v1.4.0 移除）
- Docker 部署支援

**已實作功能**：
- AgentLoader + ConfigTransformer
- SessionManager（含並發控制、冪等性檢查）
- TelegramAdapter（含速率限制、長訊息分割）
- 指令系統（/start, /help, /reset）（v1.3.0 移除 /list, /switch）
- 安全機制（用戶白名單、審計日誌、輸入驗證）

---

### v0.6.0 - 安全強化

**新增功能**：
- 用戶白名單（ALLOWED_USERS 環境變數）
- 審計日誌模組（src/utils/audit.ts）
- 訊息長度限制
- 基本 Prompt Injection 偵測
- 敏感指令確認機制（v1.4.0 移除 ConfirmationManager）

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
- `platform::userId` 作為 session key（v1.3.0 改為 `platform::agentId::userId`）
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

### ADR-005: Session Key 使用三段式雙冒號

**背景**：多機器人架構下，需要唯一識別不同平台 + Agent + 用戶的組合

**決策**：使用 `${platform}::${agentId}::${userId}` 作為 session key

**理由**：
- 單冒號可能出現在 userId 中，雙冒號作為分隔符更安全
- 加入 `agentId` 確保同一用戶對不同 Agent 有獨立 Session
- DB UNIQUE 約束對應為 `UNIQUE(platform, agent_id, user_id)`

**實作位置**：`src/core/SessionManager.ts`, `src/types/session.ts`

---

### ADR-006: SDK 模式 vs Legacy 模式（已廢棄）

**狀態**：已廢棄（v1.4.0 移除 Legacy 模式）

**原始決策**：保留 SDK 與 Legacy 兩種模式，透過環境變數切換

**廢棄原因**：v1.4.0 移除 Legacy 模式，SDK 為唯一模式。Legacy 模式（直接使用 @anthropic-ai/sdk 手動管理對話歷史）已無使用場景。`USE_CLAUDE_AGENT_SDK` 環境變數已移除。

---

### ADR-007: 多機器人架構 — 每個 Agent 獨立 Bot

**背景**：原本使用單一 Telegram Bot + `/switch` 指令切換 Agent，用戶體驗不佳且架構耦合

**決策**：
1. 每個 Agent 在 `agent.json` 中配置自己的 `telegramBotToken`
2. 新增 `PlatformOrchestrator` 統一管理所有 Adapter 的生命週期
3. 移除 `/switch`、`/list` 指令與 `switchAgent()` 方法
4. Session Key 從 `platform::userId` 改為 `platform::agentId::userId`

**理由**：
- 一對一綁定更直覺：用戶直接跟特定 Bot 對話
- 解耦：各 Agent 的 Bot 互不影響，單一 Bot 啟動失敗不影響其他
- 通用設計：`PlatformOrchestrator` 根據 config 中的 token 欄位自動判斷平台，未來可擴展到 Slack、Discord
- Token 存放在 `agent.json` 中，與 Agent 配置集中管理

**影響**：
- 移除環境變數 `TELEGRAM_BOT_TOKEN`
- DB Schema 升級至 v2（UNIQUE 約束加入 `agent_id`）
- 舊 Session 不相容（重啟後自動建新 Session）

**實作位置**：
- `src/core/PlatformOrchestrator.ts`（新增）
- `src/core/AdapterRegistry.ts`（修改為複合鍵）
- `src/adapters/TelegramAdapter.ts`（綁定 agentId）
- `src/index.ts`（使用 Orchestrator 啟動）

---

### ADR-008: Agent 記憶系統 — 零程式碼、Agent 自主管理

**背景**：需要讓 Agent 擁有跨 session 記憶能力（參考 Moltbot 純檔案記憶架構），同時保持 SDKQueryManager 可獨立抽離

**決策**：
1. 記憶邏輯完全寫在 CLAUDE.md（systemPrompt）中，由 Agent 自行操作
2. 不在 SDKQueryManager 或 MessageProcessor 注入任何記憶內容
3. 不建立「組裝層」拼接記憶到 systemPrompt
4. Agent 透過 Read/Write 工具讀寫 workspace 檔案（SOUL.md、USER.md、MEMORY.md 等）

**理由**：
- SDKQueryManager 設計目標是可以整個帶走到其他專案使用，不應包含業務邏輯
- Agent 本身已有 Read/Write 工具能力，SDK 以 `cwd=agents/<name>/` 執行，可直接存取 workspace 檔案
- 零程式碼改動 = 零風險引入新 bug，也不需要寫新測試
- CLAUDE.md 即控制點：修改記憶行為只需調整 CLAUDE.md，不需重新部署

**取捨**：
- Agent 是否遵守記憶協議取決於 LLM 的指令遵從能力（無法程式化保證）
- 記憶寫入時機依賴 Agent 判斷，可能偶爾漏記
- 可接受：Moltbot 官方也承認此機制 "is still evolving"，漏記比記太多好

**參考**：`docs/moltbot-blueprint.md`（Phase 0 純檔案記憶架構）

**實作位置**：
- `agents/general/CLAUDE.md`（記憶協議定義）
- `agents/general/SOUL.md`、`USER.md`、`IDENTITY.md`、`MEMORY.md`、`memory/`（workspace 檔案）
