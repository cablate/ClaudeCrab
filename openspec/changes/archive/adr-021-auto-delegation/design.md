# 設計：群組自動委派（Auto-Delegation）

## Decisions

### 在現有 `bot:replied` 事件中擴展

委派是回覆的延伸行為，放在同一事件流中合理。不採用新增獨立事件（`bot:delegate`），因為增加複雜度但無明確收益。也不採用使用者端透過 Telegram 中繼的方式，因為核心需求要求 Bot 間能自動交接。

### 安全機制設計

| 機制 | 說明 |
|------|------|
| 最大深度 | `MAX_DELEGATION_DEPTH = 3`，超過即停止 |
| 循環檢測 | `delegationChain` 陣列追蹤路徑，偵測重複 agentId |
| 不自我委派 | 過濾發送者自身的 username |
| 單一委派 | 每次回覆只觸發一個 Bot（第一個匹配） |

### 型別擴展

`BotRepliedPayload` 新增：
- `delegationDepth?: number` — 當前委派深度（0 = 使用者觸發）
- `delegationChain?: string[]` — 委派路徑中的所有 agentId

## Risks / Trade-offs

- **無限循環**：透過 depth limit + cycle detection 緩解
- **重複回覆**：合成訊息使用唯一 ID（`delegation-${timestamp}-${agentId}`），dedup 機制可防止
- **Bot 回覆再觸發委派**：由 depth limit 控制，最多 3 層

## Affected Components

- `src/types/events.ts` — BotRepliedPayload 擴展
- `src/core/GroupBroadcaster.ts` — 偵測 + 執行委派
- `src/core/MessageProcessor.ts` — 傳遞委派參數
