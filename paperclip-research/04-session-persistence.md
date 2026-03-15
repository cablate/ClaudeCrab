# Session 持久化比對

## Paperclip: 三層 Session 模型

### 架構概覽
```
Layer 1: agent_runtime_state     — 全域 agent 狀態（1 per agent）
Layer 2: agent_task_sessions     — 任務級 session（1 per agent+task）
Layer 3: heartbeat_runs          — 不可變執行記錄（N per agent）
```

### Layer 1: Agent Runtime State
```typescript
agent_runtime_state = {
  agentId: uuid (PK),      // 1:1 對應 agent
  companyId: uuid,
  adapterType: text,
  sessionId: text?,         // Legacy：舊的 session ID
  stateJson: jsonb,         // 通用狀態存儲
  lastRunId: uuid?,
  lastRunStatus: text?,
  totalInputTokens: bigint, // 累計 input tokens
  totalOutputTokens: bigint,
  totalCachedInputTokens: bigint,
  totalCostCents: bigint,   // 累計成本
  lastError: text?,
}
```
**用途**: Agent 的「全域記憶」。不管做什麼任務，都保存在這裡。

### Layer 2: Agent Task Sessions
```typescript
agent_task_sessions = {
  id: uuid,
  companyId: uuid,
  agentId: uuid,
  adapterType: text,
  taskKey: text,                // 任務識別鍵（通常是 issueId）
  sessionParamsJson: jsonb,     // Adapter-specific session params
  sessionDisplayId: text?,      // 人類可讀的 session ID
  lastRunId: uuid?,
  lastError: text?,
}
// UNIQUE: (companyId, agentId, adapterType, taskKey)
```
**用途**: 讓 agent 在處理同一個 issue 時能延續之前的 session（context）。切換到不同 issue 時載入對應的 session。

### Layer 3: Heartbeat Runs
```typescript
heartbeat_runs = {
  id: uuid,
  companyId: uuid,
  agentId: uuid,
  invocationSource: text,       // "timer" | "assignment" | "on_demand" | "automation"
  triggerDetail: text?,
  status: text,                 // "queued" | "running" | "completed" | "failed"
  sessionIdBefore: text?,       // 執行前的 session ID
  sessionIdAfter: text?,        // 執行後的 session ID
  contextSnapshot: jsonb?,      // 完整的執行 context 快照
  usageJson: jsonb?,            // Token usage、cost、billing type
  resultJson: jsonb?,           // 執行結果摘要
  logStore: text?,              // Log 存儲位置
  logRef: text?,                // Log 引用 ID
  logBytes: bigint?,
  logSha256: text?,             // Log 完整性校驗
  stdoutExcerpt: text?,
  stderrExcerpt: text?,
  exitCode: integer?,
  signal: text?,
  error: text?,
  errorCode: text?,
}
```
**用途**: 不可變的執行審計記錄。每次 heartbeat 執行都留下完整記錄。

### Session Codec Pattern
每個 adapter 實作自己的 `AdapterSessionCodec`：
```typescript
interface AdapterSessionCodec {
  deserialize(raw: unknown): Record<string, unknown> | null;
  serialize(params: Record<string, unknown> | null): Record<string, unknown> | null;
  getDisplayId?(params: Record<string, unknown> | null): string | null;
}
```
- Claude adapter 序列化 Claude Code 的 session ID
- Codex adapter 序列化 Codex 的 thread ID
- Cursor adapter 序列化 Cursor 的 workspace state

### Session 切換邏輯
```
Wake for Issue A → 查 task_sessions 找 Issue A 的 session → resume
Wake for Issue B → 查 task_sessions 找 Issue B 的 session → resume
Timer Wake      → reset session（全新開始）
Manual Wake     → reset session
```

---

## ClaudeCab: SessionManager

### 架構概覽
```
單層模型: sessions 表 — 1 session per (platform, agentId, userId)
```

### Session Key
```typescript
sessionKey = `${platform}::${agentId}::${userId}`
```
- 一個使用者跟一個 agent 在一個平台上只有一個 session
- 沒有 task-level 的 session 區分

### Session State
```typescript
SessionRow = {
  session_id: string,         // UUID
  agent_id: string,
  platform: string,
  user_id: string,
  state: string,              // "active" | "expired"
  sdk_session_id: string?,    // Claude SDK session ID（可 resume）
  processed_message_ids: string, // JSON array
  created_at: string,
  last_active_at: string,
}
```

### 並行控制
- 使用 `async-mutex` 的 Mutex per session
- 防止同一 session 的多個訊息並行處理

### Session Resume
- `sdk_session_id` 保存 Claude SDK 的 session ID
- 下次對話時用 `sdkSessionId` 參數 resume
- 有 TTL 機制：超時後 session 自動 expire

### Schedule 模式
- `ScheduleExecutor` 每次都建立 fresh session（`persistSession: false`）
- 不延續之前的 context

---

## 比對分析

| 面向 | Paperclip | ClaudeCab |
|------|-----------|-----------|
| **Session 層級** | 三層（global + task + run） | 單層（per user-agent-platform） |
| **Task 隔離** | ✅ taskKey-based session | ❌ 所有對話共用同一 session |
| **Audit Trail** | ✅ 不可變 heartbeat_runs | 部分（query_metrics） |
| **Session 序列化** | Adapter-specific codec | 直接存 SDK session ID |
| **Session Resume** | taskKey → params → adapter resume | SDK session ID resume |
| **Context Snapshot** | ✅ 每次 run 都快照 context | ❌ 無 |
| **並行控制** | 三層 lock | Mutex per session |
| **Log 保存** | ✅ 完整 stdout/stderr + SHA256 | ❌ 無 |
| **Schedule Session** | 可選 resume 或 fresh | 永遠 fresh |

## 值得借鑑

### 🔴 P0：Execution Audit Log
- 每次 SDK query 記錄 `sessionIdBefore` / `sessionIdAfter`
- 保存 `contextSnapshot`（觸發原因、task ID、prompt 摘要）
- 讓「這次 agent 為什麼做了這件事」可追溯

### 🟡 P1：Task-level Session
- 當 agent 處理多個不同任務時，可以為每個任務保存獨立的 session
- 切換任務時載入對應的 Claude SDK session ID
- **落地方式**: 擴充 `sessions` 表加 `task_key` 欄位，or 新增 `task_sessions` 表

### 🟢 P2：Session Codec 抽象
- 目前 ClaudeCab 直接存 `sdk_session_id`（字串）
- 如果未來支援多個 LLM backend，codec pattern 提供更好的抽象
- 但目前 ClaudeCab 只用 Claude SDK，不急需
