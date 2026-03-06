# Dashboard 群組分析與委派統計

## Why

ADR-020 Phase 2 已實現基礎 Dashboard（Agent 卡片 + Token 統計）。隨著群組協作（ADR-019）和自動委派（ADR-021）功能上線，需要更豐富的數據可視化：

1. **委派統計**：誰委派給誰、頻率、成功率
2. **群組管理**：查看群組成員、對話歷史、Bot 活躍度
3. **成本歸因**：區分使用者直接觸發 vs 委派觸發的成本

## What Changes

### 1. 委派統計面板

擴展 `query_metrics` 表或新增 `delegation_logs` 表，記錄委派流向。可視化包括：委派流向圖、委派統計卡片（24h 委派次數、平均 chain 長度、最常委派路徑）、失敗追蹤。

### 2. 群組管理面板

新增路由 `GET /dashboard/groups` 和 `GET /dashboard/groups/:chatId`，顯示群組成員列表、最近對話歷史、Bot 活躍度統計、群組設定。

### 3. 成本歸因

在 `query_metrics` 新增 `trigger_type` 欄位（`'user' | 'delegation' | 'schedule' | 'initiative'`），Dashboard 上顯示各觸發類型的成本佔比。

## Capabilities

- 可視化 Bot 之間的委派關係與頻率
- 統一管理群組成員與對話歷史
- 區分不同觸發來源的成本，便於成本控制
