# 設計：群組協作基礎設施穩定化

## Decisions

### DedupTracker 統一 dedup 機制

GroupBroadcaster 和 TelegramCommands 各自實現 dedup，策略不一致且無 TTL。建立 `DedupTracker` 類別，提供統一的 `isDuplicate(key)` API（檢查並記錄一步完成）、TTL 支援（預設 5 分鐘）、自動清理（超過 maxSize 時清理過期或最舊的條目）。

### groupSession.ts 集中 `group::` 前綴處理

`group::` magic string 散落在 MessageProcessor、TelegramCommands、GroupBroadcaster。建立 `groupSession.ts` 工具模組：
- `buildGroupUserId(chatId)` — 建立群組 session key
- `isGroupUserId(userId)` — 檢查是否為群組 session
- `extractChatIdFromGroupUserId(groupUserId)` — 解析 chatId

### ScheduleCommandDeps 型別縮窄

排程子函數使用 `deps.scheduleManager!` non-null assertion。定義 `ScheduleCommandDeps` interface（scheduleManager 為 required），在父函數檢查後傳遞縮窄後的型別。

### GroupBroadcaster 可注入

PlatformOrchestrator 直接 `new GroupBroadcaster()`，難以測試。在 `PlatformOrchestratorOptions` 新增 `groupBroadcaster?` 選項，支援依賴注入。

### handleBotReplied 拆分

方法過長，混合 recording 和 delegation 邏輯。拆分為：
- `recordBotReplyToGroupMessages()` — 記錄邏輯
- `processDelegation()` — 委派邏輯

### 保留項目

| 項目 | 理由 |
|------|------|
| `waitForBotMessageId` busy-wait | 300ms timeout、50ms 間隔，最多 6 次輪詢，改為 event-based 複雜度高但收益有限 |
| `executeQueryWithSDK` 過長 | 涉及 session setup、typing、context injection、SDK query、error handling 等多個緊密相關邏輯，拆分風險較高 |

## Risks / Trade-offs

- 重構範圍廣（12 個項目），需分階段進行確保穩定性
- 優先建立測試安全網再進行重構，降低回歸風險
- 2 個項目評估後決定保留，避免過度重構

## Affected Components

### 新增檔案

| 檔案 | 說明 |
|------|------|
| `src/utils/groupSession.ts` | `group::` 前綴工具函數 |
| `src/utils/DedupTracker.ts` | TTL dedup 機制 |
| `tests/unit/GroupBroadcaster.test.ts` | 19 個測試案例 |

### 修改檔案

| 檔案 | 變更 |
|------|------|
| `src/core/GroupBroadcaster.ts` | DedupTracker、handleBotReplied 拆分、dispose 修復、metadata 型別安全 |
| `src/core/MessageProcessor.ts` | 使用 groupSession 工具 |
| `src/core/PlatformOrchestrator.ts` | GroupBroadcaster 可注入 |
| `src/adapters/TelegramAdapter.ts` | mentionedBot 設計註解 |
| `src/adapters/commands/TelegramCommands.ts` | DedupTracker、ScheduleCommandDeps |
| `src/utils/index.ts` | 匯出新工具 |
