# 群組協作基礎設施穩定化

## Why

ADR-019 至 ADR-024 陸續實現了多 Bot 群組協作功能，包括群組訊息路由與 dedup、自動委派機制、群組命令支援。

經過 code review 識別出 14 個改善項目，包括：
- GroupBroadcaster 無單元測試
- `group::` magic string 散落多處
- Dedup 邏輯重複且策略不一致
- GroupBroadcaster 違反 SRP
- `globalThis` dedup Set 型別不安全
- `metadata` 取值 `as string` cast
- `handleBotReplied` 過長
- `dispose()` 漏清 processedMessages
- 其他低優先級項目

## What Changes

採用分階段重構策略：

1. **Phase 1**：測試安全網（GroupBroadcaster 單元測試）
2. **Phase 2**：工具抽取（groupSession.ts, DedupTracker.ts）
3. **Phase 3**：小型修復（dispose, metadata, 註解）
4. **Phase 4**：結構重構（handleBotReplied 拆分）
5. **Phase 5**：低優先級項目

保留項目：`waitForBotMessageId` busy-wait（改為 event-based 複雜度高收益有限）、`executeQueryWithSDK` 過長（邏輯緊密相關，拆分風險較高）。

## Capabilities

- GroupBroadcaster 有完整的單元測試覆蓋（19 個測試案例）
- 統一的 dedup 機制（DedupTracker），支援 TTL 與自動清理
- `group::` 前綴集中管理，消除 magic string
- handleBotReplied 拆分為 recording 和 delegation，職責清晰
- GroupBroadcaster 可注入，支援測試
- 為後續功能開發奠定可靠基礎
