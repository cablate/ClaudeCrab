# Heartbeat 排程系統比對

## Paperclip: Heartbeat 系統

### 概述
- **核心檔案**: `server/src/services/heartbeat.ts`（2599 行）
- **模式**: Polling-based heartbeat — agent 定時「打卡」執行任務
- **哲學**: "If it can receive a heartbeat, it's hired."

### 執行流程
1. **Wakeup Request** → 建立 `agent_wakeup_requests` 記錄（含 source、reason、payload）
2. **Queued Run** → 建立 `heartbeat_runs` 記錄（status: queued）
3. **Concurrency Check** → 檢查是否超過 `maxConcurrentRuns`（預設 1，上限 10）
4. **Agent Start Lock** → `withAgentStartLock()` 使用 in-memory Promise chain 防止同 agent 並行啟動
5. **DB Atomic Claim** → SQL WHERE 條件式搶佔（status = queued → running）
6. **Session Resolution** → 根據 taskKey 查找 `agent_task_sessions` 取得 session state
7. **Workspace Resolution** → 從 project_workspaces 或 agent home 取得工作目錄
8. **Adapter Execution** → 呼叫對應 adapter 的 `execute()` 方法
9. **Post-execution** → 記錄 usage、更新 session state、寫入 cost_events

### 三層並行控制
| 層級 | 機制 | 目的 |
|------|------|------|
| L1 | `startLocksByAgent` Map | 防止同 agent 並行啟動（in-memory） |
| L2 | SQL WHERE atomic claim | 防止分散式環境下的 double-claim（DB 層） |
| L3 | `activeRunExecutions` Set | Runtime 追蹤目前正在執行的 run |

### Wakeup Sources
```typescript
source: "timer" | "assignment" | "on_demand" | "automation"
triggerDetail: "manual" | "ping" | "callback" | "system"
```

### Session Reset 邏輯
- `issue_assigned` → 重置 session（新任務需要全新 context）
- `timer` → 重置 session（定時任務不延續上次）
- `on_demand` + `manual` → 重置 session

### Stale Run Adoption
當系統重啟時，之前 status = "running" 的 run 會被識別為 stale，系統會嘗試 adopt 並完成它們，而非直接標記失敗。

---

## ClaudeCab: ScheduleExecutor

### 概述
- **核心檔案**: `src/schedule/ScheduleExecutor.ts`（231 行）
- **模式**: Event-driven + cron schedule — 使用 cron expression 觸發
- **哲學**: 排程是 chat 互動的延伸，不是獨立系統

### 執行流程
1. **Cron Trigger** → ScheduleManager 根據 YAML 定義的 cron expression 觸發
2. **Agent Load** → `agentLoader.loadAgent(agentId)` 載入 agent 設定
3. **Fresh Session** → 每次 run 都建立全新 session（`persistSession: false`）
4. **SDK Query** → 透過 `sdkManager.executeQuery()` 執行
5. **Retry** → 5 次重試，backoff 5s → 15s → 45s → 60s → 60s
6. **Notification** → 完成後透過 Telegram 通知使用者
7. **Metrics** → 記錄到 `query_metrics` 表

### Retry 策略
```typescript
const SCHEDULE_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 3,
  jitterFactor: 0.2,
  isRetryable: () => true, // 排程任務值得重試所有錯誤
};
```

---

## 比對分析

| 面向 | Paperclip | ClaudeCab |
|------|-----------|-----------|
| **規模** | 2599 行，企業級 | 231 行，精簡實用 |
| **觸發方式** | Polling heartbeat + event wakeup | Cron expression |
| **並行控制** | 三層（memory + DB + runtime） | 無（每次 fresh session） |
| **Session 延續** | 根據 taskKey 找回之前的 session | 永遠 fresh session |
| **Crash Recovery** | Stale run adoption | 依賴 retry 機制 |
| **多 Agent 排程** | 原生支援（maxConcurrentRuns） | 每個 agent 獨立排程 |
| **Context 傳遞** | contextSnapshot（JSON 快照）| prompt + systemPrompt |
| **觸發粒度** | 任務級（per-issue wakeup） | 排程級（per-schedule） |
| **Cost 追蹤** | 執行後即時記錄 cost_events | 執行後記錄 query_metrics |
| **Workspace** | 動態解析（project workspace → agent home fallback） | 固定 agent.path |

## 值得借鑑

1. **Context Snapshot** — 每次 run 帶完整 context JSON，可追溯「為什麼執行」
2. **Stale Run Recovery** — 系統重啟後自動接管未完成的 run
3. **Task-level Wakeup** — 不只是定時觸發，也支援事件驅動（issue 指派、@提及）
4. **Concurrent Run Limit** — 可控制同 agent 最大並行數，防止資源耗盡
