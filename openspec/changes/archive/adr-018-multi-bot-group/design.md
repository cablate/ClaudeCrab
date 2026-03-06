# 設計：多 Bot 群組協作設計

## Decisions

### 方案選擇：所有 Bot 都 query，只有被 mention 的回覆

排除的方案：
- 方案 A（只處理被 mention 的 Bot）：Bot 之間無法知道彼此的對話
- 方案 C（共享 Session）：實現複雜，違反 agent 隔離原則

選擇方案 B 的理由：符合群組本質 — 大家都能看到對話但不一定要回覆；每個 Bot 維護完整的上下文；Bot 可以接續之前其他 Bot 的對話。

### Bot 訊息過濾

防止 Bot 之間互相觸發無限迴圈，過濾 `from.is_bot === true` 的訊息。

### observeOnly 模式

MessageProcessor 新增參數，觀察模式下：執行 SDK query（維護 session 歷史），但跳過 typing indicator、中間訊息發送、最終回應發送、status message 更新。

### GroupBroadcaster

- 監聽 `group:message` 事件
- 維護 `chatId → Set<agentId>` 映射
- Bot 收到群組訊息時自動註冊
- 根據 @mention 決定 `shouldReply`

### 回覆判斷邏輯

被直接 reply → 回覆；被 @mention → 回覆；其他情況 → 觀察。

## Risks / Trade-offs

### 正面
- Bot 之間可以「感知」彼此的對話
- 接續對話更自然（工程師 Bot 知道秘書 Bot 剛才說了什麼）
- 架構清晰，職責分離

### 負面
- 群組中每條訊息會觸發所有 Bot 的 query（API 成本）
- 需要確保 Bot 有群組訊息讀取權限

## Affected Components

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
