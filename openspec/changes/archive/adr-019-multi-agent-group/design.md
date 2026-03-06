# 設計：群組對話架構重設計 - Multi-Agent 協作生態系統

## Decisions

### Context Injection（增量注入）方案

每個 Bot 維持獨立 SDK Session，但在 query 時注入「群組對話歷史（公開部分）」。排除共享 SDK Session 方案，因為其他 Bot 的 context 會被無關的執行細節塞滿，造成 token 成本爆炸和上下文污染。

公開資訊（需共享）：用戶訊息、Bot 的最終回覆。私有資訊（不共享）：Tool calls 過程、Thinking / reasoning、中間執行步驟和錯誤重試。

### 增量注入機制（Injection Cursor）

每個 Bot 記錄「上次 SDK query 時，群組歷史注入到哪裡」，避免重複注入。

### group_injection_state 資料結構

記錄 agent_id、chat_id、platform、joined_at、joined_msg_id、last_injected_msg_id、last_injected_at。Cursor 更新時機：SDK query 成功後才更新，避免失敗時遺漏訊息。

### 邊界情況決策

| 情況 | 決策 |
|------|------|
| Cursor 基準 | 用 `message_id`（Telegram chat 內遞增，較可靠） |
| 注入時排除自己 | 自己的回覆已在 SDK session，不重複注入 |
| Cursor 更新時機 | SDK query 成功後才更新 |
| 訊息數量上限 | 最近 50 條或 4000 tokens |
| 新 Bot 加入群組 | 不注入任何歷史，cursor 從加入時間點開始 |
| 「加入」的定義 | 第一次收到群組訊息時 lazy 建立 state |
| 併發 @mention | 各自獨立的 injection state，無衝突 |
| 訊息刪除/編輯 | 暫時忽略，已注入的不追溯 |

### ensureState Race Condition 修復

將 ensureState 移到去重檢查之前，針對 sourceAgentId 執行，確保每個 Bot 在收到訊息時都會為自己建立 injection state。

### Content-based 去重

一般 Telegram 群組（非 supergroup）中，每個 Bot 對同一則物理訊息會收到不同的 message_id。改用 content-based 去重 key：`${chatId}:${userId}:${timestamp}:${text.substring(0, 50)}`。

### Autoincrement ID Cursor

改用 `group_messages.id`（autoincrement）作為 cursor，取代 platform_msg_id cursor，解決不同 Bot 的 message_id 在不同數值範圍的問題。

### Per-bot message_id 映射

在 GroupBroadcaster 中建立 perBotMessageIds 映射，在去重之前記錄每個 Bot 各自看到的 message_id，解決 reply_to_message_id 不匹配問題。包含 waitForBotMessageId() 方法處理 race condition。

### 注入格式

使用明確的中文系統指令 framing，區分「群組對話紀錄」與「當前訊息」，讓 LLM 能正確理解注入的上下文。

## Risks / Trade-offs

- 每條群組訊息會觸發所有 Bot 的處理（API 成本）
- 注入的上下文佔用 token 額度
- 訊息刪除/編輯暫時不追溯
- 一般 Telegram 群組的 per-bot message_id 問題增加實現複雜度

## Affected Components

- `group_messages` 表（SCHEMA_VERSION 5）
- `group_injection_state` 表（SCHEMA_VERSION 5）
- `GroupMessageRepository` — 記錄群組訊息
- `InjectionStateRepository` — 管理注入狀態
- `ContextInjector` — 撈取待注入訊息並格式化
- `GroupBroadcaster` — 去重、ensureState、perBotMessageIds 映射
- SDK query 流程 — 注入群組歷史
