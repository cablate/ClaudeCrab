# 設計：Live Page Data-Driven

## Decisions

### DisplaySchema 定義

在 AgentConfigSchema（Zod）中新增 display 欄位，定義 sprite、portrait、emoji 路徑。前端不再自行維護 AGENT_ASSETS 物件。

### API 驅動渲染

`/api/activity/agents` 回傳完整的 display URLs，由 agent.json 的 display config 組裝。前端完全依賴後端 API 回傳的資料渲染 Agent 視覺元素。

### 圖片路徑標準化

統一放置到 `public/images/agents/{agentId}/`，檔名標準化。Emoji key 對齊 ActivityMood enum 值（neutral、excited、annoyed、tired、focused 等）。

### 移除前端 Hardcode

刪除 live.js 中的 AGENT_ASSETS 物件，前端改為從 API 回傳的資料動態載入。

## Risks / Trade-offs

- 向後相容：需確保所有現有 agent.json 都加入 display 欄位
- Fallback：未配置 display 的 agent 需有預設 fallback（avatar emoji）

## Affected Components

- `AgentConfigSchema`（Zod）— 新增 DisplaySchema
- `/api/activity/agents` — 回傳 display URLs
- `public/images/agents/{agentId}/` — 圖片統一放置
- `public/js/live.js` — 移除 AGENT_ASSETS hardcode，改用 API 資料
- 各 agent 的 `agent.json` — 新增 display 欄位
