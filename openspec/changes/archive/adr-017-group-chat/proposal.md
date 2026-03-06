# Telegram 群組對話支援設計

## Why

用戶需要在 Telegram 群組中與 Bot 互動，而非只限於私聊。這帶來兩個挑戰：

1. **觸發機制**：群組中所有訊息都會觸發 Bot，需要過濾非相關訊息
2. **Session 管理**：群組中多個用戶應該共享還是獨立對話歷史？

### Phase 1：1 User + 1 Bot 群組
- 用戶在群組中與單一 bot 互動
- Bot 回應顯示在群組中

### Phase 2：多 Bot + 1 User 群組（未來）
- 多個 bot 在同一群組各司其職
- Bot 之間可以溝通

## What Changes

1. **觸發機制**：僅回應 @mention 或 reply to bot，避免回應所有無關訊息
2. **Session Key 設計**：群組共享歷史（基於 chatId），Session Key 為 `platform::agentId::group::chatId`
3. **回應策略**：使用 reply_to_message_id，讓回覆關聯原訊息
4. **多 Bot Token**：每個 Bot 獨立 Telegram Token

## Capabilities

- 群組對話功能上線
- 用戶可以在群組中自然地與 Bot 互動
- 為 Phase 2 多 Bot 協作奠定基礎
