# Tasks

## Step 1: InteractionHandler 改造

- [x] InteractionHandler constructor 新增 agentId 參數
- [x] handlePermission() / handleAskUserQuestion() 中加 EventBus emit
- [x] 新增靜態 permissionRegistry 和 questionRegistry Map

## Step 2: MessageProcessor 傳遞

- [x] MessageProcessor 傳遞 agentId 到 InteractionHandler constructor

## Step 3: SSEBroadcaster 監聽

- [x] SSEBroadcaster constructor 加 eventBus.on('interaction', ...) 監聽

## Step 4: Resolve API

- [x] 新增 POST /api/messages/resolve-permission endpoint
- [x] 新增 POST /api/messages/resolve-question endpoint
- [x] 透過靜態 registry 找到對應 bridge 並 resolve

## Step 5: 前端渲染

- [x] SSE handler 分支處理 interaction 事件
- [x] Portrait 面板中動態渲染選項按鈕（galgame 選択肢風格）
- [x] 點擊後呼叫 resolve API
- [x] 回應後清除選項 UI + 推送 interaction_resolved

## Step 6: 附帶修復

- [x] POST /api/messages/send 改為 fire-and-forget
- [x] Backlog 訊息截斷值加大
- [x] Quick reply 送出時同步禁用按鈕
