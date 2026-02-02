# ADR-017: Telegram 群組對話支援設計

**狀態**：✅ accepted  
**日期**：2026-02-02

## 背景

用戶需要在 Telegram 群組中與 Bot 互動，而非只限於私聊。這帶來兩個挑戰：

1. **觸發機制**：群組中所有訊息都會觸發 Bot，需要過濾非相關訊息
2. **Session 管理**：群組中多個用戶應該共享還是獨立對話歷史？

## 需求分析

### Phase 1：1 User + 1 Bot 群組
- 用戶在群組中與單一 bot 互動
- Bot 回應顯示在群組中

### Phase 2：多 Bot + 1 User 群組（未來）
- 多個 bot 在同一群組各司其職
- Bot 之間可以溝通

## 決策

### 1. 觸發機制

**選擇**：僅回應 @mention 或 reply to bot

```typescript
if (isGroupChat && this.botInfo !== null) {
  const isMentioned = message.text.includes(`@${this.botInfo.username}`);
  const isReplyToBot = message.reply_to_message?.from?.id === this.botInfo.id;
  if (!isMentioned && !isReplyToBot) return;
}
```

**理由**：
- 避免 bot 回應所有無關訊息
- 符合 Telegram bot 的標準行為模式
- 用戶體驗直觀

### 2. Session Key 設計

**選擇**：群組共享歷史（基於 chatId）

| 模式 | Session Key |
|------|-------------|
| 私聊 | `platform::agentId::userId` |
| 群組 | `platform::agentId::group::chatId` |

**考慮過的方案**：
- **A. 個人獨立**：`platform::agentId::userId::chatId` - 每人獨立歷史
- **B. 群組共享**：`platform::agentId::group::chatId` - 所有成員共享 ✅

**選擇 B 的理由**：
- 群組對話本質上是公開的，所有成員看到相同內容
- 共享歷史讓 Bot 能理解完整上下文
- 減少 session 數量，降低資源消耗

### 3. 回應策略

**選擇**：使用 reply_to_message_id

群組中發送訊息時附帶 `reply_to_message_id`，讓回覆關聯原訊息。

**理由**：
- 方便追蹤對話脈絡
- 符合 Telegram 群組對話習慣
- 多人對話時更清晰

### 4. 多 Bot Token

**選擇**：每個 Bot 獨立 Telegram Token

**理由**：
- Telegram 要求每個 bot 有獨立 token
- 便於管理和權限控制
- Phase 2 多 Bot 協作的必要條件

## 實現

### 修改的檔案

| 檔案 | 變更 |
|------|------|
| `TelegramAdapter.ts` | 新增 `botInfo`、群組觸發判斷 |
| `TelegramCommands.ts` | `handleStop`、`getCurrentSession` 支援 effectiveUserId |
| `MessageProcessor.ts` | 計算 effectiveUserId、傳遞 replyToMessageId |

### effectiveUserId 計算邏輯

```typescript
const isGroupChat = message.metadata?.isGroupChat === true;
const effectiveUserId = isGroupChat ? `group::${chatId}` : userId;
```

## 後果

**正面**：
- 群組對話功能上線
- 用戶可以在群組中自然地與 Bot 互動
- 為 Phase 2 多 Bot 協作奠定基礎

**負面**：
- 群組共享歷史可能在某些場景不適用（如私密對話）
- 需要後續實現更細粒度的權限控制

## 未來擴展

Phase 2 多 Bot 協作：
- GroupRouter 訊息路由
- Bot 間溝通機制
- 分工邏輯配置
