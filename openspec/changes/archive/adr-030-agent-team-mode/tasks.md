# Tasks

## Tier 1：最小可行 Team Mode

- [x] DelegationHandler 並行化（Promise.allSettled 取代 for...await）
- [x] 新增 executeParallelDelegation() 方法（結果收集 + synthesis prompt 注入）
- [x] BotRepliedPayload 新增 isSynthesis flag
- [x] MessageProcessor 傳遞 isSynthesis 到 emitBotRepliedEvent
- [x] DelegationHandler 對 isSynthesis 回覆不掃描 @mention

## Tier 1.1：委派意圖判斷

- [x] 新增 isDelegationResponse flag 到委派回覆流程
- [x] DelegationHandler 對帶 isDelegationResponse 的回覆不再觸發委派
- [x] 啟發式規則過濾禮貌性 @mention

## Tier 1.2：Delegation 期間靜默 Initiative

- [x] GroupBroadcaster 追蹤 delegation-in-progress 狀態
- [x] Initiative 評估前檢查 delegation 狀態

## Tier 1.3：群組噪音控制

- [x] ContextInjector 群組 context 加入行為指示（不回報記憶操作結果）
