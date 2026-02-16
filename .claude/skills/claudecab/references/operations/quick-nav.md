# ClaudeCab 快速導航

「做 X 功能看哪些檔案」對照表

---

## 常用指令

```bash
npm run dev          # 啟動開發伺服器
npm test             # 執行測試 (396 tests)
npm run typecheck    # TypeScript 型別檢查
```

---

## 環境變數

| 變數 | 說明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 金鑰（必填）|
| `ENABLE_PERSISTENCE` | 啟用 SQLite 持久化，預設 false |
| `DB_PATH` | 資料庫路徑，預設 ./data/claudecab.db |
| `WEBUI_ENABLED` | 啟用 WebUI 管理介面，預設 false |
| `WEBUI_PORT` | WebUI 埠號，預設 3001 |
| `WEBUI_PASSWORD` | WebUI 登入密碼（必填，若啟用 WebUI）|
| `WEBUI_JWT_SECRET` | WebUI JWT 簽名密鑰（必填，若啟用 WebUI）|
| `DB_RETENTION_MS` | DB session 保留時間（毫秒），預設 30 天（2592000000）|

---

## 產品定位

> **開發新功能前，先閱讀 [vision.md](../product/vision.md)**

| 文件 | 用途 |
|------|------|
| [vision.md](../product/vision.md) | 產品定位、功能開發原則、路線圖 |
| [overview.md](../system/overview.md) | 技術架構說明 |
| [changelog.md](./changelog.md) | 版本歷程 |

---

## 核心功能

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 新增 Agent | `agents/<name>/` | `agent.json`, `CLAUDE.md`, `.claude/settings.local.json` |
| 修改 Agent 載入邏輯 | `src/core/AgentLoader.ts` | `src/types/agent.ts` |
| 修改 SDK 呼叫方式 | `src/core/SDKQueryManager.ts` | - |
| 修改訊息處理流程 | `src/core/MessageProcessor.ts` | `SDKQueryManager.ts`, `SessionManager.ts`, `InteractionHandler.ts`, `StatusMessageManager.ts`, `constants.ts` |
| 修改 Session 管理 | `src/core/SessionManager.ts` | `src/types/session.ts` |
| 管理平台 Adapter 生命週期 | `src/core/PlatformOrchestrator.ts` | `src/core/AdapterRegistry.ts`, `src/adapters/TelegramAdapter.ts` |
| 修改核心常數（如記憶檢查提醒） | `src/core/constants.ts` | `MessageProcessor.ts` |

---

## Telegram 相關

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 新增 Telegram 指令 | `src/adapters/commands/TelegramCommands.ts` | `TelegramAdapter.ts` |
| 修改訊息發送邏輯 | `src/adapters/TelegramAdapter.ts` | - |
| 修改訊息分割邏輯 | `src/adapters/TelegramAdapter.ts` | `splitMessage()` 方法 |
| 新增其他平台 Adapter | 繼承 `src/adapters/BaseAdapter.ts` | `src/core/AdapterRegistry.ts` |
| 取消執行中查詢 | `src/core/MessageProcessor.ts` | `cancelQuery()`、`cancelQueryForUser()` |
| 修改即時狀態訊息 | `src/adapters/TelegramAdapter.ts` | `sendStatusMessage()`、`updateStatusMessage()` |
| 修改工具事件捕捉 | `src/core/SDKQueryManager.ts` | `onToolEvent` callback |
| 修改狀態訊息整合 | `src/core/StatusMessageManager.ts` | debounce 邏輯、`ToolEventEntry` 類型 |

**目前可用指令**：`/start`、`/help`、`/reset`、`/stop`、`/schedule`、`/members`（群組）、`/status`

**群組委派與並行協作（ADR-021/022/030）**：
- 委派核心：`src/core/DelegationHandler.ts`（`processDelegation`、`executeDelegation`、`executeParallelDelegation`、`buildSynthesisPrompt`）
- 廣播入口：`src/core/GroupBroadcaster.ts`（`handleBotReplied` → `processDelegation`）
- 事件型別：`src/types/events.ts`（`BotRepliedPayload`：`isSynthesis`、`isInitiative`、`isSocial`）
- 測試：`tests/unit/DelegationHandler.test.ts`

**群組命令路由（ADR-024）**：
- 唯讀命令（`/help`、`/status`、`/members`）：裸打 → dedup 後一個 Bot 回覆
- 破壞性命令（`/reset`、`/stop`）：裸打 → 提示指定 `@botname` 或 `@all`
- `@botname` → 只有指定 Bot 執行
- `@all` → 所有 Bot 執行，一條統一回覆
- Dedup key：`chatId:date:userId:command`（Telegram 對每個 bot 分配不同 message_id）

---

## 權限審批系統

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改權限橋接邏輯（timeout、cancelAll） | `src/core/PermissionBridge.ts` | `tests/unit/PermissionBridge.test.ts` |
| 修改權限 UI（按鈕文字、InlineKeyboard） | `src/adapters/TelegramAdapter.ts` | `sendPermissionPrompt`、`callback_query` handler |
| 修改權限型別定義 | `src/adapters/types.ts` | `PermissionPromptOptions`、`PermissionPromptResult`、`PermissionResolver` |
| 新增平台的權限 UI | 繼承 `src/adapters/BaseAdapter.ts` | Override `sendPermissionPrompt`、`updatePermissionPrompt`、`setPermissionResolver` |
| 修改 canUseTool 閉包組裝 | `src/core/InteractionHandler.ts` | `PermissionBridge.ts`、`QuestionBridge.ts` |
| 調整 Agent 預設允許的工具 | `agents/general/.claude/settings.local.json` | `permissions.allow` 陣列 |
| 修改 AskUserQuestion 處理邏輯 | `src/core/QuestionBridge.ts` | `MessageProcessor.ts`、`TelegramAdapter.ts` |
| 修改問題提示 UI | `src/adapters/TelegramAdapter.ts` | `sendQuestionPrompt`、`setQuestionResolver` |

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

## 排程系統

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改 YAML schema | `src/schedule/schemas.ts` | `src/schedule/types.ts` |
| 修改排程載入邏輯 | `src/schedule/ScheduleLoader.ts` | - |
| 修改 cron 觸發邏輯 | `src/schedule/CronScheduler.ts` | `node-cron` |
| 修改任務執行邏輯 | `src/schedule/ScheduleExecutor.ts` | `SDKQueryManager.ts`、`constants.ts` |
| 修改執行通知 | `src/schedule/ScheduleNotifier.ts` | `telegramMarkdown.ts`（sendWithMarkdownFallback） |
| 修改排程管理 API | `src/schedule/ScheduleManager.ts` | - |
| 修改 /schedule 指令 | `src/adapters/commands/TelegramCommands.ts` | `handleSchedule*` 函數 |
| 修改排程資料庫操作 | `src/persistence/ScheduleRepository.ts` | `DatabaseManager.ts` |
| 修改 Agent 排程指引 | `agents/_example/CLAUDE.md` | Scheduling System 區段 |

**排程檔案位置**：`agents/{agentId}/schedules/{taskId}.yaml`

**排程執行特性**：
- 每次執行建立獨立 session（`schedule:{specId}:{uuid}`），不影響對話 session
- Hooks：UserPromptSubmit（時間注入）— 無 PreToolUse、無 Stop hook、無 canUseTool
- 通知使用 `sendWithMarkdownFallback`（MarkdownV2 → Markdown fallback）
- Schema 容錯：`type:"at"` → `"once"`、`datetime` → `at`
- **Retry**：`retryAsync()` 包裝 executeQuery，3 次重試（5s→15s→45s backoff），每次 retry 新 session ID
- **Circuit Breaker**：CronScheduler 追蹤連續失敗次數，達 3 次自動暫停 + Telegram 通知
- **ID 規則**：檔名為 canonical ID，YAML 內 `spec.id` 不一致時自動修正為檔名

---

## Agent Skills — 三層架構（system/persona/domain）

> 設計文件：[skill-based-character-system.md](../system/skill-based-character-system.md)
> 資料配置策略：[ADR-031](../decisions/adr/adr-031-data-placement-strategy.md)
> 遷移指南：[migration-guide-skill-system.md](./migration-guide-skill-system.md)

**目錄結構**：Claude Code 只支援一層目錄（`.claude/skills/<name>/SKILL.md`），因此用命名前綴表達三層概念：`sys-*`（系統）、`persona`（人格）、`dom-*`（領域技能）。

### sys-* — 系統協議與 Bot 狀態

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改 Agent 啟動協議 | `agents/general/.claude/skills/sys-agent-protocols/references/startup-protocol.md` | `SKILL.md` |
| 修改行為規範（安全+準則+輸出格式） | `agents/general/.claude/skills/sys-agent-protocols/references/behavior.md` | — |
| 修改記憶寫入規則 | `agents/general/.claude/skills/sys-agent-protocols/references/memory-system.md` | — |
| 修改排程建立指引 | `agents/general/.claude/skills/sys-agent-protocols/references/scheduling.md` | — |
| 修改裝備欄（能力配置） | `agents/general/.claude/skills/sys-equipment/references/loadout.md` | `SKILL.md` |
| 查看/更新技能熟練度 | `agents/general/.claude/skills/sys-proficiency/references/levels.md` | `SKILL.md`（等級定義） |

### persona/ — 人格定義

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改 Agent 人格（soul） | `agents/general/.claude/skills/persona/references/soul.md` | Core Truths、Boundaries、Vibe、Voice Guide |
| 修改 AI 身份（identity） | `agents/general/.claude/skills/persona/references/identity.md` | 名字、角色、定位 |
| 複製人格到其他 Agent | 複製 `agents/general/.claude/skills/persona/` | — |

### dom-* — 實際能力

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改瀏覽器能力 | `agents/general/.claude/skills/dom-agent-browser/` | `SKILL.md` |
| 修改 Skill 搜尋能力 | `agents/general/.claude/skills/dom-find-skills/` | `SKILL.md` |
| 修改 MCP 搜尋能力 | `agents/general/.claude/skills/dom-find-mcp/` | `SKILL.md` |

> **Skill 觸發**：Agent 在 session 開始時透過 Skill 工具調用 `/agent-protocols` 和 `/persona`。
> **資料分流原則**：Bot 狀態（skill/references/）vs 關係資料（根目錄），詳見 ADR-031。

---

## Agent 記憶系統

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改 CLAUDE.md 引導 | `agents/general/CLAUDE.md` | 引導 agent 載入 skills |
| 修改使用者檔案 | `agents/general/USER.md` | — |
| 查看/修改長期記憶 | `agents/general/MEMORY.md` | Agent 自行維護 |
| 查看每日日誌 | `agents/general/memory/YYYY-MM-DD.md` | Agent 自行產生 |
| 理解記憶設計原理 | `docs/moltbot-blueprint.md` | Moltbot Phase 0 純檔案架構 |

> **注意**：記憶系統不涉及 `src/` 任何程式碼。修改只需調整 agent workspace 檔案和 skills。

---

## Activity System / Live Page（v1.27.0）

| 要做什麼 | 主要檔案 | 相關檔案 |
|----------|----------|----------|
| 修改 AI 反應生成邏輯 | `src/core/ReactionGenerator.ts` | `callHaiku()`、`parseResponse()`、`inferMood()` |
| 修改 Activity 事件管理 | `src/core/ActivityService.ts` | thin facade：事件建立 + 推送 + 狀態管理 |
| 修改 Idle Mutter 排程 | `src/core/IdleMutterScheduler.ts` | 只負責排程邏輯，AI 委託 ReactionGenerator |
| 修改 Activity 持久化 | `src/persistence/ActivityRepository.ts` | `DatabaseManager.ts`（schema v8） |
| 修改 Activity API | `src/webui/api/activity.api.ts` | `/events`、`/agents`、`/stream` |
| 修改 SSE 推播 | `src/webui/services/SSEBroadcaster.ts` | `activity.api.ts` |
| 修改 Live 前端頁面 | `public/js/live.js`、`public/css/live.css` | `src/webui/views/live/index.ejs` |
| 修改 Activity 接線（初始化） | `src/AppBootstrap.ts` | `createActivityService()`、`buildPersonalityReader()` |

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
| QuestionPromptOptions, QuestionPromptResult, QuestionResolver | `src/adapters/types.ts` |
| ToolEvent, StatusMessageOptions, StatusMessageResult | `src/adapters/types.ts` |
| SDK 類型（PermissionMode, HookEvent 等） | `src/types/sdk.ts` |

---

## 測試

| 要測試什麼 | 測試檔案位置 |
|------------|--------------|
| AgentLoader | `tests/unit/AgentLoader.test.ts` |
| SessionManager | `tests/unit/SessionManager.test.ts` |
| TelegramAdapter | `tests/unit/TelegramAdapter.test.ts` |
| TelegramCommands | `tests/unit/TelegramCommands.test.ts` |
| PermissionBridge | `tests/unit/PermissionBridge.test.ts` |
| DelegationHandler | `tests/unit/DelegationHandler.test.ts` |
| GroupBroadcaster | `tests/unit/GroupBroadcaster.test.ts` |
| InitiativeEvaluator | `tests/unit/InitiativeEvaluator.test.ts` |
| InitiativeHandler | `tests/unit/InitiativeHandler.test.ts` |
| ConfigTransformer | `tests/unit/ConfigTransformer.test.ts` |
| EventBus | `tests/unit/EventBus.test.ts` |
| PathValidator | `tests/unit/PathValidator.test.ts` |
| 持久化 | `tests/unit/ConversationRepository.test.ts`、`DatabaseManager.test.ts`、`SessionRepository.test.ts` |
| 整合測試 | `tests/integration/` |

---

## 入口點

| 用途 | 檔案 |
|------|------|
| 精簡主入口（~20 行） | `src/index.ts` |
| 集中化配置解析 | `src/config.ts` |
| 應用生命週期管理（初始化 + 關機） | `src/AppBootstrap.ts` |
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
