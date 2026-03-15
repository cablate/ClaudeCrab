# 組織架構 & 審計比對

## Paperclip: Org Chart + Governance

### 組織架構

#### Agent 層級
```typescript
agents = {
  // ...
  role: text,                // "general" (可自訂：ceo, cto, engineer, designer...)
  title: text?,              // 職稱
  reportsTo: uuid?,          // 上級 agent（自引用外鍵）
  capabilities: text?,       // 能力描述
  permissions: jsonb,        // 權限設定
}
```

- `reportsTo` 建立樹狀組織結構（CEO → CTO → Engineers）
- 索引 `agents_company_reports_to_idx` 支援快速查詢上下級

#### Goal 層級系統
```typescript
goals = {
  id: uuid,
  companyId: uuid,
  title: text,
  description: text?,
  level: text,               // "mission" | "strategy" | "project" | "task"
  status: text,              // "planned" | "active" | "achieved"
  parentId: uuid?,           // Goal 也可以有子 goal
  ownerAgentId: uuid?,       // 負責的 agent
}
```

**Goal Ancestry Chain**: Mission → Strategy → Project → Task
- Issue 可以關聯到 Goal → `issues.goalId`
- Project 也可以關聯到 Goal → `project_goals` 關聯表
- Agent 知道自己做的事如何連結到公司 mission

#### 實際效果
Agent 的 system prompt 會包含：
```
你是 CTO，向 CEO 報告。
公司目標：Build the #1 AI note-taking app to $1M MRR.
你的策略：Lead technical architecture and engineering team.
當前任務：PAP-42 - Implement real-time sync engine
```

### 審計系統

#### Activity Log
```typescript
activity_log = {
  id: uuid,
  companyId: uuid,
  actorType: text,       // "agent" | "user" | "system"
  actorId: text,
  action: text,          // "issue.created" | "agent.config.updated" | "run.started" ...
  entityType: text,      // "issue" | "agent" | "project" | "goal"
  entityId: text,
  agentId: uuid?,        // 關聯的 agent
  runId: uuid?,          // 關聯的 heartbeat run
  details: jsonb?,       // 事件詳情（已脫敏）
}
```

**特點**:
- 每個操作都寫入 activity_log
- details 會經過 `sanitizeRecord()` + `redactCurrentUserValue()` 脫敏
- 即時推送到 WebSocket（`publishLiveEvent`）供 UI 即時顯示

#### Config Versioning & Rollback
```typescript
agent_config_revisions = {
  id: uuid,
  companyId: uuid,
  agentId: uuid,
  createdByAgentId: uuid?,     // 誰改的（agent）
  createdByUserId: text?,      // 誰改的（人類）
  source: text,                // "patch" | "rollback" | "import"
  rolledBackFromRevisionId: uuid?,  // 回滾來源
  changedKeys: jsonb,          // ["name", "budgetMonthlyCents", ...]
  beforeConfig: jsonb,         // 完整的修改前設定
  afterConfig: jsonb,          // 完整的修改後設定
}
```

**Rollback 機制**:
- 每次修改 agent 設定都留下 before/after 快照
- 可以安全回滾到任何歷史版本
- `changedKeys` 讓 UI 可以 highlight 具體變更了什麼
- Secrets 會被 redact（不會出現在 revision 中）

#### Approval Gates
```typescript
approvals = {
  id: uuid,
  companyId: uuid,
  type: text,                  // "hire_agent" | "budget_change" | "config_change" | ...
  requestedByAgentId: uuid?,
  requestedByUserId: text?,
  status: text,                // "pending" | "approved" | "rejected"
  payload: jsonb,              // 審批內容
  decisionNote: text?,
  decidedByUserId: text?,
  decidedAt: timestamp?,
}
```

- Company 可設定 `requireBoardApprovalForNewAgents`
- 新增 agent 需要人類審批
- Issue 也可以設定需要審批才能開始執行

### Agent Permissions
```typescript
// 存儲在 agents.permissions (jsonb)
// 以及獨立的 principal_permission_grants 表
principal_permission_grants = {
  id: uuid,
  companyId: uuid,
  principalType: text,     // "agent" | "user"
  principalId: text,
  permission: text,        // 權限名稱
  grantedAt: timestamp,
}
```

---

## ClaudeCab: 輕量治理

### 組織結構
- **Agent Config**: YAML 定義 agent（name, role, systemPrompt, adapters）
- **扁平結構**: 所有 agent 平等，無上下級
- **Admin Agent**: 特殊 agent，負責管理其他 agent（但不是 DB 層級的 hierarchy）

### 審計
- **query_metrics**: 記錄每次 SDK query 的 token/cost
- **Pino Logger**: 結構化 log（但非持久化審計）
- **Git**: agent 的 memory/output 透過 git 追蹤（但不是系統層級審計）

### 治理
- **Permission Prompt**: 工具執行前可要求使用者授權
- **Plan Mode**: 複雜操作先生成計畫，使用者審核後執行
- **Hooks**: project-whitelist 限制檔案操作範圍
- **Layer 3 提案**: CLAUDE.md 的自主進化規則（核心設定需提案審批）

---

## 比對分析

| 面向 | Paperclip | ClaudeCab |
|------|-----------|-----------|
| **組織結構** | 樹狀 org chart（reportsTo） | 扁平（所有 agent 平等） |
| **Goal Alignment** | Mission → Strategy → Task 層級 | 無 |
| **Activity Log** | ✅ 結構化 + 即時 WebSocket | Pino log（非結構化審計） |
| **Config Versioning** | ✅ Before/after 快照 + rollback | Git history（間接） |
| **Approval Gates** | ✅ DB 級審批流程 | Permission prompt（會話級） |
| **Permission Model** | ✅ principal_permission_grants 表 | Hooks + settings.local.json |
| **Secret Management** | ✅ company_secrets + redaction | .env + Hooks 過濾 |
| **即時事件** | ✅ WebSocket live events | 無 |

## 值得借鑑

### 🟡 P1：Structured Activity Log
- 不需要完整的 activity_log 系統
- 但可以在關鍵操作（agent call、schedule exec、permission grant）時留下結構化記錄
- **落地方式**: 擴充 query_metrics 或新增 `activity_events` 表
- 記錄：actorType + action + entityType + entityId + details

### 🟡 P1：Config Change Tracking
- 當 agent YAML config 被修改時，記錄 before/after diff
- 目前依賴 git history，但 runtime config 變更（如 schedule 啟停）不在 git 中
- **落地方式**: 在 AgentLoader 中加 config hash 比對，變更時寫 log

### 🟢 P2：Secret Redaction in Logs
- Paperclip 的 `redactCurrentUserValue()` 和 `sanitizeRecord()` 是好實踐
- ClaudeCab 的 log 可能包含敏感資訊（chatId、userId）
- 可以在 Pino transport 層加 redaction

### 💡 觀察：不同治理哲學
- **Paperclip**: "零人公司" — agent 像員工，需要組織架構、審批、審計
- **ClaudeCab**: "AI 助理團隊" — agent 像工具，使用者直接互動和控制
- ClaudeCab 的治理更輕量是合理的，因為場景不同
- 但 activity log 和 config tracking 仍有價值（for 使用者的事後分析）
