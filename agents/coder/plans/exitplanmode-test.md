# ExitPlanMode UI 測試計畫

## 目標

驗證 ExitPlanMode 在 Telegram 顯示專屬的「📋 Plan Review」UI，而非被當成一般權限請求。

## 測試步驟

### 1. 啟動 ClaudeCab

```bash
cd F:\_Program\OwnProject\ClaudeCab
npm run dev
```

### 2. 觸發 ExitPlanMode

在 Telegram 對話中請求需要規劃的任務，例如：

```
幫我在 remotions 專案新增一個 fade-in 動畫元件
```

Agent 應該：
1. 進入 plan mode
2. 寫計畫到檔案
3. 呼叫 `ExitPlanMode` 工具

### 3. 預期結果

Telegram 顯示：

```
📋 *Plan Review*

Claude 已完成計畫，請審核：

*需要的權限：*
• Bash: run tests
• Bash: install dependencies

[✅ 核准] [❌ 拒絕]
```

**而非**舊的：
```
🔐 *Permission Request*
Tool: `ExitPlanMode`
```

### 4. 驗證按鈕功能

| 操作 | 預期行為 |
|------|---------|
| 點擊「✅ 核准」 | 顯示「✅ 已核准」，Agent 開始執行計畫 |
| 點擊「❌ 拒絕」 | 顯示「❌ 已拒絕」，Agent 收到拒絕訊息 |

### 5. 邊界情況

- [ ] 無 `allowedPrompts` 時不顯示權限區塊
- [ ] 多個 `allowedPrompts` 正確列出
- [ ] Callback 超時處理
- [ ] 同時有多個 plan review 請求

## 回滾方案

若有問題，還原以下檔案：
- `src/adapters/types.ts`
- `src/adapters/BaseAdapter.ts`
- `src/adapters/TelegramAdapter.ts`
- `src/core/InteractionHandler.ts`
- `src/core/index.ts`
- `src/types/events.ts`

刪除：
- `src/core/ExitPlanModeBridge.ts`
