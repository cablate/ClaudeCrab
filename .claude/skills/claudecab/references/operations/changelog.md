# ClaudeCab 版本歷史

> 架構決策紀錄 (ADR) 已移至 [decisions/_index.md](../decisions/_index.md)

---

## 版本歷史

### v1.17.0 - Codebase 優化重構（當前版本）

**發布日期**：2026-02-03

**目標**：提升模組邊界清晰度、消除重複程式碼、改善開發者可維護性與可擴充性。

**Tier 1: Quick Wins**

1. **EVENT_NAMES 修復**
   - 補齊缺失的 `group:message` 和 `bot:replied` 事件名稱

2. **日誌等級修正**
   - `ContextInjector`：4 處 info → debug（cursor 查詢為例行操作）
   - `GroupMessageRepository`：2 處 info → debug（insert 操作為例行操作）

3. **barrel exports 補齊**
   - `src/core/index.ts` 補上 ContextInjector、QuestionBridge、GroupBroadcaster、SDKQueryManager、PathValidator

4. **sendWithMarkdownFallback 共用函式**
   - `src/utils/telegramMarkdown.ts` 新增函式，消除 MessageProcessor 中 2 處重複的 MarkdownV2 → Markdown fallback 邏輯

5. **sender label 共用函式**
   - 新增 `src/utils/format.ts`，提供 `formatUserLabel()` 和 `formatBotLabel()`
   - 消除 GroupBroadcaster（2 處）和 MessageProcessor（1 處）的重複

**Tier 2: Structural Refactors**

6. **AppBootstrap 重構**
   - 新增 `src/config.ts` — 集中化 env var 解析（AppConfig 介面）
   - 新增 `src/AppBootstrap.ts` — 應用生命週期管理（start + shutdown）
   - `src/index.ts` 從 288 行精簡到 20 行

7. **StatusMessageManager 抽取**
   - 新增 `src/core/StatusMessageManager.ts`（212 行）
   - 封裝 tool event tracking、debounced 更新、status message 生命週期
   - 提供 `isStatusCapable()` 型別守衛

8. **InteractionHandler 抽取**
   - 新增 `src/core/InteractionHandler.ts`（327 行）
   - 封裝 PermissionBridge + QuestionBridge 設置和 canUseTool callback 建構
   - AskUserQuestion 處理和一般權限審批流程

9. **Post-query methods 拆分**
   - MessageProcessor 的 post-query 區段拆分為 5 個 private methods
   - `saveSDKSessionId()` / `updateInjectionCursor()` / `persistConversation()` / `sendFinalResponse()` / `emitBotRepliedEvent()`

**重構成果**：
- MessageProcessor: 1,397 行 → 1,065 行 (-24%)
- index.ts: 288 行 → 20 行 (-93%)
- 新增 5 個專責模組，總計 1,033 行

**新增檔案**：
- `src/config.ts`
- `src/AppBootstrap.ts`
- `src/core/StatusMessageManager.ts`
- `src/core/InteractionHandler.ts`
- `src/utils/format.ts`

**修改檔案**：
- `src/index.ts` — 精簡為委派 AppBootstrap
- `src/core/MessageProcessor.ts` — 職責分離重構
- `src/core/GroupBroadcaster.ts` — 使用共用 format 函式
- `src/core/ContextInjector.ts` — 日誌等級修正
- `src/core/index.ts` — 補齊 barrel exports
- `src/persistence/GroupMessageRepository.ts` — 日誌等級修正
- `src/types/events.ts` — EVENT_NAMES 補齊
- `src/utils/telegramMarkdown.ts` — 新增 sendWithMarkdownFallback

---

### v1.16.0 - WebUI 管理系統增強

**發布日期**：2026-02-02

**Phase 1: 核心功能補完**

1. **Agent 管理增強**
   - Agent 刪除（軟刪除移至 `.trash/`，支援硬刪除）
   - Agent 複製（含記憶保留選項）
   - Bot 啟停控制（個別 Agent 的 Bot 啟動/停止）

2. **排程建立 UI**
   - Create Schedule Modal（表單化建立）
   - YAML 即時預覽
   - Cron 表達式說明

3. **PlatformOrchestrator 新增方法**
   - `getBotStatusForAgent()` - 取得 Bot 狀態
   - `startBotForAgent()` - 啟動單一 Bot
   - `stopBotForAgent()` - 停止單一 Bot

**Phase 2: 監控與 Dashboard 改進**

4. **MonitoringService 服務**
   - 系統指標（uptime、memory、sessions）
   - Bot 狀態追蹤
   - 事件記錄（EventBus 整合）

5. **System 監控頁面**
   - `/system` - 系統總覽
   - `/system/metrics` - 詳細指標
   - `/system/events` - 事件日誌
   - `/system/audit` - 審計日誌（預覽）

6. **Dashboard 改進**
   - 三欄布局
   - Bot 狀態卡片（即時顯示）
   - Recent Events 區塊

7. **Sidebar 導航更新**
   - 新增 System 區塊（Overview、Metrics、Events、Audit）

**新增檔案**：
- `src/webui/services/MonitoringService.ts`
- `src/webui/api/system.api.ts`
- `src/webui/routes/system.ts`
- `src/webui/views/system/index.ejs`
- `src/webui/views/system/metrics.ejs`
- `src/webui/views/system/events.ejs`
- `src/webui/views/system/audit.ejs`

**修改檔案**：
- `src/core/PlatformOrchestrator.ts` - Bot 單獨啟停方法
- `src/webui/api/agents.api.ts` - 刪除、複製、Bot 控制、排程建立 API
- `src/webui/WebUIServer.ts` - MonitoringService 整合
- `src/webui/types.ts` - MonitoringService 依賴
- `src/webui/routes/index.ts` - System 路由
- `src/webui/routes/dashboard.ts` - 傳遞監控數據
- `src/webui/views/dashboard/index.ejs` - Bot 狀態 + Events
- `src/webui/views/agents/list.ejs` - 刪除、複製、Bot 控制 UI
- `src/webui/views/agents/detail.ejs` - Schedule 建立 Modal
- `src/webui/views/partials/sidebar.ejs` - System 導航

---

### v1.15.0 - 多 Bot 群組協作 Phase 2

**發布日期**：2026-02-02

**變更**：

1. **GroupBroadcaster 模組**
   - 新增 `src/core/GroupBroadcaster.ts`
   - 監聽 `group:message` 事件，分發給所有同群組 Bot
   - 維護 chatId → agentIds 映射（Bot 收到訊息時自動註冊）

2. **多 Bot 協作機制**
   - 所有 Bot 都執行 query（維護各自 session 歷史）
   - 只有被 @mention 或 reply to 的 Bot 發送回覆
   - 其他 Bot 以 `observeOnly` 模式運行（query 但不回覆）

3. **Bot 訊息過濾**
   - TelegramAdapter 過濾 `from.is_bot === true` 的訊息
   - 防止 Bot 之間互相觸發無限迴圈

4. **observeOnly 模式**
   - MessageProcessor 新增 `observeOnly` 參數
   - 觀察模式跳過：typing indicator、中間訊息、最終回應、status message

5. **事件系統擴展**
   - 新增 `group:message` 事件類型（`GroupMessagePayload`）
   - TelegramAdapter 群組訊息改為發出事件，由 GroupBroadcaster 處理

**新增檔案**：
- `src/core/GroupBroadcaster.ts`

**修改檔案**：
- `src/types/events.ts` - 新增 GroupMessagePayload
- `src/adapters/TelegramAdapter.ts` - Bot 過濾、getBotInfo()、發出事件
- `src/core/MessageProcessor.ts` - observeOnly 模式
- `src/core/PlatformOrchestrator.ts` - 整合 GroupBroadcaster

---

### v1.14.0 - Telegram 群組對話支援 Phase 1

**發布日期**：2026-02-02

**變更**：

1. **群組觸發機制**
   - 新增 `botInfo` 屬性保存 bot 的 username 和 id
   - 群組中只回應 @mention 或 reply to bot 的訊息
   - 非相關訊息自動忽略

2. **群組共享 Session**
   - 群組模式 Session Key: `platform::agentId::group::chatId`
   - 所有群組成員共享同一對話歷史
   - 私聊模式維持 `platform::agentId::userId`

3. **群組回應策略**
   - 群組中發送訊息時附帶 `reply_to_message_id`
   - 讓回覆關聯原訊息，方便追蹤對話脈絡

4. **Commands 支援**
   - `handleStop`, `getCurrentSession` 支援群組 effectiveUserId
   - `/reset`, `/stop` 在群組中正確操作共享 session

**修改檔案**：
- `src/adapters/TelegramAdapter.ts`
- `src/adapters/commands/TelegramCommands.ts`
- `src/core/MessageProcessor.ts`

---

### v1.13.0 - PathValidator 路徑權限強制執行

**發布日期**：2026-02-02

**變更**：

1. **PathValidator 路徑驗證模組**
   - 新增 `src/core/PathValidator.ts`
   - 強制執行 Agent 工作區隔離
   - 透過 PreToolUse hook 攔截所有檔案操作工具（Read, Write, Edit, Glob, Grep, Bash）

2. **路徑權限規則（程式層面強制）**
   - 自己的工作區：讀寫皆可
   - `_shared/knowledge/`：所有 bot 可讀
   - `_shared/knowledge/{自己}/`：可寫入
   - `_shared/knowledge/{其他}/`：禁止寫入
   - 其他路徑：禁止存取

3. **Bash 命令路徑檢測**
   - 從命令字串中提取路徑（引號內路徑、絕對路徑、相對路徑）
   - 轉換為實際絕對路徑後驗證
   - 阻止 `ls ../nitterbot/` 等越界操作

4. **MessageProcessor 整合**
   - 在 `additionalOptions.hooks` 加入 PreToolUse hook
   - 自動注入路徑驗證，Agent 無需維護 hooks.ts

**新增檔案**：
- `src/core/PathValidator.ts`
- `tests/unit/PathValidator.test.ts`（30 個測試案例）

**修改檔案**：
- `src/core/MessageProcessor.ts`

---

### v1.12.0 - 共享知識區架構

**發布日期**：2026-02-01

**變更**：

1. **共享知識區 `_shared/knowledge/`**
   - 建立跨 Agent 知識共享機制
   - 目錄結構：`agents/_shared/knowledge/{agentId}/`
   - 權限規則：所有 bot 可讀，只能寫入自己的命名空間

2. **私有知識區 `knowledge/`**
   - 將 `tools/` 和 `cases/` 整合到 `knowledge/` 目錄
   - 分類：`tools/`（工具評估）、`cases/`（案例研究）、`research/`（研究筆記）
   - 作為草稿區，完成後可發布到共享區

3. **EQUIPMENT.md**
   - 新增已安裝工具清單檔案
   - 記錄 MCP servers、Skills、Plugins

4. **Agent 協議更新**
   - `memory-system.md` 新增 Knowledge 檔案系統規範
   - `safety.md` 新增路徑權限規則（禁止存取其他 bot 工作區）
   - `startup-protocol.md` Step 3 加入讀取 EQUIPMENT.md

**新增檔案**：
- `agents/_shared/knowledge/` 目錄結構
- `agents/*/EQUIPMENT.md`
- `agents/*/knowledge/` 目錄結構
- `.claude/skills/claudecab/references/system/shared-knowledge.md`
- `.claude/skills/claudecab/references/decisions/adr/adr-015-shared-knowledge.md`

**修改檔案**：
- `agents/*/agent-protocols/references/memory-system.md`
- `agents/*/agent-protocols/references/safety.md`
- `agents/*/agent-protocols/references/startup-protocol.md`
- `.claude/skills/claudecab/references/system/overview.md`
- `.claude/skills/claudecab/references/decisions/_index.md`
- `.claude/skills/claudecab/SKILL.md`

---

### v1.11.0 - Agent Skill 系統

**發布日期**：2026-01-30

**變更**：

1. **協議 Skill 化（agent-protocols）**
   - 將 Startup Protocol、Memory System、Safety、Scheduling、Guidelines、Output Style 抽離為獨立 skill
   - 位置：`agents/general/.claude/skills/agent-protocols/`
   - 所有協議文件移至 `references/` 子目錄
   - SKILL.md 作為協議索引，觸發時機：每次 session 開始時

2. **人格 Skill 化（persona）**
   - 將 SOUL.md、IDENTITY.md 抽離為可攜帶的 skill
   - 位置：`agents/general/.claude/skills/persona/`
   - 人格與環境狀態（USER.md、MEMORY.md）分離
   - 部署到新環境只需複製 persona skill

3. **CLAUDE.md 簡化**
   - 從完整協議文檔改為指向 skills 的引導文件
   - 新增 `<STRICTLY_IMPORTANT>` 標籤強調啟動協議必須執行
   - 新增「重新校準」機制：長對話時重新調用 skills 恢復注意力
   - 保留 Lessons Learned 區段供 agent 自行維護

4. **啟動協議提醒注入**
   - `src/core/constants.ts` 新增 `STARTUP_PROTOCOL_REMINDER` 常數
   - `buildPromptContext()` 接受 `isNewSession` 參數
   - 新 session 時透過 UserPromptSubmit hook 注入啟動提醒
   - `MessageProcessor` 使用 `internalSession.sdkSessionId === undefined` 判斷是否為新 session

5. **記憶檔案讀取強化**
   - `startup-protocol.md` 更新為更明確的步驟
   - Step 2 加入 Glob 工具搜尋 `memory/*.md` 確認日誌檔案
   - 明確指示讀取今天和昨天的日期檔案

6. **日期時間處理改用 date-fns**
   - `src/core/constants.ts` 使用 `date-fns` 和 `date-fns-tz` 處理日期
   - 使用 `toZonedTime` 確保 Asia/Taipei 時區
   - 使用 `subDays` 計算昨天日期
   - 日誌路徑格式：`memory/YYYY-MM-DD.md`

7. **SDK settingSources 改為 'project'**
   - `src/core/SDKQueryManager.ts` 預設 `settingSources` 從 `['local']` 改為 `['project']`
   - 目的：讓 SDK 能載入 `.claude/skills/` 目錄的 skills
   - 仍透過 `systemPrompt` 參數明確傳入 CLAUDE.md 內容（避免 SDK 搜尋父目錄）

**修改檔案**：
- `agents/general/CLAUDE.md` — 簡化為 skill 引導
- `agents/general/.claude/skills/agent-protocols/` — 新增協議 skill
- `agents/general/.claude/skills/persona/` — 新增人格 skill
- `src/core/constants.ts` — 新增 STARTUP_PROTOCOL_REMINDER、isNewSession 支援
- `src/core/MessageProcessor.ts` — isNewSession 檢測、傳遞給 hook

**Skill 結構**：

```
agents/general/.claude/skills/
├── agent-protocols/
│   ├── SKILL.md                    # 協議索引
│   └── references/
│       ├── startup-protocol.md     # 啟動流程
│       ├── memory-system.md        # 記憶寫入規則
│       ├── safety.md               # 安全規則
│       ├── scheduling.md           # 排程建立指引
│       ├── guidelines.md           # 回覆準則
│       └── output-style.md         # 輸出格式
└── persona/
    ├── SKILL.md                    # 人格定義入口
    └── references/
        ├── soul.md                 # 核心價值觀、說話風格
        └── identity.md             # 名字、角色、定位
```

---

### v1.10.1 - 排程系統修復與優化

**發布日期**：2026-01-30

**變更**：

1. **chatId 自動注入**
   - `buildPromptContext(chatId?)` 接受 chatId 參數
   - 輸出 `【當前對話】platform: telegram, chatId: xxx`
   - Agent 建立排程時可從 context 取得 chatId，不需手動填入

2. **WebUI 編輯保留 MCP 權限**
   - 修復 `edit.ejs`：編輯 agent 時保留非基本工具權限（MCP 工具等）
   - 之前問題：每次編輯會覆蓋 SDK "Always Allow" 加入的權限

3. **ScheduleNotifier 修復**
   - 從用 `platform` 改為用 `agentId` 作為 adapter key
   - 修復多 agent 時通知送到錯誤頻道的問題
   - `index.ts` 啟動時正確註冊 adapters 到 notifier

4. **排程通知只傳最後一條訊息**
   - `ScheduleExecutor` 加入 `onIntermediateMessage` callback
   - 通知只包含最後一條 assistant message，不含中間過程

5. **Database Schema v4**
   - 移除 `schedule_executions` 的 FK 約束（YAML 是 source of truth）

**修改檔案**：
- `src/core/constants.ts` — buildPromptContext 接受 chatId
- `src/core/MessageProcessor.ts` — 傳遞 chatId 給 hook
- `src/schedule/ScheduleExecutor.ts` — onIntermediateMessage 只保留最後一條
- `src/schedule/ScheduleNotifier.ts` — 用 agentId 作為 adapter key
- `src/index.ts` — 註冊 adapters 到 notifier
- `src/webui/views/agents/edit.ejs` — 保留非基本工具權限
- `src/persistence/DatabaseManager.ts` — Schema v4 migration
- `agents/_example/CLAUDE.md` — 排程指引更新
- `agents/general/CLAUDE.md` — 排程指引更新
- `agents/nitterbot/CLAUDE.md` — 排程指引更新

---

### v1.10.0 - Agent-Driven Scheduling System

**發布日期**：2026-01-29

**變更**：

1. **排程系統核心架構**
   - 三層架構：對話層 → 規格層 → 執行層
   - Agent 可偵測排程意圖，引導使用者建立 YAML 規格
   - 排程任務使用獨立 session 執行（Agent 有 Startup Protocol 提供 context）

2. **YAML 規格系統**
   - 排程檔案位置：`agents/{agentId}/schedules/{taskId}.yaml`
   - 支援 cron、interval、once 三種觸發類型
   - 完整的 Zod schema 驗證

3. **執行與通知**
   - `CronScheduler` 使用 node-cron 管理排程觸發
   - `ScheduleExecutor` 執行任務，記錄結果
   - `ScheduleNotifier` 發送 Telegram 通知（完成/失敗）

4. **資料庫擴展**
   - 新增 `scheduled_tasks` 表（任務定義）
   - 新增 `schedule_executions` 表（執行記錄）
   - Schema 版本升級至 v3

5. **Telegram 指令**
   - `/schedule list` - 列出所有排程
   - `/schedule info <id>` - 查看詳情
   - `/schedule pause/resume <id>` - 暫停/恢復
   - `/schedule run <id>` - 立即執行
   - `/schedule delete <id>` - 刪除
   - `/schedule history [id]` - 執行歷史

6. **Agent 指引擴展**
   - `agents/_example/CLAUDE.md` 新增 Scheduling System 區段
   - 定義觸發詞、建立流程、YAML 範例

**新增檔案**：
- `src/schedule/schemas.ts` — Zod schema 定義
- `src/schedule/types.ts` — TypeScript 類型
- `src/schedule/ScheduleLoader.ts` — YAML 載入器
- `src/schedule/CronScheduler.ts` — Cron 排程器
- `src/schedule/ScheduleExecutor.ts` — 任務執行器
- `src/schedule/ScheduleNotifier.ts` — 通知發送器
- `src/schedule/ScheduleManager.ts` — 統一管理介面
- `src/schedule/index.ts` — 模組匯出
- `src/persistence/ScheduleRepository.ts` — 排程資料庫操作

**修改檔案**：
- `src/persistence/DatabaseManager.ts` — 新增 v3 schema + migration
- `src/adapters/commands/TelegramCommands.ts` — 新增 /schedule 指令
- `src/core/PlatformOrchestrator.ts` — 傳遞 scheduleManager
- `src/index.ts` — 初始化排程系統
- `agents/_example/CLAUDE.md` — 新增排程指引

**新增依賴**：
- `node-cron` — Cron 表達式排程
- `yaml` — YAML 解析

---

### v1.9.2 - SDK 權限回調擴展 + /stop 指令

**發布日期**：2026-01-29

**變更**：

1. **Allow Always 權限選項（Phase 1）**
   - Telegram 權限提示新增三個按鈕：Allow / Always / Deny
   - 點擊 "Always" 會設定 `alwaysAllow: true` 並回傳 `updatedPermissions`
   - SDK 自動將權限寫入 `settings.local.json`，後續不再詢問
   - 更新 `PermissionDecision` 介面加入 `alwaysAllow?: boolean`
   - 更新 `PermissionResolver` 類型支援 `'allow' | 'always' | 'deny'`

2. **AskUserQuestion 處理（Phase 2）**
   - 新增 `QuestionBridge` 處理問題-答案的 async 協調
   - 新增 `QuestionPromptOptions`、`QuestionPromptResult`、`QuestionResolver` 類型
   - TelegramAdapter 實作 `sendQuestionPrompt`、`updateQuestionPrompt`、`setQuestionResolver`
   - callback_query handler 處理 `q_opt_*` 事件
   - canUseTool 閉包檢測 `AskUserQuestion` 工具並透過 Telegram 按鈕呈現選項
   - 目前只支援單選（multiSelect 未來再支援）

3. **/stop 指令**
   - 新增 `/stop` Telegram 指令，可強制中斷正在執行的 Claude 查詢
   - MessageProcessor 新增 `cancelQuery()`、`cancelQueryForUser()`、`hasActiveQueryForUser()` 方法
   - 更新 `/help` 和 `/start` 訊息加入 `/stop` 說明

4. **即時狀態訊息（Status Message）**
   - 處理查詢時發送「🔄 處理中...」狀態訊息
   - 捕捉 SDK tool 事件（tool_use, tool_result, tool_progress, tool_use_summary）
   - Debounce 更新（1 秒最小間隔）避免 Telegram API 速率限制
   - 顯示最近 5 個工具事件，提供即時執行反饋
   - 完成時更新為「✅ 完成（使用了 N 個工具）」
   - 狀態訊息不存入資料庫

**新增檔案**：
- `src/core/QuestionBridge.ts` — 問題-答案橋接器

**修改檔案**：
- `src/adapters/types.ts` — 新增 Question 相關類型 + ToolEvent、StatusMessage 類型
- `src/adapters/BaseAdapter.ts` — 新增 question 相關預設方法
- `src/adapters/TelegramAdapter.ts` — 實作 question UI + Always 按鈕 + callback handler + sendStatusMessage / updateStatusMessage
- `src/core/MessageProcessor.ts` — canUseTool 處理 AskUserQuestion + cancelQuery 方法 + 狀態訊息整合
- `src/core/SDKQueryManager.ts` — ExecuteQueryOptions 新增 onToolEvent callback + 捕捉 tool 事件
- `src/core/PermissionBridge.ts` — PermissionDecision 加入 alwaysAllow
- `src/adapters/commands/TelegramCommands.ts` — 新增 /stop 指令

---

### v1.9.1 - SDK 類型系統擴展

**發布日期**：2026-01-29

**變更**：

1. **SDK 類型轉接層**
   - 新增 `src/types/sdk.ts` — 從 `@anthropic-ai/claude-agent-sdk` 導入並 re-export 所有類型
   - 權限系統：`PermissionMode`, `PermissionBehavior`, `PermissionResult`, `CanUseTool` 等
   - Hook 系統：`HookEvent`, `HookCallback`, 13 種 Hook 輸入/輸出類型
   - 會話系統：`ExitReason`, `ConfigScope`, `SettingSource`
   - 訊息類型：`SDKMessage`, `SDKAssistantMessage` 等
   - 自定義 `AskUserQuestion` 類型（SDK 未暴露）

2. **PermissionMode 擴展**
   - 從 3 種擴展為 6 種：`default`, `acceptEdits`, `bypassPermissions`, `plan`, `delegate`, `dontAsk`
   - 更新 `PermissionModeSchema`（Zod）
   - 更新 `PERMISSION_MODE_MAP` 和 `SDKOptions` 介面

3. **Hook 事件擴展**
   - `HOOK_EVENT_NAMES` 加入 `setup` 事件（共 13 種）

**修改檔案**：
- `src/types/sdk.ts`（新增）— SDK 類型轉接層
- `src/types/agent.ts` — 擴展 PermissionModeSchema
- `src/types/hooks.ts` — 加入 setup 事件
- `src/types/index.ts` — 導出 sdk.ts
- `src/core/ConfigTransformer.ts` — 更新 PERMISSION_MODE_MAP 和 SDKOptions

**測試**：297 tests, 20 files 全部通過

---

### v1.9.0 - Agent 專門化支援（MCP + Skills）

**發布日期**：2026-01-29

**變更**：

1. **MCP Server 自動載入**
   - 配置檔從 `mcp.json` 改為 `.mcp.json`（符合 SDK 的 project scope 標準）
   - SDK 會自動從 `agents/{id}/.mcp.json` 讀取 MCP 配置
   - 不需要手動傳遞 `mcpServers` 選項

2. **Skills 支援**
   - Skills 目錄結構：`agents/{id}/.claude/skills/{skill-name}/SKILL.md`
   - SDK 會自動從 `.claude/skills/` 掃描並載入 skills
   - 需要在 `settings.local.json` 的 `allow` 清單加入 `"Skill"`

3. **General Agent 更新**
   - 新增 `"Skill"` 到允許的工具清單
   - 建立測試用 `.mcp.json`（echo server）
   - 新增 `capability-discovery` skill（引導用戶發現 MCP/Skills 資源）

4. **WebUI Skills 管理**
   - Agent Detail 頁面新增 Skills Tab
   - 上傳 skill zip 檔案安裝到 `.claude/skills/`
   - 檢視/編輯 SKILL.md 內容
   - 刪除 skills（含確認對話框）
   - 發現資源連結（SkillsMP、SkillHub、Anthropic Skills）

**修改檔案**：
- `src/core/AgentLoader.ts` — `MCP_CONFIG_FILE` 改為 `.mcp.json`
- `agents/general/.claude/settings.local.json` — 加入 `"Skill"`
- `agents/general/.mcp.json`（新增）— 測試 MCP 配置
- `agents/general/.claude/skills/capability-discovery/SKILL.md`（新增）— 能力發現引導 skill
- `src/webui/api/agents.api.ts` — Skills API endpoints
- `src/webui/types.ts` — SkillInfo 型別
- `src/webui/views/agents/detail.ejs` — Skills Tab UI

**配置範例**：

`.mcp.json`（放在 agent 根目錄）：
```json
{
  "mcpServers": {
    "echo": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-echo"]
    }
  }
}
```

SKILL.md（放在 `.claude/skills/{name}/SKILL.md`）：
```markdown
---
name: my-skill
description: My custom skill
---

Instructions for the skill...
```

---

### v1.8.1 - 時間注入修復

**發布日期**：2026-01-29

**變更**：

1. **UserPromptSubmit Hook 時間注入**
   - 新增 `buildPromptContext()` 函數，動態生成含當前時間的 context
   - 格式：`【當前時間】2026/01/29 00:24 週四`
   - 時區：Asia/Taipei
   - 修復 AI 時間認知錯誤（如「已經 12:21 卻說快 12 點」）

**修改檔案**：
- `src/core/constants.ts` — 新增 `buildPromptContext()` 函數
- `src/core/MessageProcessor.ts` — 使用動態 context 取代靜態常數

---

### v1.8.0 - Agent 頁面 UI 改善 + Memory System UI

**發布日期**：2026-01-28

**變更**：

1. **Agent Create/Edit 功能**
   - 新增 `POST /api/agents` - 從 `_example` 模板建立新 agent
   - 新增 `PUT /api/agents/:id` - 編輯現有 agent 設定
   - 新增 `GET /agents/create` 和 `GET /agents/:id/edit` 頁面
   - Agent ID、Name、Description、Model、Telegram Token、Permissions 完整編輯

2. **Agent Detail 頁面資訊補充**
   - 新增 Telegram Token 顯示（遮罩版 + Copy 按鈕）
   - 新增 Allowed Tools (Permissions) 顯示（綠色 pill badges）
   - Model 優先順序：`settings.local.json` > `agent.json` > `'sonnet'`

3. **Agent List 頁面**
   - 新增 Version 欄位顯示

4. **Memory System UI（Tab 整合）**
   - Detail 頁面改為 Tab 結構：System Prompt / Memory System / Sessions
   - Core Files 顯示：SOUL.md、USER.md、IDENTITY.md、MEMORY.md
   - Daily Logs 顯示：memory/*.md 日誌列表
   - Modal 編輯器：支援檢視和編輯記憶檔案
   - 新增 Memory API：
     - `GET /api/agents/:id/memory` - 列出記憶檔案
     - `GET /api/agents/:id/memory/file?path=...` - 讀取檔案
     - `PUT /api/agents/:id/memory/file` - 更新檔案

5. **Session 過期顯示修復**
   - Sessions 列表現在會顯示所有 sessions（包括超過 `SESSION_TIMEOUT_MS` 的過期 sessions）
   - 過期 sessions 從 DB 讀取，標記 `isExpired: true`
   - Session detail 頁面可以查看過期 sessions 的詳情和對話歷史
   - messageCount 從 conversations 表計算，不再顯示 0

**修改檔案**：
- `agents/_example/`（新增）— Agent 模板目錄
- `src/core/AgentLoader.ts` — scanAgents() 跳過 `_example`
- `src/webui/api/agents.api.ts` — POST/PUT agents + Memory API
- `src/webui/routes/agents.ts` — create/edit 路由 + sessions 從 DB 讀取
- `src/webui/views/agents/*.ejs` — UI 頁面（create, edit, detail, list）
- `src/webui/routes/sessions.ts` — 從 DB 讀取過期 sessions + messageCount
- `src/webui/api/sessions.api.ts` — 從 DB 讀取過期 sessions + messageCount
- `src/webui/types.ts` — CreateAgent/UpdateAgent/Memory 型別
- `src/persistence/types.ts` — IConversationRepository.getMessageCount

---

### v1.7.1 - General Agent 權限修正 + Memory Checkpoint Hook

**發布日期**：2026-01-28

**變更**：

1. **General Agent 權限修正**（`agents/general/.claude/settings.local.json`）
   - `allow` 加回 `Write` 和 `Edit`
   - 原因：記憶管理是 general agent 核心功能，每次寫入都要按按鈕體驗太差
   - 最終權限：`["Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"]`，只有 `Bash` 需要審批

2. **Memory Checkpoint Hook**
   - 新增 `src/core/constants.ts`：定義 `MEMORY_CHECKPOINT_CONTEXT` 常數
   - 修改 `src/core/MessageProcessor.ts`：透過 SDK `hooks.UserPromptSubmit` 注入記憶檢查提醒
   - 每次使用者送訊息時，agent 會收到提醒：「回覆前，先檢查上一輪對話是否有值得記錄的內容」
   - 目的：提高記憶寫入的可靠性，確保 agent 不會忘記保存重要內容

**修改檔案**：
- `agents/general/.claude/settings.local.json` — 權限修正
- `src/core/constants.ts`（新增）— MEMORY_CHECKPOINT_CONTEXT 常數
- `src/core/MessageProcessor.ts` — UserPromptSubmit hook 注入

---

### v1.7.0 - 互動式 Telegram 權限審批系統

**發布日期**：2026-01-28

**背景**：Agent SDK 執行工具時需要人類審批權限（canUseTool callback），但原先只能在 CLI 中操作。ClaudeCab 需要將此流程橋接到 Telegram，讓使用者透過 InlineKeyboard 按鈕即時審批。

**變更**：
- **PermissionBridge**（新增 `src/core/PermissionBridge.ts`）：Promise-based 非同步橋接，管理 requestId → deferred Promise，支援 120 秒 timeout 自動 deny、AbortSignal、cancelAll
- **PermissionBridge 單元測試**（新增 `tests/unit/PermissionBridge.test.ts`）：13 項單元測試覆蓋核心邏輯
- **Adapter 型別擴充**（`src/adapters/types.ts`）：新增 `PermissionPromptOptions`、`PermissionPromptResult`、`PermissionResolver` 型別
- **BaseAdapter 預設方法**（`src/adapters/BaseAdapter.ts`）：新增 3 個預設方法 — `sendPermissionPrompt`、`updatePermissionPrompt`、`setPermissionResolver`
- **TelegramAdapter 權限 UI**（`src/adapters/TelegramAdapter.ts`）：Override 3 個方法 + InlineKeyboard（Allow / Deny）+ `callback_query` handler；message handler 改為 fire-and-forget 避免 grammy polling deadlock；`doStart` 加入 `allowed_updates: ['message', 'callback_query']`
- **MessageProcessor 權限組裝**（`src/core/MessageProcessor.ts`）：建立 PermissionBridge、組裝 `canUseTool` 閉包、透過 `additionalOptions` 傳入 SDK；allow 回應包含 `updatedInput`（SDK Zod schema 要求）
- **Agent 權限收緊**（`agents/general/.claude/settings.local.json`）：`allow` 從 `["*"]` 改為 `["Read", "Glob", "Grep", "WebFetch", "WebSearch"]`（v1.7.1 加回 Write/Edit）

**修改檔案**：
- `src/core/PermissionBridge.ts`（新增）
- `tests/unit/PermissionBridge.test.ts`（新增）
- `src/adapters/types.ts` — 新增權限相關型別
- `src/adapters/BaseAdapter.ts` — 新增 3 個預設方法
- `src/adapters/TelegramAdapter.ts` — 權限 UI + fire-and-forget + allowed_updates
- `src/core/MessageProcessor.ts` — PermissionBridge 組裝 + canUseTool 閉包
- `agents/general/.claude/settings.local.json` — 權限收緊

---

### v1.6.0 - 中間訊息即時串流

**發布日期**：2026-01-28

**背景**：SDK 多輪 agent 處理期間會產生多個 assistant 訊息（「讓我查看檔案」 → 工具執行 →「找到了」→ 最終回答），但原本所有訊息收集後一次性發送，使用者在處理期間完全沒有反饋。

**變更**：
- **Callback-based Streaming**：`ExecuteQueryOptions` 新增 `onIntermediateMessage` optional callback，SDK for-await 迴圈中每收到 assistant 訊息即呼叫 callback 即時送出
- **MessageProcessor 串流注入**：`executeQueryWithSDK()` 注入 callback 閉包，透過 adapter 即時發送中間訊息到 Telegram
- **DB 分段持久化**：中間訊息獨立存入 DB，WebUI 對話記錄與 Telegram 看到的一致
- **QueryResult 擴充**：新增 `intermediateMessageCount` 欄位追蹤已串流的訊息數量
- **向後相容**：不提供 callback 時行為完全不變，既有 284 tests 零修改全部通過

**設計原則維持**：
- SDKQueryManager 保持解耦 — callback 是 optional 函式，不知道消費者身份
- 零 Adapter 改動 — TelegramAdapter 既有的 RateLimiter 自動處理多次呼叫

**修改檔案**：
- `src/core/SDKQueryManager.ts` — `ExecuteQueryOptions` + `QueryResult` 介面擴充、for-await 迴圈 callback 邏輯、移除未使用 import
- `src/core/MessageProcessor.ts` — `executeQueryWithSDK()` callback 注入、DB 分段持久化

**測試**：284 tests, 19 files 全部通過

---

### v1.5.2 - Moltbot Gap Analysis 實作

**發布日期**：2026-01-28

**背景**：根據 Moltbot 官方文件（docs.molt.bot）逐項對照，補齊 agents/general/ 缺少的機制。

**變更**：
- **教訓路由修正**：寫入規則從 SOUL.md 改為 CLAUDE.md 自身的 Lessons Learned 區段（符合官方 AGENTS.md 模板）
- **BOOTSTRAP.md**：新增首次啟動儀式，agent 第一次對話時自動執行 onboarding（認識使用者、定義自己），完成後刪除檔案
- **對話保護規則**：CLAUDE.md 新增 Auto-flush 行為規則，agent 在長對話中主動保存記憶
- **Lessons Learned 區段**：CLAUDE.md 尾部新增空區段，供 agent 自行寫入從經驗學到的操作規則

**決定不做**：
- **HEARTBEAT.md**：需要 Gateway 排程器配套才能實現定期巡邏，純 CLAUDE.md 指令無法達成
- **TOOLS.md**：general agent 不需要環境特定備註

**修改檔案**：
- `agents/general/CLAUDE.md` — 教訓路由 + Startup Protocol + 對話保護 + Lessons Learned
- `agents/general/BOOTSTRAP.md` — 新增
- `docs/moltbot-gap-analysis.md` — 新增（差距分析文件）

**設計原則維持**：零引擎改動，所有變更都在 agent 層

---

### v1.5.1 - Dynamic SystemPrompt

**發布日期**：2026-01-28

**問題**：AgentLoader 在啟動時讀取 CLAUDE.md 並快取為 `LoadedAgent.systemPrompt` 靜態字串。Agent 若在對話中透過 Write 工具自主更新 CLAUDE.md（記憶協議允許），後續 query 仍使用舊的快取值。

**修復**：
- **AgentLoader.readSystemPrompt(agentId)** — 新增方法，每次從磁碟重新讀取 CLAUDE.md（保持原有優先序：config.systemPrompt > systemPromptFile > CLAUDE.md）
- **MessageProcessorOptions.getSystemPrompt** — 新增可選的函式注入點，每次 query 前呼叫以取得最新 systemPrompt
- **MessageProcessor.executeQueryWithSDK()** — 使用注入的 `getSystemPrompt(agent.id)` 取代快取的 `agent.systemPrompt`
- **index.ts** — 連接 `agentLoader.readSystemPrompt()` 到 MessageProcessor

**設計原則維持**：
- SDKQueryManager 零改動 — 仍然只接收 systemPrompt 字串
- 依賴注入 — MessageProcessor 透過函式接收，不直接依賴 AgentLoader
- 向下相容 — `getSystemPrompt` 為 optional，未提供時 fallback 到 `agent.systemPrompt` 快取值

**修改檔案**：
- `src/core/AgentLoader.ts` — 新增 `readSystemPrompt()` 方法
- `src/core/MessageProcessor.ts` — 新增 `getSystemPrompt` 注入、每次 query 前讀取最新
- `src/index.ts` — 連接 agentLoader 到 messageProcessor

**測試**：284 tests, 19 files 全部通過

---

### v1.5.0 - Agent 記憶系統

**發布日期**：2026-01-28

**重大變更**：
- **Moltbot 風格記憶系統**：`agents/general/` 整合自主記憶能力，採用 Moltbot 純檔案記憶架構
- **零程式碼改動**：不動 `src/` 任何一行，記憶邏輯完全由 Agent 透過 CLAUDE.md 指令自行管理
- **SDKQueryManager 完全解耦**：記憶系統不污染 SDK 整合層，SDKQueryManager 可獨立抽離做其他開發

**設計原則**：
- Agent 自主管理 — CLAUDE.md 定義記憶協議，Agent 用 Read/Write 工具自行讀寫 workspace 檔案
- 不建立「組裝層」— 不在 MessageProcessor 或任何中間層把記憶內容注入 systemPrompt
- SDKQueryManager 只接收 systemPrompt 字串 + cwd 路徑，完全不知道記憶系統的存在

**新增檔案**（`agents/general/`）：
- `CLAUDE.md`（改寫）— 從 9 行簡單提示改為完整記憶協議（Startup Protocol + Memory System + Safety）
- `SOUL.md` — 人格定義（Core Truths、Boundaries、Vibe、Continuity、Voice Guide）
- `USER.md` — 使用者檔案模板
- `IDENTITY.md` — AI 身份模板
- `MEMORY.md` — 長期記憶空結構
- `memory/.gitkeep` — 每日日誌目錄

**Agent 啟動協議**（CLAUDE.md 定義）：
1. 讀 SOUL.md — 知道自己是誰
2. 讀 USER.md — 知道對面是誰
3. 讀 IDENTITY.md — 知道自己的名字和風格
4. 讀 MEMORY.md — 知道過去的重要事實
5. 讀 memory/今天.md — 知道今天發生了什麼
6. 讀 memory/昨天.md — 知道昨天的 context

**記憶寫入規則**：
| 內容 | 寫到哪裡 |
|------|----------|
| 決定、偏好、持久事實 | MEMORY.md |
| 日常筆記、進行中 context | memory/YYYY-MM-DD.md |
| 學到的教訓、犯的錯 | SOUL.md |
| 人格上的自我發現 | SOUL.md（修改必須通知使用者）|

**參考設計**：[Moltbot 純檔案記憶架構](../../docs/moltbot-blueprint.md)（Phase 0）

---

### v1.4.1 - 對話連續性修復

**發布日期**：2026-01-27

**問題**：伺服器重啟後對話永遠從零開始，日誌顯示 `resume: "(new session)"`

**根因**：Session 過期→DB 刪除→ON DELETE CASCADE 刪除對話歷史→新 session 無 sdkSessionId→SDK 開啟全新對話

**修復**：
- **保留 DB 行**：`cleanupExpired()` 只從記憶體移除，DB 行保留供對話延續
- **restoreSessions()** 僅清理超過 `dbRetentionMs`（預設 30 天）的古老 session，過期 session 不載入記憶體但保留在 DB
- **createSession() 繼承 sdkSessionId**：建立新 session 前查 DB 取回先前 `session_id` + `sdk_session_id`，重用舊 session ID（保持 conversations FK 關聯）
- **Resume 失敗自動重試**：`executeQueryWithSDK()` 帶 resume 呼叫 SDK 失敗時，清除 sdkSessionId 並不帶 resume 重試一次（優雅降級）
- **Server crash 恢復**：`restoreSessions()` 自動重置卡住的 `processing` 狀態為 `idle`

**新增設定**：
- `SessionStoreConfig.dbRetentionMs` — DB 保留期（預設 30 天），超過此期限的 session 在啟動時清除
- `DB_RETENTION_MS` 環境變數

**修改檔案**：
- `src/core/SessionManager.ts` — cleanupExpired、restoreSessions、createSession
- `src/core/MessageProcessor.ts` — executeQueryWithSDK resume 重試邏輯
- `src/types/session.ts` — dbRetentionMs 配置
- `src/persistence/types.ts` — IConversationRepository 補 getLastMessages
- `src/index.ts` — DB_RETENTION_MS 環境變數
- `tests/unit/SessionManager.test.ts` — 新增 4 個對話連續性測試

**測試**：284 tests, 19 files 全部通過

---

### v1.4.0 - 設計債清理與架構對齊

**發布日期**：2026-01-27

**重大變更**：
- **移除 Legacy 模式**：SDK 為唯一模式，移除 `USE_CLAUDE_AGENT_SDK` 環境變數、Legacy 執行路徑、直接使用 @anthropic-ai/sdk 的程式碼
- **移除 CLI**：刪除 `src/cli.ts` 與 `npm run cli` script
- **SDK 訊息持久化**：SDK query 完成後自動將 user/assistant 訊息存入 ConversationRepository，供 WebUI 查看對話歷史
- **agent.json 配置生效**：`maxTurns` 等設定值從 agent 配置讀取（原先硬寫為 10）
- **清理安全框架**：移除未使用的 `ConfirmationManager`、`SensitiveCommandConfig`、`PendingConfirmation`、`DEFAULT_SENSITIVE_COMMANDS`
- **清理 ConversationRepository**：移除 Legacy 專用方法（`trimConversation`、`bulkInsert`、`cleanupOrphaned`）

**移除檔案**：
- `src/cli.ts`

**修改檔案**：
- `src/core/MessageProcessor.ts` — 移除 Legacy 分支、讀取 agent maxTurns、新增 SDK 訊息持久化
- `src/index.ts` — 移除 Legacy 初始化、連接 conversationRepository 到 MessageProcessor
- `src/persistence/ConversationRepository.ts` — 移除 Legacy 方法
- `src/persistence/types.ts` — 移除 `trimConversation` 介面方法
- `src/utils/security.ts` — 移除 ConfirmationManager 相關程式碼
- `src/utils/index.ts` — 移除 ConfirmationManager exports
- `package.json` — 移除 cli script

**測試**：280 tests, 19 files 全部通過

---

### v1.3.0 - 多機器人架構

**發布日期**：2026-01-27

**重大變更**：
- **每個 Agent 獨立 Bot**：從「單一 Bot + `/switch` 切換」改為「一個 Agent 一個 Bot」
- 新增 `PlatformOrchestrator` — 統一管理所有平台 Adapter 的生命週期
- 新增 `AdapterRegistry` — `platform::agentId` 複合鍵管理 Adapter 實例
- Session Key 從 `platform::userId` 改為 `platform::agentId::userId`
- DB Schema v2 — UNIQUE 約束加入 `agent_id`，含自動 migration
- 移除 `/switch`、`/list` Telegram 指令
- 移除 `switchAgent()` 方法
- 移除 `TELEGRAM_BOT_TOKEN` 環境變數

**新增欄位**：
- `agent.json` 新增 `telegramBotToken` 欄位

**新增檔案**：
- `src/core/PlatformOrchestrator.ts`
- `src/core/AdapterRegistry.ts`

**修改檔案**：
- `src/types/agent.ts` — AgentConfigSchema 新增 telegramBotToken
- `src/types/session.ts` — getSessionKey 改為三段式
- `src/persistence/DatabaseManager.ts` — Schema v2 migration
- `src/persistence/SessionRepository.ts` — 查詢加入 agentId
- `src/core/SessionManager.ts` — 所有方法加入 agentId 參數
- `src/core/MessageProcessor.ts` — 接收外部傳入 agentId
- `src/core/AgentLoader.ts` — 新增 getAgentsWithPlatformTokens()
- `src/adapters/TelegramAdapter.ts` — 建構綁定 agentId
- `src/adapters/commands/TelegramCommands.ts` — 移除 switch/list
- `src/index.ts` — 使用 PlatformOrchestrator 啟動
- `src/webui/types.ts` — 注入 PlatformOrchestrator
- `src/webui/routes/agents.ts` — 顯示 Bot 狀態
- `src/webui/api/agents.api.ts` — Bot 重載使用 Orchestrator
- `src/webui/views/agents/list.ejs` — Bot Status 欄位
- `src/webui/views/agents/detail.ejs` — Bot Status 區塊

**WebUI 增強**：
- Agents 列表頁顯示各 Bot 運行狀態（綠色/黃色 badge）
- Agent 詳情頁顯示 Bot 狀態資訊
- Agent 重載透過 Orchestrator 同時重啟 config 與 Adapter

**測試**：312 tests, 19 files 全部通過（v1.4.0 後降為 280 tests）

---

### v1.2.0 - WebUI 管理介面

**發布日期**：2026-01-27

**重大變更**：
- 新增 `src/webui/` 模組 - Express + EJS 管理介面
- 支援密碼認證（JWT + httpOnly Cookie）
- Dashboard 系統狀態監控
- Agents 管理（列表、詳情、重載）
- Sessions 管理（列表、篩選、關閉、清理）
- Conversations 查看與匯出

**新增依賴**：
- express ^5.0.1
- ejs ^3.1.10
- cookie-parser ^1.4.7
- jsonwebtoken ^9.0.2
- tailwindcss ^3.4.17（開發依賴）

**新增環境變數**：
- `WEBUI_ENABLED` - 啟用 WebUI（預設 false）
- `WEBUI_PORT` - WebUI 埠號（預設 3001）
- `WEBUI_PASSWORD` - 登入密碼（必填）
- `WEBUI_JWT_SECRET` - JWT 密鑰
- `WEBUI_SESSION_EXPIRE` - Session 過期時間

**新增檔案**：
- `src/webui/WebUIServer.ts` - Express Server
- `src/webui/middleware/auth.ts` - JWT 認證
- `src/webui/routes/` - 頁面路由
- `src/webui/api/` - API 端點
- `src/webui/views/` - EJS 模板（元件化設計）
- `public/` - 靜態資源

**架構特點**：
- 元件化 EJS 模板（components/, partials/）
- 使用 `partials/start.ejs` + `partials/end.ejs` 包裹模式（EJS 不支援原生 layout）
- 依賴注入（透過 middleware 注入到 request）
- 服務層分離（StatsService）
- 啟動時預載所有 Agents（`loadAllAgents()`）

**已知修復**：
- 修正 EJS 模板結構（從錯誤的 JavaScript 模板字串語法改為正確的 EJS include）
- 修正 Agents 列表不完整問題（改用 `loadAllAgents()` 預載）

---

### v1.1.0 - SQLite 持久化

**發布日期**：2026-01-26

**重大變更**：
- 新增 `src/persistence/` 模組
- 支援 Session 持久化到 SQLite
- 重啟後可恢復 Session（SDK 模式透過 resume）
- WAL 模式提升並發效能

**新增環境變數**：
- `ENABLE_PERSISTENCE` - 啟用持久化（預設 false）
- `DB_PATH` - 資料庫路徑

**新增檔案**：
- `src/persistence/DatabaseManager.ts`
- `src/persistence/SessionRepository.ts`
- `src/persistence/ConversationRepository.ts`
- `src/persistence/types.ts`

---

### v1.0.0 - 生產環境就緒

**重大變更**：
- 完整的 Telegram Bot 功能
- 323 個測試，覆蓋率達標
- CLI 測試工具（v1.4.0 移除）
- Docker 部署支援

**已實作功能**：
- AgentLoader + ConfigTransformer
- SessionManager（含並發控制、冪等性檢查）
- TelegramAdapter（含速率限制、長訊息分割）
- 指令系統（/start, /help, /reset）（v1.3.0 移除 /list, /switch）
- 安全機制（用戶白名單、審計日誌、輸入驗證）

---

### v0.6.0 - 安全強化

**新增功能**：
- 用戶白名單（ALLOWED_USERS 環境變數）
- 審計日誌模組（src/utils/audit.ts）
- 訊息長度限制
- 基本 Prompt Injection 偵測
- 敏感指令確認機制（v1.4.0 移除 ConfirmationManager）

---

### v0.5.0 - Telegram 平台整合

**新增功能**：
- TelegramAdapter（使用 grammy）
- 訊息分割（4096 字元上限）
- 打字指示器
- 速率限制（35ms 最小間隔）
- 指令處理

---

### v0.4.0 - SessionManager

**新增功能**：
- 多用戶 Session 管理
- `platform::userId` 作為 session key（v1.3.0 改為 `platform::agentId::userId`）
- 並發控制（async-mutex）
- 冪等性檢查
- 自動清理過期 Session

---

### v0.3.0 - AgentLoader

**新增功能**：
- 目錄掃描載入 Agent
- Zod Schema 驗證
- Agent 繼承（extends）
- hooks.ts 動態載入

---

### v0.2.0 - 型別定義

**新增功能**：
- 完整 TypeScript 型別系統
- Zod Schema 驗證
- 自訂錯誤類別

---

### v0.1.0 - 專案初始化

**建立項目**：
- TypeScript + ESM 配置
- ESLint + Prettier
- Vitest 測試框架
- pino 日誌系統
