# ADR-026: 群組協作基礎設施穩定化

**狀態**：✅ implemented
**日期**：2026-02-05
**相關**：ADR-019, ADR-021, ADR-022, ADR-024

---

## 背景

ADR-019 至 ADR-024 陸續實現了多 Bot 群組協作功能，包括：
- 群組訊息路由與 dedup
- 自動委派機制
- 群組命令支援

經過 code review 識別出 14 個改善項目，需要進行基礎設施穩定化以確保後續功能開發的可靠性。

### 識別的問題

| 優先級 | 問題 |
|--------|------|
| ⭐⭐⭐ | GroupBroadcaster 無單元測試 |
| ⭐⭐⭐ | `group::` magic string 散落多處 |
| ⭐⭐⭐ | Dedup 邏輯重複且策略不一致 |
| ⭐⭐⭐ | GroupBroadcaster 違反 SRP |
| ⭐⭐ | `globalThis` dedup Set 型別不安全 |
| ⭐⭐ | `metadata` 取值 `as string` cast |
| ⭐⭐ | `handleBotReplied` 過長 |
| ⭐⭐ | `dispose()` 漏清 processedMessages |
| ⭐ | `waitForBotMessageId` busy-wait |
| ⭐ | `mentionedBot` 只取第一個（缺少設計說明） |
| ⭐ | `scheduleManager!` non-null assertion |
| ⭐ | PlatformOrchestrator 直接 new GroupBroadcaster |
| ⭐ | `executeQueryWithSDK` 過長 |
| ⭐ | `processedMessages` 無 TTL |

---

## 決策

### 重構策略

採用分階段重構，優先建立測試安全網，再進行工具抽取和結構改善：

1. **Phase 1**：測試安全網（GroupBroadcaster 單元測試）
2. **Phase 2**：工具抽取（groupSession.ts, DedupTracker.ts）
3. **Phase 3**：小型修復（dispose, metadata, 註解）
4. **Phase 4**：結構重構（handleBotReplied 拆分）
5. **Phase 5**：低優先級項目

### 實作決策

#### 1. DedupTracker 統一 dedup 機制

**問題**：GroupBroadcaster 和 TelegramCommands 各自實現 dedup，策略不一致且無 TTL。

**決策**：建立 `DedupTracker` 類別，提供：
- 統一的 `isDuplicate(key)` API（檢查並記錄一步完成）
- TTL 支援（預設 5 分鐘）
- 自動清理（超過 maxSize 時清理過期或最舊的條目）

```typescript
const tracker = new DedupTracker({ maxSize: 1000, ttlMs: 5 * 60 * 1000 });
if (tracker.isDuplicate('msg-123')) return; // 已處理，跳過
```

#### 2. groupSession.ts 集中 `group::` 前綴處理

**問題**：`group::` magic string 散落在 MessageProcessor、TelegramCommands、GroupBroadcaster。

**決策**：建立 `groupSession.ts` 工具模組：
- `buildGroupUserId(chatId)` — 建立群組 session key
- `isGroupUserId(userId)` — 檢查是否為群組 session
- `extractChatIdFromGroupUserId(groupUserId)` — 解析 chatId

#### 3. ScheduleCommandDeps 型別縮窄

**問題**：排程子函數使用 `deps.scheduleManager!` non-null assertion。

**決策**：定義 `ScheduleCommandDeps` interface（scheduleManager 為 required），在父函數檢查後傳遞縮窄後的型別。

```typescript
interface ScheduleCommandDeps extends CommandDependencies {
  scheduleManager: ScheduleManager; // required
}
```

#### 4. GroupBroadcaster 可注入

**問題**：PlatformOrchestrator 直接 `new GroupBroadcaster()`，難以測試。

**決策**：在 `PlatformOrchestratorOptions` 新增 `groupBroadcaster?` 選項，支援依賴注入。

#### 5. handleBotReplied 拆分

**問題**：方法過長，混合 recording 和 delegation 邏輯。

**決策**：拆分為兩個 private 方法：
- `recordBotReplyToGroupMessages()` — 記錄邏輯
- `processDelegation()` — 委派邏輯

---

## 保留項目

以下項目評估後決定保留：

| 項目 | 理由 |
|------|------|
| `waitForBotMessageId` busy-wait | 300ms timeout、50ms 間隔，最多 6 次輪詢，改為 event-based 複雜度高但收益有限 |
| `executeQueryWithSDK` 過長 | 涉及 session setup、typing、context injection、SDK query、error handling 等多個緊密相關邏輯，拆分風險較高 |

---

## 影響

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

### 測試覆蓋

GroupBroadcaster 單元測試涵蓋：
- **Membership**：register、restore from repository
- **Dedup**：跨 adapter 去重
- **Routing**：@mention、reply-to、no mention
- **Delegation**：chain、cycle prevention、depth limit、inbound/outbound
- **Recording**：user messages、bot replies
- **Dispose**：清理所有內部狀態

---

## 結果

| 分類 | 數量 |
|------|------|
| 完成 | 12 |
| 保留 | 2 |
| 總計 | 14 |

基礎設施穩定化完成，為後續功能開發（ADR-023 Bot Initiative、ADR-025+ Dashboard Analytics）奠定基礎。
