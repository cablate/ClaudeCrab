# 任務管理系統比對

## Paperclip: Issue / Ticket System

### 概述
Paperclip 的 Issue 系統是整個平台的核心——所有 agent 工作都圍繞 issue 展開。Issue 不只是 "task"，它是工作的最小追蹤單位，承載了任務分配、session 管理、cost 歸因、審批閘門等多重職責。

### Issue Schema
```typescript
issues = {
  id: uuid,
  companyId: uuid,
  projectId: uuid?,              // 所屬 project
  goalId: uuid?,                 // 對齊到的 goal
  parentId: uuid?,               // 子 issue（樹狀結構）
  title: text,
  description: text?,
  status: text,                  // "backlog" | "todo" | "in_progress" | "done" | "cancelled"
  priority: text,                // "low" | "medium" | "high" | "urgent"
  assigneeAgentId: uuid?,        // 指派給哪個 agent
  assigneeUserId: text?,         // 或指派給人類
  checkoutRunId: uuid?,          // 搶佔用的 run ID
  executionRunId: uuid?,         // 正在執行的 run ID
  executionLockedAt: timestamp?, // 鎖定時間（防止 double execution）
  executionAgentNameKey: text?,  // 執行 agent 的 name key
  createdByAgentId: uuid?,       // 誰建立的（agent）
  createdByUserId: text?,        // 誰建立的（人類）
  issueNumber: integer?,         // 序號（PAP-1, PAP-2）
  identifier: text?,             // 唯一識別碼（PAP-1）
  requestDepth: integer,         // 委派深度（防止無限遞迴）
  billingCode: text?,            // 成本分類碼
  assigneeAdapterOverrides: jsonb?,      // 指派時的 adapter 覆寫
  executionWorkspaceSettings: jsonb?,    // 工作區設定覆寫
}
```

### Atomic Checkout（搶佔機制）
```sql
-- 偽代碼：只有搶到的 agent 才能開始工作
UPDATE issues SET
  checkoutRunId = :runId,
  executionLockedAt = NOW()
WHERE id = :issueId
  AND (checkoutRunId IS NULL OR executionLockedAt < NOW() - INTERVAL '30 minutes')
```
- **樂觀鎖定**: 用 SQL WHERE 條件實現原子性搶佔
- **Stale Lock 自動釋放**: 30 分鐘超時後自動解鎖
- **防止 Double Execution**: 同一 issue 不會被兩個 agent 同時處理

### Issue Lifecycle
```
backlog → todo → in_progress → done
                      ↓
                  cancelled
```

### Issue 與其他系統的關聯
- **Goal Alignment**: `goalId` → 每個 issue 追溯到公司目標
- **Project Scope**: `projectId` → issue 屬於哪個 project
- **Cost Attribution**: `cost_events.issueId` → 花費歸因
- **Session Isolation**: `agent_task_sessions.taskKey = issueId` → session 隔離
- **Approval Gates**: `issue_approvals` 表 → 某些 issue 需要人類審批才能開始

### Issue Approval
```typescript
issue_approvals = {
  id: uuid,
  companyId: uuid,
  issueId: uuid,
  approverUserId: text?,
  status: text,            // "pending" | "approved" | "rejected"
  note: text?,
}
```

### 子 Issue / 委派
- `parentId` 支援樹狀結構
- `requestDepth` 追蹤委派深度，防止 A → B → C → A 無限迴圈
- Agent 可以把工作拆分成子 issue 並指派給下屬 agent

---

## ClaudeCab: 無獨立任務系統

### 現況
ClaudeCab **沒有獨立的任務管理系統**。工作管理分散在幾個機制中：

1. **Schedule YAML** — 定義排程任務（cron + prompt）
2. **Agent Call** — Agent 間呼叫（fire-and-forget 或 await）
3. **Telegram Chat** — 使用者直接對話指派任務
4. **TodoWrite** — Claude Code 內建的任務追蹤（session 內）

### 對應關係
| Paperclip 概念 | ClaudeCab 對應 |
|---------------|---------------|
| Issue | Telegram message / Schedule prompt |
| Issue Status | 無（靠對話追蹤） |
| Atomic Checkout | 無（Mutex per session） |
| Issue Approval | Permission Prompt（工具層級） |
| Sub-issue Delegation | Agent Call |
| Cost Attribution | query_metrics（agent 層級） |
| Issue Number (PAP-1) | 無 |

---

## 比對分析

| 面向 | Paperclip | ClaudeCab |
|------|-----------|-----------|
| **任務定義** | 結構化 Issue（title, description, status） | 非結構化（對話 / prompt） |
| **任務追蹤** | 完整 lifecycle（backlog → done） | 無 |
| **搶佔機制** | ✅ Atomic checkout + 超時釋放 | ❌ 無 |
| **審批閘門** | ✅ Issue-level approval | Permission prompt（工具層級） |
| **Goal Alignment** | ✅ Issue → Goal 追溯鏈 | ❌ 無 |
| **Cost 歸因** | ✅ Per-issue | Per-agent only |
| **委派** | ✅ Sub-issue + requestDepth | Agent Call（無深度追蹤） |
| **識別碼** | PAP-1, PAP-2（自動編號） | 無 |
| **複雜度** | 高（需要完整 CRUD + UI） | 低（對話即任務） |

## 值得借鑑

### 🟡 P1：結構化任務記錄
- 不是要建完整的 issue system（太重）
- 而是在 `ScheduleExecutor` 和 `AgentCallService` 執行時，留下結構化的「execution record」
- 包含：觸發原因、prompt 摘要、結果、cost、duration
- **落地方式**: 新增 `execution_records` 表

### 🟡 P1：Agent Call 深度追蹤
- 記錄 `requestDepth`，防止 A call B call A 的無限迴圈
- 目前 agent-call 有 cycle detection 嗎？值得確認

### 🟢 P2：Atomic Checkout
- 如果未來有多個 agent 可能搶同一任務的場景
- SQL WHERE 條件式搶佔是成熟的模式
- 但目前 ClaudeCab 每個 agent 各管各的，還不需要

### 🟢 P2：Goal Alignment Chain
- Issue → Project → Goal 的追溯鏈很漂亮
- 但 ClaudeCab 的場景更像「個人助理團隊」而非「零人公司」
- 暫時不需要這麼重的結構
