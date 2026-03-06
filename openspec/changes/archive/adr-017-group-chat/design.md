# 設計：Telegram 群組對話支援設計

## Decisions

### 觸發機制：僅回應 @mention 或 reply to bot

群組中僅在被 @mention 或 reply to bot 時才回應，避免回應所有無關訊息，符合 Telegram bot 的標準行為模式。

### Session Key：群組共享歷史

| 模式 | Session Key |
|------|-------------|
| 私聊 | `platform::agentId::userId` |
| 群組 | `platform::agentId::group::chatId` |

選擇群組共享歷史的理由：群組對話本質上是公開的，所有成員看到相同內容；共享歷史讓 Bot 能理解完整上下文；減少 session 數量，降低資源消耗。

### 回應策略：使用 reply_to_message_id

群組中發送訊息時附帶 `reply_to_message_id`，讓回覆關聯原訊息，方便追蹤對話脈絡。

### 多 Bot Token：每個 Bot 獨立 Telegram Token

Telegram 要求每個 bot 有獨立 token，便於管理和權限控制，也是 Phase 2 多 Bot 協作的必要條件。

### effectiveUserId 計算邏輯

群組中使用 `group::${chatId}` 作為 effectiveUserId，私聊中使用原始 userId。

## Risks / Trade-offs

### 正面
- 群組對話功能上線
- 用戶可以在群組中自然地與 Bot 互動
- 為 Phase 2 多 Bot 協作奠定基礎

### 負面
- 群組共享歷史可能在某些場景不適用（如私密對話）
- 需要後續實現更細粒度的權限控制

## Affected Components

| 檔案 | 變更 |
|------|------|
| `TelegramAdapter.ts` | 新增 `botInfo`、群組觸發判斷 |
| `TelegramCommands.ts` | `handleStop`、`getCurrentSession` 支援 effectiveUserId |
| `MessageProcessor.ts` | 計算 effectiveUserId、傳遞 replyToMessageId |
