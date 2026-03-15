# 借鑑清單 & 落地規劃

> 從 Paperclip 萃取的可落地設計，按優先級排序

---

## 🔴 P0：Budget Hard Stop（預算硬控）

### 為什麼
- ClaudeCab 有 token/cost 追蹤（QueryMetricsRepository）但**沒有預算上限**
- 一個排程跑瘋了可能燒掉幾十美元才被發現
- Paperclip 的 auto-pause 是最值得抄的功能

### 設計概念
```
Agent Config (YAML):
  budgetDaily: 500      # cents (= $5.00)
  budgetMonthly: 5000   # cents (= $50.00)

Runtime:
  每次 SDK query 完成後 →
    查 query_metrics 計算今日/月累計 →
    超過 budget → 標記 agent 為 paused →
    paused agent 不回應對話、不執行排程 →
    通知使用者
```

### 改動範圍
| 檔案 | 改動 |
|------|------|
| `types/agent.ts` | 新增 `budgetDailyCents?` / `budgetMonthlyCents?` |
| `config.yml` | Agent 設定新增 budget 欄位 |
| `QueryMetricsRepository` | 新增 `getCostSince(agentId, since)` 方法 |
| `MessageProcessor` | Query 後呼叫 budget check |
| `ScheduleExecutor` | 執行前 + 執行後 budget check |
| `PlatformOrchestrator` | 加入 paused agent 跳過邏輯 |

### 預估複雜度：🟡 中（2-3 小時）
- 核心邏輯簡單（比較兩個數字）
- 但需要改動多個入口點

---

## 🔴 P0：Execution Audit Log（執行審計記錄）

### 為什麼
- ClaudeCab 目前只有 query_metrics（數字）和 Pino log（非結構化）
- 無法回答「agent 在 3/13 凌晨做了什麼？為什麼？」
- Paperclip 的 heartbeat_runs + contextSnapshot 提供完整追溯能力

### 設計概念
```typescript
// 新增 execution_records 表
execution_records = {
  id: text (UUID),
  agent_id: text,
  trigger_type: text,       // "chat" | "schedule" | "agent_call"
  trigger_source: text,     // schedule ID, calling agent ID, user ID
  prompt_summary: text,     // 前 200 字的 prompt 摘要
  response_summary: text,   // 前 200 字的回應摘要
  sdk_session_id_before: text?,
  sdk_session_id_after: text?,
  input_tokens: integer,
  output_tokens: integer,
  total_cost_usd: real,
  duration_ms: integer,
  status: text,             // "success" | "error" | "timeout"
  error_message: text?,
  created_at: text,
}
```

### 改動範圍
| 檔案 | 改動 |
|------|------|
| `persistence/types.ts` | 新增 ExecutionRecordRow interface |
| `persistence/DatabaseManager.ts` | 新增 CREATE TABLE |
| `persistence/ExecutionRecordRepository.ts` | 新增 repository |
| `MessageProcessor` | Query 前後記錄 execution |
| `ScheduleExecutor` | 執行前後記錄 execution |
| `AgentCallService` | Agent call 記錄 execution |

### 預估複雜度：🟡 中（2-3 小時）

---

## 🟡 P1：Integer Cents 成本單位

### 為什麼
- 浮點數累加有精度問題（0.1 + 0.2 ≠ 0.3）
- Paperclip 用 integer cents 是業界最佳實踐（Stripe 也是這樣做的）
- 長期累計後誤差會變明顯

### 設計概念
- `total_cost_usd: real` → `total_cost_cents: integer`
- 所有 cost 計算用 cents，只在顯示時除以 100
- 現有資料可以 `ROUND(total_cost_usd * 100)` 遷移

### 改動範圍
| 檔案 | 改動 |
|------|------|
| `persistence/types.ts` | costUsd → costCents |
| `QueryMetricsRepository` | 所有 cost 相關 SQL |
| `ScheduleExecutor` | cost 記錄改用 cents |
| `MessageProcessor` | cost 記錄改用 cents |

### 預估複雜度：🟢 低（1 小時）
- 純粹的單位轉換，邏輯不變

---

## 🟡 P1：Cost Summary 增強

### 為什麼
- 目前 QueryMetricsRepository 有 `getDailyStats` 等 API
- 但沒有方便的 Telegram 指令來查看
- Paperclip 的 by-agent / by-project / utilization% 很實用

### 設計概念
Admin agent 的新指令（或自動日報）：
```
📊 成本日報 (2026-03-14)
──────────────
coder:    $2.34 (47 queries)
writer:   $1.12 (23 queries)
general:  $0.56 (12 queries)
──────────────
合計:     $4.02
月累計:   $45.67 / $100.00 (45.7%)
```

### 改動範圍
- Admin agent 的排程 prompt 中加入 cost 查詢指令
- 或新增 MCP tool 讓 agent 查詢 cost summary

### 預估複雜度：🟢 低（1 小時）
- QueryMetricsRepository 的 API 已經夠用

---

## 🟡 P1：Agent Call Depth Tracking

### 為什麼
- Agent A call B call C call A = 無限迴圈
- Paperclip 用 `requestDepth` 追蹤委派深度
- ClaudeCab 的 agent-call 目前有 cycle detection 嗎？

### 設計概念
```typescript
// AgentCallService
const MAX_CALL_DEPTH = 5;

// 在 AgentCallOptions 中加入 depth
interface AgentCallOptions {
  depth?: number;  // 預設 0
}

// 每次 call 時 depth + 1
// 超過 MAX_CALL_DEPTH → 拒絕呼叫
```

### 改動範圍
| 檔案 | 改動 |
|------|------|
| `services/AgentCallService.ts` | 新增 depth 參數 + 檢查 |
| `tools/notifyAgentTool.ts` | 傳遞 depth |

### 預估複雜度：🟢 低（30 分鐘）

---

## 🟡 P1：Structured Activity Events

### 為什麼
- 不是完整的 activity_log 系統，但關鍵操作需要結構化記錄
- 目前依賴 Pino log，查詢困難
- 用 SQLite 表存放結構化事件，方便 admin agent 查詢

### 設計概念
```typescript
activity_events = {
  id: integer (autoincrement),
  agent_id: text,
  event_type: text,      // "query" | "schedule" | "agent_call" | "error" | "budget_exceeded"
  event_action: text,    // "started" | "completed" | "failed"
  details: text,         // JSON
  created_at: text,
}
```

### 改動範圍
- 新增 repository + CREATE TABLE
- 在 MessageProcessor、ScheduleExecutor、AgentCallService 中寫入事件

### 預估複雜度：🟡 中（1.5 小時）

---

## 🟢 P2：Task-level Session（任務級 Session）

### 為什麼
- 如果 agent 要處理多個不同的專案/任務
- 用同一個 session 會導致 context 混雜
- Paperclip 的 taskKey-based session 讓每個任務有獨立的 Claude SDK session

### 設計概念
- Schedule 任務可以有 `taskKey`（如 schedule ID）
- Agent call 可以有 `taskKey`（如 calling agent + purpose）
- 根據 taskKey 保存/恢復對應的 `sdk_session_id`

### 預估複雜度：🟡 中（2 小時）
- 需要擴充 SessionManager 的 key resolution 邏輯

---

## 🟢 P2：Config Change Tracking

### 為什麼
- Agent YAML 修改後沒有歷史記錄
- Paperclip 的 before/after 快照 + changedKeys 很清晰
- Git 可以追蹤檔案變更，但 runtime config（如 schedule 啟停）不在 git 中

### 設計概念
- AgentLoader 載入 config 時計算 hash
- Hash 變更 → 寫入 `config_changes` 表（before, after, changedKeys）
- Admin agent 可以查詢 config 變更歷史

### 預估複雜度：🟡 中（1.5 小時）

---

## 🟢 P2：Migration System

### 為什麼
- 目前用 `CREATE TABLE IF NOT EXISTS`，schema 演進時會有問題
- 如果要加新欄位，需要手動 ALTER TABLE
- 正式的 migration 系統是遲早要做的

### 設計概念
- 使用 better-sqlite3-migrations 或自建
- Migration 檔案放在 `src/persistence/migrations/`
- 每次啟動時自動執行未完成的 migration

### 預估複雜度：🟡 中（2 小時 for setup）

---

## 🟢 P3：不急需 / 觀察

| 項目 | 理由 |
|------|------|
| Web Dashboard | Telegram UI 對個人場景足夠 |
| Multi-tenancy | ClaudeCab 是個人工具 |
| Org Chart hierarchy | 扁平結構已夠用 |
| Atomic Checkout | 無多 agent 搶同一任務的場景 |
| Session Codec | 只用 Claude SDK，不需抽象 |
| Runtime Services | 暫無 per-workspace 服務需求 |
| Goal Alignment Chain | 過重的結構 |
| Environment Check | 只用 Claude SDK，環境簡單 |

---

## 實施路線圖

### Phase 1：安全網（1-2 天）
1. ✅ Budget Hard Stop
2. ✅ Execution Audit Log
3. ✅ Agent Call Depth Tracking

### Phase 2：可觀測性（1 天）
4. Integer Cents 遷移
5. Cost Summary 增強
6. Structured Activity Events

### Phase 3：架構改善（按需）
7. Task-level Session
8. Config Change Tracking
9. Migration System

### 投入產出比
- **Phase 1**: 最高 ROI — 防止失控花費 + 追溯能力
- **Phase 2**: 中等 ROI — 更好的成本可見性
- **Phase 3**: 長期投資 — 為未來演進鋪路
