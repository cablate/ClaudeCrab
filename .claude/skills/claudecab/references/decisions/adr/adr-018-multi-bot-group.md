# ADR-018: 多 Bot 群組協作設計

**狀態**：✅ accepted  
**日期**：2026-02-02

## 背景

ADR-017 完成了群組對話 Phase 1（1 User + 1 Bot）。Phase 2 的目標是讓多個 Bot 在同一群組中協作：

- 多個 Bot 在同一群組各司其職
- Bot 之間能「看到」彼此的對話
- 體驗如同真實群組聊天

## 問題

如何讓群組中的所有 Bot 都知道發生了什麼，但只有被點名的 Bot 回覆？

## 考慮的方案

### 方案 A：只處理被 mention 的 Bot
- 只有被 @mention 的 Bot 執行 query
- 其他 Bot 完全不知道發生什麼

**缺點**：Bot 之間無法知道彼此的對話

### 方案 B：所有 Bot 都 query，只有被 mention 的回覆 ✅

- 所有 Bot 都執行 query（維護各自的 session）
- 只有被 @mention 或 reply to 的 Bot 發送回覆
- 其他 Bot 以「觀察模式」運行

**優點**：
- 符合群組本質 — 大家都能看到對話但不一定要回覆
- 每個 Bot 維護完整的上下文
- Bot 可以接續之前其他 Bot 的對話

### 方案 C：共享 Session
- 所有 Bot 共用同一個 Claude session
- 需要複雜的訊息路由邏輯

**缺點**：實現複雜，違反 agent 隔離原則

## 決策

選擇 **方案 B：所有 Bot 都 query，只有被 mention 的回覆**

用戶的觀點：「群組存在意義啊，大家本來就是會打開群組知道大家在聊什麼但不一定會回覆之類的。」

## 架構設計

### 職責分離

```
Telegram 群組訊息
         │
         ▼
┌─────────────────────────────────────────────────┐
│              TelegramAdapter                     │
│  職責：接收訊息、過濾 Bot 訊息、發出原始事件      │
│  - 過濾 from.is_bot === true                    │
│  - 發出 group:message 事件                       │
└────────────────────┬────────────────────────────┘
                     │ EventBus.emit('group:message')
                     ▼
┌─────────────────────────────────────────────────┐
│              GroupBroadcaster                    │
│  職責：管理群組訊息廣播、決定誰該處理            │
│  - 監聽 group:message 事件                       │
│  - 找出同群組的所有 Bot                          │
│  - 呼叫每個 Bot 的 MessageProcessor              │
└────────────────────┬────────────────────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐
    │ BotA    │ │ BotB    │ │ BotC    │
    │ query ✅│ │ query ✅│ │ query ✅│
    │ reply ✅│ │ reply ❌│ │ reply ❌│
    │ (被@)   │ │ (觀察)  │ │ (觀察)  │
    └─────────┘ └─────────┘ └─────────┘
```

### 關鍵實現

#### 1. Bot 訊息過濾

防止 Bot 之間互相觸發無限迴圈：

```typescript
if (from.is_bot === true) {
  return; // 過濾 Bot 訊息
}
```

#### 2. observeOnly 模式

MessageProcessor 新增參數，觀察模式下：
- ✅ 執行 SDK query（維護 session 歷史）
- ❌ 跳過 typing indicator
- ❌ 跳過中間訊息發送
- ❌ 跳過最終回應發送
- ❌ 跳過 status message 更新

#### 3. GroupBroadcaster

- 監聯 `group:message` 事件
- 維護 `chatId → Set<agentId>` 映射
- Bot 收到群組訊息時自動註冊
- 根據 @mention 決定 `shouldReply`

#### 4. 回覆判斷邏輯

```typescript
shouldBotReply(agentId, mentionedBot, isReplyToBot, botInfo): boolean {
  // 被直接 reply
  if (isReplyToBot) return true;
  // 被 @mention
  if (mentionedBot === botInfo.username) return true;
  // 其他情況：觀察
  return false;
}
```

## 實現

### 新增檔案

| 檔案 | 說明 |
|------|------|
| `src/core/GroupBroadcaster.ts` | 群組訊息廣播管理 |

### 修改檔案

| 檔案 | 變更 |
|------|------|
| `src/types/events.ts` | 新增 `GroupMessagePayload` |
| `src/adapters/TelegramAdapter.ts` | Bot 過濾、`getBotInfo()`、發出事件 |
| `src/core/MessageProcessor.ts` | `observeOnly` 模式 |
| `src/core/PlatformOrchestrator.ts` | 整合 GroupBroadcaster |

## 後果

**正面**：
- Bot 之間可以「感知」彼此的對話
- 接續對話更自然（工程師 Bot 知道秘書 Bot 剛才說了什麼）
- 架構清晰，職責分離

**負面**：
- 群組中每條訊息會觸發所有 Bot 的 query（API 成本）
- 需要確保 Bot 有群組訊息讀取權限

## 驗證結果

實測群組對話：
```
用戶: @秘書Bot 我有個工程師前幾天找錯資料夾一直鬼打牆

秘書Bot: 😂 哈哈哈哈哈，是不是那種「明明改了但怎麼跑起來都沒變」...

用戶: @工程師Bot 唉唷你在啊

工程師Bot: 哈哈沒事啦老闆！剛剛看秘書 bot 跟您聊工程師找錯資料夾的事，
           我在旁邊偷笑 🤭
```

✅ 工程師 Bot 成功感知到秘書 Bot 之前的對話內容
