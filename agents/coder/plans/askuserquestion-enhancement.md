# AskUserQuestion 補強計畫

## 現狀分析

### SDK 定義（`AskUserQuestionInput`）

```typescript
{
  questions: [{              // 1-4 個問題
    question: string;        // "Which library should we use?"
    header: string;          // "Library" (max 12 chars)
    options: [{              // 2-4 個選項
      label: string;         // "React Query"
      description: string;   // "Best for server state"
    }, ...];
    multiSelect: boolean;    // 可多選
  }, ...];
  answers?: Record<string, string>;  // SDK 回傳用
}
```

SDK 註解：`There should be no 'Other' option, that will be provided automatically.`

### 目前 ClaudeCab 實作

**InteractionHandler.handleAskUserQuestion()**
- ✅ 支援選項按鈕
- ✅ 按鈕回調正常
- ⚠️ 只處理 `questions[0]`（第一個問題）
- ✅ 支援 multiSelect（2026-02-28 完成）
- ✅ 支援 Other（自訂輸入）（2026-02-28 完成）

**TelegramAdapter.sendQuestionPrompt()**
- 每個選項一個 InlineKeyboard 按鈕
- callback: `q_opt_{requestId}:{optionIndex}`
- 回應格式：`answers[question] = selectedLabel`

---

## 補強項目

### 1. Other 自訂輸入

**需求**：SDK 說「Other 會自動提供」，但 ClaudeCab 沒實作。

**方案**：
1. 在 InlineKeyboard 加一個「📝 其他」按鈕
2. 點擊後，Bot 回覆「請輸入您的答案：」
3. 監聽下一則訊息作為答案
4. 將用戶輸入作為 `answer` 回傳

**難點**：
- 需要追蹤「等待自訂輸入」狀態
- 可能與正常訊息處理衝突
- 超時處理

**實作路徑**：
- `QuestionBridge` 新增 `pendingCustomInput` 狀態
- `TelegramAdapter` 新增 `q_other_{requestId}` callback
- `handleTextMessage` 檢查是否有 pending custom input

### 2. 多選（multiSelect）

**需求**：`multiSelect: true` 時允許選多個選項。

**方案**：
1. 按鈕改為 toggle（選中顯示 ✓）
2. 新增「確認」按鈕
3. 收集所有選中項，用逗號分隔回傳

**難點**：
- Telegram InlineKeyboard 不支援「狀態」，需用 editMessageReplyMarkup 更新
- 追蹤選中狀態

**實作路徑**：
- `QuestionBridge` 新增 `selectedOptions: Set<number>` 追蹤
- 點擊選項 → toggle + 更新 keyboard
- 點擊確認 → 收集所有選中項回傳

### 3. 多問題處理

**需求**：SDK 允許 1-4 個問題，目前只處理第一個。

**方案**：
1. 依序顯示每個問題
2. 收集所有答案到 `answers` 物件
3. 全部完成後回傳

**難點**：
- 需要追蹤「第幾個問題」狀態
- 用戶中途取消的處理

**實作路徑**：
- 修改 `handleAskUserQuestion` 為 loop
- 每個問題獨立 `requestQuestion` + `sendQuestionPrompt`
- 任一問題取消 → 整體取消

---

## 優先順序建議

| 優先級 | 功能 | 理由 | 狀態 |
|--------|------|------|------|
| P1 | Other 自訂輸入 | SDK 說「自動提供」，ClaudeCab 沒實作是缺陷 | ✅ 完成 |
| P2 | multiSelect | 常見需求，但目前沒遇到實際使用場景 | ✅ 完成 |
| P3 | 多問題 | SDK 支援但較少用到 | 待實作 |

---

## P1 實作細節：Other 自訂輸入

### 修改檔案

| 檔案 | 變更 |
|------|------|
| `src/adapters/types.ts` | `QuestionPromptOptions` 新增 `allowOther?: boolean` |
| `src/adapters/TelegramAdapter.ts` | 新增「📝 其他」按鈕、處理 `q_other_` callback |
| `src/core/QuestionBridge.ts` | 新增 `awaitingCustomInput` 狀態 |
| `src/core/InteractionHandler.ts` | 傳遞 `allowOther: true` |

### 流程

```
1. 發送問題 → InlineKeyboard
   [Option A] [Option B]
   [📝 其他]

2. 用戶點「📝 其他」
   → callback: q_other_{requestId}
   → Bot 回覆：「請輸入您的答案：」
   → 設定 awaitingCustomInput[chatId] = requestId

3. 用戶輸入文字
   → handleTextMessage 檢查 awaitingCustomInput
   → 如果有，將文字作為答案，resolve question
   → 清除 awaitingCustomInput

4. 超時處理
   → 60 秒無輸入 → 取消等待、恢復正常訊息處理
```

### 狀態追蹤

```typescript
// TelegramAdapter 新增
private awaitingCustomInput = new Map<string, {
  requestId: string;
  promptMessageId: string;
  timer: NodeJS.Timeout;
}>();
```

---

## 風險評估

| 風險 | 等級 | 緩解 |
|------|------|------|
| 自訂輸入與正常訊息衝突 | 中 | 用 chatId 區分、有超時機制 |
| 狀態複雜度增加 | 中 | 清楚的狀態機設計 |
| 測試覆蓋 | 低 | 手動測試 + 單元測試 |

---

## 預計改動量

- P1（Other）: ~150 行
- P2（multiSelect）: ~100 行
- P3（多問題）: ~50 行
