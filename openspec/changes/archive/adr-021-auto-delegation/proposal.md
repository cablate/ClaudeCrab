# 群組自動委派（Auto-Delegation）

## Why

ADR-019 實現了群組多 Bot 協作，但只有被使用者 @mention 或 reply-to 的 Bot 會回應。當秘書 Bot 回覆中建議「請 @coder 幫你處理」，coder Bot 不會自動接手——使用者必須手動再 @coder 一次。

這違反了 ADR-019 用戶願景中的核心需求：

> 「主管 Bot 可以分配任務給其他 Bot（透過 @mention）」

## What Changes

在現有的 `bot:replied` 事件流中新增自動委派邏輯：

1. Bot A 回覆後，`GroupBroadcaster.handleBotReplied()` 偵測回覆文字中的 @mention
2. 若 @mention 的是群組內其他 Bot 的 username，自動建立合成訊息觸發該 Bot 的 `processMessage()`
3. 被委派的 Bot 在群組 session context 中處理，並正常回覆

安全機制包括：最大深度限制（`MAX_DELEGATION_DEPTH = 3`）、循環檢測（`delegationChain` 陣列追蹤路徑）、不自我委派、單一委派（每次回覆只觸發一個 Bot）。

`BotRepliedPayload` 新增 `delegationDepth` 和 `delegationChain` 型別擴展。

## Capabilities

- Bot 間可自動交接任務，符合「團隊協作」願景
- 利用現有 `bot:replied` 事件流，最小改動自然整合
- 安全機制防止無限循環與重複回覆
