# ADR-033: Web UI Interactive Hooks — Galgame 選択肢互動

**日期**：2026-02-13
**狀態**：📋 proposed
**關聯**：InteractionHandler、PermissionBridge、QuestionBridge、SSEBroadcaster、messages.api、live.js

## 背景

v1.33 實作了 Web UI 傳訊息給 agent 的功能（`POST /api/messages/send`）。訊息使用 `platform: 'telegram'` + `chatId: OWNER_USER_ID`，與 Telegram 私訊共享 session。

### 問題

Agent 執行 query 時會觸發需要使用者交互的 hooks：

| Hook | 觸發時機 | 現行行為 | Web UI 影響 |
|------|---------|---------|------------|
| **Permission prompt** | Agent 想用被限制的工具 | `adapter.sendPermissionPrompt()` → Telegram | Web 使用者看不到，等 120 秒 auto-deny |
| **AskUserQuestion** | Agent 需要使用者選擇 | `adapter.sendQuestionPrompt()` → Telegram | Web 使用者看不到，等 120 秒 auto-cancel |
| **Stop hook** | Agent 想結束對話 | Block + 告知做 memory check | 不需使用者交互，無影響 |

InteractionHandler 硬綁 TelegramAdapter，所有互動提示只走 Telegram。Web UI 沒有接收和回應機制。

### 架構分析

```
現有管線：
MessageProcessor.processMessage()
  → new InteractionHandler(adapter, chatId)
  → interactionHandler.buildCanUseTool() → canUseTool callback
    → handlePermission() → adapter.sendPermissionPrompt() → Telegram inline keyboard
                         → permissionBridge.requestPermission() → 等待 resolve（120s timeout）
    → handleAskUserQuestion() → adapter.sendQuestionPrompt() → Telegram inline keyboard
                               → questionBridge.requestQuestion() → 等待 resolve（120s timeout）
  → adapter.setPermissionResolver() ← Telegram callback → bridge.resolvePermission()
  → adapter.setQuestionResolver() ← Telegram callback → bridge.resolveQuestion()
```

**關鍵發現**：PermissionBridge / QuestionBridge 是 requestId-based 的 pub/sub。任何能拿到 requestId 的人都可以呼叫 `resolvePermission()` / `resolveQuestion()` 解除阻塞。不需要從 adapter 層解耦。

## 決策

### 設計方向：SSE 推送 + API 回應（最小侵入）

不改 InteractionHandler 架構，只在「推送」和「回應」兩端加入 Web UI 通道。

### 實作方案

#### 1. EventBus 廣播互動事件

在 `InteractionHandler.handlePermission()` 和 `handleAskUserQuestion()` 中，在呼叫 adapter 之外，同時透過 EventBus 廣播：

```typescript
// handlePermission() 中，adapter.sendPermissionPrompt() 之後加：
eventBus.emitSync('interaction', {
  type: 'permission_request',
  requestId,
  agentId: this.agentId,  // 需要新增 agentId 到 constructor
  toolName,
  toolInput,
  decisionReason: options.decisionReason,
});

// handleAskUserQuestion() 中，adapter.sendQuestionPrompt() 之後加：
eventBus.emitSync('interaction', {
  type: 'question_request',
  requestId,
  agentId: this.agentId,
  question: firstQuestion.question,
  header: firstQuestion.header,
  options: firstQuestion.options,
  multiSelect: firstQuestion.multiSelect,
});
```

#### 2. SSEBroadcaster 監聽 interaction 事件

```typescript
// SSEBroadcaster constructor 中新增：
eventBus.on('interaction', (event) => this.broadcast(event));
```

SSE 推送格式跟 activity event 一樣走 `data: JSON\n\n`，前端用 `event.type` 區分。

#### 3. Resolve API

```typescript
// messages.api.ts 中新增兩個 endpoint：

router.post('/resolve-permission', (req, res) => {
  const { requestId, decision } = req.body;  // decision: 'allow' | 'deny' | 'always'
  // 直接呼叫 bridge — 需要拿到 bridge 實例
  // → 透過全域 registry 或 InteractionHandler 靜態 Map
});

router.post('/resolve-question', (req, res) => {
  const { requestId, answer } = req.body;  // answer: string | null
  // 同上
});
```

**Bridge 存取方案**：InteractionHandler 建立時，把 bridge 以 requestId → bridge 映射註冊到全域 Map。API 拿到 requestId 就能直接 resolve。

```typescript
// InteractionHandler.ts 新增靜態 registry：
static permissionRegistry = new Map<string, PermissionBridge>();
static questionRegistry = new Map<string, QuestionBridge>();
```

#### 4. 前端：SSE 事件處理 + 選項渲染

```javascript
// connectSSE() 中，source.onmessage 已經處理所有 SSE 事件
// handleActivityEvent() 只需加一個分支：

function handleActivityEvent(event) {
  if (event.type === 'permission_request') {
    showPermissionPrompt(event);
    return;
  }
  if (event.type === 'question_request') {
    showQuestionPrompt(event);
    return;
  }
  // ...existing activity event handling
}
```

**Portrait 面板中渲染選項**（galgame 選択肢風格）：

```javascript
function showPermissionPrompt(event) {
  // 只在對應 agent 的 portrait 打開時顯示
  if (portraitOpenAgentId !== event.agentId) return;
  
  const container = document.querySelector('.dialogue-quick-replies');
  container.innerHTML = `
    <div class="interaction-prompt">
      <div class="prompt-title">🔐 工具授權</div>
      <div class="prompt-detail">${event.toolName}</div>
      <button class="choice-btn choice-allow" data-request-id="${event.requestId}" data-decision="allow">允許</button>
      <button class="choice-btn choice-always" data-request-id="${event.requestId}" data-decision="always">永遠允許</button>
      <button class="choice-btn choice-deny" data-request-id="${event.requestId}" data-decision="deny">拒絕</button>
    </div>
  `;
}
```

#### 5. 雙通道並行

- Telegram 和 Web UI **同時**收到互動提示
- 任一端先回應即可 resolve bridge（`resolvePermission` / `resolveQuestion` 有去重保護 — pending Map 刪除後第二次呼叫無效）
- 已回應後需推送 `interaction_resolved` 事件，讓另一端清除 UI

## 實作步驟

### Step 1: InteractionHandler 改造（最小改動）
- 新增 `agentId` 參數到 constructor
- `handlePermission()` / `handleAskUserQuestion()` 中加 EventBus emit
- 新增靜態 registry Map

### Step 2: MessageProcessor 傳遞 agentId
- `new InteractionHandler(adapter, chatId, timeout, agentId)`

### Step 3: SSEBroadcaster 監聽 interaction
- constructor 加 `eventBus.on('interaction', ...)`

### Step 4: Resolve API
- `POST /api/messages/resolve-permission`
- `POST /api/messages/resolve-question`
- 透過靜態 registry 找到對應 bridge 並 resolve

### Step 5: 前端渲染
- SSE handler 分支處理 interaction 事件
- Portrait 面板中動態渲染選項按鈕
- 點擊後呼叫 resolve API
- 回應後清除選項 UI

### Step 6: Blocking API 修復（順帶）
- `POST /api/messages/send` 改為 fire-and-forget（不 await processMessage）
- 立即回應 `{ success: true }`
- 結果透過 SSE 推送

## 涉及檔案

| 檔案 | 變更類型 | 說明 |
|------|---------|------|
| `src/core/InteractionHandler.ts` | 修改 | 新增 agentId、EventBus emit、靜態 registry |
| `src/core/MessageProcessor.ts` | 修改 | 傳遞 agentId 到 InteractionHandler |
| `src/webui/services/SSEBroadcaster.ts` | 修改 | 監聽 interaction 事件 |
| `src/webui/api/messages.api.ts` | 修改 | 新增 resolve-permission、resolve-question endpoint；send 改 fire-and-forget |
| `public/js/live.js` | 修改 | SSE interaction 事件處理、選項渲染、resolve API 呼叫 |
| `public/css/live.css` | 修改 | 選項按鈕樣式（galgame 風格） |
| `src/webui/views/live/index.ejs` | 可能不需要改 | quick-reply 容器已存在，動態渲染即可 |

## 已知附帶問題（同步修復）

| 問題 | 說明 | 修復方式 |
|------|------|---------|
| Blocking API | `POST /send` await processMessage 才回應 | 改 fire-and-forget |
| Backlog 訊息截斷 | 使用者訊息截到 60 字元 | `formatDialogueEvent` 中 task_received 截斷值加大 |
| Quick reply 未禁用 | 送出時 quick reply 按鈕沒同步禁用 | sendMessageToAgent 中同步禁用 |