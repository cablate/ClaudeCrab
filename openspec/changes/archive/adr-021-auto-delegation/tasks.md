# Tasks

- [x] 在 `GroupBroadcaster.handleBotReplied()` 中新增 @mention 偵測邏輯
- [x] 建立合成訊息觸發被委派 Bot 的 `processMessage()`
- [x] 擴展 `BotRepliedPayload` 新增 `delegationDepth` 和 `delegationChain`
- [x] 實作最大深度限制（`MAX_DELEGATION_DEPTH = 3`）
- [x] 實作循環檢測（追蹤 `delegationChain` 中的重複 agentId）
- [x] 過濾自我委派與單一委派邏輯
- [x] 在 `MessageProcessor` 中傳遞委派參數
