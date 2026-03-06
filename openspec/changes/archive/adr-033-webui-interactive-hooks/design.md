# 設計：Web UI Interactive Hooks

## Decisions

### EventBus 廣播互動事件

在 InteractionHandler.handlePermission() 和 handleAskUserQuestion() 中，adapter 呼叫之外同時透過 EventBus 廣播 interaction 事件（type: permission_request / question_request），包含 requestId、agentId、toolName/question 等資訊。InteractionHandler constructor 新增 agentId 參數。

### 靜態 Registry 存取 Bridge

InteractionHandler 新增靜態 Map：permissionRegistry 和 questionRegistry，以 requestId 映射到對應的 PermissionBridge / QuestionBridge。API 拿到 requestId 就能直接 resolve。

### SSE 推送

SSEBroadcaster constructor 新增 `eventBus.on('interaction', ...)` 監聽，推送格式與 activity event 一樣走 `data: JSON\n\n`，前端用 event.type 區分。

### Resolve API

新增兩個 endpoint：
- POST /api/messages/resolve-permission（requestId + decision: allow/deny/always）
- POST /api/messages/resolve-question（requestId + answer: string/null）

透過靜態 registry 找到對應 bridge 並 resolve。

### 雙通道並行

Telegram 和 Web UI 同時收到互動提示。任一端先回應即可 resolve bridge（resolvePermission / resolveQuestion 有去重保護 — pending Map 刪除後第二次呼叫無效）。已回應後推送 interaction_resolved 事件讓另一端清除 UI。

### 前端 Galgame 選択肢風格

Portrait 面板中的 dialogue-quick-replies 容器動態渲染選項按鈕。只在對應 agent 的 portrait 打開時顯示。

### 附帶修復

POST /api/messages/send 改為 fire-and-forget（不 await processMessage），立即回應 `{ success: true }`，結果透過 SSE 推送。

## Risks / Trade-offs

- 雙通道同時收到提示，需要 interaction_resolved 事件同步清除另一端 UI
- 靜態 registry 需要確保在 InteractionHandler 生命週期結束時清理

## Affected Components

- `src/core/InteractionHandler.ts` — 新增 agentId、EventBus emit、靜態 registry
- `src/core/MessageProcessor.ts` — 傳遞 agentId 到 InteractionHandler
- `src/webui/services/SSEBroadcaster.ts` — 監聽 interaction 事件
- `src/webui/api/messages.api.ts` — 新增 resolve-permission、resolve-question endpoint；send 改 fire-and-forget
- `public/js/live.js` — SSE interaction 事件處理、選項渲染、resolve API 呼叫
- `public/css/live.css` — 選項按鈕樣式（galgame 風格）
