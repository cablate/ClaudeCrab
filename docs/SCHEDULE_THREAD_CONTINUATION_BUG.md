# Bug：排程 Thread 無法延續對話

## 症狀

排程任務在 Discord 建立 thread 並完成 AI 查詢後，使用者在該 thread 中回覆，無法延續排程的對話 context。使用者看到的是全新對話，而非接續排程的結果繼續聊。

---

## 根本原因分析（已追蹤完整資料流）

### 問題 1：排程用 V1（stateless），使用者回覆用 V2（persistent）— JSONL 路徑不匹配

**排程執行路徑**：
- `ScheduleExecutor.ts:189` → 呼叫 `SDKQueryManager.executeQuery()`（V1 stateless）
- V1 使用的 sessionId = `"schedule:{spec.id}:thread"`（`ScheduleExecutor.ts:178`）
- V1 回傳 `result.sdkSessionId`（從 SDK stream 中 `message.session_id` 萃取，`SDKQueryManager.ts:371`）
- `ScheduleExecutor.ts:346-358` 將此 `sdkSessionId` 存入 `ScheduleThreadMap`

**使用者回覆路徑**：
- `DiscordMessageHandler.ts:193-200` → 從 `ScheduleThreadMap` 取出 `sdkSessionId`，設入 metadata `inheritedSdkSessionId`
- `ConversationPipeline.ts:96-101` → 傳給 `SessionManager.getOrCreateSession()`
- `SessionManager.ts:213` → 設為 session 的 `sdkSessionId`
- `QueryExecutor.ts:325` → 傳給 `SDKSessionManager.executeQuery()` 作為 `resume` 參數
- `SDKSessionManager.ts:88-91` → 找不到對應的 `ManagedSession`（因為排程走的是 V1，從沒建過 V2 session）→ 建立全新 V2 session

**V2 resume 需要 JSONL 檔案**：
- SDK 的 JSONL 路徑格式：`~/.claude/projects/{projectHash}/{sdkSessionId}.jsonl`
- `projectHash` 由 `agentCwd` 決定（`SDKContextRestore.ts:20`：`agentCwd.replace(/[^a-zA-Z0-9]/g, '-')`）
- 排程執行時的 `cwd = agent.path`（`ScheduleExecutor.ts:194`）
- 使用者回覆時的 `cwd` 也是 `agent.path`（`QueryExecutor.ts:216`）
- **cwd 相同，所以 projectHash 相同**。如果 V1 產出了 JSONL 且沒被清理，V2 resume 理論上能找到。

**但 V1 的 sessionId 與 sdkSessionId 不同**：
- V1 呼叫 SDK `query()` 時傳入的 sessionId = `"schedule:{spec.id}:thread"`
- SDK 內部產生的 sdkSessionId 是 UUID 格式（如 `abc123-def456...`）
- JSONL 檔名用的是 **sdkSessionId**（SDK 內部決定的 UUID）
- V2 resume 用的也是這個 sdkSessionId → 所以 JSONL 路徑應該能匹配

**實際風險**：V1 query 結束後 CLI process 退出，JSONL 是否被清理取決於 SDK 行為。若 JSONL 被保留，resume 應能成功。若 JSONL 被刪或損壞，resume 會靜默失敗。

### 問題 2（更根本）：userId 不一致 — 每次回覆都建新 session

**排程執行時**：
- `userId = 'system'`（`ScheduleExecutor.ts:289`）
- SessionManager 不會為排程建立 session（排程直接呼叫 `SDKQueryManager`，繞過 `SessionManager`）

**使用者回覆時**：
- `userId = 'schedule:thread:{threadId}'`（`DiscordMessageHandler.ts:197`）
- `SessionManager.getOrCreateSession()` 以 `(platform='discord', agentId, userId='schedule:thread:{threadId}')` 查詢
- DB 裡根本沒有對應的 session row → **每次都建立全新 session**
- 雖然 `inheritedSdkSessionId` 被正確設入新 session，但 `SDKSessionManager.sessions` map 裡沒有對應的 `ManagedSession`
- 結果：每次使用者回覆都走 `SDKSessionManager._createSession()`（建新 V2 session）→ 用 `resume: sdkSessionId` 嘗試恢復

**更嚴重的問題**：使用者的第二次回覆也是 `userId = 'schedule:thread:{threadId}`，所以第二次確實能找到第一次建的 session。但第一次回覆時 `setSdkSessionId()` 會用 V2 新 session 的 sdkSessionId 覆蓋掉原始排程的 sdkSessionId（`QueryExecutor.ts:373-374`），所以第二次之後的 resume 用的已經是 V2 自己的 sdkSessionId，不再是排程的。**第一次回覆是唯一有機會接續排程 context 的時刻**。

### 問題 3：排程不建 V2 session — keepalive 無法維持 cache

排程走 V1 stateless query，CLI process 查詢完就結束。沒有 V2 `ManagedSession`，沒有 keepalive ping。排程完成到使用者回覆之間，prompt cache 必然過期（通常 5 分鐘 TTL）。即使 JSONL resume 成功，也要重建整個 context cache。

---

## 涉及的關鍵檔案與行號

| 檔案 | 行號 | 角色 |
|------|------|------|
| `src/schedule/ScheduleExecutor.ts` | 178-180 | sessionId 建立（穩定 vs 隨機） |
| `src/schedule/ScheduleExecutor.ts` | 189 | 呼叫 V1 `SDKQueryManager.executeQuery()` |
| `src/schedule/ScheduleExecutor.ts` | 289 | `userId: 'system'` |
| `src/schedule/ScheduleExecutor.ts` | 346-358 | `ScheduleThreadMap.set()` 註冊映射 |
| `src/schedule/ScheduleThreadMap.ts` | 18-23 | `set()` 存儲映射 |
| `src/adapters/discord/DiscordMessageHandler.ts` | 193-200 | schedule thread 偵測 + `inheritedSdkSessionId` |
| `src/adapters/discord/DiscordMessageHandler.ts` | 197 | `userId = 'schedule:thread:{threadId}'` |
| `src/conversation/ConversationPipeline.ts` | 96-101 | 傳遞 `inheritedSdkSessionId` 給 SessionManager |
| `src/core/SessionManager.ts` | 179-217 | `getOrCreateSession()` — `inheritedSdkSessionId` 設入 session |
| `src/core/SessionManager.ts` | 184 | DB lookup 用 `(platform, agentId, userId)` |
| `src/core/QueryExecutor.ts` | 325 | `resume: internalSession.sdkSessionId` |
| `src/core/QueryExecutor.ts` | 373-374 | 查詢後 `setSdkSessionId()` 覆蓋為新的 |
| `src/core/SDKSessionManager.ts` | 88-91 | `sessions.get(sessionId)` → 找不到 → `_createSession()` |
| `src/core/SDKQueryManager.ts` | 371 | V1 stream 萃取 `sdkSessionId` |
| `src/core/SDKContextRestore.ts` | 20-21 | JSONL 路徑計算 |
| `src/core/JsonlSanitizer.ts` | 70-71 | JSONL 路徑計算（另一處） |

---

## 設計約束

1. **排程不能改成走 V2**：V2 每次 create 都 spawn CLI process，排程是一次性查詢，V2 overhead 不划算（排程可能用 cheap model、短 prompt）。
2. **ScheduleExecutor 不走 ConversationRequest/MessageProcessor**：這是 CODEXPLAN-V2 的明確設計決策 — thread 預建 + streaming delivery + custom retry 與 chat 完全不同。
3. **Session Guard 是 token-based**：不要引入 message-count proxy。
4. **sdk_session_id 語意規則**：只寫真實 SDK session ID，沒有就寫 `NULL`。

---

## 預期行為

使用者在排程 thread 中回覆時，AI 應該能「記得」排程剛才說了什麼，延續對話。具體來說：
1. 排程完成後，使用者在 thread 中回覆「你剛才提到的 X 是什麼意思？」
2. AI 應該知道「X」的上下文，給出延續性的回答
3. 後續多輪對話都應在同一個 context 中

---

## 可能的解法方向（供參考，不拘束）

- 排程完成後，是否該把 V1 的 sdkSessionId 轉為 V2 ManagedSession？（讓後續使用者回覆能在 V2 中 resume）
- 或者：排程的 thread mode 改用 V2 session？（只有 thread mode 需要，message mode 不需要）
- 或者：使用者回覆 schedule thread 時，先確認 JSONL 存在再 resume，不存在則明確告知而非靜默建新對話？
- userId 統一問題：schedule thread 的 userId 設計是否需要重新考慮？
