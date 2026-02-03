# ADR-019: 群組對話架構重設計 - Multi-Agent 協作生態系統

**狀態**：✅ accepted（已實作）
**日期**：2026-02-03
**相關**：ADR-017, ADR-018

---

## 背景

ADR-018 實現了「所有 Bot 都 query，只有被 mention 的回覆」方案。當時的設計假設：

> 「所有 Bot 都執行 query（維護各自的 session），只有被 @mention 或 reply to 的 Bot 發送回覆，其他 Bot 以觀察模式運行。」

**實際使用中發現問題**：「coder 不知道我剛剛跟 general 對話的內容，這很奇怪」

---

## 用戶願景

> 「我本來期望的是大家可以分部門放在群組裡面自成一個生態系，我可以提出需求讓適合的人去執行。例如我 tag 主管，主管再分配任務透過群組對話 tag 其他人把任務分下去執行，然後再一一回報，主管負責統整訊息。當然今天娛樂性高一點也可以讓部門每個人之間有主動聊天互動回訊息的模式。」

### 核心需求

1. **任務分配**：主管 Bot 可以分配任務給其他 Bot（透過 @mention）
2. **Bot 互動**：Bot 之間可以透過群組對話互相溝通
3. **團隊協作**：類似真實團隊的協作模式
4. **上下文共享**：每個 Bot 能「看到」其他 Bot 的對話和回覆
5. **模式切換**：支援 silent 觀察和主動回覆兩種模式

---

## 現況分析

### 目前架構

```
TelegramAdapter (每個 Bot 各一個)
       ↓ emit 'group:message'
GroupBroadcaster
       ↓ 去重後處理
MessageProcessor
       ↓ SDK 查詢
SDKQueryManager
       ↓ resume: sdkSessionId
Claude Agent SDK
```

### Session 模型

- **Session Key**：`${platform}:${agentId}:${userId}`
- **群組 userId**：`group::${chatId}`
- **SDK Session**：每個 Bot 有獨立的 `sdkSessionId`

### 訊息流程

1. 用戶在群組發送訊息
2. 每個 TelegramAdapter 都收到訊息，發出 `group:message` 事件
3. GroupBroadcaster 去重後，為每個 Bot 調用 MessageProcessor
4. 被 @mention 的 Bot 用 `full` 模式（SDK 查詢 + 回覆）
5. 其他 Bot 用 `silent` 模式（只記錄到 DB，不調用 SDK）
6. `bot:replied` 事件將回覆廣播到其他 Bot 的 DB session

---

## 問題診斷

### 根本原因：SDK Session 隔離

```
SDK 查詢使用 resume: sdkSessionId 恢復對話
         ↓
每個 Bot 有獨立的 sdkSessionId
         ↓
general 的 SDK session 只包含 general 的對話
coder 的 SDK session 只包含 coder 的對話
         ↓
DB 中的對話歷史（包括 bot:replied 廣播）不會被 SDK 讀取
         ↓
❌ coder 永遠看不到 general 的對話！
```

### 訊息流程缺陷

```
1. 用戶 @mention general → general 用 SDK 回覆
2. bot:replied 廣播 → general 的回覆記錄到 coder 的 DB session
3. 用戶 @mention coder → coder 用 SDK 回覆
4. SDK resume coder 的 session → 只有 coder 自己的歷史
5. ❌ coder 看不到 general 的回覆（只在 DB 中，SDK 不讀取）
```

### 其他問題

1. **訊息重複記錄**：silent 模式每個 Bot 都記錄一次，加上 bot:replied 廣播
2. **Telegram 格式錯誤**：bot:replied 廣播時 MarkdownV2 解析失敗

---

## 關鍵發現

### DB vs SDK 的斷裂

| 層面 | DB（ConversationRepository） | SDK |
|------|------------------------------|-----|
| 用途 | WebUI 顯示、審計 | 實際對話恢復 |
| 對話歷史 | 完整（包含 bot:replied 廣播） | 獨立（只有自己的對話） |
| Bot 互通 | ✅ 透過 bot:replied 廣播 | ❌ 各自獨立 session |

### ADR-018 的假設錯誤

ADR-018 假設「observeOnly 模式下執行 SDK query 可以維護 session 歷史」，但實際上：
- `observeOnly` 模式不發送回覆
- 但 SDK session 只記錄「自己說的話」和「用戶說的話」
- **其他 Bot 的回覆不會進入 SDK session**

---

## 決策

### 方案選擇：Context Injection（增量注入）

**排除方案：共享 SDK Session**

每個 Bot 的 SDK Session 包含完整執行過程（tool calls、thinking、中間步驟），共享會導致：
- 其他 Bot 的 context 被無關的執行細節塞滿
- Token 成本爆炸
- 上下文污染

**資訊的公開 vs 私有**

```
┌─────────────────────────────────────────┐
│ 私有（不該共享給其他 Bot）              │
│ • Tool calls 過程                       │
│ • Thinking / reasoning                  │
│ • 中間執行步驟、錯誤重試                │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│ 公開（需要共享給其他 Bot）              │
│ • 用戶訊息                              │
│ • Bot 的最終回覆                        │
└─────────────────────────────────────────┘
```

**採用方案：Context Injection**

每個 Bot 維持**獨立 SDK Session**，但在 query 時注入「群組對話歷史（公開部分）」：

```
SDK Query 時的 context 組成：

┌─────────────────────────────────────────┐
│ 1. System Prompt（Bot 人格）            │
├─────────────────────────────────────────┤
│ 2. 注入：群組對話歷史（公開部分）       │
│    - [User] @general 幫我查資料         │
│    - [general] 查到了 XXX               │
│    - [User] @coder 根據這個寫程式       │
├─────────────────────────────────────────┤
│ 3. SDK Resume：自己的工作記憶           │
│    （包含自己之前的 tool calls 等）     │
└─────────────────────────────────────────┘
```

---

### 增量注入機制

**問題：避免重複注入**

```
時間軸：
msg-1~4: 群組對話
msg-5: @coder 觸發 → 注入 msg 1~4
msg-6~9: 群組對話
msg-10: @coder 觸發 → 應該只注入 msg 6~9（不含 1~4）
```

**解法：Injection Cursor**

每個 Bot 記錄「上次 SDK query 時，群組歷史注入到哪裡」

---

### 資料結構：group_injection_state 表

```sql
CREATE TABLE group_injection_state (
  id              SERIAL PRIMARY KEY,
  agent_id        VARCHAR(50) NOT NULL,    -- Bot ID
  chat_id         VARCHAR(100) NOT NULL,   -- 群組 ID
  platform        VARCHAR(20) NOT NULL,    -- 'telegram'

  -- 加入時間點（Bot 不會看到加入前的歷史）
  joined_at       TIMESTAMP NOT NULL,
  joined_msg_id   INTEGER,

  -- 注入 cursor
  last_injected_msg_id  INTEGER,
  last_injected_at      TIMESTAMP,

  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),

  UNIQUE(platform, agent_id, chat_id)
);
```

---

### 邊界情況決策

| 情況 | 決策 |
|------|------|
| **Cursor 基準** | 用 `message_id`（Telegram chat 內遞增，較可靠） |
| **注入時排除自己** | ✅ 自己的回覆已在 SDK session，不重複注入 |
| **Cursor 更新時機** | SDK query **成功後**才更新，避免失敗時遺漏訊息 |
| **訊息數量上限** | 設定上限（例如最近 50 條或 4000 tokens） |
| **新 Bot 加入群組** | 不注入任何歷史，cursor 從加入時間點開始 |
| **「加入」的定義** | 第一次收到群組訊息時 lazy 建立 state |
| **併發 @mention** | 各自獨立的 injection state，無衝突 |
| **訊息刪除/編輯** | 暫時忽略，已注入的不追溯 |

---

### 注入邏輯

```typescript
async function getMessagesToInject(agentId: string, chatId: string) {
  const state = await getInjectionState(agentId, chatId);

  // 決定起始點
  const startFrom = state.lastInjectedMsgId
    ?? state.joinedMsgId    // 首次 query，從加入點開始
    ?? null;                // 都沒有就不注入

  if (!startFrom) {
    return []; // 新加入，沒有歷史要注入
  }

  // 撈 startFrom 之後的訊息（排除自己）
  return await getGroupMessages({
    chatId,
    afterMsgId: startFrom,
    excludeAgentId: agentId,
    limit: 50,
  });
}

// 收到群組訊息時，確保 state 存在
async function ensureInjectionState(agentId, chatId, currentMsgId) {
  const existing = await getInjectionState(agentId, chatId);
  if (!existing) {
    await createInjectionState({
      agentId,
      chatId,
      joinedAt: new Date(),
      joinedMsgId: currentMsgId,
    });
  }
}
```

---

### 注入格式

區分「背景資訊」與「當前訊息」：

```
[群組對話紀錄]
[10:30] User: @general 查天氣
[10:31] general: 今天晴天 25°C
[10:32] User: 不錯耶

[當前訊息]
User: @coder 根據上面寫個天氣 widget
```

---

## 實作狀態

- [x] 建立 `group_messages` 和 `group_injection_state` 表（SCHEMA_VERSION 5）
- [x] 實作 `GroupMessageRepository` - 記錄群組訊息
- [x] 實作 `InjectionStateRepository` - 管理注入狀態
- [x] 實作 `ContextInjector` - 撈取待注入訊息並格式化
- [x] 修改 SDK query 流程，注入群組歷史
- [x] Cursor 更新邏輯（成功後更新）
- [x] 注入格式設計與實作
- [x] 移除 ADR-018 遺留的 silent mode / observeMode
- [x] Content-based 去重（解決 per-bot message_id 問題）
- [x] Autoincrement ID cursor（取代 platform_msg_id cursor）
- [x] Per-bot message_id 映射（解決 reply_to 失敗問題）
- [x] 注入格式改進（LLM 可理解的中文 framing）

---

## 實作過程發現的問題

### Race Condition: ensureState 時機

**問題**：每個 TelegramAdapter 獨立 emit `group:message` 事件，但 GroupBroadcaster 會去重。

```
訊息到達時：
1. general 的事件先到達 → registerBotInGroup(general) → 去重通過
2. ensureState 只為當時的 members 建立（只有 general）
3. coder 的事件到達 → registerBotInGroup(coder) → 去重失敗，return
4. coder 沒有 ensureState！他的 joined_msg_id 要到下一個訊息才會建立
```

**修復**：將 `ensureState` 移到去重檢查**之前**，針對 `sourceAgentId` 執行：

```typescript
// Register bot
this.registerBotInGroup(chatId, sourceAgentId);

// IMPORTANT: Ensure injection state BEFORE dedup check!
if (platformMsgId && this.injectionStateRepository) {
  this.injectionStateRepository.ensureState(
    sourceAgentId,  // 只為當前 bot 建立
    chatId,
    message.platform,
    platformMsgId
  );
}

// Deduplicate
if (this.processedMessages.has(messageKey)) {
  return; // 重複訊息被跳過，但 ensureState 已執行
}
```

這樣每個 Bot 在收到訊息時都會為自己建立 injection state。

### Regular Telegram Group 的 per-bot message_id 問題

**問題**：在一般 Telegram 群組（非 supergroup）中，每個 Bot 對同一則物理訊息會收到**不同的 `message_id`**。

```
同一則用戶訊息：
general 看到 message_id = 1457
coder   看到 message_id = 93
```

這導致三個問題：

#### 1. 去重失敗 → 重複記錄

原先去重 key 使用 `message.id`（`telegram:${message_id}:${chat_id}`），但每個 Bot 的 `message_id` 不同，導致同一訊息被記錄多次。

**修復**：改用 content-based 去重 key：
```typescript
const dedupeTs = Math.floor(message.timestamp.getTime() / 1000);
const messageKey = `${chatId}:${message.userId}:${dedupeTs}:${message.text.substring(0, 50)}`;
```

#### 2. Cursor 比較失效 → Context Injection 斷裂

原先 cursor 使用 `platform_msg_id` 比較（`WHERE CAST(platform_msg_id AS INTEGER) > ?`），但不同 Bot 的 `message_id` 在不同數值範圍，導致比較結果錯誤。

```
general 的 message_id 範圍: 1412-1461
coder   的 message_id 範圍: 51-99
cursor = 1458 → coder 的回覆 (msg_id=98) 永遠被過濾掉！
```

**修復**：改用 `group_messages.id`（autoincrement）作為 cursor：
```sql
-- GroupMessageRepository.getMessagesAfter
SELECT * FROM group_messages
WHERE platform = ? AND chat_id = ? AND id > ?
  AND NOT (sender_type = 'bot' AND sender_id = ?)
ORDER BY id ASC LIMIT ?
```

同時 `ensureState` 改用 `getLatestId()`（autoincrement）而非 `platformMsgId`。

#### 3. reply_to_message_id 不匹配 → 回覆失敗

去重後只有第一個 Bot 的事件通過，其 `platformMsgId` 被傳給 responding bot。但 responding bot 的 adapter 使用的是不同的 `message_id`，導致 Telegram API 回傳 `Bad Request: message to be replied not found`。

**修復**：在 GroupBroadcaster 中建立 `perBotMessageIds` 映射，在去重**之前**記錄每個 Bot 各自看到的 `message_id`：

```typescript
// 每個 Bot 的事件到達時（去重前），記錄其 message_id
private readonly perBotMessageIds: Map<string, Map<string, string>> = new Map();

// 去重前存儲
let botMsgIds = this.perBotMessageIds.get(messageKey);
if (botMsgIds === undefined) {
  botMsgIds = new Map();
  this.perBotMessageIds.set(messageKey, botMsgIds);
}
botMsgIds.set(sourceAgentId, platformMsgId);

// 去重後，查找 responding bot 自己的 message_id
let respondingBotMsgId = this.perBotMessageIds.get(messageKey)?.get(respondingBot);
```

另有 `waitForBotMessageId()` 方法處理 race condition（responding bot 的事件可能還沒到達）：

```typescript
private async waitForBotMessageId(
  messageKey: string, agentId: string, timeoutMs: number
): Promise<string | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const msgId = this.perBotMessageIds.get(messageKey)?.get(agentId);
    if (msgId !== undefined) return msgId;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return undefined; // timeout: 發送訊息但不帶 reply_to
}
```

### LLM 無法理解注入的上下文

**問題**：注入的歷史使用英文標記和模糊的 framing，Bot 誤以為注入內容只是用戶訊息格式，未意識到這是其他 Bot 的真實回覆。

**修復**：改用明確的中文系統指令 framing：

```
[SYSTEM: 以下是此群組中已發生的真實聊天紀錄。
標記為 [@...] 的訊息是群組中其他機器人的實際回覆，這些都是事實。
請在回答時參考這些對話內容。]
---
[10:30] [User (@john)]: @general 查天氣
[10:31] [@general_bot]: 今天晴天 25°C
---
[以下是使用者現在發送的新訊息]
```
