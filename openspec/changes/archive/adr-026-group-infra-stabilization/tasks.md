# Tasks

- [x] 建立 GroupBroadcaster 單元測試（19 個測試案例）
- [x] 新建 `DedupTracker.ts`，統一 dedup 機制（TTL + 自動清理）
- [x] 新建 `groupSession.ts`，集中 `group::` 前綴處理
- [x] GroupBroadcaster 改用 DedupTracker
- [x] TelegramCommands 改用 DedupTracker
- [x] MessageProcessor 改用 groupSession 工具
- [x] 定義 `ScheduleCommandDeps` interface，消除 non-null assertion
- [x] PlatformOrchestratorOptions 新增 `groupBroadcaster?` 可注入選項
- [x] 拆分 `handleBotReplied` 為 `recordBotReplyToGroupMessages()` 和 `processDelegation()`
- [x] 修復 `dispose()` 漏清 processedMessages
- [x] 修復 `metadata` 取值 `as string` cast 為型別安全取值
- [x] TelegramAdapter 新增 mentionedBot 設計註解
