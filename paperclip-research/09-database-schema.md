# 資料庫 Schema 比對

## Paperclip: PostgreSQL + Drizzle ORM

### 概述
- **Database**: PostgreSQL（支援 embedded PGlite 開發模式）
- **ORM**: Drizzle ORM
- **Tables**: 36 張表
- **Migrations**: 27+ 個 migration 檔案
- **Multi-tenancy**: companyId-based 行級過濾

### 完整 Schema 一覽

#### 核心實體（6 tables）
| Table | 用途 | 關鍵欄位 |
|-------|------|---------|
| `companies` | 公司/租戶 | budgetMonthlyCents, issuePrefix |
| `agents` | AI Agent | reportsTo, budgetMonthlyCents, adapterType |
| `projects` | 專案 | companyId, name |
| `goals` | 目標層級 | level(mission→task), parentId, ownerAgentId |
| `issues` | 任務/工單 | status, assigneeAgentId, checkoutRunId |
| `labels` | 標籤 | companyId, name, color |

#### 執行引擎（4 tables）
| Table | 用途 | 關鍵欄位 |
|-------|------|---------|
| `heartbeat_runs` | 執行記錄（不可變） | status, usageJson, contextSnapshot |
| `heartbeat_run_events` | Run 內的事件流 | runId, type, data |
| `agent_runtime_state` | Agent 全域狀態 | sessionId, stateJson, totalCostCents |
| `agent_task_sessions` | 任務級 Session | taskKey, sessionParamsJson |

#### 治理 & 審計（5 tables）
| Table | 用途 | 關鍵欄位 |
|-------|------|---------|
| `activity_log` | 操作審計 | actorType, action, entityType |
| `approvals` | 審批閘門 | type, status, payload |
| `approval_comments` | 審批討論 | approvalId, comment |
| `agent_config_revisions` | 設定版本 | beforeConfig, afterConfig, changedKeys |
| `principal_permission_grants` | 權限授予 | principalType, permission |

#### 成本追蹤（1 table）
| Table | 用途 | 關鍵欄位 |
|-------|------|---------|
| `cost_events` | 成本事件 | agentId, issueId, costCents, provider, model |

#### Issue 生態（5 tables）
| Table | 用途 | 關鍵欄位 |
|-------|------|---------|
| `issue_comments` | Issue 討論 | issueId, authorType |
| `issue_attachments` | 附件 | issueId, fileKey |
| `issue_labels` | Issue ↔ Label | issueId, labelId |
| `issue_approvals` | Issue 審批 | issueId, status |
| `issue_read_states` | 已讀狀態 | issueId, userId |

#### Workspace（3 tables）
| Table | 用途 | 關鍵欄位 |
|-------|------|---------|
| `project_workspaces` | 專案工作區 | cwd, repoUrl, isPrimary |
| `project_goals` | 專案 ↔ 目標 | projectId, goalId |
| `workspace_runtime_services` | 背景服務 | serviceName, status, lifecycle |

#### 認證 & 多租戶（8 tables）
| Table | 用途 |
|-------|------|
| `auth` | 使用者認證 |
| `company_memberships` | 使用者 ↔ 公司 |
| `instance_user_roles` | Instance 級角色 |
| `invites` | 邀請碼 |
| `join_requests` | 加入申請 |
| `agent_api_keys` | Agent JWT key |
| `company_secrets` | 公司密鑰 |
| `company_secret_versions` | 密鑰版本 |

#### 其他（3 tables）
| Table | 用途 |
|-------|------|
| `agent_wakeup_requests` | Wakeup 佇列 |
| `assets` | 資源/圖片 |

### 索引策略
- **幾乎所有表都有 companyId 前綴的複合索引**（多租戶查詢效能）
- `issues_company_status_idx` — 快速查找待辦 issue
- `heartbeat_runs_company_agent_started_idx` — 快速查找 agent 的 run 歷史
- `activity_log_company_created_idx` — 快速查找活動日誌
- `cost_events_company_agent_occurred_idx` — 快速查找成本事件
- **UniqueIndex**: `agent_task_sessions_company_agent_adapter_task_uniq`

### 設計模式
1. **UUID PK everywhere** — 所有 PK 都是 UUID（可合併、可分散）
2. **companyId on everything** — 每張表都有 companyId（多租戶隔離）
3. **jsonb for flexibility** — config、metadata、payload 用 jsonb
4. **Soft delete via status** — 用 status field 而非刪除行
5. **Timestamp pair** — createdAt + updatedAt on every table

---

## ClaudeCab: SQLite + better-sqlite3

### 概述
- **Database**: SQLite（better-sqlite3）
- **ORM**: 原生 SQL prepared statements
- **Tables**: 7 張表
- **Migrations**: Schema init in code
- **Multi-tenancy**: 無（單租戶）

### Schema 一覽

| Table | 用途 | 關鍵欄位 |
|-------|------|---------|
| `sessions` | Session 管理 | platform, agentId, userId, sdkSessionId |
| `conversations` | 對話歷史 | sessionId, role, content |
| `group_messages` | 群組訊息 | chatId, senderType, content |
| `group_injection_state` | 群組注入狀態 | agentId, chatId, lastInjectedMsgId |
| `group_members` | 群組成員 | agentId, chatId |
| `query_metrics` | 查詢指標 | agentId, inputTokens, totalCostUsd |
| `schedule_executions` | 排程執行記錄 | scheduleId, executionId, status |

### 索引策略
- SQLite 自動建立 PK index
- 其餘依賴查詢時的 WHERE 條件（無額外索引定義）

---

## 比對分析

| 面向 | Paperclip | ClaudeCab |
|------|-----------|-----------|
| **Database** | PostgreSQL | SQLite |
| **Tables** | 36 | 7 |
| **ORM** | Drizzle（型別安全） | 原生 SQL |
| **PK 策略** | UUID（可合併） | Autoincrement（簡單） |
| **多租戶** | companyId 行級過濾 | 無（單租戶） |
| **Migration** | Drizzle migration 檔案 | Code-level schema init |
| **JSONB 使用** | 大量（config, metadata, payload） | 少量（processedMessageIds） |
| **索引** | 精心設計的複合索引 | 最小化 |
| **WAL Mode** | PostgreSQL 原生 MVCC | ✅ 支援 WAL |
| **Backup** | 有 backup-lib.ts | 無 |

### 規模對比
```
Paperclip: 36 tables, 100+ columns, 20+ indexes, 27 migrations
ClaudeCab:  7 tables,  40+ columns,  minimal indexes, 0 migrations
```

## 值得借鑑

### 🟡 P1：Migration 系統
- ClaudeCab 目前用 `CREATE TABLE IF NOT EXISTS`（隱式 migration）
- 隨著 schema 演進，需要正式的 migration 機制
- **選項**: better-sqlite3-migrations, drizzle-kit, 或自建 migration runner
- 不急但遲早要做

### 🟡 P1：Composite Indexes
- `query_metrics` 表可能需要 `(agent_id, created_at)` 複合索引
- `sessions` 表已有 `(platform, agent_id, user_id)` 唯一約束
- 隨著數據量增長，需要檢視查詢效能

### 🟢 P2：UUID PK
- 如果未來需要跨 instance 合併數據（如備份恢復）
- UUID PK 比 autoincrement 更安全
- 但 SQLite + autoincrement 對 ClaudeCab 的規模來說夠用

### 💡 觀察
Paperclip 的 36 表 schema 反映了它是一個 **完整的 SaaS 平台**。ClaudeCab 的 7 表反映了它是一個 **輕量的個人工具**。規模不同，不需要刻意對齊。
