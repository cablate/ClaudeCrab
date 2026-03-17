# ClaudeCab 架構審計報告

> 日期：2026-03-16
> 分支：feat/discord-company-platform
> 方法：4 平行 agent（目錄結構 / 依賴方向 / SRP / 設計模式一致性）

---

## 總覽

| 維度 | 發現 | 嚴重 | 中等 | 低 |
|------|------|------|------|-----|
| 目錄結構 | 11 | 4 | 3 | 4 |
| 依賴方向 | 28 | 16 | 12 | 0 |
| SRP / 大檔案 | 13 | 2 | 2 | 9 |
| 設計模式一致性 | 10 | 2 | 4 | 4 |
| **合計** | **62** | **24** | **21** | **17** |

---

## A. 目錄結構問題

### A1. Discord-specific services 混在通用 `src/services/` [HIGH]

| 檔案 | 依賴 | 建議移至 |
|------|------|----------|
| `ActivityEventService.ts` | `import { EmbedBuilder } from 'discord.js'` + `DiscordAdapter` | `src/adapters/discord/services/` |
| `CostReportService.ts` | 同上 | 同上 |
| `DashboardService.ts` | 同上 | 同上 |
| `TaskService.ts` | `import { ChannelType, Client, ThreadChannel } from 'discord.js'` | 拆分：`TaskService`(pure) + `DiscordTaskSync`(discord/) |

### A2. Adapter 子目錄結構不對稱 [MED]

```
現況：                          建議：
src/adapters/                   src/adapters/
├── DiscordAdapter.ts           ├── BaseAdapter.ts (共用)
├── TelegramAdapter.ts          ├── types.ts (共用)
├── TelegramCallbackHandler.ts  ├── ConnectionHealthMonitor.ts (共用)
├── commands/                   ├── RateLimiter.ts (共用)
│   ├── TelegramCommands.ts     ├── telegram/
│   └── ScheduleCommands.ts     │   ├── TelegramAdapter.ts
└── discord/                    │   ├── TelegramCallbackHandler.ts
    ├── DiscordInteractionHandler.ts  │   └── commands/
    └── DiscordSlashCommands.ts │       ├── TelegramCommands.ts
                                │       └── ScheduleCommands.ts
                                └── discord/
                                    ├── DiscordAdapter.ts
                                    ├── DiscordInteractionHandler.ts
                                    ├── DiscordSlashCommands.ts
                                    └── services/
                                        ├── ActivityEventService.ts
                                        ├── CostReportService.ts
                                        ├── DashboardService.ts
                                        └── DiscordTaskSync.ts
```

### A3. `telegramMarkdown.ts` 在通用 `src/utils/` [MED]

Telegram-specific 的 MarkdownV2 轉換工具混在通用 utils。應移至 `src/adapters/telegram/`。

### A4. 其他低優先項 [LOW]

- `ActivityService.ts` 更像 service 層（操作 ActivityRepository），放 `src/core/` 不精確
- `PathValidator.ts` 是通用工具，放 `src/core/` 不精確，應在 `src/utils/`
- `src/webui/controllers/` 空目錄，應刪除

---

## B. 依賴方向違規

### B1. Core → Services 反向依賴 [HIGH × 8]

`MessageProcessor.ts` import 了 5 個 service（AgentCallService, BudgetService, TaskService, ActivityEventService, TTSService）。
`McpToolSetup.ts` import 了 3 個 service。

**根因**：MessageProcessor 同時做 orchestration + service coordination，職責過重。

**修法方向**：
- 短期：保持現狀（都是 `import type`，runtime 不真正依賴）
- 長期：抽 interface 到 `src/types/`，MessageProcessor 只依賴 interface

### B2. Core → Tools 反向依賴 [HIGH × 4]

`McpToolSetup.ts` import 4 個 tool factory（notifyAgentTool, ttsTool, sendFileTool, taskTool）。

**修法**：`McpToolSetup.ts` 應移至 `src/services/` 或 `src/` 頂層（它是組裝邏輯，不是 core）。

### B3. Types → Adapters 反向依賴 [HIGH × 2]

`src/types/events.ts` import `../adapters/types.js`（UnifiedMessage）和 `../adapters/ConnectionHealthMonitor.js`（ConnectionState）。

**修法**：將 `UnifiedMessage` 和 `ConnectionState` 型別移至 `src/types/`。

### B4. Utils → Adapters 反向依賴 [HIGH × 2]

`telegramMarkdown.ts` import `BaseAdapter` 和 `SendOptions/SendResult`。
`audit.ts` import `UnifiedMessage`。

**修法**：移動 telegramMarkdown 到 adapter 層；audit.ts 的 UnifiedMessage 待 B3 修復後自然解決。

### B5. Persistence ↔ Schedule 循環依賴 [HIGH]

`ScheduleRepository` import `schedule/types.js`，`ScheduleExecutor/Manager` import `persistence/`。

**修法**：將 `ScheduledTask`/`ScheduleExecution` 型別移至 `src/types/` 或 `src/persistence/types.ts`。

### B6. Adapters → Core 具體類別 [MED × 8]

Command handlers（Telegram/Discord）import AgentLoader, SessionManager, MessageProcessor 具體類別。
BaseAdapter import `getEventBus`（runtime singleton）。

### B7. Schedule → Services [MED × 2]

ScheduleExecutor import BudgetService, ActivityEventService。

---

## C. SRP / 大檔案

### C1. `MessageProcessor.ts` — 1368 行 [P0]

同時負責：(1) 請求協調 (2) SDK 執行（530 行 executeQueryWithSDK）(3) 對話持久化 (4) 審計/指標 (5) Typing indicator

**建議拆分**：
- `QueryExecutor.ts` — executeQueryWithSDK 邏輯
- `ExecutionAuditService.ts` — recordExecutionAudit, recordQueryMetrics, emitBotRepliedEvent
- MessageProcessor 精簡為 orchestrator（~400 行）

### C2. `TelegramAdapter.ts` — 1501 行 [P0]

4 個關注點混合：訊息接收/路由、訊息發送、互動 UI（Permission/Question prompt）、連線健康監控。

**建議拆分**：
- `TelegramInteractionManager.ts` — prompt/resolver 狀態機
- `TelegramHealthMonitor.ts` — latency 統計、connection alerts

### C3. `DiscordAdapter.ts` — 1082 行 [P1]

Thread/Forum 管理（createForumPost, archiveThread, replyToThread, updateForumPostTags）是獨立關注點。

**建議拆分**：`DiscordChannelManager.ts`

### C4. `AppBootstrap.ts` — 979 行 [P1]

15 個 initialize* + 4 個 create* 方法。作為 Composition Root 合理，但規模過大。

**建議拆分**：`DiscordBootstrap.ts` 分離 Discord 初始化路徑。

---

## D. 設計模式一致性

### D1. GroupBroadcaster EventBus 訂閱未清理 [HIGH]

`GroupBroadcaster` 構造時訂閱 `group:message` 和 `bot:replied`，但 `dispose()` 沒有取消訂閱，造成 listener leak。

### D2. EventBus.emitSync 無 catch 保護 [HIGH]

`void this.emit(event, payload)` — 若 handler 拋出 async 例外，unhandled rejection。

### D3. 錯誤型別幾乎不用 [MED]

`src/types/errors.ts` 定義完整 error 階層（12 個 custom error），但 codebase 幾乎全用 `throw new Error`。

### D4. Logging child logger 不一致 [MED]

- `AgentCallService` 直接用 root `logger`（無 child）
- `src/index.ts` 用 `console.error` 繞過 logger
- Persistence 層 3 個 repo 未建 child logger

### D5. 4 個 Repository 缺少 interface [MED]

`ActivityRepository`, `ExecutionRecordRepository`, `ScheduleRepository`, `TaskRecordRepository` 沒有對應的 `I*Repository` interface。

### D6. DI 模式不統一 [LOW]

- Constructor injection（主要）
- `wirePostInit()`（MessageProcessor, ScheduleExecutor）
- `setAdapterGetter()`（AgentCallService）
- `getEventBus()` global singleton

---

## 修復優先級

### Phase 1：立即可修 — **已完成 2026-03-16**

| # | 問題 | 狀態 |
|---|------|------|
| 1 | GroupBroadcaster dispose 未清理 EventBus 訂閱 | **已修復** — 構造時儲存 unsubscriber，dispose 時清理 |
| 2 | EventBus.emitSync 加 catch | **已修復** — `.catch(err => logger.error(...))` |

### Phase 2：短期重構 — **部分完成 2026-03-16**

| # | 問題 | 狀態 |
|---|------|------|
| 3 | types/events.ts 的 UnifiedMessage/ConnectionState 移到 types/ | **已修復** — 新建 `src/types/message.ts`，adapters/ re-export 保持向後相容 |
| 4 | McpToolSetup.ts 移出 core/ | **已修復** — 移至 `src/McpToolSetup.ts` |
| 5 | telegramMarkdown.ts 移到 adapters/telegram/ | **暫緩** — 已只被 TelegramAdapter import，實質上已隔離；移動需配合 Task 6 |
| 6 | adapters/ 子目錄對稱化（telegram/ 子目錄） | **暫緩** — 影響 20+ import 路徑，合併回 main 後在獨立 PR 執行 |

### Phase 3：中期重構（需要設計）

| # | 問題 | 工作量 | 影響 |
|---|------|--------|------|
| 7 | Discord services 移到 adapters/discord/services/ | 大 | 目錄結構正確化 |
| 8 | MessageProcessor 拆分 QueryExecutor + AuditService | 大 | SRP、可測試性 |
| 9 | TelegramAdapter 拆分 InteractionManager + HealthMonitor | 中 | SRP |
| 10 | Core→Services interface 化 | 大 | 依賴方向正確化 |

### Phase 4：長期改善（漸進式）

| # | 問題 | 說明 |
|---|------|------|
| 11 | Custom error 全面採用 | 每次修改都順手用 custom error 替換 |
| 12 | Repository interface 補齊 | 缺 4 個 |
| 13 | Logger child 統一 | 每次修改都順手加 |
