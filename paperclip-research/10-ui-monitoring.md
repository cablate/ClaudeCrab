# UI & 監控比對

## Paperclip: React Web Dashboard

### 技術棧
- **Frontend**: React + TypeScript
- **Routing**: React Router（pages/）
- **State**: React context + hooks
- **Real-time**: WebSocket（Server-Sent Events 或 WebSocket）
- **API**: REST API（Express routes）

### 目錄結構
```
ui/src/
├── App.tsx
├── adapters/        # API client 層
├── api/             # API hooks
├── components/      # UI 元件
├── context/         # React context
├── fixtures/        # 測試/開發用假資料
├── hooks/           # 自訂 hooks
├── lib/             # 工具函數
├── pages/           # 路由頁面
└── main.tsx
```

### 核心頁面
根據 routes 目錄推測的主要頁面：

| 頁面 | 功能 |
|------|------|
| Dashboard | 總覽（活躍 agent、最近 run、cost summary） |
| Agents | Agent 列表 + 詳情（status、config、runs history） |
| Issues | Issue 看板 / 列表 |
| Projects | 專案管理 |
| Goals | 目標層級視圖 |
| Costs | 成本分析（by agent、by project、daily trend） |
| Activity | Activity log 流 |
| Approvals | 待審批項目 |
| Secrets | 密鑰管理 |

### Real-time 推送
```typescript
// server/src/services/live-events.ts
function publishLiveEvent(event: {
  companyId: string;
  type: string;          // "activity.logged", "run.started", "run.finished", ...
  payload: unknown;
}) {
  // → WebSocket/SSE 推送到前端
}
```

每個重要操作都即時推送：
- Agent status 變更
- Run 開始/結束
- Activity log 新增
- Issue 狀態變更
- Cost event 記錄

### Cost Dashboard
從 `routes/costs.ts` 和 `services/costs.ts` 可知提供：
- **Company Summary**: 總花費 / 預算 / 使用率%
- **By Agent**: 每個 agent 的花費（含 API vs subscription 區分）
- **By Project**: 每個 project 的花費
- **Date Range Filter**: 可篩選時段

### Sidebar Badges
```typescript
// services/sidebar-badges.ts
// 計算 sidebar 上的 badge 數字
// 如：待審批數量、活躍 run 數量
```

### Mobile Ready
README 強調 "Monitor and manage your autonomous businesses from anywhere"——responsive design。

---

## ClaudeCab: Telegram 原生 UI

### 概述
ClaudeCab **沒有 web dashboard**。監控和管理完全透過 Telegram 對話完成。

### 監控方式
| 需求 | 實現方式 |
|------|---------|
| Agent 狀態 | Telegram 對話（問 admin agent） |
| 成本查看 | Admin agent 查詢 QueryMetricsRepository |
| 排程狀態 | Schedule notification（Telegram 推送） |
| 錯誤通知 | Schedule error notification（Telegram 推送） |
| Agent 日誌 | Pino log file（需 SSH 查看） |

### Admin Agent 監控指令
Admin agent 可以：
- 查詢所有 agent 的 query metrics
- 查看排程執行歷史
- 管理 agent 設定

### Notification System
```typescript
// ScheduleNotifier
// 排程完成 → Telegram 通知使用者
// 排程失敗 → Telegram 通知使用者
spec.notification?.onComplete → notifier.notifyComplete()
spec.notification?.onError → notifier.notifyError()
```

---

## 比對分析

| 面向 | Paperclip | ClaudeCab |
|------|-----------|-----------|
| **UI 類型** | Web Dashboard（React） | Telegram 原生對話 |
| **即時更新** | ✅ WebSocket live events | Telegram 推送 |
| **Cost Dashboard** | ✅ 視覺化圖表 | 文字查詢結果 |
| **Agent 監控** | ✅ Status + runs + config | 對話式查詢 |
| **Issue 管理** | ✅ 看板 / 列表 UI | 無 |
| **Mobile** | ✅ Responsive web | ✅ Telegram app |
| **部署複雜度** | 需要額外 web server | 零額外部署 |
| **使用者體驗** | 豐富視覺化 | 輕量但功能有限 |
| **開發成本** | 高（React + API + WebSocket） | 低（利用 Telegram 原生） |

## 值得借鑑

### 🟢 P2：簡易 Web Dashboard
- 不需要完整的 Paperclip 級 dashboard
- 但一個簡單的靜態頁面展示：
  - 各 agent 的 daily cost trend
  - 最近的 query metrics
  - 排程執行歷史
- **落地方式**: Express 靜態頁面 + `query_metrics` SQL 查詢
- 或更簡單：每日排程生成 HTML report 發到 Telegram

### 🟡 P1：Cost Summary Command
- 在 Admin agent 中加入更豐富的 cost 查詢能力
- 支援 by-agent、by-day、by-period 的文字報表
- 這個不需要 web UI，純 Telegram 文字就夠

### 💡 觀察
- Paperclip 需要 web dashboard 因為它的目標是「多人管理的零人公司」
- ClaudeCab 的 Telegram 原生 UI 對「個人 AI 助理團隊」場景其實更方便
- 使用者不需要額外開瀏覽器，在 Telegram 裡就能管理一切
- **這是 ClaudeCab 的 UX 優勢，不是劣勢**
