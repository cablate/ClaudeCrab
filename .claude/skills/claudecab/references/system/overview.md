# ClaudeCab 架構設計

## 目錄

1. [技術棧](#技術棧)
2. [目錄結構](#目錄結構)
3. [設計原則](#設計原則)
4. [核心模組](#核心模組)
5. [Agent 配置結構](#agent-配置結構)
6. [Agent 記憶運作機制](#agent-記憶運作機制)
7. [資料流](#資料流)
8. [核心型別定義](#核心型別定義)

---

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

---

## 目錄結構

```
claudecab/
├── src/
│   ├── index.ts           # 精簡入口（~20 行，委派給 AppBootstrap）
│   ├── config.ts           # 集中化環境變數解析（AppConfig）
│   ├── AppBootstrap.ts     # 應用生命週期管理（初始化 + 關機序列）
│   ├── core/              # AgentLoader, SessionManager, SDKQueryManager, EventBus, PlatformOrchestrator, StatusMessageManager, InteractionHandler, ActivityService, GroupBroadcaster, DelegationHandler, etc.
│   ├── persistence/       # SQLite 持久化層
│   ├── schedule/          # 排程系統（CronScheduler, ScheduleManager, ScheduleExecutor, etc.）
│   ├── adapters/          # TelegramAdapter, BaseAdapter, commands/TelegramCommands
│   ├── webui/             # Express + EJS 管理介面
│   │   ├── WebUIServer.ts
│   │   ├── routes/        # 頁面路由
│   │   ├── api/           # API 端點
│   │   ├── services/      # 業務邏輯
│   │   └── views/         # EJS 模板（元件化）
│   ├── types/             # TypeScript 型別定義
│   └── utils/             # logger, security, audit, retry, format, DedupTracker, groupSession, telegramMarkdown
├── public/                # 靜態資源 (JS, CSS, images)
│   └── images/agents/     # Agent 視覺資產（sprite, portrait, emoji）
├── agents/                # Agent 配置（每個子目錄 = 一個代理）
│   ├── general/           # 通用助手（含記憶系統 workspace）
│   │   ├── .claude/
│   │   │   ├── settings.local.json  # 權限配置
│   │   │   └── skills/              # Agent Skills
│   │   │       ├── agent-protocols/ # 核心協議（啟動、記憶、安全）
│   │   │       └── persona/         # 人格定義（soul, identity）
│   │   ├── CLAUDE.md      # 系統提示（引導 → skills）
│   │   ├── BOOTSTRAP.md   # 首次啟動儀式（完成後自動刪除）
│   │   ├── USER.md        # 使用者檔案
│   │   ├── MEMORY.md      # 長期記憶
│   │   └── memory/        # 每日日誌
│   └── coder/             # 程式碼助手
├── scripts/               # 工具腳本
│   ├── setup.ts           # 互動式首次設定精靈 (npm run setup)
│   └── validate-image-assets.cjs  # 圖片資產規格驗證
├── tests/                 # 386 tests, 25 files
└── data/                  # SQLite 資料庫
```

---

## 設計原則

- **SDK 優先**：充分利用 Claude Agent SDK 內建功能，避免重複造輪子
- **TypeScript 嚴格模式**：確保類型安全，禁用 `any`
- **配置驅動**：透過 JSON 配置 Agent，降低使用門檻
- **模組化設計**：便於擴充與測試
- **依賴反轉**：介面優先
- **SDKQueryManager 可獨立抽離**：SDKQueryManager 只負責接收 `systemPrompt` 字串 + `cwd` 路徑並呼叫 SDK `query()`，不注入任何業務邏輯（如記憶系統）。系統使用 SDK 的 preset append 模式（`{ type: 'preset', preset: 'claude_code', append: systemPrompt }`），保留 Claude Code 內建 prompt 並附加自訂指令。設計目標是可以從 ClaudeCab 中整個帶走到其他專案使用
- **Agent 自主管理**：記憶、人格等進階功能完全由 Agent 透過 CLAUDE.md 指令自行操作，引擎層（`src/`）零感知。不建立「組裝層」注入記憶內容到 systemPrompt

---

## 核心模組

### AgentLoader (`src/core/AgentLoader.ts`)

從 `agents/` 目錄載入所有代理配置：
- 掃描子目錄
- 讀取 `agent.json` 配置
- 載入 `CLAUDE.md` 系統提示詞
- 支援代理繼承（extends）
- Zod 驗證配置結構
- **動態 SystemPrompt 讀取**（v1.5.1）：`readSystemPrompt(agentId)` 每次從磁碟重新讀取 CLAUDE.md，支援 Agent 在 runtime 自主更新系統提示詞
- **通用規則注入**（v1.41）：`loadSystemPrompt()` 自動 append `getGlobalStaticRules()` 返回的引擎層通用規則（如 `[send:path]` 檔案傳送語法）

```typescript
interface IAgentRepository {
  get(agentId: string): LoadedAgent | undefined;
  list(): string[];
}
```

### SessionManager (`src/core/SessionManager.ts`)

管理用戶會話狀態：
- 會話建立與查詢（`platform::agentId::userId` 作為 key）
- 每個 Agent + 用戶 + 平台的組合擁有獨立 Session
- 訊息去重（idempotency）
- 分散式鎖（async-mutex，防止並發處理）
- 自動清理過期會話（僅從記憶體移除，DB 行保留）
- **SDK Session ID 存儲**：儲存 `sdkSessionId` 供 resume 使用
- **對話連續性**（v1.4.1）：`createSession()` 建立新 session 前查 DB 取回先前的 `session_id` + `sdk_session_id`，重用舊 session ID（保持 FK 關聯）並繼承 `sdkSessionId`
- **DB 保留策略**：`cleanupExpired()` 只從記憶體移除，不刪 DB 行。`restoreSessions()` 僅清理超過 `dbRetentionMs`（預設 30 天）的古老 session

### SDKQueryManager (`src/core/SDKQueryManager.ts`)

封裝 Claude Agent SDK `query()` 函數：

**關鍵設計（Agent Isolation + Skills）**：
- `settingSources: ['project', 'local']` - 載入 agent 的設定檔（`.claude/settings.local.json`）**和 skills**（`.claude/skills/`）
- `systemPrompt` 參數 - 使用 SDK preset append 模式（`{ type: 'preset', preset: 'claude_code', append: agentSystemPrompt }`），保留 Claude Code 內建 prompt 並附加 agent 的 CLAUDE.md 內容
- **原因**：`'local'` 無法載入 skills；改用 `'project'` 後，仍透過明確傳遞 `systemPrompt` 確保 agent isolation。v1.28 從字串覆蓋改為 preset append，避免丟失 Claude Code 的工具規範與安全規則
- **變更歷史**：v1.11.0 從 `['local']` → `['project']` → `['project', 'local']`

**功能**：
- 管理 Query 生命週期
- 使用 `resume` option 恢復對話歷史
- 從 SDK 訊息擷取 `session_id`
- 支援重試邏輯
- **中間訊息串流**（v1.6.0）：`onIntermediateMessage` optional callback，每收到 assistant 訊息即呼叫，支援即時回饋而非等全部完成

### PermissionBridge (`src/core/PermissionBridge.ts`)

Promise-based 非同步權限橋接，用於連接 SDK 的 `canUseTool` callback 與 Telegram InlineKeyboard 審批 UI：
- 管理 `requestId → deferred Promise` 映射，每個工具審批請求對應一個 pending Promise
- SDK 呼叫 `canUseTool` 時建立 deferred，Telegram 使用者按下按鈕時 resolve
- **120 秒 timeout** — 超時自動 deny，避免 Promise 永遠 pending
- **AbortSignal 支援** — 外部可取消等待中的請求
- **cancelAll()** — 一次取消所有 pending 請求（如 session 結束時清理）
- 不直接依賴 Adapter 或 SDK，純粹的 Promise 協調層

### MessageProcessor (`src/core/MessageProcessor.ts`)

處理訊息流程（SDK 模式），v1.17.0 重構後約 1,065 行，職責分離至 InteractionHandler 和 StatusMessageManager：
1. 接收 UnifiedMessage
2. 取得/建立 Session
3. **動態讀取 systemPrompt**（v1.5.1）：透過 `getSystemPrompt(agentId)` 函數注入
4. **委派 InteractionHandler**（v1.17.0）：建立 InteractionHandler 處理 canUseTool callback
5. **委派 StatusMessageManager**（v1.17.0）：建立 StatusMessageManager 處理即時狀態訊息
6. SDKQueryManager 呼叫 `query()`（帶 `resume: sdkSessionId` + `onIntermediateMessage` callback + `canUseTool` via `additionalOptions`）
7. **中間訊息即時串流**（v1.6.0）：SDK 每產生 assistant 訊息，透過 callback 即時發送到 Telegram
8. **Resume 失敗自動重試**（v1.4.1）：帶 resume 呼叫失敗時，清除 sdkSessionId，不帶 resume 重試一次
9. **Inline Image 自動發圖**（v1.40）：`sendInlineImages()` 偵測回覆中的圖片路徑（支援 Windows/Unix 絕對路徑、相對路徑、backtick 包裹、markdown image 語法），驗證檔案存在後透過 `adapter.sendPhoto()` 發送，再從文字中 strip 路徑
10. **Inline Document 傳送**（v1.41）：`sendInlineDocuments()` 使用 `[send:path]` 明確語法傳送文件，避免 agent 提及路徑時意外觸發傳檔
10. **Post-query 處理**（v1.17.0 拆分為 private methods）：`saveSDKSessionId()` → `updateInjectionCursor()` → `persistConversation()` → `sendFinalResponse()` → `emitBotRepliedEvent()`

### InteractionHandler (`src/core/InteractionHandler.ts`)

v1.17.0 從 MessageProcessor 抽出，封裝 Permission/Question 互動橋接：
- 建構時設置 PermissionBridge + QuestionBridge + Adapter 解析器
- `buildCanUseTool()` 回傳 SDK 可用的 canUseTool callback
- 攔截 `AskUserQuestion` 工具，透過 Telegram 按鈕呈現選項
- 一般工具則走 PermissionBridge 審批流程
- `dispose()` 清理所有 pending 請求

### StatusMessageManager (`src/core/StatusMessageManager.ts`)

v1.17.0 從 MessageProcessor 抽出，封裝即時狀態訊息管理：
- Tool event 追蹤和 debounced 更新（避免 Telegram 429）
- 狀態訊息建立/更新/結算生命週期
- 中間 assistant 訊息發送時 finalize 當前 batch，下次 tool event 建新 status message
- `isStatusCapable()` 型別守衛檢查 adapter 是否支援狀態訊息

### PathValidator (`src/core/PathValidator.ts`)

工作區隔離強制執行（v1.13.0）：
- 透過 PreToolUse hook 攔截所有檔案操作工具（Read, Write, Edit, Glob, Grep, Bash）
- 在 MessageProcessor 中自動注入，Agent 無需維護 hooks.ts
- **Bash 特殊處理**：從命令字串提取路徑（引號內、絕對、相對），轉換為實際路徑後驗證

**權限規則**：
| 路徑 | 讀取 | 寫入 |
|------|------|------|
| 自己的工作區 `agents/{id}/` | ✅ | ✅ |
| 共享區 `_shared/knowledge/` | ✅ | ❌ |
| 自己的命名空間 `_shared/knowledge/{id}/` | ✅ | ✅ |
| 其他 agent 工作區 | ❌ | ❌ |

### constants (`src/core/constants.ts`)

集中管理核心常數與 hook 建構函式：
- **MEMORY_CHECKPOINT_CONTEXT**（v1.7.1）：記憶檢查提醒文字，透過 UserPromptSubmit hook 注入，提醒 agent 在回覆前檢查上一輪對話是否有值得記錄的內容
- **buildMemoryStopCheckpoint(groupChatId?)**（v1.18.0, v1.19.0 修正）：Stop hook 記憶檢查；群組對話時明確指示「群組事件寫 groups/{chatId}/，不寫 memory/*.md」
- **buildPromptContext(chatId?, isNewSession?, groupChatId?)**：UserPromptSubmit hook context；群組對話時顯示 `【群組日誌路徑】` 取代個人 `【日誌路徑】`

### EventBus (`src/core/EventBus.ts`)

類型安全的事件發布訂閱機制：
- `message:received` / `message:sent`
- `session:created` / `session:closed`
- `agent:loaded` / `agent:reloaded`
- `error`

### PlatformOrchestrator (`src/core/PlatformOrchestrator.ts`)

管理所有平台 Adapter 的生命週期：
- 掃描 Agent 配置中的平台 token（如 `telegramBotToken`）
- 為每個有 token 的 Agent 建立獨立的 Adapter 實例
- 單一 Agent 啟動失敗不影響其他 Agent
- 支援 `reloadAgent(agentId)` — 重載 Agent 配置並重啟其 Adapter
- 提供 `getRunningAdapters()` 供 WebUI 監控
- 通用設計，未來可擴展到 Slack、Discord 等平台

### AdapterRegistry (`src/core/AdapterRegistry.ts`)

管理 Adapter 實例註冊：
- Key 為 `platform::agentId` 複合鍵
- 支援按平台+Agent 查詢 Adapter

### ConfigTransformer (`src/core/ConfigTransformer.ts`)

AgentConfig → SDK Options 轉換器：
- `toSDKOptions()` 將 agent.json 配置轉換為 SDK `query()` 可用的 options
- `getSDKModel()` 映射 model 名稱（sonnet/opus/haiku → SDK model ID）
- `validateSDKOptions()` 驗證轉換後的 options
- 內含 `PERMISSION_MODE_MAP` 映射表（default/acceptEdits/bypassPermissions/plan/delegate/dontAsk）

### QuestionBridge (`src/core/QuestionBridge.ts`)

Promise-based 非同步問答橋接（與 PermissionBridge 平行的設計）：
- 處理 SDK `AskUserQuestion` 工具的回應流程
- 管理 `requestId → deferred Promise` 映射
- 提取問題選項標籤供 Telegram InlineKeyboard 顯示
- 由 InteractionHandler 整合調用

### ContextInjector (`src/core/ContextInjector.ts`)

群組對話歷史注入（v1.18.0+）：
- `getInjectionContext()` 取得群組訊息歷史，格式化為 agent 可理解的上下文
- `formatHistory()` 將群組訊息轉為結構化文字
- `formatMemberList()` 格式化群組成員資訊
- `updateCursor()` 更新注入游標，避免重複注入
- 依賴 GroupMessageRepository + InjectionStateRepository

### DelegationHandler (`src/core/DelegationHandler.ts`)

Agent 對 Agent 委派機制（ADR-022）：
- `processDelegation()` 處理委派請求
- `detectDelegationTargets()` 識別委派目標 agent
- `executeDelegation()` / `executeParallelDelegation()` 執行單一/並行委派
- `buildSynthesisPrompt()` 建構委派結果綜合提示
- 內含 `MAX_DELEGATION_DEPTH` 防止無限遞迴

### GroupBroadcaster (`src/core/GroupBroadcaster.ts`)

多 Agent 群組對話協調器（v1.18.0+）：
- `handleGroupMessage()` 處理群組訊息路由
- `getRespondingBot()` 決定由哪個 bot 回應
- `registerBotInGroup()` / `restoreMemberships()` 群組成員管理
- `handleBotReplied()` / `recordBotReplyToGroupMessages()` 回應追蹤
- 整合 DelegationHandler、InitiativeHandler、SocialHandler
- 管理 per-bot 訊息去重（DedupTracker）

### InitiativeEvaluator (`src/core/InitiativeEvaluator.ts`)

Agent 主動互動評估器（ADR-023）：
- 評估 agent 是否應主動發起對話
- 基於 agent.json `settings.initiative` 配置

### InitiativeHandler (`src/core/InitiativeHandler.ts`)

Agent 主動互動執行器（ADR-023）：
- `evaluateInitiatives()` 評估所有 agent 的主動行為時機
- `executeInitiative()` 執行主動訊息發送
- 冷卻時間管理（cooldowns）+ 每小時計數器（hourlyCounters）

### SocialEvaluator (`src/core/SocialEvaluator.ts`)

社交行為評估器：
- 評估群組中 agent 是否應進行社交互動

### SocialHandler (`src/core/SocialHandler.ts`)

社交互動執行器：
- `evaluateSocial()` 評估社交互動時機
- `executeSocial()` 執行社交訊息
- 群組能量（energy）機制：每次互動消耗能量，自然衰減，防止 bot 過度活躍
- `DEFAULTS` 配置：cooldown、energyThreshold、maxConsecutiveBotTurns、maxPerHour

### ActivityService (`src/core/ActivityService.ts`)

Live page 活動追蹤服務（v1.27.0+）：
- 緩衝式事件收集（`FLUSH_THRESHOLD` / `FLUSH_INTERVAL_MS`）+ 寫入佇列
- `emitReaction()` / `emitMutter()` / `emitReply()` / `emitStatusChange()` / `emitWorkflow()` 發送不同類型事件
- `trackActivity()` 追蹤 agent 活動狀態（phase + mood）
- `getAgentState()` / `getIdleDuration()` / `getStats()` 狀態查詢
- `restoreMoodFromDb()` 重啟後恢復 mood
- 依賴 ActivityRepository + ReactionGenerator + EventBus
- `PHASE_DESCRIPTIONS` 映射：idle/task_received/working/tool_use/completed/error

### ReactionGenerator (`src/core/ReactionGenerator.ts`)

AI 驅動的反應/心情生成器（Live page 用）：
- `generateReaction()` 根據事件生成 agent 反應（emoji + 短文字）
- `generateMutter()` 生成 idle 時的自言自語
- `inferMood()` 從事件推斷 agent 心情（ActivityMood）
- 使用 Haiku 模型（低成本即時生成）
- `MUTTER_SCENARIOS` 預定義自言自語場景

### IdleMutterScheduler (`src/core/IdleMutterScheduler.ts`)

Idle 自言自語排程器（Live page 用）：
- 定期檢查 agent 閒置時間（`checkIntervalMs`）
- 閒置超過閾值（`idleThresholdMs`）時有機率（`mutterChance`）觸發自言自語
- 每 agent 每小時上限（`maxPerAgentPerHour`）
- `hasActiveViewers()` 回調：僅在有人觀看 Live page 時觸發
- **Per-agent 設定**：透過 `agent.json` 的 `settings.idleMutter` 覆寫全域預設
  - `enabled`（預設 true）— 關閉則該 agent 不產生獨白
  - `chance`（預設 0.3）— 觸發機率
  - `maxPerHour`（預設 3）— 每小時上限

### Schedule 模組 (`src/schedule/`)

排程系統（agent 可建立定時任務）：
- `ScheduleManager.ts` — 排程 CRUD + 生命週期管理（create/pause/resume/delete/runNow）
- `ScheduleLoader.ts` — 從 agent 目錄載入排程定義
- `CronScheduler.ts` — Cron 表達式排程引擎
- `ScheduleExecutor.ts` — 排程任務執行器
- `ScheduleNotifier.ts` — 排程事件通知
- `schemas.ts` / `types.ts` — Zod schema 與型別定義

### BaseAdapter (`src/adapters/BaseAdapter.ts`)

所有平台 Adapter 的抽象基底類別：
- 定義 `sendMessage`、`sendTypingIndicator`、`sendPhoto` 等抽象方法
- `sendPhoto(chatId, filePath, caption?)` — 發送本地圖片，預設回傳 not-implemented，子類 override
- **權限審批預設方法**（v1.7.0）：提供 `sendPermissionPrompt`、`updatePermissionPrompt`、`setPermissionResolver` 三個預設方法（no-op / auto-deny），子類可 override 實作平台特定的審批 UI

### TelegramAdapter (`src/adapters/TelegramAdapter.ts`)

Telegram 平台整合（每個 Agent 一個 Bot 實例）：
- grammy Bot 封裝
- 建構時綁定 `agentId`
- 訊息分割（超過 4096 字元）
- 打字指示器
- 速率限制（35ms 最小間隔）
- 指令處理（`commands/TelegramCommands.ts`）：`/start`, `/help`, `/reset`, `/restart`（v1.41，白名單限定，含 tsc 預檢）
- **權限審批 UI**（v1.7.0）：Override `sendPermissionPrompt`、`updatePermissionPrompt`、`setPermissionResolver` 三個方法；發送 InlineKeyboard（Allow / Deny 按鈕）；註冊 `callback_query` handler 處理使用者按鈕回應
- **`sendPhoto` 實作**：使用 grammy `InputFile` 發送本地圖片，支援 caption，整合 rateLimiter
- **`sendDocument` 實作**（v1.41）：發送本地文件（pdf, md, txt 等），使用 `[send:path]` 語法觸發
- **Fire-and-forget message handler**（v1.7.0）：message handler 不 await processMessage，避免阻塞 grammy polling loop 造成 callback_query 死鎖
- **allowed_updates**（v1.7.0）：`doStart` 明確指定 `allowed_updates: ['message', 'callback_query']` 確保接收按鈕回調事件

### Persistence 層 (`src/persistence/`)

SQLite 持久化：
- `DatabaseManager.ts` - 連線管理、Schema 初始化（v8）、WAL 模式、線性 migration 鏈（v1→v8）
- `SessionRepository.ts` - Session CRUD、過期清理、`sdkSessionId` 存儲（UNIQUE: platform + agent_id + user_id）
- `ConversationRepository.ts` - 對話歷史 CRUD（SDK 訊息持久化，供 WebUI 查看）
- `GroupMemberRepository.ts`（v1.18.0）- 群組成員持久化（platform + chat_id + agent_id），供重啟後還原成員關係
- `QueryMetricsRepository.ts`（v1.19.0）- 每次 SDK query 的 token 用量、成本、回應時間追蹤；提供 per-agent 聚合統計和每日統計
- `ActivityRepository.ts`（v1.27.0）- Activity events 持久化（重啟後 Live page 歷史可見）；支援 agentId/type/since 篩選查詢
- `GroupMessageRepository.ts`（v1.18.0+）- 群組訊息持久化，供 ContextInjector 注入歷史上下文
- `InjectionStateRepository.ts`（v1.18.0+）- 群組訊息注入游標狀態，追蹤每個 agent 已注入到哪條訊息
- `ScheduleRepository.ts` - 排程定義與執行歷史持久化

---

## Agent 配置結構

每個 agent 是一個獨立的 Claude Code 專案：

```
agents/general/
├── .claude/
│   └── settings.local.json   # Agent 權限配置
├── agent.json                 # ClaudeCab 元資料
└── CLAUDE.md                  # 系統提示詞
```

### .claude/settings.local.json

```json
{
  "model": "sonnet",
  "permissions": {
    "allow": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    "deny": []
  }
}
```

> **重要**：使用 `settings.local.json` 而非 `settings.json`，搭配 `settingSources: ['project', 'local']` 載入 agent 設定檔和 skills。
>
> **所有權**：此檔案由 SDK 管理。SDK 在 runtime 會動態寫入 `permissions.allow`（使用者核准工具時）。
> Dashboard Edit 頁面可讀寫此檔案的 `permissions` 和 `model`（merge 式更新，不覆蓋其他欄位）。
> 詳見 [ADR-027](../decisions/adr/adr-027-dashboard-config-management.md)。

### Output Style（僅 CLI 支援，SDK 不支援）

Output Style 是 Claude Code **CLI** 的功能，允許自訂回覆風格。

> **⚠️ 重要：SDK 不支援 Output Style**
>
> ClaudeCab 透過 `@anthropic-ai/claude-agent-sdk` 的 `query()` 函數呼叫，SDK 的 `Options` 型別中**沒有 `outputStyle` 參數**。即使在 `settings.local.json` 設定 `"outputStyle": "..."`，SDK 也會忽略此設定。
>
> **替代方案**：把輸出風格指令直接寫在 CLAUDE.md 中（如 `## Output Style` 區段）。

以下為 CLI 原生 Output Style 的參考資訊（ClaudeCab 不適用）：

**檔案位置**：`.claude/output-styles/<style-name>.md`

**檔案格式**：
```markdown
---
name: My Custom Style
description: 顯示在 /output-style 選單的描述
keep-coding-instructions: false
---

# 自訂指令
[內容會加到系統提示末尾...]
```

**Frontmatter 選項**：

| 欄位 | 說明 | 預設值 |
|------|------|--------|
| `name` | 風格名稱 | 從檔案名稱繼承 |
| `description` | 風格描述 | 無 |
| `keep-coding-instructions` | 是否保留編碼指令 | `false`（會排除編碼指令）|

### agent.json

```json
{
  "name": "General Assistant",
  "description": "通用助手",
  "version": "1.0.0",
  "model": "sonnet",
  "telegramBotToken": "123456:ABC-DEF...",
  "display": {
    "avatar": "📝",
    "color": "#F59E0B",
    "sprite": "sprite.png",
    "portrait": "portrait.png",
    "emoji": {
      "neutral": "emoji-neutral.png",
      "excited": "emoji-excited.png",
      "annoyed": "emoji-annoyed.png",
      "tired": "emoji-tired.png",
      "focused": "emoji-focused.png"
    }
  },
  "settings": {
    "permissionMode": "default",
    "maxTurns": 20
  }
}
```

> **display 欄位**（v1.31）：Live page 視覺資產配置。圖片路徑相對於 `public/images/agents/{agentId}/`，API 自動組裝完整 URL。emoji key 對齊 `ActivityMood` 值。未設定的欄位前端自動 fallback（avatar emoji 替代 sprite）。

### CLAUDE.md

SDK 會自動載入此檔案作為系統提示（透過 SDKQueryManager 明確傳遞）。

### Agent Skills（v1.11.0）

Claude Code 原生 Skills 機制，用於模組化 Agent 的協議和人格定義：

```
agents/general/.claude/skills/
├── agent-protocols/              # 核心行為規範
│   ├── SKILL.md                  # 協議索引（觸發入口）
│   └── references/
│       ├── startup-protocol.md   # Session 啟動流程
│       ├── behavior.md           # 行為規範（安全+準則+輸出格式）
│       ├── memory-system.md      # 記憶寫入規則
│       └── scheduling.md         # 排程建立指引
└── persona/                      # 人格定義（可攜帶）
    ├── SKILL.md                  # 人格入口
    └── references/
        ├── soul.md               # 核心價值觀、說話風格
        └── identity.md           # 名字、角色、定位
```

**Skill 載入機制**：
- Skill metadata（name, description）在 session 開始時自動載入
- Agent 透過 Skill 工具調用 `/skill-name` 載入完整內容
- CLAUDE.md 引導 agent 在啟動時調用 `/agent-protocols`

**設計原則**：
- **協議與人格分離**：agent-protocols 定義「怎麼做」，persona 定義「是誰」
- **可攜帶性**：persona skill 可複製到其他 agent 快速部署相同人格
- **環境狀態獨立**：USER.md、MEMORY.md、memory/ 是環境特定狀態，不放入 skill

### Agent Workspace 檔案（記憶系統）

Agent 可擁有額外的 workspace 檔案，由 CLAUDE.md 中的指令驅動 agent 自行讀寫：

```
agents/general/
├── .claude/
│   ├── settings.local.json   # Agent 權限配置
│   └── skills/               # Agent Skills（見上方）
├── agent.json                 # ClaudeCab 元資料
├── CLAUDE.md                  # 系統提示詞（引導 → skills）
├── BOOTSTRAP.md               # 首次啟動儀式（完成後由 agent 自行刪除）
├── USER.md                    # 使用者檔案（身份、偏好）
├── MEMORY.md                  # 長期記憶（篩選過的持久事實）
├── EQUIPMENT.md               # 已安裝工具清單
├── knowledge/                 # 私有知識產出（草稿區）
│   ├── tools/                 # 工具評估
│   ├── cases/                 # 案例研究
│   └── research/              # 研究筆記
├── groups/                    # 群組記憶（v1.18.0）
│   └── {chatId}/
│       ├── MEMORY.md          # 群組持久記憶（共識、決策、任務分配）
│       └── YYYY-MM-DD.md      # 群組每日討論紀錄
└── memory/                    # 每日日誌
    └── YYYY-MM-DD.md
```

### 共享知識區（v1.12.0）

跨 Agent 的知識共享機制，讓 bot 產出的知識資產可被其他 bot 參考：

```
agents/
├── _shared/
│   └── knowledge/
│       ├── general/           # general 發布的內容
│       │   ├── tools/
│       │   └── cases/
│       └── nitterbot/         # nitterbot 發布的內容
```

**權限規則**：
- 讀取：所有 bot 可讀整個 `_shared/knowledge/`
- 寫入：只能寫入自己的命名空間 `_shared/knowledge/{agentId}/`
- 禁止：存取其他 bot 的私有 `knowledge/` 目錄

詳見 [shared-knowledge.md](shared-knowledge.md)

> **v1.11.0 變更**：SOUL.md、IDENTITY.md 移至 `.claude/skills/persona/references/`，成為可攜帶的 skill

> **重要**：這些檔案不由引擎層管理。Agent 在 session 啟動時依 CLAUDE.md 指示自行讀取，對話中自行寫入。SDKQueryManager 完全不知道這些檔案的存在。
>
> **BOOTSTRAP.md**（v1.5.2）：一次性首次啟動儀式。Agent 偵測到此檔案存在時，執行 onboarding 流程（認識使用者、定義自己），完成後刪除檔案。不存在 = 已啟動過。

---

## Agent 記憶運作機制

Agent 的記憶系統採用「零程式碼」設計 — 完全透過 CLAUDE.md 指令驅動，不修改引擎任何一行程式碼。

### 運作原理

```
AgentLoader 讀取 CLAUDE.md（啟動時快取 + 每次查詢時從磁碟重新讀取）
       │
       ▼
作為 systemPrompt 字串傳入 SDKQueryManager
       │
       ▼
SDK 以 cwd=agents/<name>/ 執行 agent
       │
       ▼
Agent 看到 systemPrompt 裡的記憶協議
       │
       ▼
Agent 用 Read/Write 工具自行讀寫 workspace 檔案
```

### 為什麼不在引擎層注入記憶

- **SDKQueryManager 可獨立抽離**：設計目標是可以把 SDKQueryManager 整個帶走到其他專案使用，因此不在此層注入記憶、人格等業務邏輯
- **不需要「組裝層」**：不在 MessageProcessor 或任何中間層把記憶內容拼接進 systemPrompt
- **Agent 自主管理**：Agent 本身就有 Read/Write 工具能力，CLAUDE.md 告訴它要讀什麼寫什麼，它自己操作

### 分層邊界

| 層級 | 職責 | 知道記憶系統？ |
|------|------|:---:|
| `SDKQueryManager` | 接收 systemPrompt + cwd，以 preset append 呼叫 SDK query() | ✗ |
| `MessageProcessor` | 管理訊息處理流程、Session 狀態；透過函數注入取得即時 systemPrompt | ✗ |
| `AgentLoader` | 讀取 CLAUDE.md 內容（啟動時快取 + `readSystemPrompt()` 即時讀取） | ✗（只是讀檔案）|
| `CLAUDE.md`（agent 層）| 定義記憶協議、啟動讀取順序、寫入規則 | ✓ |
| Agent（runtime）| 執行 CLAUDE.md 指令，讀寫 workspace 檔案 | ✓ |

---

## 資料流

```
使用者發送訊息
       │
       ▼
┌─────────────────────────────────────────────┐
│  1. TelegramAdapter 接收訊息                  │
│     - grammy 接收 Telegram 訊息               │
│     - 轉換為 UnifiedMessage                   │
│     - EventBus.emit('message:received')      │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  2. MessageProcessor 處理                    │
│     - 冪等性檢查（已處理過的 message_id 跳過）  │
│     - 查詢/建立 Session（SessionManager）     │
│     - 更新 Session 狀態為 'processing'        │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  3. SDKQueryManager 執行查詢                  │
│     - cwd = agent 目錄                        │
│     - settingSources: ['project', 'local']              │
│     - systemPrompt = 從磁碟重新讀取的 CLAUDE.md│
│     - resume = sdkSessionId（如有）           │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  4. 處理回應                                  │
│     - 擷取 session_id 存入 SessionManager    │
│     - 收集 assistant 回應文字                 │
│     - 持久化 user/assistant 訊息到 DB        │
│     - 更新 Session 狀態為 'idle'              │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  5. TelegramAdapter 發送回應                  │
│     - 長訊息分割（4096 字元）                  │
│     - EventBus.emit('message:sent')          │
└─────────────────────────────────────────────┘
```

---

## 核心型別定義

### AgentConfig

```typescript
interface AgentConfig {
  name: string;
  description?: string;
  version?: string;
  extends?: string;
  model?: 'sonnet' | 'opus' | 'haiku';
  maxTokens?: number;
  maxThinkingTokens?: number;
  telegramBotToken?: string;  // 每個 Agent 獨立的 Telegram Bot Token
  systemPrompt?: string;       // 優先於 systemPromptFile 和 CLAUDE.md
  systemPromptFile?: string;   // 優先於 CLAUDE.md
  allowedTools?: string[];     // SDK query 層工具白名單（Dashboard 不管理，手動編輯 agent.json）
  disallowedTools?: string[];  // SDK query 層工具黑名單（同上）
  mcpConfigFile?: string;      // MCP 伺服器設定檔路徑（相對於 agent 目錄）
  display?: {                  // Live page 視覺資產（v1.31）
    avatar?: string;           // 文字 emoji（如 📝），用於 feed 和 fallback
    color?: string;            // 主題色（如 #F59E0B）
    sprite?: string;           // 辦公室場景角色圖檔名（相對於 public/images/agents/{id}/）
    portrait?: string;         // 對話面板半身像圖檔名
    emoji?: Record<string, string>;  // mood → 表情圖檔名，key 對齊 ActivityMood
  };
  settings?: {
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'delegate' | 'dontAsk';
    maxTurns?: number;
    maxHistoryLength?: number;  // ⚠️ schema 有定義，runtime 未串接
    maxBudgetUsd?: number;      // ⚠️ schema 有定義，runtime 未串接
    delegation?: {              // ADR-022: 委派設定
      inbound?: boolean;
      outbound?: boolean;
    };
    initiative?: {              // ADR-023: 主動互動設定
      enabled?: boolean;
      mode?: 'work' | 'social';
      cooldown?: number;
      maxPerHour?: number;
    };
    idleMutter?: {              // 閒置獨白 per-agent 設定
      enabled?: boolean;        // 預設 true
      chance?: number;          // 觸發機率 0-1，預設 0.3
      maxPerHour?: number;      // 每小時上限，預設 3
    };
  };
}
```

> **Dashboard 設定管理**（ADR-027）：Dashboard Edit 頁面可管理上述大部分欄位，
> 但 `systemPrompt`、`systemPromptFile`、`allowedTools`、`disallowedTools` 不在 UI 中。
> `permissions.allow` 從 `settings.local.json` 讀寫，不在 agent.json。

### LoadedAgent

```typescript
interface LoadedAgent {
  id: string;           // 目錄名稱
  path: string;         // 完整路徑
  config: AgentConfig;
  systemPrompt: string; // 解析後的 prompt
}
```

### UserSession

```typescript
interface UserSession {
  sessionId: string;
  agentId: string;
  platform: string;
  userId: string;
  state: 'idle' | 'processing' | 'error';
  sdkSessionId?: string;  // SDK session ID for resume
  createdAt: Date;
  lastActiveAt: Date;
  processedMessageIds: Set<string>;
}
```

### UnifiedMessage

```typescript
interface UnifiedMessage {
  id: string;
  platform: string;
  userId: string;
  chatId: string;
  text: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
```

### Permission Types（v1.7.0）

```typescript
// 權限提示選項（Adapter 發送審批 UI 時使用）
interface PermissionPromptOptions {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  chatId: string;
}

// 權限提示結果（使用者按下按鈕後回傳）
interface PermissionPromptResult {
  messageId: number;  // 用於後續更新訊息狀態
}

// 權限解析回調（Adapter 呼叫以通知 PermissionBridge 使用者決定）
type PermissionResolver = (requestId: string, allowed: boolean) => void;
```
