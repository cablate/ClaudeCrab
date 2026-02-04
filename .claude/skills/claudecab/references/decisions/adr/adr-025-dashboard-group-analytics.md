# ADR-025: Dashboard 群組分析與委派統計

**狀態**：📋 proposed
**日期**：2026-02-04
**相關**：ADR-020, ADR-021

---

## 背景

ADR-020 Phase 2 已實現基礎 Dashboard（Agent 卡片 + Token 統計）。隨著群組協作（ADR-019）和自動委派（ADR-021）功能上線，需要更豐富的數據可視化：

1. **委派統計**：誰委派給誰、頻率、成功率
2. **群組管理**：查看群組成員、對話歷史、Bot 活躍度
3. **成本歸因**：區分使用者直接觸發 vs 委派觸發的成本

---

## 提議

### 1. 委派統計面板

#### 數據來源

擴展 `query_metrics` 表或新增 `delegation_logs` 表：

```sql
CREATE TABLE delegation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_agent_id TEXT NOT NULL,
    to_agent_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    depth INTEGER NOT NULL,
    success INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
```

#### 可視化

- **委派流向圖**：顯示 Bot 之間的委派關係（簡易 Sankey 或箭頭圖）
- **委派統計卡片**：24h 委派次數、平均 chain 長度、最常委派路徑
- **失敗追蹤**：委派失敗的原因（depth 超限、cycle 偵測等）

### 2. 群組管理面板

#### 路由

- `GET /dashboard/groups` — 群組列表
- `GET /dashboard/groups/:chatId` — 單一群組詳情

#### 內容

- 群組成員列表（Bot 名稱 + @username + 角色描述）
- 最近對話歷史（從 `group_messages` 表）
- Bot 活躍度統計（各 Bot 在此群組的回覆次數）
- 群組設定（未來：主動互動模式、委派設定等）

### 3. 成本歸因

在 `query_metrics` 新增欄位區分觸發來源：

```sql
ALTER TABLE query_metrics ADD COLUMN trigger_type TEXT DEFAULT 'user';
-- trigger_type: 'user' | 'delegation' | 'schedule' | 'initiative'
```

Dashboard 上顯示各觸發類型的成本佔比。

---

## 實作優先級

| 功能 | 優先級 | 依賴 |
|------|--------|------|
| 委派 log 記錄 | P1 | ADR-021（已完成） |
| 群組成員面板 | P1 | ADR-020 Phase 1（已完成） |
| 群組對話歷史 | P2 | group_messages 表（已有） |
| 委派流向圖 | P2 | delegation_logs 表 |
| 成本歸因 | P3 | query_metrics 擴展 |

---

## 影響

- `src/persistence/DatabaseManager.ts` — 新表 / schema 擴展
- `src/persistence/DelegationLogRepository.ts` — **新建**
- `src/core/GroupBroadcaster.ts` — 記錄委派 log
- `src/webui/routes/` — 群組管理路由
- `src/webui/views/` — 群組面板模板

## 待討論

- [ ] 委派 log 是否需要獨立表，還是在 query_metrics 加欄位就夠？
- [ ] 群組對話歷史的顯示量（最近 N 筆 vs 分頁）？
- [ ] 流向圖用前端 JS 庫（如 D3）還是 server-side 渲染？
- [ ] 成本歸因的 trigger_type 分類是否足夠？
