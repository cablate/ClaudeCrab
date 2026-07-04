# Schedule Thread Continuation Fix Plan

## 核心目標

修正 schedule thread continuation 問題，同時保留排程與正常對話的唯一差異：

- 排程執行階段結束後可以直接關閉，不需要 persistent session
- 但排程建立的 Discord thread，一旦使用者開始回覆，就必須能像正常對話一樣穩定延續 context
- 第一次回覆、第二次回覆、後續多輪，都必須落在同一條可延續對話鏈上
- 如果原始 schedule context 已不可恢復，系統必須明確報錯，不能靜默開新對話

---

## 白話設計

整體拆成兩段生命週期：

1. 排程執行期
- schedule 執行本身維持短命、一次性
- 使用 V1 / stateless query
- 執行完即可關閉
- 不建立長駐 V2 ManagedSession
- 不需要 keepalive

2. thread 對話期
- 當使用者第一次在該 schedule thread 回覆時，正式轉入正常 persistent chat 模式
- 後續所有回覆都應與一般正常對話一致
- 包含 session 延續、V2 resume、keepalive、timeout、reset 等既有行為

一句話總結：

schedule execution is ephemeral, but schedule thread conversation becomes a normal persistent conversation from the first user reply onward.

---

## ID 與 resume 對齊方式

要分清楚兩種 ID：

1. ClaudeCab session identity
- 使用 `userId = schedule:thread:{threadId}`
- 這是穩定的內部對話身份
- 作用是讓同一個 Discord thread 永遠找到同一筆 ClaudeCab session

2. SDK session identity
- 使用 `sdkSessionId`
- 這是 Claude SDK 真正拿來 `resume` 的 ID
- 不當作 ClaudeCab 主鍵，而是掛在 session 身上

固定資料鏈：

`threadId -> schedule:thread:{threadId} -> ClaudeCab session row -> stored sdkSessionId -> SDK resume`

這樣可以保證：
- 同一個 schedule thread 永遠對到同一筆 session
- 第一次回覆時能找到排程留下來的原始 `sdkSessionId`
- 第一次接成功後，後續可更新為新的 V2 `sdkSessionId`
- 但 session identity 不變，不會漂移

---

## 要修改的核心行為

### 1. 排程完成時預先建立 thread 對話身份

在 schedule thread 建立成功、schedule query 成功後：

- 立刻建立一筆 ClaudeCab session row
- `platform = discord`
- `agentId = schedule 對應 agent`
- `userId = schedule:thread:{threadId}`
- `sdkSessionId = 本次 schedule 執行回傳的 sdkSessionId`

這筆 session row 的作用是：
- 讓第一次使用者回覆時，不需要靠臨時 bridge 才知道要接哪條對話
- 讓 thread continuation 在重啟後仍然成立

---

### 2. 新增 schedule thread continuation 狀態

session 需要有明確 continuation state，至少包含：

- `schedule_pending`
  - 表示排程已經產出 thread 與 sdkSessionId
  - 但第一次使用者 handoff 尚未成功

- `active`
  - 表示第一次使用者回覆已成功接回 schedule context
  - 之後這個 thread 就與一般 persistent chat 無異

普通聊天可視為：
- `normal`

---

### 3. 第一次使用者回覆的處理規則

當使用者在 schedule thread 第一次回覆時：

- 先用 `threadId` 導出 `userId = schedule:thread:{threadId}`
- 用這個固定 userId 找到預先建立的 session row
- 從該 session row 取出原始 `sdkSessionId`
- 用這個 `sdkSessionId` 做 V2 `resume`

如果 resume 成功：
- 將 session continuation state 從 `schedule_pending` 轉成 `active`
- 後續所有對話都按正常 persistent chat 處理
- 後續新的 V2 `sdkSessionId` 可更新回同一筆 session row

---

### 4. resume 失敗時的規則

如果第一次 schedule handoff 時發現：

- JSONL 不存在
- JSONL 損壞
- Claude SDK resume 找不到原始 session
- 其他使原始排程上下文不可恢復的錯誤

則應：

- 明確通知使用者 schedule context 恢復失敗
- 停止這次回覆
- 不自動新開對話
- 不靜默 fallback
- session 保持在 `schedule_pending` 或等價失敗狀態，避免誤以為已成功轉正

這是目前已決定的產品行為。

---

## 對現有設計的修正方向

### 1. 不再把 `inheritedSdkSessionId` 當主要 continuity 機制

現況問題是：
- schedule 執行沒有正式建立對話 session
- 第一次回覆時才臨時塞 `inheritedSdkSessionId`
- 容易造成第一次接不穩、第二次被覆蓋

修正後：
- `inheritedSdkSessionId` 不再是主要方案
- 主要方案改為「thread 建立時先建正式 session row」

---

### 2. `ScheduleThreadMap` 不再是唯一真相來源

`ScheduleThreadMap` 可以保留，但只能當：

- in-memory cache
- thread metadata 輔助索引
- 非權威加速器

不能再依賴它作為唯一 continuity source，因為：
- process restart 後會消失
- 不足以保證 post-restart continuation correctness

真正權威來源應是 persisted session row。

---

### 3. `output.persistSession` 對 thread mode 不再作為控制開關

目前 `persistSession` 名稱容易混淆「排程執行是否 persistent」和「thread 後續是否可延續」。

新的語意應明確分離：

- 排程執行期：永遠可關閉，不需 persistent
- thread 對話期：永遠必須可延續

因此：
- `thread` mode 下，follow-up continuity 應視為固定行為
- 舊欄位可保留解析相容，但 runtime 不應再讓它關閉 thread continuity
- 必要時記錄 deprecation warning

---

## 預期修正後的使用者體驗

情境：

1. schedule 在 Discord 建立 thread 並貼出 AI 結果
2. 使用者回覆：「你剛剛提到的 X 是什麼意思？」
3. AI 必須知道 X 是什麼，能延續前文回答
4. 使用者再問第二輪、第三輪，context 仍在
5. 整段 thread 行為與正常 persistent chat 一致

但同時：
- 排程任務跑完時 backend 不需要長駐該 session
- 只有真的有人開始在 thread 裡聊，才進入正常 persistent conversation lifecycle

---

---

## 實作細節（基於 codebase 驗證）

### Step 1：DB migration v15 — 新增 `continuation_source` 欄位

在 `sessions` 表新增欄位，不擴展既有 `state` 狀態機（避免汙染 `idle | processing | error` 語意）：

```sql
ALTER TABLE sessions ADD COLUMN continuation_source TEXT DEFAULT NULL;
-- 'schedule' = 排程預建、等待使用者接手
-- NULL = 一般 chat session
```

**修改檔案**：
- `src/persistence/migrations.ts` — 新增 v14→v15 migration
- `src/persistence/types.ts` — `SessionRow` 加 `continuation_source?: string | null`
- `src/types/session.ts` — `UserSession` 加 `continuationSource?: 'schedule' | null`

### Step 2：ScheduleExecutor 預建 session row

**目前狀況**：`ScheduleExecutor` 沒有注入 `SessionManager` 或 `SessionRepository`。

**修改**：
- `src/schedule/ScheduleExecutor.ts` — constructor 新增 `sessionRepository: ISessionRepository` 依賴
- `src/schedule/ScheduleBootstrap.ts` — 傳入 `sessionRepository`
- `src/app/AppBootstrap.ts` — 在 `initializeScheduleSystem()` 時傳入

**預建時機**：`ScheduleExecutor.ts:346-358`（現有 `ScheduleThreadMap.set()` 處），在同一個 `if` block 內加：

```typescript
// 在 threadMap.set() 之後
sessionRepository.save({
  session_id: uuidv4(),
  platform: 'discord',
  agent_id: agentId,
  user_id: `schedule:thread:${thread.threadId}`,
  state: 'idle',
  sdk_session_id: result.sdkSessionId,
  is_active: true,
  continuation_source: 'schedule',
  created_at: new Date().toISOString(),
  last_active_at: new Date().toISOString(),
});
```

### Step 3：thread mode 永遠用穩定 sessionId

**修改**：`src/schedule/ScheduleExecutor.ts:178`

目前 `shouldPersistSession` 由 YAML 的 `output.persistSession` 控制。改為：thread mode 下固定為穩定 sessionId，`persistSession` flag 在 thread mode 下忽略。

```typescript
const isThreadMode = spec.output?.mode === 'thread';
const sessionId = isThreadMode
  ? `schedule:${spec.id}:thread`
  : `schedule:${spec.id}:${randomUUID()}`;
```

### Step 4：DiscordMessageHandler schedule thread resolver 改查 DB

**目前**：`DiscordMessageHandler.ts:193-200` 透過 `ctx.scheduleThreadResolver()` 查 in-memory `ScheduleThreadMap`。

**修改方向**：resolver 改為 DB-first，ScheduleThreadMap 降為 cache：

- `src/core/PlatformOrchestrator.ts:314-320` — resolver 改為先查 `ScheduleThreadMap`（快），miss 時 fallback 查 `SessionRepository.findByPlatformAgentAndUser('discord', agentId, 'schedule:thread:{threadId}')`
- 但 resolver 不知道 `agentId`，只有 `threadId`。需要新增 `SessionRepository.findByScheduleThread(threadId)` — 查 `continuation_source = 'schedule' AND user_id = 'schedule:thread:{threadId}'`

**新增**：
- `src/persistence/SessionRepository.ts` — `findByScheduleThread(threadId: string): SessionRow | undefined`
- `src/persistence/types.ts` — 介面加此方法

### Step 5：resume 失敗時明確報錯

**目前**：`QueryExecutor.ts:346-356` resume 失敗時自動清掉 sdkSessionId 並重試新對話。

**修改**：在 schedule thread（`continuationSource === 'schedule'` 且尚未成功接手）的情況下，resume 失敗不 fallback：

```typescript
if (internalSession.sdkSessionId !== undefined && isResumeError) {
  if (internalSession.continuationSource === 'schedule') {
    // Schedule thread 第一次接手失敗 — 明確報錯，不靜默開新對話
    await adapter.sendFormattedMessage(chatId,
      '❌ 無法恢復排程對話的上下文。原始 session 可能已過期或損壞。請重新執行排程任務。'
    );
    return '';
  }
  // 一般 chat — 既有 fallback 行為
  // ...
}
```

**成功接手後**：`QueryExecutor.ts:373` 更新 sdkSessionId 時，同時清除 `continuationSource`：

```typescript
if (result.sdkSessionId && result.sdkSessionId !== internalSession.sdkSessionId) {
  sessionManager.setSdkSessionId(platform, agentId, userId, result.sdkSessionId);
  if (internalSession.continuationSource === 'schedule') {
    sessionManager.clearContinuationSource(platform, agentId, userId);
  }
}
```

### Step 6：移除 `inheritedSdkSessionId` 對 schedule thread 的依賴

Step 4 讓 schedule thread 的 session row 已預先存在 DB，所以 `SessionManager.getOrCreateSession()` 能直接從 DB 找到該 session（含 sdkSessionId）。

`DiscordMessageHandler.ts:196` 的 `inheritedSdkSessionId = resolved.sdkSessionId` 可以保留作為 defense-in-depth，但不再是主要 continuity 機制。主鏈是 `threadId → userId → DB session row → sdkSessionId`。

### Step 7：啟動時 ScheduleThreadMap rehydration（可選）

如果保留 ScheduleThreadMap 作為 cache，啟動時從 DB 查 `continuation_source = 'schedule'` 的 session rows，回填 map。或者直接讓 resolver 每次查 DB（SQLite WAL 讀取很快），省掉 rehydration 複雜度。

**建議**：先用 DB-direct 查詢，不做 rehydration。效能有問題再加 cache。

---

## 實作順序

| # | 任務 | 涉及檔案 | 依賴 |
|---|------|---------|------|
| 1 | DB migration v15 + type 擴展 | migrations.ts, persistence/types.ts, types/session.ts | — |
| 2 | SessionRepository.findByScheduleThread() | SessionRepository.ts | Step 1 |
| 3 | ScheduleExecutor 預建 session row | ScheduleExecutor.ts, ScheduleBootstrap.ts, AppBootstrap.ts | Step 1, 2 |
| 4 | Thread mode 永遠穩定 sessionId | ScheduleExecutor.ts | — |
| 5 | Schedule thread resolver 改查 DB | PlatformOrchestrator.ts | Step 2 |
| 6 | Resume 失敗明確報錯 + 成功清除 continuationSource | QueryExecutor.ts, SessionManager.ts | Step 1 |
| 7 | 測試 | tests/ | Step 1-6 |

---

## 測試重點

1. schedule thread 建立後，系統會預先建立對應 session row
2. schedule 執行本身不建立 V2 ManagedSession
3. 第一次使用者回覆時，能正確從 `threadId` 找到 session row 與 `sdkSessionId`
4. 第一次 resume 成功後，`continuationSource` 被清除，session 行為與一般 chat 一致
5. 第二次之後回覆能穩定延續，不再依賴 bridge
6. 若第一次 resume 失敗，系統會明確報錯且停止，不會偷偷新開對話
7. process restart 後，schedule thread 仍可藉由 persisted session row 找回 continuity
8. 一般 chat、task thread、message mode schedule 行為不受影響
