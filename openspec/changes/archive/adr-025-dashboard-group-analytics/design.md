# 設計：Dashboard 群組分析與委派統計

## Decisions

### 委派 Log 資料結構

新增 `delegation_logs` 表：

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

### 委派可視化

- **委派流向圖**：顯示 Bot 之間的委派關係（簡易 Sankey 或箭頭圖）
- **委派統計卡片**：24h 委派次數、平均 chain 長度、最常委派路徑
- **失敗追蹤**：委派失敗的原因（depth 超限、cycle 偵測等）

### 群組管理路由

- `GET /dashboard/groups` — 群組列表
- `GET /dashboard/groups/:chatId` — 單一群組詳情（成員列表、對話歷史、活躍度統計）

### 成本歸因

在 `query_metrics` 新增欄位：

```sql
ALTER TABLE query_metrics ADD COLUMN trigger_type TEXT DEFAULT 'user';
-- trigger_type: 'user' | 'delegation' | 'schedule' | 'initiative'
```

### 實作優先級

| 功能 | 優先級 | 依賴 |
|------|--------|------|
| 委派 log 記錄 | P1 | ADR-021（已完成） |
| 群組成員面板 | P1 | ADR-020 Phase 1（已完成） |
| 群組對話歷史 | P2 | group_messages 表（已有） |
| 委派流向圖 | P2 | delegation_logs 表 |
| 成本歸因 | P3 | query_metrics 擴展 |

## Risks / Trade-offs

- 委派 log 獨立表 vs 在 query_metrics 加欄位的選擇待確認
- 流向圖前端 JS 庫（如 D3）vs server-side 渲染的選擇待確認
- 群組對話歷史的顯示量（最近 N 筆 vs 分頁）待確認

## Affected Components

- `src/persistence/DatabaseManager.ts` — 新表 / schema 擴展
- `src/persistence/DelegationLogRepository.ts` — **新建**
- `src/core/GroupBroadcaster.ts` — 記錄委派 log
- `src/webui/routes/` — 群組管理路由
- `src/webui/views/` — 群組面板模板
