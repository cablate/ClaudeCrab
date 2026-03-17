# ClaudeCab Codebase Audit v2

> 日期：2026-03-17
> 分支：feat/discord-company-platform
> 方法：4 平行 audit agents（依賴/耦合、dead code/type safety、error handling/resilience、AI 友善度/維護性）
> 基準：paperclip-research/17-architecture-audit.md 的修復後狀態

---

## 發現總覽

| 維度 | HIGH | MED | LOW | 小計 |
|------|------|-----|-----|------|
| 依賴方向 / 耦合 | 6 | 8 | 1 | 15 |
| Error handling / Resilience | 2 | 2 | 5 | 9 |
| Dead code / Type safety | 3 | 2 | 8 | 13 |
| AI 友善度 / 維護性 | 3 | 3 | 2 | 8 |
| **合計** | **14** | **15** | **16** | **45** |

---

## P0：立即修復（14 HIGH）

### 依賴/耦合

| ID | 問題 | 檔案 | 修法 |
|----|------|------|------|
| D1 | services/ 4 個檔案 import discord.js（Platform Leak） | ActivityEventService, CostReportService, DashboardService, TaskService | 移至 adapters/discord/services/ 或拆 pure service + discord adapter |
| D2 | core/MessageProcessor import 5 個 services（Layer 違規） | MessageProcessor.ts:34-40 | 抽 interface 到 types/，MP 只依賴 interface |
| D3 | AgentCallService ↔ MessageProcessor 循環依賴 | AgentCallService.ts:17 | 抽 IMessageProcessor interface |
| D4 | schedule/ScheduleExecutor import services/（間接拉入 discord.js） | ScheduleExecutor.ts:15-16 | 依賴 interface，不依賴具體 service |
| D5 | utils/audit.ts 仍從 adapters/types import（B3 修復未傳播） | audit.ts:2 | 改為 import from types/message.js |
| D6 | SSEBroadcaster EventBus 訂閱未在 dispose() 清理（Listener Leak） | SSEBroadcaster.ts:20-22 | 同 GroupBroadcaster 修法：儲存 unsubscriber |

### Error Handling

| ID | 問題 | 檔案 | 修法 |
|----|------|------|------|
| E1 | DiscordAdapter.rateLimitedSend 定義但從未被呼叫（所有 API 呼叫繞過 rate limiter） | DiscordAdapter.ts:993 | 所有 channel.send/message.edit 改走 rateLimitedSend |
| E2 | Discord Client 沒有 'error' 事件監聽（網路錯誤走 uncaughtException） | DiscordAdapter.ts | doStart() 加 client.on('error', ...) |

### Dead Code / Type Safety

| ID | 問題 | 檔案 | 修法 |
|----|------|------|------|
| T1 | TelegramAdapter 13+ 處 this.bot! 非空斷言 | TelegramAdapter.ts | 加 guard method（assertBot()），或在 doStart 後 assign non-nullable |
| T2 | PlatformOrchestrator discordBotToken!/discordChannelId! 在可選欄位上 | PlatformOrchestrator.ts:439 | 加 runtime guard + early return |
| T3 | SDKSessionManager 用 (sessionOptions as unknown as Record<string, unknown>) 雙重 cast | SDKSessionManager.ts:204-211 | 定義 ExtendedSessionOptions interface 覆蓋 SDK 型別 |

### AI 友善度

| ID | 問題 | 檔案 | 修法 |
|----|------|------|------|
| A1 | MessageProcessor.ts 1434 行 + 無檔案層級 JSDoc | MessageProcessor.ts | 補 JSDoc + 拆分 executeQueryWithSDK |
| A2 | TelegramAdapter.ts 1507 行 + 無檔案層級 JSDoc | TelegramAdapter.ts | 補 JSDoc |
| A3 | process.env 在 6+ 個檔案中直接讀取（繞過 config.ts） | security.ts, auth.ts, audit.ts, AppBootstrap.ts | 納入 AppConfig |

---

## P1：短期修復（15 MED）

### 依賴/耦合

| ID | 問題 | 檔案 |
|----|------|------|
| D7 | PlatformOrchestrator 直接 new TelegramAdapter/DiscordAdapter | PlatformOrchestrator.ts:9-10 |
| D8 | webui/messages.api 直接存取 InteractionHandler 靜態 Map | messages.api.ts:5,122,147 |
| D9 | adapters/types.ts dynamic import core/stt + core/tts | adapters/types.ts:286-289 |
| D10 | AgentCallService setAdapterGetter() 兩階段初始化 | AgentCallService.ts:70-72 |
| D11 | MessageProcessor wirePostInit() 延遲注入（race window） | MessageProcessor.ts:222-228 |
| D12 | ScheduleExecutor wirePostInit() 延遲注入 | ScheduleExecutor.ts:50-54 |
| D13 | AgentCallService 讀取 discord.reportsTo 做業務邏輯 | AgentCallService.ts:128-135 |
| D14 | AppBootstrap 43 個 import + Discord 類別直接引入 | AppBootstrap.ts:52-54 |

### Error Handling

| ID | 問題 | 檔案 |
|----|------|------|
| E3 | MessageProcessor.dispose() void 丟棄 async SDKSessionManager.dispose() | MessageProcessor.ts:1432 |
| E4 | ActivityEventService.dispose() 最終 flush 用 void（shutdown 時 DB 可能先關） | ActivityEventService.ts:201 |

### Dead Code / Type Safety

| ID | 問題 | 檔案 |
|----|------|------|
| T4 | SDKSessionManager (message as any).subtype 冗餘 cast | SDKSessionManager.ts:319 |
| T5 | sendWithMarkdownFallback 已 export 但完全無消費者 | telegramMarkdown.ts:116 |

### AI 友善度

| ID | 問題 | 檔案 |
|----|------|------|
| A4 | DiscordSlashCommands 硬編碼 context window 200000 | DiscordSlashCommands.ts:506-507 |
| A5 | ResponseSender 用 string.includes('500') 匹配 HTTP status | ResponseSender.ts:82-97 |
| A6 | TelegramAdapter 10+ 處 const result 命名模糊 | TelegramAdapter.ts |

---

## P2：漸進改善（16 LOW）

| ID | 問題 | 檔案 |
|----|------|------|
| E5 | ScheduleExecutor activityEventService.log() void fire-and-forget | ScheduleExecutor.ts:73,247,283 |
| E6 | ScheduleManager watcher.close() void 丟棄 | ScheduleManager.ts:421 |
| E7 | TelegramCallbackHandler void replyFn() | TelegramCallbackHandler.ts:130 |
| E8 | SDK hooks catch 靜默吞錯（無 log） | SDKSessionManager.ts:219,236 |
| E9 | SessionManager cleanupExpired() void fire-and-forget | SessionManager.ts:86 |
| T6 | MEMORY_STOP_CHECKPOINT import 但只在注釋碼中 | MessageProcessor.ts:10 |
| T7 | SendResult import 但未使用 | MessageProcessor.ts:3 |
| T8 | createChildLogger export 但無消費者 | logger.ts:63 |
| T9 | AgentDisplayConfig 死碼 | types/activity.ts:47 |
| T10 | logAgentSwitch() 死碼 | utils/audit.ts:212 |
| T11 | StatusMessageOptions/Result 孤兒介面 | adapters/types.ts:167-176 |
| T12 | withRetry/shouldRetryError/RATE_LIMIT_RETRY_OPTIONS 只在測試 | utils/retry.ts |
| T13 | convertTablesToTelegramFormat 不需要 export | telegramMarkdown.ts:79 |
| A7 | GroupBroadcaster entries.slice(0, 500) 無命名常數 | GroupBroadcaster.ts:309 |
| A8 | SDKSessionManager 硬編碼 fallback model | SDKSessionManager.ts:161 |
| D15 | STT/TTS 型別未提升至 types/ | core/stt, core/tts |

---

## 修復執行計畫

### Phase 1：快速修復（不改架構，預估 2-3h）

立即可做，無風險：

- [ ] D5：audit.ts import 改為 types/message.js（1 行）
- [ ] D6：SSEBroadcaster dispose 加 EventBus unsubscribe（10 行）
- [ ] E1：DiscordAdapter 所有 API 呼叫改走 rateLimitedSend（~20 行）
- [ ] E2：DiscordAdapter doStart 加 client.on('error')（5 行）
- [ ] T1：TelegramAdapter 加 assertBot() guard（20 行）
- [ ] T2：PlatformOrchestrator 加 token guard（10 行）
- [ ] T4：SDKSessionManager 移除冗餘 as any（1 行）
- [ ] T5-T13：移除 dead code（~50 行刪除）
- [ ] A1-A2：補 MessageProcessor + TelegramAdapter 檔案層級 JSDoc（~20 行）
- [ ] A3：process.env 納入 AppConfig（~40 行）
- [ ] A4-A5：magic numbers 抽常數（~15 行）
- [ ] E8：SDK hooks catch 加 log.warn（4 行）

### Phase 2：interface 化（預估 3-4h）

解決 D1-D4 的根因——services 層 platform leak：

- [ ] D1：ActivityEventService/CostReportService/DashboardService/TaskService 拆分 pure logic + discord adapter
- [ ] D2+D3：抽 IAgentCallService, IBudgetService, ITaskService, IActivityEventService interface 到 types/
- [ ] MessageProcessor 只依賴 interface
- [ ] D4：ScheduleExecutor 只依賴 interface
- [ ] T3：定義 ExtendedSessionOptions interface

### Phase 3：結構重組（預估 4-6h）

- [ ] D7：PlatformOrchestrator 用 adapter factory
- [ ] D14：AppBootstrap 拆 DiscordBootstrap
- [ ] A1 拆分 executeQueryWithSDK
- [ ] D10-D12：統一 DI 模式（解決 wirePostInit race）
