# ClaudeCab Architecture Reference

> **Version**: 1.3.0 — 2026-04-29
> **Source of truth**: Code (`src/`). 本文件從 codebase 產出，非設計文件。

---

## 1. 系統概覽

ClaudeCab 是一個 Discord-only 的 AI 對話工作台，透過 Anthropic Claude Agent SDK 提供持久化會話。每個 Discord bot 對應一個 agent 設定（model、prompt、hooks、MCP tools），使用者在 Discord channel/thread 中與 agent 對話，系統負責 session 管理、prompt cache 維持、token 追蹤、排程任務執行、與可觀測性。

**核心特徵**：
- Discord 是唯一平台入口
- V2 persistent session 為主、V1 stateless query 為備援
- Prompt cache keepalive 保持 ~84% cache hit rate
- 每個 agent 獨立的 CLAUDE.md / hooks / MCP / model 設定
- SQLite 持久化（sessions、conversations、metrics、rate limits）
- YAML 驅動的排程系統（cron/interval/once）

---

## 2. 分層架構

```
┌─────────────────────────────────────────────┐
│  adapters/          平台層（Discord）         │
│  ├─ DiscordAdapter        訊息收發、thread    │
│  ├─ DiscordMessageHandler 訊息驗證、轉換      │
│  ├─ DiscordInteractionHandler 按鈕/slash     │
│  └─ services/       Dashboard、CostReport    │
├─────────────────────────────────────────────┤
│  conversation/      對話協調層               │
│  └─ ConversationPipeline  dedup→budget→      │
│                     guard→execute→deliver    │
├─────────────────────────────────────────────┤
│  core/              核心業務邏輯             │
│  ├─ MessageProcessor      統一訊息入口       │
│  ├─ QueryExecutor         SDK 查詢協調       │
│  ├─ SDKSessionManager     V2 持久化 session  │
│  ├─ SDKQueryManager       V1 無狀態查詢      │
│  ├─ SessionManager        使用者 session     │
│  ├─ SessionGuard          token/cache 守衛   │
│  ├─ InteractionHandler    權限/問答 bridge   │
│  └─ hooks/                Hook 定義          │
├─────────────────────────────────────────────┤
│  schedule/          排程系統                  │
│  ├─ ScheduleManager       YAML 載入/監視     │
│  ├─ CronScheduler         cron 排程          │
│  ├─ ScheduleExecutor      排程執行+重試      │
│  └─ ScheduleThreadMap     thread→session 映射│
├─────────────────────────────────────────────┤
│  services/          應用服務                  │
│  ├─ BudgetService         預算控制           │
│  ├─ OAuthUsageService     配額利用率         │
│  └─ KeepaliveROIService   cache ROI 計算     │
├─────────────────────────────────────────────┤
│  persistence/       資料層                    │
│  ├─ DatabaseManager       SQLite 連線/遷移   │
│  └─ *Repository           各 domain repo     │
├─────────────────────────────────────────────┤
│  types/             共享型別                  │
│  utils/             工具函式                  │
│  tools/             MCP 工具 (task/file/tts) │
└─────────────────────────────────────────────┘
```

**依賴方向**：adapters → core → services → persistence → types。types 不依賴任何上層。

---

## 3. 模組地圖

### 3.1 adapters/ — 平台層

| 檔案 | 行數 | 職責 |
|------|------|------|
| `BaseAdapter.ts` | 489 | adapter 基類：訊息發送、權限/問題/PlanMode 提示 |
| `DiscordAdapter.ts` | 1110 | Discord.js Client 管理、thread 操作、按鈕交互 |
| `discord/DiscordMessageHandler.ts` | 231 | 訊息驗證、安全檢查、附件下載、UnifiedMessage 轉換 |
| `discord/DiscordInteractionHandler.ts` | 301 | 按鈕點擊、slash command、modal 提交的路由 |
| `discord/DiscordSlashCommands.ts` | 1057 | /help /reset /stop /model /status /schedule 實現 |
| `discord/DiscordBootstrap.ts` | 310 | Discord 服務初始化（adapter、interaction、dashboard） |
| `discord/discordUtils.ts` | 89 | 訊息分割（2000 字限制）、thread 標題生成 |
| `discord/services/DiscordDashboard.ts` | 343 | #dashboard embed（agent 狀態、成本、任務） |
| `discord/services/DiscordCostReport.ts` | 159 | 每日成本報告 embed |
| `discord/services/DiscordActivityReporter.ts` | 67 | #system-log / #alerts 通知 |
| `discord/services/DiscordTaskSync.ts` | 196 | Discord Forum ↔ TaskService 同步 |

### 3.2 conversation/ — 對話協調

| 檔案 | 行數 | 職責 |
|------|------|------|
| `ConversationPipeline.ts` | 286 | 六階段對話管道協調（§4 詳述） |
| `types.ts` | 33 | `ConversationRequest` 型別定義 |

### 3.3 core/ — 核心邏輯

**訊息處理與 session**

| 檔案 | 行數 | 職責 |
|------|------|------|
| `MessageProcessor.ts` | 477 | 統一訊息入口、委派 ConversationPipeline |
| `SessionManager.ts` | 730 | 使用者 session 生命週期、JSONL 恢復、Mutex 鎖 |
| `SessionGuard.ts` | 187 | token 長度 / cache TTL / rate limit 守衛 |
| `PlatformOrchestrator.ts` | 330 | 啟動各 agent 的 adapter、連接訊息管道 |
| `AdapterRegistry.ts` | 184 | 按 agentId 的 adapter 全域 registry |
| `EventBus.ts` | 202 | 型別安全事件匯流排 |

**SDK 查詢執行**

| 檔案 | 行數 | 職責 |
|------|------|------|
| `QueryExecutor.ts` | 624 | V2 優先 / V1 備援查詢協調、重試、MCP 設定 |
| `SDKSessionManager.ts` | 473 | V2 persistent session 管理、keepalive |
| `SDKSessionFactory.ts` | 346 | session 建立：config 組裝、CLI 路徑、hook 設定 |
| `SDKStreamProcessor.ts` | 725 | V2 stream 處理：訊息分類、sub-agent、tool event |
| `SDKQueryManager.ts` | 627 | V1 stateless query、CLI 路徑、JSONL 清理 |
| `SDKKeepaliveManager.ts` | 325 | 4 分鐘 keepalive ping、ROI 計算、cache 效率 |
| `SDKContextRestore.ts` | 66 | 從 JSONL 恢復 per-turn context size |

**互動與回應**

| 檔案 | 行數 | 職責 |
|------|------|------|
| `InteractionHandler.ts` | 507 | permission / question / planMode 的 SDK↔adapter 協調 |
| `PermissionBridge.ts` | 149 | 權限決策 promise bridge（120s timeout） |
| `QuestionBridge.ts` | 147 | AskUserQuestion promise bridge |
| `ExitPlanModeBridge.ts` | 141 | PlanMode 退出 promise bridge |
| `StreamResponseRouter.ts` | 297 | streaming 回應路由：status / sub-agent / hook / final |
| `ResponseSender.ts` | 140 | 回應格式化、noise 過濾、adapter 遞送 |
| `StatusMessageManager.ts` | 223 | 工具事件追蹤、status message 去抖動（2s） |
| `SubAgentMessageManager.ts` | 226 | sub-agent task 可編輯訊息管理 |
| `HookMessageManager.ts` | 70 | hook 事件 `-# 🪝 Hook` subtitle 格式化 |

**Agent 載入**

| 檔案 | 行數 | 職責 |
|------|------|------|
| `AgentLoader.ts` | 675 | 掃描 agents/、載入 agent.json / hooks / MCP |
| `ConfigTransformer.ts` | 178 | agent.json → SDK options（model ID、permission mode） |

**輔助邏輯**

| 檔案 | 行數 | 職責 |
|------|------|------|
| `JsonlSanitizer.ts` | 224 | 防止 JSONL resume 時 readFileState diff 注入 |
| `QueryMetricsRecorder.ts` | 164 | 查詢後指標記錄 |
| `hooks/definitions.ts` | 150 | Hook 定義集中管理（§7 詳述） |

### 3.4 schedule/ — 排程系統

| 檔案 | 行數 | 職責 |
|------|------|------|
| `ScheduleManager.ts` | 438 | YAML 載入、chokidar 監視、cron 註冊 |
| `ScheduleLoader.ts` | 209 | agents/{id}/schedules/*.yaml 解析 |
| `CronScheduler.ts` | 304 | node-cron 排程、連續失敗 3 次自動暫停 |
| `ScheduleExecutor.ts` | 485 | 執行排程任務：thread 預建、重試、streaming delivery |
| `ScheduleNotifier.ts` | 252 | Discord thread 建立/通知傳送 |
| `ScheduleThreadMap.ts` | 66 | threadId → schedule session 記憶體映射 |
| `schemas.ts` | 127 | Zod schema：trigger / execution / output / metadata |
| `types.ts` | 105 | ScheduleSpec / ExecutionResult 型別 |

### 3.5 services/ — 應用服務

| 檔案 | 行數 | 職責 |
|------|------|------|
| `BudgetService.ts` | 193 | 按 agent 每月預算、80% 警告、超額暫停 |
| `OAuthUsageService.ts` | 82 | Anthropic OAuth API 5h/7d 配額利用率、60s cache |
| `KeepaliveROIService.ts` | 145 | keepalive ping ROI = actual cost vs hypothetical no-cache |
| `TaskService.ts` | 256 | 任務 CRUD + Discord Forum sync |
| `TTSService.ts` | 198 | TTS 生成、檔案管理、播放 |

### 3.6 persistence/ — 資料層

**Schema version**: 16（SQLite + WAL mode）

| Repository | 行數 | 資料表 | 核心操作 |
|-----------|------|-------|---------|
| `SessionRepository` | 217 | sessions | 使用者 session CRUD、soft-delete（is_active） |
| `ConversationRepository` | 101 | conversations | 對話歷史追加/查詢 |
| `QueryMetricsRepository` | 377 | query_metrics | token/cost 記錄、daily/weekly 統計、keepalive stats |
| `RateLimitRepository` | 154 | rate_limit_snapshots | OAuth 配額快照、趨勢、week-over-week 成長 |
| `ActivityRepository` | 193 | activity_events | 操作事件日誌 |
| `ExecutionRecordRepository` | 138 | execution_records | SDK 查詢審計（trigger / token / cost / status） |
| `TaskRecordRepository` | 255 | task_records | 任務記錄（SQLite + Discord Forum 雙層） |
| `ScheduleRepository` | 297 | schedule_executions | 排程執行記錄 |
| `GroupMessageRepository` | 123 | group_messages | 群組聊天歷史（multi-bot context） |
| `GroupMemberRepository` | 54 | group_members | 群組成員關聯 |
| `InjectionStateRepository` | 99 | injection_states | context 注入遊標 |

### 3.7 tools/ — MCP 工具

| 檔案 | 職責 |
|------|------|
| `taskTool.ts` | `create_task` MCP tool（建立任務 + Forum post） |
| `sendFileTool.ts` | `send_file` MCP tool（檔案→Discord，自動偵測類型） |
| `ttsTool.ts` | `speak` MCP tool（文字→語音→本地播放） |

---

## 4. 對話 Pipeline

使用者訊息的完整處理流程：

```
Discord messageCreate
  │
  ▼
DiscordAdapter.handleMessage()
  │  委派給 DiscordMessageHandler
  │  ├─ 驗證頻道/thread 權限
  │  ├─ 下載附件
  │  ├─ 安全驗證（prompt injection 偵測）
  │  ├─ 自動建立 thread（含 task/schedule thread 重寫）
  │  └─ 構建 UnifiedMessage
  │
  ▼
MessageProcessor.processMessage()
  │  委派給 ConversationPipeline
  │
  ▼
ConversationPipeline.run()  ← 六階段
  │
  ├─ A. Dedup 檢查
  │     isMessageProcessed() → 跳過重複
  │
  ├─ B. Budget 檢查
  │     budgetService.canQuery() → 超預算拒絕
  │
  ├─ C. Session 解析
  │     sessionManager.getOrCreateSession()
  │     支援 inheritedSdkSessionId（schedule thread 連接）
  │
  ├─ D. 加鎖執行 withLock()
  │     ├─ 第二層 dedup（防競態）
  │     ├─ 標記訊息已處理
  │     │
  │     ├─ E. SessionGuard 檢查
  │     │     ├─ Cache TTL 守衛：超過 cacheTTLMs → 提示重建
  │     │     ├─ Token 長度守衛：超過 tokenThreshold → 提示切換
  │     │     └─ Rate limit 守衛：OAuth 利用率 ≥80% → 警告
  │     │
  │     └─ F. 查詢執行
  │           executeQueryWithSDK()（見 §5）
  │
  ▼
回應遞送
  ├─ ResponseSender.sendFinalResponse()  → noise 過濾 → adapter 傳送
  ├─ 重送失敗的中間訊息
  ├─ 靜默失敗偵測 → fallback 訊息
  └─ deliverUsageSummary() → per-turn token/cost/ctx Discord subtext
```

---

## 5. SDK 整合

### 5.1 V2 Persistent Session（主路徑）

```
QueryExecutor.executeQueryWithSDK()
  │
  ├─ 啟動 typing indicator
  ├─ 構建 StatusMessageManager / SubAgentMessageManager / HookMessageManager
  ├─ 構建 MCP server 配置（McpToolSetup）
  │
  ▼
SDKSessionManager.executeQuery()
  │
  ├─ 無 session → SDKSessionFactory.createManagedSession()
  │     ├─ 組裝 config（model / permission / hooks / MCP / CLI path）
  │     ├─ 呼叫 SDK unstable_v2_createSession()
  │     └─ 回傳 ManagedSession（session handle + metadata）
  │
  ├─ 有 session → preDrainResidualMessages()
  │     排出上一輪殘留的 stream 訊息
  │
  ├─ session.send(prompt, { resume: sdkSessionId })
  │
  ├─ SDKStreamProcessor.processStream()
  │     ├─ 訊息分類：assistant / system / tool_use / tool_result / sub-agent
  │     ├─ 中間訊息 → StreamResponseRouter → adapter 即時遞送
  │     ├─ tool events → StatusMessageManager 更新
  │     ├─ sub-agent events → SubAgentMessageManager 更新
  │     ├─ hook events → HookMessageManager subtitle
  │     └─ 累計 token usage / context tokens
  │
  └─ SDKKeepaliveManager.startKeepalive()
        每 ~4 分鐘 ping 一次保持 prompt cache
        動態偵測 cache TTL → 自動調整 keepalive interval
```

**Cache 效率**：V2 持久化 session 保持 CLI 進程存活，prompt cache hit rate ~84%+。

### 5.2 V1 Stateless Query（備援）

當 V2 失敗（session error、首次查詢）時 fallback：

```
SDKQueryManager.executeQuery()
  └─ 建立新 CLI 進程 → SDK query() → 一次性查詢
     cache hit rate ~25%（每次重建 context）
```

### 5.3 Resume 失敗恢復

若 V2 resume 失敗（session 已過期），QueryExecutor 自動：
1. 清除 sdkSessionId
2. 以新對話重試（不帶 resume）

### 5.4 Context Size 追蹤

- `lastTurnContextTokens` = 上一輪 `inputTokens + cacheReadInputTokens + cacheCreationInputTokens`
- Session resume 時從 JSONL 恢復（`SDKContextRestore.restoreContextFromJsonl()`）
- SessionGuard 用此值做 threshold 檢查
- Discord usage summary 顯示 `ctx XXK (XX.X%)`

---

## 6. Session 管理

### 6.1 Session 生命週期

```
SessionManager.getOrCreateSession()
  │
  ├─ 查 DB：findByPlatformAgentAndUser()
  │   └─ 有 → 恢復（含 sdkSessionId）
  │
  └─ 無 → 建立新 session
       └─ 寫入 DB（state='idle', is_active=true）
```

**Session key**: `discord::${agentId}::${userId}`

**狀態機**: `idle` → `processing` → `idle` / `error`

**Soft-delete**: `is_active` flag，不做硬刪除。

### 6.2 Session Guard

三層檢查（`SessionGuard.checkSessionGuard()`）：

| 檢查 | 觸發條件 | 使用者動作 |
|------|---------|-----------|
| Cache TTL | 距上次查詢 > `cacheTTLMs`（預設 30 分鐘） | 選擇：繼續（cache 重建）或切換新 session |
| Token 長度 | context tokens > `tokenThreshold`（預設 300K） | 選擇：繼續或切換新 session |
| Rate limit | OAuth 5h 利用率 ≥ 80% | 警告訊息（不阻擋） |

**每輪觸發**：只要 `tokenCount >= threshold` 就會每輪彈出提示，沒有抑制機制。

**Resume Guard**：當 `ManagedSession` 不存在但 session 有 `sdkSessionId` 時（例如 process restart 後），SessionGuard 在 resume 前先讀取 JSONL 以估算 context 大小（`SDKContextRestore.restoreContextFromJsonl()`），然後執行 cache TTL 檢查。若超過閾值，向使用者提示是否確認重建 cache，防止在不知情下發生昂貴的 context rebuild。

### 6.3 併發控制

- `SessionManager.withLock()` — per-session Mutex，防止同一使用者的並行查詢競態
- Lock 內做第二層 dedup 檢查（防止 Discord replay 造成雙倍 token）

---

## 7. Hook 系統

### 7.1 四個 SDK Callback Hook

定義集中在 `core/hooks/definitions.ts`：

| Hook | 用途 | 行為 |
|------|------|------|
| `userPromptSubmit` | 查詢前檢查清單 | 強制 AI 執行 pre-response 檢查；短回覆（< 4 字元）自動跳過 |
| `preCompact` | Context 壓縮標記 | 在壓縮前注入標記 |
| `stop` | 兩階段品質審查 | Phase 0: 品質檢查 → Phase 1: 記憶反思。phases 長度控制何時真正停止。Phase 0 的 `block` 決定會隱藏 SDK stream 的原始 assistant message；修正：Phase 0 在 block 前先從 `input.last_assistant_message` 提取主回覆，透過 `onIntermediateMessage` 推送，避免 single-turn text-only 場景下主回覆消失 |
| `postToolUseBash` | Bash 指令錯誤偵測 | 偵測指令錯誤並記錄到 ERRORS.md |

### 7.2 Hook 載入機制

```
AgentLoader.loadHooks()
  ├─ 查找 agents/{id}/hooks.js（優先）或 hooks.ts
  ├─ pathToFileURL()（Windows 相容）
  ├─ 動態 import + cache busting（?t=${Date.now()}）
  └─ validateHooksExport()（比對 HOOK_EVENT_NAMES）
```

### 7.3 Hook 視覺化

`HookMessageManager` 將 hook 事件格式化為 Discord `-# 🪝 Hook - <name>: <message>` subtitle，即時顯示在對話中。

---

## 8. 互動系統

Permission / Question / PlanMode 三種互動共用同一套 Bridge + Registry 架構：

```
SDK callback（需要使用者決策）
  │
  ▼
InteractionHandler.buildCanUseTool()
  │  區分類型：permission / AskUserQuestion / ExitPlanMode
  │
  ├─ Permission:
  │   PermissionBridge.requestPermission()
  │     → adapter.sendPermissionPrompt()（Discord 按鈕）
  │     → Promise 等待（120s timeout → 自動拒絕）
  │     → 使用者按鈕 → bridge.resolvePermission()
  │
  ├─ Question:
  │   QuestionBridge.requestQuestion()
  │     → adapter.sendQuestionPrompt()（Discord 按鈕選項）
  │     → Promise 等待 → bridge.resolveQuestion()
  │
  └─ PlanMode:
      ExitPlanModeBridge.requestReview()
        → adapter.sendPlanReviewPrompt()
        → Promise 等待 → bridge.resolveReview()
```

**靜態 Registry**：每個 Bridge 型別有獨立的 static registry（`InteractionHandler.permissionRegistry` / `questionRegistry` / `exitPlanModeRegistry`），按 requestId 查詢。避免 SDK session 閉包捕獲的 InteractionHandler 過期問題。

---

## 9. 排程系統

### 9.1 YAML 驅動

排程定義在 `agents/{agentId}/schedules/{taskId}.yaml`，Zod schema 驗證。

**觸發類型**：
| 類型 | 語法 | 範例 |
|------|------|------|
| `cron` | 標準 cron 表達式 | `"0 3 * * *"`（每日 03:00） |
| `interval` | 毫秒間隔 | `3600000`（每小時） |
| `once` | ISO datetime | `"2026-05-01T09:00:00"`（一次性） |

**輸出模式**：`thread`（獨立 Discord thread）/ `message`（直接訊息）

**Delivery 模式**：`streaming`（即時推送）/ `summary`（完成後摘要）/ `last-only`（僅最後訊息）

### 9.2 執行流程

```
CronScheduler tick
  │
  ▼
ScheduleExecutor.execute()
  ├─ output.mode === 'thread' → ScheduleNotifier.createThread()
  ├─ 建立穩定 sessionId: "schedule:{spec.id}:thread"
  ├─ SDKQueryManager.executeQuery()（V1 路徑）
  ├─ onIntermediateMessage → ScheduleNotifier.sendToThread()
  ├─ 記錄 token metrics
  └─ ScheduleThreadMap.set(threadId, sessionMapping)
       → 允許使用者在 schedule thread 中繼續對話
```

**重試策略**：初始 5s / 最大 60s / backoff ×3。連續失敗 3 次自動暫停排程。

**Thread 接續**（兩段生命週期設計）：

1. **排程執行期**（ephemeral）：走 V1 stateless query，完成即結束。執行成功後預建一筆 session row（`continuation_source = 'schedule'`，`continuation_state = 'pending'`，`userId = schedule:thread:{threadId}`），包含排程的 `sdkSessionId`。同時寫入 `ScheduleThreadMap` 作為 in-memory cache。

2. **Thread 對話期**（persistent）：使用者第一次在 schedule thread 回覆時，`DiscordMessageHandler` 透過 DB-first resolver 找到預建的 session row，取得 `sdkSessionId`。`SessionManager.getOrCreateSession()` 從 DB 恢復該 session（含 `sdkSessionId`），V2 用此 ID resume。Resume 成功後將 `continuation_state` 更新為 `'active'`。`continuation_source` 現在為永久欄位（不再清除），後續對話仍可追溯排程來源。

3. **`findByScheduleThread`** 同時匹配 `continuation_state IN ('pending', 'active')` 兩種狀態，確保 process restart 後仍可找回 session continuity。

4. **Resume 失敗（`requireResume` 策略）**：`ExecuteQueryOptions` 新增 `requireResume` 旗標。當 schedule thread pending + resume 失敗時，回傳 typed error 而非靜默 fallback 到新對話，防止排程對話策略被繞過造成浪費。

---

## 10. 可觀測性

### 10.1 Per-turn Usage Summary

每次 AI 回應後，在 Discord 以 `-#` subtext 顯示：
- Token usage（input / output / cache read / cache creation）
- Cost estimate（USD）
- Context window 使用率（`ctx XXK (XX.X%)`）
- 5h / 7d rate limit utilization（來自 OAuth API）

**Context 顯示規則**：context size 只顯示真實的 API per-turn context tokens（`lastTurnContextTokens`），已移除基於 throughput/turns 的推算 fallback，避免顯示誤導性估值。`/ctx` 指令的 DB fallback 改用 `last_active_at`（非 `created_at`）。`sessions.created_at` 為不可變欄位，upsert 時不覆寫。

### 10.2 Keepalive & Cache

| 機制 | 位置 | 頻率 |
|------|------|------|
| Cache keepalive ping | `SDKKeepaliveManager` | ~4 分鐘（動態偵測 TTL 後自動調整） |
| Cache hit rate 追蹤 | `SDKStreamProcessor` | 每次查詢 |
| Cache anomaly alert | `SDKKeepaliveManager` | hit rate < 50% 時觸發 |
| Keepalive ROI | `KeepaliveROIService` | per-session 計算 actual vs hypothetical cost |

**Dynamic Cache TTL Detection**：從 API response 偵測實際 cache TTL（而非假設 5 分鐘），自動調整 keepalive interval 為 `detectedTTL × 0.8`。

### 10.3 OAuth Usage API

`OAuthUsageService` 從 `https://api.anthropic.com/api/oauth/usage` 拉取：
- 5 小時配額利用率
- 7 天配額利用率
- Token：讀取 `~/.claude/.credentials.json` 的 `claudeAiOauth.accessToken`
- 60 秒 TTL 記憶體 cache

### 10.4 Discord Dashboard

`DiscordDashboard`（每 15 分鐘更新）在 #dashboard channel 維護單一 embed：
- 各 Agent 狀態（online / paused）
- 今日 / 本月成本
- 活躍任務
- 最近活動

### 10.5 Cost Report

`DiscordCostReport` 在 #cost-report channel：
- 各 Agent 成本明細
- 進度條視覺化

### 10.6 事件系統

`EventType` 常數登錄簿（`utils/events.ts`）：~135 個事件類型，分類：
- `lifecycle.*` — startup / heartbeat / shutdown / crash
- `adapter.*` — init / start / message / discord_dashboard
- `message.*` — received / processing / duplicate / race / rejected
- `sdk.*` — cli / rate_limit / hook / keepalive
- `session.guard.*` — token_length / cache_ttl / switches
- `session.*` — created / restored / disposed / lock / dedup
- `schedule.*` — tick / fired / execution / watcher / budget_skip
- `budget.*` — exceeded / paused / resumed / report
- `cache.*` — efficiency_snapshot / keepalive / session_evicted

---

## 11. 持久化層

### 11.1 技術選型

- **引擎**：SQLite + better-sqlite3 + WAL mode
- **Schema version**：16
- **遷移**：`migrations.ts` 內 v1→v16 增量 SQL。`DatabaseManager` 執行遷移的順序為先跑 migrations **再** 執行 SCHEMA_SQL，避免既有 DB 在執行 SCHEMA_SQL 時因欄位尚未存在而報錯。

### 11.2 資料表

| 表 | 用途 | 關鍵欄位 |
|----|------|---------|
| `sessions` | 使用者 session | agent_id, user_id, state, sdk_session_id, is_active, continuation_source, continuation_state |
| `conversations` | 對話歷史 | session_id, role, content, sequence_number |
| `query_metrics` | token/cost 追蹤 | agent_id, sdk_session_id(nullable), input/output/cache tokens, cost_usd |
| `rate_limit_snapshots` | OAuth 配額快照 | sdk_session_id(nullable), utilization_pct, status, resets_at |
| `activity_events` | 操作事件日誌 | agent_id, type, phase, message |
| `execution_records` | SDK 查詢審計 | trigger, tokens, cost, status |
| `task_records` | 任務管理 | agent_id, status, cost, discord_thread_id |
| `group_messages` | 群組聊天歷史 | group_id, sender_agent_id, content |
| `group_members` | 群組成員 | group_id, agent_id |
| `injection_states` | context 注入遊標 | agent_id, group_id, cursor |
| `schedule_executions` | 排程執行記錄 | schedule_id, status, duration |

### 11.3 語意規則

- `sdk_session_id`：只寫真實的 SDK session ID，沒有時寫 `NULL`（不寫合成值）
- `continuation_source`：`'schedule'` 表示排程預建來源；一般 chat 為 `NULL`。此欄位為永久性，接手後不清除，保留排程追溯能力。
- `continuation_state`：排程交接生命週期——`'pending'`（已預建、等待使用者接手）→ `'active'`（接手成功）→ `NULL`（一般 chat）。`findByScheduleThread` 同時匹配 pending 和 active 兩態。v16 遷移新增此欄位。
- Sessions 使用 soft-delete（`is_active` flag），不做硬刪除
- 資料保留：`DB_RETENTION_MS`（預設 30 天）

---

## 12. 配置

### 12.1 環境變數

**Core**

| 變數 | 預設 | 說明 |
|------|------|------|
| `ENABLE_PERSISTENCE` | false | 啟用 SQLite 持久化 |
| `DB_PATH` | ./data/claudecab.db | 資料庫路徑 |
| `SESSION_TIMEOUT_MS` | 3600000 | session 過期（1h） |
| `MAX_SESSIONS` | 1000 | 最大 session 數 |
| `DB_RETENTION_MS` | 2592000000 | 資料保留（30d） |

**Session Guard**

| 變數 | 預設 | 說明 |
|------|------|------|
| `SESSION_GUARD_ENABLED` | true | 啟用 session guard |
| `SESSION_GUARD_TOKEN_THRESHOLD` | 300000 | token 長度閾值（300K） |
| `SESSION_GUARD_CACHE_TTL_MS` | 1800000 | cache TTL 守衛（30 分鐘） |

**Discord**

| 變數 | 預設 | 說明 |
|------|------|------|
| `DISCORD_ENABLED` | false | 啟用 Discord |
| `DISCORD_MAIN_BOT_TOKEN` | — | 主 bot token |
| `DISCORD_GUILD_ID` | — | Discord server ID |
| `DISCORD_CHANNEL_*` | — | 6 個 channel ID（dashboard / cost-report / system-log / alerts / tasks / general） |
| `DISCORD_DASHBOARD_UPDATE_MINUTES` | 15 | Dashboard 更新間隔 |
| `DISCORD_OWNER_USER_ID` | — | bot 擁有者 ID（optional） |

**Schedule / STT / TTS / Security / Audit** — 見 `src/config.ts`。

### 12.2 Agent 設定

每個 agent 在 `agents/{agentId}/` 下有：
- `agent.json` — model / permission mode / hooks / MCP / display metadata
- `CLAUDE.md` — agent 專屬系統提示（SDK 自動載入）
- `settings.local.json` — SDK 層設定（model source of truth）
- `hooks.js` / `hooks.ts` — callback hook 實現
- `.mcp.json` — MCP server 配置
- `schedules/*.yaml` — 排程任務定義

**Model 映射**（`ConfigTransformer.ts`）：
| 設定值 | SDK Model ID |
|--------|-------------|
| sonnet | claude-sonnet-4-6 |
| opus | claude-opus-4-6 |
| haiku | claude-haiku-4-5-20251001 |

---

## 13. 安全

| 機制 | 位置 | 說明 |
|------|------|------|
| 使用者白名單 | `ALLOWED_USERS` env | 逗號分隔的允許 user ID |
| 訊息長度限制 | `MAX_MESSAGE_LENGTH` env | 超過長度拒絕 |
| Prompt injection 偵測 | `utils/security.ts` | `PROMPT_INJECTION_DETECTION` 啟用時掃描 |
| 工作區隔離 | agent `.claude/settings.local.json` + `_foundation/workspace-policy.md` | `permissions.allow` 白名單 + `defaultMode` + workspace 政策 prompt 規則 + workspace validator MCP 工具 |
| Audit trail | `utils/audit.ts` | 所有使用者操作、授權事件、tool 呼叫記錄 |
| Secret redaction | `logger.ts` | token / apiKey / password / authorization 自動遮蔽 |
| 危險操作約束 | prompt 規則（`_example/.claude/rules/permissions.md`） | 「不可殺廣義 process（如全部 node）」等行為約束（prompt-level，非硬性 deny） |

---

## 14. 啟動流程

```
start.ts（進程監督）
  │  指數退避重啟：1s → 2s → 4s → 30s cap
  │  轉發 SIGINT/SIGTERM 給子進程
  │
  ▼
src/index.ts
  │  實例鎖（localhost:47823）防重複
  │  載入 .env
  │  全域錯誤處理（unhandledRejection / uncaughtException）
  │
  ▼
AppBootstrap.start()
  │
  ├─ 1. AgentLoader.scanAgents() + loadAllAgents()
  ├─ 2. DatabaseManager + 各 Repository 初始化
  ├─ 3. SessionManager 初始化 + 歷史 session 恢復
  ├─ 4. STT / TTS providers 初始化
  ├─ 5. BudgetService 建立
  ├─ 6. MessageProcessor 建立（注入所有依賴）
  ├─ 7. PlatformOrchestrator.startAll()（啟動 Discord adapters）
  ├─ 8. initializeScheduleSystem()（ScheduleLoader → CronScheduler → ScheduleExecutor）
  ├─ 9. DiscordBootstrap.initializeDiscordServices()
  │      （TaskService / Dashboard / CostReport）
  ├─ 10. MessageProcessor.wirePostInit()（注入 Discord-dependent 服務）
  └─ 11. ScheduleExecutor.wirePostInit()（注入 ThreadMap）
```

**Late Dependency Injection**：部分服務（TaskService）依賴 Discord adapter 初始化完成，因此在 `wirePostInit()` 階段注入，所有存取點有 null-check 保護。

---

## 15. 程式碼統計

| 目錄 | 檔案數 | 行數 | 佔比 |
|------|--------|------|------|
| core/ | ~35 | ~8,500 | 38% |
| adapters/ | ~15 | ~3,500 | 16% |
| persistence/ | ~14 | ~3,700 | 17% |
| schedule/ | ~9 | ~2,000 | 9% |
| utils/ | ~17 | ~2,000 | 9% |
| services/ | ~8 | ~1,200 | 5% |
| types/ | ~14 | ~1,300 | 6% |
| conversation/ | ~3 | ~320 | 1% |
| **Total** | **~146** | **~22,300** | |

---

## 16. Quality Gate

```bash
npm run quality-gate
```

五個 gate：
1. `tsc --noEmit` — 型別檢查
2. `npm run build` — 編譯
3. 殘留子系統掃描 — src/ 中不得出現 `Telegram` / `WebUI` / `Initiative` / `SocialHandler` / `Delegation` / `AgentCallService` / `GroupBroadcaster`
4. Session Guard 語意掃描 — 不得出現 `messageCountThreshold` / `message-count proxy`
5. `vitest run` — 全部測試（224 tests）
