# Web UI Interactive Hooks — Galgame 選択肢互動

## Why

v1.33 實作了 Web UI 傳訊息給 agent 的功能，但 Agent 執行 query 時觸發的 Permission prompt 和 AskUserQuestion 只走 Telegram。InteractionHandler 硬綁 TelegramAdapter，Web UI 沒有接收和回應機制。Web 使用者看不到這些互動提示，只能等 120 秒 auto-deny/auto-cancel。

關鍵發現：PermissionBridge / QuestionBridge 是 requestId-based 的 pub/sub，任何能拿到 requestId 的人都可以呼叫 resolve 解除阻塞，不需要從 adapter 層解耦。

## What Changes

設計方向：SSE 推送 + API 回應（最小侵入），不改 InteractionHandler 架構，只在「推送」和「回應」兩端加入 Web UI 通道。

1. **EventBus 廣播互動事件**：InteractionHandler 在 handlePermission() 和 handleAskUserQuestion() 中透過 EventBus 廣播 interaction 事件
2. **SSEBroadcaster 監聽 interaction 事件**：推送到 Web UI 前端
3. **Resolve API**：新增 POST /api/messages/resolve-permission 和 /api/messages/resolve-question，透過靜態 registry 找到對應 bridge 並 resolve
4. **前端渲染**：Portrait 面板中動態渲染選項按鈕（galgame 選択肢風格），點擊後呼叫 resolve API
5. **雙通道並行**：Telegram 和 Web UI 同時收到互動提示，任一端先回應即可 resolve

附帶修復：
- POST /api/messages/send 改為 fire-and-forget（不 await processMessage）
- Backlog 訊息截斷值加大
- Quick reply 送出時同步禁用按鈕

## Capabilities

- Web UI 使用者能即時看到並回應 Agent 的 Permission prompt 和 AskUserQuestion
- Telegram 和 Web UI 雙通道並行，任一端先回應即可
- Galgame 選択肢風格的互動體驗
- 已回應後自動推送 interaction_resolved 事件清除另一端 UI
