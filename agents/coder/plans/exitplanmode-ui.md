# ClaudeCab SDK 互動 UI 差異化計畫

## 目標

為 ClaudeCab 實作差異化的 Telegram UI，讓不同的 SDK 互動類型有專屬介面：
- **AskUserQuestion** — 選項按鈕（已實作，需補強）
- **ExitPlanMode** — 計畫審核介面（**新增**）
- **Permission Request** — 權限確認（已完善）

---

## 需修改的檔案

| 檔案 | 修改類型 | 說明 |
|------|---------|------|
| `src/adapters/types.ts` | 新增型別 | ExitPlanModePromptOptions, ExitPlanModeResolver |
| `src/adapters/BaseAdapter.ts` | 新增方法 | sendExitPlanModePrompt, setExitPlanModeResolver |
| `src/adapters/TelegramAdapter.ts` | 實作 | 專屬 UI + callback 路由 |
| `src/core/InteractionHandler.ts` | 新增分支 | handleExitPlanMode() |

---

## 實作步驟

### Step 1: 定義型別 (`types.ts`)

```typescript
export interface ExitPlanModePromptOptions {
  requestId: string;
  planFilePath?: string;        // plan 檔案路徑
  allowedPrompts?: Array<{      // SDK 提供的權限清單
    tool: string;
    prompt: string;
  }>;
}

export interface ExitPlanModePromptResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export type ExitPlanModeResolver = (
  requestId: string,
  decision: 'approve' | 'reject'
) => void;
```

### Step 2: BaseAdapter 方法 (`BaseAdapter.ts`)

新增抽象方法：
- `sendExitPlanModePrompt(chatId, options)`
- `updateExitPlanModePrompt(chatId, messageId, text)`
- `setExitPlanModeResolver(resolver)`

### Step 3: TelegramAdapter 實作 (`TelegramAdapter.ts`)

#### 3.1 sendExitPlanModePrompt()

```typescript
override async sendExitPlanModePrompt(
  chatId: string,
  options: ExitPlanModePromptOptions
): Promise<ExitPlanModePromptResult> {
  const keyboard = new InlineKeyboard()
    .text('✅ 核准', `plan_approve:${options.requestId}`)
    .text('❌ 拒絕', `plan_reject:${options.requestId}`);

  const allowedList = options.allowedPrompts?.length
    ? options.allowedPrompts.map(p => `• ${p.tool}: ${p.prompt}`).join('\n')
    : '（無特殊權限）';

  const text = [
    '📋 *Plan Review*',
    '',
    'Claude 已完成計畫，請審核：',
    '',
    '*需要的權限：*',
    allowedList,
  ].join('\n');

  // ... 發送訊息
}
```

#### 3.2 Callback 路由

在 `doInitialize()` 的 callback_query handler 新增：

```typescript
// ExitPlanMode 回調
const planMatch = /^plan_(approve|reject):(.+)$/.exec(data);
if (planMatch !== null) {
  const decision = planMatch[1] as 'approve' | 'reject';
  const requestId = planMatch[2];
  this.exitPlanModeResolver?.(requestId, decision);
  await ctx.answerCallbackQuery();
  return;
}
```

### Step 4: InteractionHandler 整合 (`InteractionHandler.ts`)

#### 4.1 新增 exitPlanModeResolver 連結

```typescript
adapter.setExitPlanModeResolver((requestId, decision) => {
  if (decision === 'approve') {
    this.permissionBridge.resolvePermission(requestId, { behavior: 'allow' });
  } else {
    this.permissionBridge.resolvePermission(requestId, {
      behavior: 'deny',
      message: 'User rejected the plan',
    });
  }
});
```

#### 4.2 buildCanUseTool 新增分支

```typescript
if (toolName === 'AskUserQuestion') {
  return this.handleAskUserQuestion(toolInput, options);
}
if (toolName === 'ExitPlanMode') {
  return this.handleExitPlanMode(toolInput, options);  // 新增
}
return this.handlePermission(toolName, toolInput, options);
```

#### 4.3 handleExitPlanMode 方法

```typescript
private async handleExitPlanMode(
  toolInput: Record<string, unknown>,
  options: CanUseToolOptions
): Promise<CanUseToolResult> {
  const allowedPrompts = toolInput.allowedPrompts as Array<{tool: string; prompt: string}> | undefined;

  const { requestId, promise } = this.permissionBridge.requestPermission(
    'ExitPlanMode',
    toolInput,
    { signal: options.signal, toolUseID: options.toolUseID }
  );

  // 發送專屬 UI
  await this.adapter.sendExitPlanModePrompt(this.chatId, {
    requestId,
    allowedPrompts,
  });

  const decision = await promise;

  if (decision.behavior === 'allow') {
    return {
      behavior: 'allow',
      updatedInput: toolInput,
      toolUseID: options.toolUseID,
    };
  }

  return {
    behavior: 'deny',
    message: decision.message ?? 'User rejected the plan',
    toolUseID: options.toolUseID,
  };
}
```

---

## Telegram UI 預覽

### ExitPlanMode (新增)
```
📋 *Plan Review*

Claude 已完成計畫，請審核：

*需要的權限：*
• Bash: run tests
• Bash: install dependencies

[✅ 核准] [❌ 拒絕]
```

### Permission Request (現有)
```
🔐 *Permission Request*

Tool: `Bash`
Reason: Running test command
Input:
```json
{"command": "npm test"}
```

[✅ Allow] [✅ Always] [❌ Deny]
```

### AskUserQuestion (現有)
```
❓ *Library*

Which library should we use for date formatting?

1. **Day.js**: Lightweight date library
2. **Moment.js**: Full-featured but heavy

[Day.js] [Moment.js]
```

---

## 驗證方式

1. **手動測試**
   - 啟動 ClaudeCab
   - 讓 Claude 進入 Plan Mode 並退出
   - 確認 Telegram 顯示 📋 Plan Review 而非 🔐 Permission Request
   - 點擊按鈕確認回調正常

2. **檢查點**
   - [ ] ExitPlanMode 使用專屬訊息格式
   - [ ] 按鈕文字是「核准/拒絕」而非「Allow/Deny」
   - [ ] allowedPrompts 有正確顯示
   - [ ] 點擊後訊息更新為決策結果

---

## 備註

**不需要新建 Bridge**：ExitPlanMode 可以直接複用 PermissionBridge，因為它本質上也是一個「允許/拒絕」的二元決策，只是 UI 呈現不同。
