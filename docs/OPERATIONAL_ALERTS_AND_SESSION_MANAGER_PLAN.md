# PLAN: Operational Alerts + Session Manager + Resume Guard Fix

**Created**: 2026-04-29
**Status**: Reviewed & Revised
**Scope**: 3 features — 即時營運可見性、資源管理、成本防護。

---

## 問題陳述

1. **營運盲區**：重要事件（silent failure、zombie session、cache bust、高成本 query）只寫 log file，owner 必須手動讀 log 才知道出事。
2. **資源累積**：V2 persistent session 的 CLI process 常駐背景，用久了佔記憶體，沒有簡易方式列出/清理。
3. **Resume 成本盲區**：SessionGuard 的設計目的是「在使用者付出成本之前攔住」，但 session 被 close 後 resume 時 ManagedSession 不存在，guard 完全跳過。這恰恰是最該擋的場景 — cache 可能已過期，rebuild 成本最高。

---

## Phase 0: 前置 — 擴展 OperationalEventType（所有 Feature 的 unblock 前提）

`OperationalEvent.type` 受 `OperationalEventType` union 限制（`src/types/activity.ts:25-35`），目前只有 10 個 type。Feature A 的 16 個事件大多需要新 type，不先擴展會導致 `tsc --noEmit` 失敗。

### 改動

**`src/types/activity.ts`** — 擴展 `OperationalEventType`：
```typescript
export type OperationalEventType =
  // existing
  | 'chat.received' | 'chat.responded'
  | 'schedule.started' | 'schedule.completed' | 'schedule.failed'
  | 'budget.warning' | 'budget.exceeded'
  | 'task.created' | 'task.completed'
  | 'error.occurred'
  // Feature A new types
  | 'session.silent_failure'
  | 'session.delivery_failed'
  | 'session.zombie_recovered'
  | 'session.resume_empty'
  | 'session.resume_lost'
  | 'session.error'
  | 'session.guard_timeout'
  | 'session.guard_switch'
  | 'session.cache_bust'
  | 'session.high_cost'
  | 'session.rate_limit'
  | 'session.keepalive_failed'
  | 'schedule.auto_paused'
  | 'system.adapter_failed'
  | 'system.message_error';
```

**`src/services/ActivityEventService.ts`** — 更新 `EVENT_EMOJI` map：
```typescript
'session.silent_failure': '🔇',
'session.delivery_failed': '📭',
'session.zombie_recovered': '🧟',
'session.resume_empty': '🔄',
'session.resume_lost': '💔',
'session.error': '💥',
'session.guard_timeout': '⏳',
'session.guard_switch': '🔀',
'session.cache_bust': '💸',
'session.high_cost': '🔥',
'session.rate_limit': '🚦',
'session.keepalive_failed': '💀',
'schedule.auto_paused': '⏸️',
'system.adapter_failed': '🔌',
'system.message_error': '🚨',
```

### 驗收
- `npm run quality-gate` 通過（tsc 不報 type error）

---

## Feature A: Operational Alerts → #alerts Channel

### 設計原則

`ActivityEventService.log()` 的 `level: 'warn' | 'error'` 已自動路由到 #alerts（via `DiscordActivityReporter.sendAlert`，`src/adapters/discord/services/DiscordActivityReporter.ts:44-66`）。只需在關鍵事件點加 `.log()` 呼叫。

### Phase A1: 已有 activityEventService 的地方（直接加）

| # | 事件 | 觸發點 | type | level |
|---|------|-------|------|-------|
| A3 | **Zombie session → 自動重建** | `SDKSessionManager.ts` — zombie detection block（`wallClockMs <= 50 && !result.usage`）| `session.zombie_recovered` | `warn` |
| A4 | **Resume empty → fresh retry** | `SDKSessionManager.ts` — `if (options.resume && !hasOutput && managed.messageCount === 1)` | `session.resume_empty` | `warn` |
| A5 | **V2 session error** | `SDKSessionManager.ts` — catch block in `executeQuery` | `session.error` | `error` |
| A6 | **Guard timeout** | `ConversationPipeline.ts` — `if (guardResult === 'timeout')` | `session.guard_timeout` | `warn` |
| A7 | **Guard switch** | `ConversationPipeline.ts` — `if (guardResult === 'switch')` | `session.guard_switch` | `warn` |
| A8 | **Resume lost** | `SDKSessionManager.ts` — `freshResult.resumeLost = true` 之後 | `session.resume_lost` | `warn` |
| A16 | **Message processing error** | `ConversationPipeline.ts` — catch block | `system.message_error` | `error` |

**SDKSessionManager 取得 activityEventService 的方式**：已有 setter `setActivityEventService()`（用於 keepalive cache miss alerts），直接用 `this.activityEventService?.log(...)` 即可。

**實作約束**：
- ✅ `this.activityEventService?.log({ type: '...', agentId: agent.id, message: '...', level: 'warn' })`
- ❌ 不要在 alert message 裡放完整 error stack（太長，Discord embed 有字數限制 1024）
- ❌ 不要給 A6/A7 設 `level: 'error'`，它們是使用者主動行為或自然超時，不是系統錯誤

### Phase A2: 需要穿透 activityEventService 的地方

| # | 事件 | 觸發點 | 穿透路徑 | type | level |
|---|------|-------|---------|------|-------|
| A1 | **Silent failure** | `StreamResponseRouter.ts` — `deliverFinalResponse` 函式內 silent failure 偵測 | `QueryExecutor.executeQueryWithSDK` 已有 `activityEventService` → 傳入 `deliverFinalResponse` 參數 | `session.silent_failure` | `error` |
| A2 | **訊息發送失敗** | `ResponseSender.ts` — `sendFinalResponse` 回傳 `undefined` 且 response 非空非 noise | 同上，從 `deliverFinalResponse` 傳入 `sendFinalResponse` | `session.delivery_failed` | `warn` |
| A12 | **Keepalive failed** | `SDKKeepaliveManager.ts` — catch block in keepalive timer | `startKeepalive` 和 `adjustKeepaliveInterval` 函式已接收多個參數，加一個 `activityEventService?: IActivityEventService` | `session.keepalive_failed` | `warn` |

**穿透改動清單**：

1. `deliverFinalResponse` 函式簽名加 `activityEventService?: IActivityEventService`
2. `sendFinalResponse` 函式簽名加 `activityEventService?: IActivityEventService`（只在 silent failure/delivery failure 時用）
3. `QueryExecutor.ts` 呼叫 `deliverFinalResponse` 時傳入
4. `startKeepalive` 和 `adjustKeepaliveInterval` 函式簽名加 `activityEventService` 參數
5. `SDKSessionManager._createSession` 和 keepalive 啟動時傳入

### Phase A3: 成本/營運 alerts

| # | 事件 | 觸發點 | type | level | 備註 |
|---|------|-------|------|-------|------|
| A9 | **Cache bust** | `SDKKeepaliveManager.ts:updateCacheEfficiency` — `cacheEfficiencyAvg < 50` 且 `messageCount > 2` | `session.cache_bust` | `warn` | 已有 `logger.warn`，加 `activityEventService.log` |
| A10 | **高成本 query** | `QueryMetricsRecorder.ts` — 記錄後判斷 `totalCostUsd > HIGH_COST_THRESHOLD` | `session.high_cost` | `warn` | 閾值用 env `HIGH_COST_ALERT_THRESHOLD`，預設 `5`（USD） |
| A11 | **Rate limit** | `SDKSessionManager.executeQuery` — 從 `result` 的 `rate_limit_event` 判斷，不需穿透到 StreamProcessor | `session.rate_limit` | `warn` | 只推 `status !== 'allowed'` 的事件 |

**配置**：
- `HIGH_COST_ALERT_THRESHOLD`：env variable，預設 5（USD），加到 `src/config.ts`
- Cache bust 閾值（< 50%）：已有常數 `CACHE_EFFICIENCY_WARN_THRESHOLD = 50`

### Phase A4: 系統健康 alerts

| # | 事件 | 觸發點 | type | level | 備註 |
|---|------|-------|------|-------|------|
| A13 | **排程執行失敗** | `ScheduleExecutor.ts` | `schedule.failed` | `error` | **已有** `activityEventService.log`，確認 level 是 error |
| A14 | **排程自動暫停** | `CronScheduler.ts` — `onAutoPause` callback | `schedule.auto_paused` | `warn` | `onAutoPause` callback 從 `ScheduleBootstrap` 注入，在 callback 內呼叫 `activityEventService.log`。注意：`ScheduleNotifier` 已有 Discord 通知，但那走的是獨立 channel（不是 #alerts），需要在 callback 內額外推 |
| A15 | **Adapter 啟動失敗** | `PlatformOrchestrator.ts:95` | `system.adapter_failed` | `error` | PlatformOrchestrator 沒有 `activityEventService`，但它的 caller `AppBootstrap` 有。用 try/catch 在 `AppBootstrap` 層推 alert |

### 驗收
- 所有 P0 事件觸發後 #alerts 收到 embed
- `npm run quality-gate` 通過
- 更新 `tests/unit/SessionGuard.test.ts` 若有 interface 改動

---

## Feature B: `/sessions` 指令 — V2 Session Manager UI

### 功能

Discord slash command `/sessions`，列出所有活躍的 V2 persistent sessions，提供個別/批次關閉。

**與 `/cache status` 的關係**：不合併。`/cache status` 是 aggregate health snapshot（整體命中率、session 數量），`/sessions` 是 per-session 管理工具（個別資訊 + 操作按鈕）。兩者並存。

### 顯示內容（Discord Embed）

```
🖥️ V2 Sessions（5 個活躍）

┌─ coder · thread:1490717585732534414
│  ctx: 310K / 1M (31%) · cache: 99%
│  last query: 15 min ago · age: 2.7h · msgs: 12
│  cost: $4.82 · sdkSession: 457695f2
│  [❌ 關閉]
│
├─ general · thread:1498382558147117188
│  ctx: 215K / 1M (21.5%) · cache: 100%
│  last query: 3 min ago · age: 7h · msgs: 6
│  cost: $1.37 · sdkSession: b58ba1d1
│  [❌ 關閉]
│
...

[🗑️ 全部關閉]  [🧹 關閉閒置 >1h]
```

### 資料來源

**`SDKSessionManager`**（`sessions` 是 `private`，需透過新公開方法 `getSessionSummaries()`）：
- `sdkSessionId`, `createdAt`, `lastUsedAt`, `messageCount`
- `lastTurnContextTokens`, `contextWindowSize`, `cacheEfficiencyAvg`
- `prevUsage.totalCostUsd` — 注意：這是累計吞吐量快照，代表此 session 的累計總成本
- `lastQueryAt`（最後使用者 query 時間，不含 keepalive）
- `isQuerying`（是否正在執行）

**agentId / chatId 的取得**：`SDKSessionManager` 不知道 `agentId/chatId`（它只用 `sessionId` 作 key）。sessionId 格式為 platform-derived composite key，但沒有 parse 回 agentId/chatId 的方法。
解法：在 slash command handler 內，用 `deps.sessionManager.getAllSessions()` 拿到所有 `UserSession`（含 `agentId`, `chatId` 等），對 `UserSession.sessionId` 做 join。`getSessionSummaries()` 只回傳 SDK-side 資料，caller 負責 join。

### 新增 API

```typescript
// SDKSessionManager 新方法（只回傳 SDK-side 資料，不含 agentId/chatId）
getSessionSummaries(): SDKSessionSummary[]

interface SDKSessionSummary {
  sessionId: string;
  sdkSessionId: string;
  createdAt: number;
  lastQueryAt: number;
  lastUsedAt: number;
  messageCount: number;
  contextTokens: number | undefined;
  contextWindowSize: number | undefined;
  cacheEfficiencyAvg: number | undefined;
  totalCostUsd: number;
  isQuerying: boolean;
}
```

Caller（slash command handler）join `SessionManager.getAllSessions()` 取得 `agentId`, `platform`, `userId`（含 chatId 資訊）。

### 按鈕互動

- `customId = "sess:close:{sessionId}"` — 個別關閉
  - 若 `isQuerying === true`，回覆 ephemeral「⚠️ 此 session 正在查詢中，請稍後再試」，不強制終止
  - 否則 `destroySession(sessionId)`，保留 sdkSessionId，更新 embed
- `customId = "sess:closeall"` — 全部關閉
  - 跳過 `isQuerying === true` 的 session
  - 回覆已關閉 N 個、跳過 M 個正在查詢
- `customId = "sess:closeidle"` — 關閉閒置 >1h
  - `lastQueryAt < Date.now() - 3600000` 且 `!isQuerying` 的 session

### 按鈕 timeout

參考 `DiscordInteractionHandler.scheduleReviewTimeout()` pattern（24h 後 disable 按鈕）。`/sessions` embed 設 5 分鐘 timeout（session 列表會快速過時），timeout 後移除所有按鈕。

### 按鈕路由

在 `DiscordInteractionHandler.handleButton` 加 `sess:` prefix routing，跟現有 `review:` 同層級。需注入 `sdkSessionManager` 到 handler（或透過 `SlashCommandDependencies` 共享）。

### 實作位置

| 檔案 | 改動 |
|------|------|
| `src/core/SDKSessionManager.ts` | 新增 `getSessionSummaries(): SDKSessionSummary[]` |
| `src/adapters/discord/DiscordSlashCommands.ts` | 新增 `/sessions` command definition + `handleSessions()` handler |
| `src/adapters/discord/DiscordInteractionHandler.ts` | 新增 `sess:` 按鈕路由 + 5 分鐘 timeout |

### 實作約束
- ✅ Embed field 數量有 Discord 限制（max 25 fields），session 數超過時用 pagination 或截斷
- ✅ 只有 admin（`DISCORD_OWNER_USER_ID`）可操作，跟 `/cache flush` 同 gate
- ❌ 不要直接存取 `SDKSessionManager.sessions`（private），用 `getSessionSummaries()`
- ❌ closeall 不要強制終止 `isQuerying` 的 session

### 驗收
- `/sessions` 顯示正確的 session 列表
- 個別關閉、全部關閉、閒置關閉按鈕都正常運作
- 正在查詢的 session 不會被強制關閉
- 5 分鐘後按鈕自動消失

---

## Feature C: Resume Guard Fix — 在付出成本之前攔住

### 問題

SessionGuard 在 ConversationPipeline 檢查時，resume 場景的 ManagedSession 還不存在（在 `executeQuery` → `_createSession` 內才建立）。Guard 永遠跳過。而 `_createSession` 內的 JSONL restore 是 fire-and-forget（`import(...).then(...)`，沒有 await），context 資訊在 guard 檢查時完全不可用。

### 流程分析

```
Current（有缺陷）:
  ConversationPipeline.process()
    → checkSessionGuard()          // ManagedSession 不存在 → tokenCount = null → skip
    → queryExecutor.execute()
      → sdkSessionManager.executeQuery()
        → _createSession(resume)   // 這裡才建 ManagedSession
        → JSONL restore (fire-and-forget import().then())
        → send() + processStream() // 已經在付錢了
```

### 修復方案

在 `checkSessionGuard` 中，如果 ManagedSession 不存在但 session 有 `sdkSessionId`（代表之前 close 過、要 resume），就 **await `restoreContextFromJsonl`** 取得 context size 做判斷。

```
Fixed:
  ConversationPipeline.process()
    → checkSessionGuard()
      → tokenCount = sdkSessionManager.getSessionTokenCount(sessionId)
      → if null AND session.sdkSessionId exists:
        → tokenCount = await restoreContextFromJsonl(sdkSessionId, agentCwd)  // async, 需 await
        → 用 tokenCount 判斷 guard
    → queryExecutor.execute()  // guard 已攔過
```

### `agentCwd` 的取得路徑

`restoreContextFromJsonl(sdkSessionId, agentCwd)` 需要 `agentCwd`（agent 的 working directory，用來算 JSONL 的 projectHash）。

**問題**：`ConversationPipeline` 和 `SessionGuard` 都沒有 `agentCwd`。這個資訊在 `agent.path`（LoadedAgent），由 `AgentLoader` 管理。

**方案**：在 `ConversationPipeline.runLocked` 中，從 `deps.agentLoader` 取得 agent config 的 `path`，傳入 `checkSessionGuard`。

改動鏈：
1. `ConversationPipelineDeps` 加 `agentLoader: AgentLoader`
2. `ConversationPipeline.runLocked` 用 `deps.agentLoader.getAgent(agentId)?.path` 取得 `agentCwd`
3. `SessionGuardDeps` 加 `agentCwd?: string`
4. `checkSessionGuard` 用 `agentCwd` 呼叫 `restoreContextFromJsonl`

### `sdkSessionId` 的取得

`UserSession` 已有 `sdkSessionId?: string` 公開欄位（`src/types/session.ts:35`）。Guard 已接收 `session: UserSession`，直接用 `session.sdkSessionId` 即可，不需要新增 method。

### 實作細節

**`src/core/SessionGuard.ts`** — `checkSessionGuard` 修改：

```typescript
let tokenCount = sdkSessionManager.getSessionTokenCount(session.sessionId);
let lastActivityAt = sdkSessionManager.getSessionLastActivityAt(session.sessionId);

// Resume guard: ManagedSession 不存在但有 sdkSessionId → 從 JSONL 讀 context
if (tokenCount === null && session.sdkSessionId && deps.agentCwd) {
  try {
    const { restoreContextFromJsonl } = await import('./SDKContextRestore.js');
    tokenCount = await restoreContextFromJsonl(session.sdkSessionId, deps.agentCwd);
  } catch { /* I/O 錯誤 → 視為無資料，不阻擋 */ }

  // cache TTL: 沒有 lastActivityAt 時，用 JSONL 的檔案修改時間估算
  if (lastActivityAt === null && tokenCount !== null) {
    // JSONL 存在代表之前有 session，但我們不知道閒置多久
    // 保守做法：視為 cache 已過期（idle > cacheTTLMs）
    lastActivityAt = 0; // 觸發 cache TTL guard
  }
}
```

### 邊界情況

| 場景 | 行為 |
|------|------|
| JSONL 不存在（首次使用或被清理） | `restoreContextFromJsonl` 回傳 `null` → guard 不觸發 → 正常 |
| JSONL 存在但 context 很小（< threshold） | guard 不觸發 → 正常 |
| JSONL 存在且 context > threshold | token guard 觸發 → 使用者選 Continue/Switch/Timeout |
| `restoreContextFromJsonl` 讀取失敗（I/O error） | catch 吞掉 → `tokenCount` 保持 `null` → guard 不觸發 → 正常（寧可放行也不要阻塞） |
| 兩個訊息同時到達 | 都會讀 JSONL、都會觸發 guard。第一個 guard 回應後第二個的 guard 可能已經 timeout。ConversationPipeline 已有 per-session lock（`runLocked`），所以同一 session 不會並發。 |

### 測試影響

`tests/unit/SessionGuard.test.ts` — `SessionGuardDeps` 改動（加 `agentCwd`）會影響現有 mock 構造。需要：
1. Mock 的 deps 加 `agentCwd: '/mock/path'`
2. 新增測試 case：「resume 場景 — JSONL 有 context > threshold → guard 觸發」
3. 新增測試 case：「resume 場景 — JSONL 不存在 → guard 不觸發」

### 實作位置

| 檔案 | 改動 |
|------|------|
| `src/core/SessionGuard.ts` | `SessionGuardDeps` 加 `agentCwd?: string`；`checkSessionGuard` 加 JSONL fallback |
| `src/conversation/ConversationPipeline.ts` | deps 加 `agentLoader`；`runLocked` 傳 `agentCwd` 到 guard |
| `tests/unit/SessionGuard.test.ts` | 更新 mock + 新增 resume guard tests |

### 實作約束
- ✅ `restoreContextFromJsonl` 是 async function，必須 `await`（不是同步）
- ✅ I/O 錯誤必須 catch 住，不能讓一次磁碟問題阻塞所有訊息
- ❌ 不要在 guard 內建立 ManagedSession（那是 SDKSessionManager 的職責）
- ❌ 不要 import AgentLoader type 到 SessionGuard（只傳 `agentCwd: string`，保持解耦）

---

## 實作順序

```
Phase 0 → A1 → C → A2 → B
```

| Phase | 範圍 | 估計 | 前置條件 |
|-------|------|------|---------|
| **Phase 0** | `OperationalEventType` 擴展 + `EVENT_EMOJI` | 10 min | 無 |
| **Phase A1** | P0 alerts（A3-A8, A16）— 已有 activityEventService 的地方 | 1-2h | Phase 0 |
| **Feature C** | Resume Guard Fix + tests | 2-3h | Phase 0（需要新 event type for guard timeout/switch alerts if combined with A1） |
| **Phase A2** | P0 穿透（A1/A2）+ P1（A9-A12）+ P2（A13-A16） | 2-4h | Phase 0, A1 |
| **Feature B** | `/sessions` command + UI + 按鈕 | 4-6h | Phase 0 |

Feature C 排在 A1 之後，因為 A1 加了 guard timeout/switch alerts，C 的 guard 改動可以直接享用。

---

## ADR: 不做的事

| 決策 | 理由 |
|------|------|
| **不合併 `/sessions` 和 `/cache status`** | `/cache status` 是 aggregate snapshot，`/sessions` 是 per-session 管理工具，用途不同 |
| **不用 EventBus 做 alert routing** | 現有 `activityEventService.log()` 已經是正確的 alert routing 機制，用 EventBus 是過度抽象 |
| **不做 baseline 減法**（SessionGuard 的 tokenCount 仍用 raw context） | 目前觸發點（300K）對大多數 agent 合理。per-agent baseline 差異大（68K~530K），做精確減法需要額外儲存 baseline，複雜度不值得。未來若需要再考慮 |
| **closeall 不強制終止 isQuerying 的 session** | 避免 response 半殘留，寧可跳過正在查詢的 session |
| **不計算記憶體佔用** | Node.js 無法精確測量單個 child process 記憶體，顯示假數字比不顯示更糟 |

---

## 已知相關文件

| 檔案 | 角色 |
|------|------|
| `src/types/activity.ts` | `OperationalEventType` union（Phase 0 改動） |
| `src/services/ActivityEventService.ts` | Alert routing + `EVENT_EMOJI`（Phase 0 改動） |
| `src/core/SessionGuard.ts` | Guard 邏輯（Feature C 改動） |
| `src/core/SDKSessionManager.ts` | Session 生命週期（A1 + B 改動） |
| `src/core/SDKContextRestore.ts` | JSONL context restore（Feature C 使用） |
| `src/core/StreamResponseRouter.ts` | Silent failure 偵測（A2 穿透改動） |
| `src/core/ResponseSender.ts` | 訊息發送（A2 穿透改動） |
| `src/core/SDKKeepaliveManager.ts` | Keepalive（A2 穿透改動） |
| `src/core/QueryExecutor.ts` | Query 執行（A2 穿透起點） |
| `src/core/QueryMetricsRecorder.ts` | 成本記錄（A10 改動） |
| `src/conversation/ConversationPipeline.ts` | Guard 呼叫點（A1 + C 改動） |
| `src/adapters/discord/DiscordSlashCommands.ts` | Slash commands（B 改動） |
| `src/adapters/discord/DiscordInteractionHandler.ts` | 按鈕路由（B 改動） |
| `src/adapters/discord/services/DiscordActivityReporter.ts` | Discord alert embed 實作 |
| `src/config.ts` | 新增 `HIGH_COST_ALERT_THRESHOLD` config |
| `tests/unit/SessionGuard.test.ts` | Guard 測試（C 需更新） |
| `docs/ARCHITECTURE.md` | 架構文件（全部完成後更新） |
