# ADR-021: 群組自動委派（Auto-Delegation）

**狀態**：✅ accepted
**日期**：2026-02-04
**相關**：ADR-019, ADR-020

---

## 背景

ADR-019 實現了群組多 Bot 協作，但只有被使用者 @mention 或 reply-to 的 Bot 會回應。當秘書 Bot 回覆中建議「請 @coder 幫你處理」，coder Bot 不會自動接手——使用者必須手動再 @coder 一次。

這違反了 ADR-019 用戶願景中的核心需求：

> 「主管 Bot 可以分配任務給其他 Bot（透過 @mention）」

---

## 決策

在現有的 `bot:replied` 事件流中新增自動委派邏輯：

1. Bot A 回覆後，`GroupBroadcaster.handleBotReplied()` 偵測回覆文字中的 @mention
2. 若 @mention 的是群組內其他 Bot 的 username，自動建立合成訊息觸發該 Bot 的 `processMessage()`
3. 被委派的 Bot 在群組 session context 中處理，並正常回覆

### 安全機制

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

---

## 替代方案

### 方案 A：新增獨立事件（`bot:delegate`）

- 優點：事件語意清晰
- 缺點：需要額外事件類型、額外監聽器、程式碼重複
- **不採用**：增加複雜度但無明確收益

### 方案 B：在現有 `bot:replied` 事件中擴展（✅ 採用）

- 優點：最小改動、利用現有事件流、自然整合
- 缺點：`BotRepliedPayload` 增加了委派相關欄位
- **採用理由**：委派是回覆的延伸行為，放在同一事件流中合理

### 方案 C：使用者端透過 Telegram 中繼（不自動化）

- 優點：最安全、零改動
- 缺點：使用者體驗差，違反「團隊協作」願景
- **不採用**：核心需求要求 Bot 間能自動交接

---

## 影響

### 修改檔案

- `src/types/events.ts` — BotRepliedPayload 擴展
- `src/core/GroupBroadcaster.ts` — 偵測 + 執行委派
- `src/core/MessageProcessor.ts` — 傳遞委派參數

### 風險

- **無限循環**：透過 depth limit + cycle detection 緩解
- **重複回覆**：合成訊息使用唯一 ID（`delegation-${timestamp}-${agentId}`），dedup 機制可防止
- **Bot 回覆再觸發委派**：由 depth limit 控制，最多 3 層

### 未來擴展

- 支援多重委派（同時 @mention 多個 Bot）
- 委派優先級（根據 Bot 角色排序）
- 使用者可配置是否啟用自動委派
