# 成本控管比對

## Paperclip: Budget + Cost Events

### 架構
- **核心檔案**: `server/src/services/costs.ts`（204 行）
- **Schema**: `cost_events`、`agents.spentMonthlyCents`、`companies.budgetMonthlyCents`
- **單位**: Integer cents（整數分，避免浮點精度問題）

### 預算模型
```
Company Level:  budgetMonthlyCents / spentMonthlyCents
Agent Level:    budgetMonthlyCents / spentMonthlyCents
```

兩級預算控制：公司總預算 + 個別 agent 預算。

### Cost Event Schema
```typescript
costEvents = {
  id: uuid,
  companyId: uuid,        // 公司隔離
  agentId: uuid,          // 哪個 agent 花的
  issueId: uuid?,         // 花在哪個 issue 上
  projectId: uuid?,       // 花在哪個 project 上
  goalId: uuid?,          // 花在哪個 goal 上
  billingCode: text?,     // 自訂分類碼
  provider: text,         // "anthropic", "openai" 等
  model: text,            // 具體模型
  inputTokens: integer,
  outputTokens: integer,
  costCents: integer,     // ← 整數分！
  occurredAt: timestamp,
}
```

### 預算執行（Hard Stop）
```typescript
// createEvent() 內的關鍵邏輯：
// 1. 記錄 cost_event
// 2. 原子性更新 agent.spentMonthlyCents
// 3. 原子性更新 company.spentMonthlyCents
// 4. 檢查是否超預算 → 自動 pause agent

if (
  updatedAgent.budgetMonthlyCents > 0 &&
  updatedAgent.spentMonthlyCents >= updatedAgent.budgetMonthlyCents &&
  updatedAgent.status !== "paused" &&
  updatedAgent.status !== "terminated"
) {
  await db.update(agents).set({ status: "paused" });
}
```

**這是 post-execution 檢查**，不是 pre-execution 閘門。意味著：
- Agent 可能在最後一次執行中稍微超支
- 但下次 heartbeat 將不會啟動（status = paused）

### 設計問題
- `spentMonthlyCents` 名字暗示「月度」，但**實際是累計值**（沒有月度重置邏輯）
- 需要手動或排程重置 `spentMonthlyCents = 0`
- Cost 歸因精確到 issue/project/goal 級別（三維度歸因）

### Cost 查詢 API
- `summary(companyId)` — 公司級 cost 摘要 + utilization%
- `byAgent(companyId)` — 按 agent 分組（含 API/subscription 分類）
- `byProject(companyId)` — 按 project 分組（透過 activity_log 關聯）

### Billing Type 區分
```typescript
type AdapterBillingType = "api" | "subscription" | "unknown";
```
- **api**: 按 token 計費（如 Claude API）
- **subscription**: 包月制（如 Cursor Pro），只追蹤 token 數但不計費
- **unknown**: 無法判斷

---

## ClaudeCab: QueryMetricsRepository

### 架構
- **核心檔案**: `src/persistence/QueryMetricsRepository.ts`（267 行）
- **Schema**: `query_metrics` 表（SQLite）
- **單位**: Float USD（`totalCostUsd: number`）

### Metrics Schema
```typescript
query_metrics = {
  id: autoincrement,
  agent_id: text,
  platform: text,        // "telegram", "schedule" 等
  chat_id: text,
  user_id: text,
  input_tokens: integer,
  output_tokens: integer,
  cache_read_tokens: integer,
  cache_creation_tokens: integer,
  total_cost_usd: real,  // ← 浮點 USD
  num_turns: integer,
  duration_ms: integer,
  created_at: text,
}
```

### 查詢 API
- `getAgentStats(agentId)` — 單 agent 全時間統計
- `getAgentStatsSince(agentId, since)` — 時段統計
- `getAllAgentStats()` — 所有 agent 統計
- `getDailyStats(agentId, days)` — 每日趨勢
- `getRecentQueries(limit, offset, agentId?)` — 最近查詢明細

### 缺少的部分
- ❌ 沒有預算設定（budget）
- ❌ 沒有自動暫停機制
- ❌ 沒有 per-issue/per-task 的 cost 歸因
- ❌ 沒有 cache token 成本計算
- ✅ 有 cache_read_tokens / cache_creation_tokens 追蹤

---

## 比對分析

| 面向 | Paperclip | ClaudeCab |
|------|-----------|-----------|
| **成本單位** | Integer cents（精確） | Float USD（有精度風險） |
| **預算設定** | ✅ Agent + Company 兩級 | ❌ 無 |
| **自動暫停** | ✅ 超預算自動 pause | ❌ 無 |
| **Cost 歸因** | Issue + Project + Goal 三維度 | Agent + Platform 兩維度 |
| **Billing 分類** | api / subscription / unknown | 無區分 |
| **Cache 追蹤** | 無（只追蹤 input/output） | ✅ cache_read + cache_creation |
| **存儲** | PostgreSQL（UUID PK） | SQLite（autoincrement PK） |
| **月度重置** | 需手動（設計缺陷） | N/A（無預算概念） |
| **索引策略** | 複合索引（company+agent+time） | 無特殊索引 |

## 值得借鑑

### 🔴 P0：Budget Hard Stop
- 為每個 agent 設定 `budgetMonthlyCents`
- 在 SDK query 完成後檢查是否超預算
- 超預算自動停止該 agent 的排程和回應
- **落地方式**: 在 `QueryMetricsRepository.record()` 後加 budget 檢查邏輯

### 🟡 P1：Integer Cents 而非 Float USD
- 改用整數分為成本單位，避免浮點累計誤差
- 0.01 USD = 1 cent，精度足夠

### 🟡 P1：Cost 歸因到 Task 層級
- 排程任務的 cost 記錄可以關聯到 schedule ID
- Agent-call 的 cost 可以關聯到觸發來源

### 🟢 P2：Billing Type 區分
- 區分 API 計費 vs 訂閱制，讓 cost dashboard 更精確
