# Tasks

- [x] 將 `detectDelegationTarget()` 改為 `detectDelegationTargets()` 回傳 `string[]`
- [x] 實作多重委派共用同一個 delegation depth
- [x] 在 `agent.ts` 新增 `DelegationSettingsSchema`（`inbound`、`outbound`）
- [x] 在 `GroupBroadcaster` 新增 `getDelegationSettings` callback 及 inbound/outbound 檢查
- [x] 在 `PlatformOrchestrator` 提供 `getDelegationSettings` callback
