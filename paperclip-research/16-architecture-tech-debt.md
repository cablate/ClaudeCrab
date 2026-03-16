# ClaudeCab 架構技術債全面清查 + 修復規劃

> 日期：2026-03-16
> 分支：feat/discord-company-platform
> 狀態：待修復

## 已發現的問題

### 類別 A：繞過 Adapter 層（核心流程不走通用管線）

#### A1. ScheduleExecutor 直接用 SDKQueryManager
- **位置**：`src/schedule/ScheduleExecutor.ts:101`
- **問題**：排程直接呼叫 `sdkManager.executeQuery()`，繞過 MessageProcessor
- **影響**：排程不走 V2 session、不走 adapter、不建 Discord thread、不走 budget pre-check（另外加的）、不走完整 session 管理
- **修法**：ScheduleExecutor 改成透過 MessageProcessor.processMessage() 執行，構造 UnifiedMessage 進入通用管線

#### A2. ScheduleNotifier 用 Telegram 專用 Markdown
- **位置**：`src/schedule/ScheduleNotifier.ts:10,39,74,117`
- **問題**：用 `sendWithMarkdownFallback`（telegramMarkdown.js），會嘗試 MarkdownV2 格式
- **影響**：如果通知走 Discord adapter，格式會爆
- **修法**：通知改成透過 adapter.sendMessage() 直接發（adapter 自己決定格式）

#### A3. ScheduleManager 寫死 `platform: 'telegram'`
- **位置**：`src/schedule/ScheduleManager.ts:153`
- **問題**：排程通知 platform 硬寫 telegram
- **修法**：從 agent config 或排程 YAML 取得目標 platform

#### A4. WebUI messages.api 寫死 `platform: 'telegram'`
- **位置**：`src/webui/api/messages.api.ts:51,91`
- **問題**：WebUI 發訊息強制走 Telegram adapter + session
- **修法**：接受 platform 參數，或根據 agent 有哪些 adapter 決定

#### A5. WebUI MonitoringService 寫死 `platform: 'telegram'`
- **位置**：`src/webui/services/MonitoringService.ts:179`
- **問題**：監控只看 Telegram adapter 狀態
- **修法**：列出所有 platform 的 adapter 狀態

### 類別 B：Core 層用了平台專用工具

#### B1. ResponseSender 用 sendWithMarkdownFallback
- **位置**：`src/core/ResponseSender.ts:11,51`
- **問題**：Core 的回應發送用 Telegram 專用的 Markdown 轉換函式
- **影響**：Discord 回覆可能有 Telegram 轉義字元垃圾（\* \_ 等）
- **修法**：建立平台感知的 formatMessage 層。adapter 實作格式化，Core 只傳原始 markdown

#### B2. MessageProcessor 用 sendWithMarkdownFallback
- **位置**：`src/core/MessageProcessor.ts:13,671,765`
- **問題**：中間回覆也用 Telegram Markdown
- **修法**：同 B1

#### B3. constants.ts 寫死 platform: telegram
- **位置**：`src/core/constants.ts:101`
- **問題**：`buildPromptContext` 硬寫 `platform: telegram`
- **修法**：接受 platform 參數

### 類別 C：具體 Adapter 型別洩漏到 Core/Services

#### C1. Services 層 import DiscordAdapter
- **位置**：
  - `src/services/TaskService.ts:10`
  - `src/services/DashboardService.ts:10`
  - `src/services/CostReportService.ts:9`
  - `src/services/ActivityEventService.ts:12`
- **問題**：Service 層直接 import `DiscordAdapter`，應該只依賴 `BaseAdapter`
- **修法**：改用 BaseAdapter。需要 sendEmbed/editEmbed 的話，在 BaseAdapter 加預設 no-op 方法

#### C2. PlatformOrchestrator import 具體 Adapter
- **位置**：`src/core/PlatformOrchestrator.ts:9-10`
- **問題**：Core 直接 import TelegramAdapter 和 DiscordAdapter
- **備註**：PlatformOrchestrator 的職責是管理 adapter，import 具體類別用於 instanceof 檢查和建構。這可以接受，但 `instanceof TelegramAdapter` 用在 line 108 來取得 TelegramAdapter 專有方法是不對的
- **修法**：把 Telegram 專有方法（如 getBotInfo）提升到 BaseAdapter 介面

#### C3. AppBootstrap instanceof 檢查
- **位置**：
  - `src/AppBootstrap.ts:359` — `instanceof TelegramAdapter`
  - `src/AppBootstrap.ts:458` — `instanceof TelegramAdapter`
  - `src/AppBootstrap.ts:735` — `instanceof DiscordAdapter`
- **問題**：啟動邏輯依賴具體 adapter 型別
- **修法**：用 `adapter.platform === 'telegram'` 代替 instanceof，或提供通用介面

### 類別 D：Late-binding / `as any` 繞過型別系統

#### D1. AppBootstrap 用 `as any` 注入 private 欄位
- **位置**：
  - `src/AppBootstrap.ts:198` — `(messageProcessor as any).taskService`
  - `src/AppBootstrap.ts:202` — `(messageProcessor as any).activityEventService`
  - `src/AppBootstrap.ts:206` — `(this.scheduleExecutor as any).activityEventService`
  - `src/AppBootstrap.ts:724` — `(messageProcessor as any).sdkSessionManager`
- **問題**：繞過 TypeScript 存取控制，改 private 欄位。如果加 readonly 就靜默失效
- **修法**：MessageProcessor 和 ScheduleExecutor 提供 `wirePostInit(deps)` public 方法

### 類別 E：平台預設值問題

#### E1. AgentCallService 預設 platform = 'telegram'
- **位置**：`src/services/AgentCallService.ts:170`
- **問題**：沒傳 platform 就預設 telegram，WebUI 或其他入口的 agent-call 會路由錯誤
- **修法**：不設預設值，要求 caller 明確傳 platform

### 類別 F：單平台功能未抽象

#### F1. startBotForAgent/stopBotForAgent 只操作 Telegram
- **位置**：`src/core/PlatformOrchestrator.ts:405-446`
- **修法**：接受 platform 參數，同時操作對應 adapter

#### F2. StatusMessageManager 只支援 Telegram
- **位置**：`src/core/StatusMessageManager.ts:22`
- **修法**：Discord 用 Embed edit 實作 status，加入 BaseAdapter 介面

#### F3. GroupBroadcaster 只支援 Telegram
- **位置**：`src/core/GroupBroadcaster.ts` 全檔
- **修法**：抽象化群組路由邏輯，Discord 版本需要處理多 channel 監聽

#### F4. WebUI 只顯示/操作 Telegram
- **位置**：`src/webui/` 多處（agents list/detail/edit、login 頁面文字）
- **修法**：WebUI 支援顯示和操作多平台 adapter

---

## 修復規劃（按依賴順序）

### 第一波：Core 管線統一（P0）

**目標**：所有訊息（chat、schedule、webui、agent-call）走同一條管線

| 任務 | 改動範圍 | 預估 |
|------|---------|------|
| 1. 建立 `MessageFormatter` 抽象層 | 新建 `src/core/MessageFormatter.ts`，BaseAdapter 新增 `formatMessage()` 方法，Telegram 用 MarkdownV2，Discord 用原生 Markdown，fallback plaintext | 2h |
| 2. ResponseSender + MessageProcessor 改用 MessageFormatter | 替換 `sendWithMarkdownFallback` → `adapter.sendMessage()`（adapter 自己格式化） | 1h |
| 3. ScheduleExecutor 改走 MessageProcessor | 構造 UnifiedMessage → processMessage()，ScheduleNotifier 改成 post-hook | 3h |
| 4. constants.ts buildPromptContext 接受 platform 參數 | 小改動 | 15min |

### 第二波：型別洩漏清理（P1）

| 任務 | 改動範圍 | 預估 |
|------|---------|------|
| 5. Services 改依賴 BaseAdapter（不是 DiscordAdapter） | BaseAdapter 新增 sendEmbed/editEmbed/createForumPost 等 no-op 方法 | 1.5h |
| 6. AppBootstrap instanceof → platform 字串判斷 | 替換 instanceof 為 adapter.platform 比較 | 30min |
| 7. `as any` → public wirePostInit() 方法 | MessageProcessor + ScheduleExecutor 新增 post-init wiring 介面 | 1h |
| 8. AgentCallService 移除 platform 預設值 | 所有 caller 明確傳 platform | 30min |

### 第三波：多平台支援補齊（P2）

| 任務 | 改動範圍 | 預估 |
|------|---------|------|
| 9. WebUI messages.api 支援多平台 | 接受 platform 參數 | 30min |
| 10. WebUI MonitoringService 支援多平台 | 列出所有 adapter | 30min |
| 11. PlatformOrchestrator start/stop 支援 Discord | 已部分完成，補齊 | 30min |
| 12. StatusMessageManager Discord 版 | BaseAdapter 新增 status 介面 | 1h |
| 13. WebUI 頁面多平台顯示 | agent detail/edit 顯示 Discord 資訊 | 1h |

### 第四波：群組模式（P3）

| 任務 | 改動範圍 | 預估 |
|------|---------|------|
| 14. GroupBroadcaster 抽象化 | 平台無關的群組路由 | 3h |

**總計預估：~16h**
