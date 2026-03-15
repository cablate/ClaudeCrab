# ClaudeCab Discord 公司平台：完整規劃與可行性評估

> 日期：2026-03-15
> 版本：v1.0
> 基於：paperclip-research 01-14 + openspec/specs/* + 現有原始碼分析
> 目的：應用場景分析 → 可行性評估 → 架構拆解 → Roadmap → 任務拆分 → 自我檢查

---

## 一、ClaudeCab 願景還原

從 openspec/specs/ 與研究報告中提煉出的核心願景：

> **ClaudeCab = 一個人的 AI 公司。**
> 每個 Agent 是專職員工，有自己的人格、記憶、技能成長軌跡。
> Telegram 是即時通訊（手機端），Discord 是公司辦公室（桌面端）。
> Agent 不只是工具——他們會成長、會學習、會發展出獨特的能力。

**三根支柱：**

| 支柱 | 說明 | 對應 spec |
|------|------|-----------|
| **通訊介面** | 雙平台（Telegram 即時 + Discord 辦公室） | product-vision, system-architecture |
| **智慧代理** | 目錄即代理、自管記憶、技能成長、MMORPG 遊戲化 | skill-character-system, mmorpg-skill-system |
| **營運基礎** | 預算控管、執行審計、任務管理、排程系統 | product-principles, paperclip-research 01-14 |

---

## 二、應用場景分析

### A. 顯性場景（文件中明確提到）

#### A1. 個人 AI 助理團隊
- **描述**：8 個專職 Agent（coder、writer、admin、seo、transcriber、media、general、oss-coder），各司其職
- **現狀**：已實現，Telegram 端完整運作
- **價值**：核心使用場景，所有其他場景的基礎

#### A2. AI 公司辦公室（Discord）
- **描述**：Discord Server 作為結構化管理介面——Dashboard、Task Board、Approval Gate、Audit Log、Cost Report
- **現狀**：DiscordAdapter 基礎文字收發已有，但缺 Embed/Button/Forum/Slash Command
- **價值**：Paperclip 用 50K 行 React 做的事，Discord 原生結構零前端代碼實現

#### A3. 自動化排程操作
- **描述**：Cron 排程讓 Agent 自動執行任務——每日反思、週報、監控、內容發布
- **現狀**：ScheduleExecutor 已實現（v1.10），YAML 定義排程
- **價值**：無人值守的自動化產出

#### A4. 多代理協作
- **描述**：Delegation chain、Agent Call、Group Chat——Agent 之間自動分工協作
- **現狀**：Telegram 群組完整實作（ADR-019/022/023/030），Discord 尚無群組支援
- **價值**：Agent 之間形成真正的「團隊」，而非獨立個體

#### A5. 內容創作管線
- **描述**：Writer 撰稿 → SEO 優化 → Media 配圖 → 排程發布
- **現狀**：各 Agent 獨立運作，可透過 Agent Call 串接，但無結構化管線
- **價值**：自動化內容生產流程

#### A6. 軟體開發輔助
- **描述**：Coder 處理專案開發，OSS-Coder 處理開源維護
- **現狀**：已實現，Agent 可操作 Claude Code 完整工具鏈
- **價值**：AI-Powered 開發流程

#### A7. 會議/內容轉寫
- **描述**：Transcriber Agent 處理語音轉文字、逐字稿整理
- **現狀**：Telegram 端 STT 已實現（Groq Whisper），Agent 有專屬 Skill
- **價值**：語音內容的結構化處理

#### A8. 知識管理系統
- **描述**：Shared Knowledge 發布機制（私有 → 共享）、Agent 間知識流通
- **現狀**：shared-knowledge spec 已定義，PathValidator 已實作讀寫權限
- **價值**：Agent 累積的知識可以跨 Agent 複用

### B. 隱含場景（從架構與設計中推導）

#### B1. 預算控管的 AI 營運
- **描述**：Budget Hard Stop 防止失控花費、自動暫停超預算 Agent、視覺化成本報告
- **現狀**：QueryMetrics 有追蹤但無預算控制
- **價值**：個人使用者的成本安全網——一個排程跑瘋不會燒掉幾十美元

#### B2. Agent 遊戲化成長（MMORPG）
- **描述**：技能熟練度、裝備系統、成就徽章、角色面板、技能合成——讓 Agent 使用越久越獨特
- **現狀**：spec 完整定義（skill-character-system + mmorpg-skill-system），部分 Agent 有初步實作
- **價值**：情感留存 + 獨特性壁壘——「我花 90 天培養的 Agent 不可能被別人複製」

#### B3. 執行審計與追溯
- **描述**：每次 SDK query 留不可變記錄（觸發原因、tokens、成本、session ID）、Activity Event Feed
- **現狀**：只有 Pino log（非結構化）+ query_metrics（數字）
- **價值**：「Agent 昨晚 3 點做了什麼？」可以回答

#### B4. 多平台 AI 介面
- **描述**：同一組 Agent 同時在 Telegram + Discord 運作，未來可擴展 Slack、Line
- **現狀**：BaseAdapter 抽象層已設計好，Telegram 完整、Discord 基礎
- **價值**：使用者在不同場景用不同平台，Agent 體驗一致

#### B5. AI 團隊人事管理
- **描述**：Admin Agent 作為「人資總監」——管理其他 Agent 的配置、監控狀態、產出報告
- **現狀**：Admin Agent 已存在，有 agent-management skill
- **價值**：Meta-agent 管理 agent 團隊

### C. 延伸場景（合理推導但未明確寫出）

#### C1. 語音 AI 辦公室
- **描述**：Discord Voice Channel + TTS，Agent 用語音播報結果、參加「語音會議」
- **現狀**：TTSService 已有（Replicate），Discord Voice 未實作
- **價值**：更擬人化的 AI 團隊體驗

#### C2. AI 驅動的 DevOps
- **描述**：Coder Agent 自動監控 CI/CD、Review PR、修復 build failure
- **現狀**：Coder Agent 有 Claude Code 完整能力，但無自動觸發機制
- **價值**：減少人工介入的開發流程

#### C3. 知識合成與技能進化
- **描述**：Agent 從長期互動中自動提煉模式，合成新 Skill（Draft → Refined → Masterwork → Legendary）
- **現狀**：mmorpg-skill-system spec 有完整定義，尚未實作
- **價值**：Agent 越用越聰明、越用越獨特

#### C4. 開源多代理框架
- **描述**：ClaudeCab 作為可複用的開源框架，讓其他人也能建立自己的 AI 團隊
- **現狀**：OSS-Coder Agent 存在，SDK 整合層可抽離
- **價值**：社群效應、生態系統

#### C5. 客戶端 AI 團隊
- **描述**：為不同客戶建立獨立 Discord Server，每個 Server 有專屬 Agent 團隊
- **現狀**：架構上可行但需 multi-tenancy
- **價值**：商業化路徑之一（但 spec 明確標為「不做」）

---

## 三、可行性評估

### 評估維度

| 等級 | 落地難度 | 技術成熟度 |
|------|---------|-----------|
| 低 | ≤4h，改動 ≤3 個檔案 | 成熟：有現成方案或已有部分實作 |
| 中 | 4-8h，改動 4-8 個檔案 | 可行：需要研發但路徑清晰 |
| 高 | >8h，需要新模組/新架構 | 高風險：路徑不確定或依賴外部因素 |

### 評估矩陣

| # | 場景 | 落地難度 | 技術成熟度 | 風險 | 優先級 |
|---|------|---------|-----------|------|--------|
| **A1** | 個人 AI 助理團隊 | — | 成熟 | — | ✅ 已完成 |
| **A2** | AI 公司辦公室（Discord） | 高 | 可行 | Discord API rate limit、multi-bot 協調 | **P0** |
| **A3** | 自動化排程 | — | 成熟 | — | ✅ 已完成 |
| **A4** | 多代理協作 | 中 | 成熟 | Telegram 已有，Discord 需移植 | P1 |
| **A5** | 內容創作管線 | 中 | 可行 | 需 Task Board 支撐結構化管線 | P2 |
| **A6** | 軟體開發輔助 | — | 成熟 | — | ✅ 已完成 |
| **A7** | 會議轉寫 | — | 成熟 | — | ✅ 已完成 |
| **A8** | 知識管理 | 低 | 成熟 | spec 已定義、PathValidator 已有 | P2 |
| **B1** | 預算控管 | 中 | 成熟 | Paperclip 有成熟方案可借鑑 | **P0** |
| **B2** | MMORPG 遊戲化 | 高 | 可行但需研發 | 純 CLAUDE.md 驅動，無引擎代碼 | P3 |
| **B3** | 執行審計 | 中 | 成熟 | 新增 3 張表 + 雙寫 | **P0** |
| **B4** | 多平台介面 | 中 | 可行 | BaseAdapter 已設計好 | P1 |
| **B5** | AI 團隊管理 | 低 | 成熟 | Admin Agent 已存在 | P2 |
| **C1** | 語音 AI 辦公室 | 高 | 高風險 | @discordjs/voice 複雜度高 | P4 |
| **C2** | AI DevOps | 中 | 可行 | 需 webhook/event 觸發機制 | P3 |
| **C3** | 知識合成/技能進化 | 高 | 可行但需研發 | 依賴 Agent 自主能力 | P3 |
| **C4** | 開源框架 | 高 | 可行 | 需要大量文件、抽象、測試 | P4 |
| **C5** | 客戶端 AI 團隊 | 高 | 高風險 | 需 multi-tenancy（明確不做） | ❌ 排除 |

### 風險清單

| 風險 | 影響 | 緩解措施 |
|------|------|---------|
| Discord API Rate Limit（5/5s/channel） | Dashboard 更新頻率受限 | Embed edit（非 send）、15 分鐘更新間隔 |
| Multi-Bot 的 Interaction 路由 | Slash Command 只能註冊在一個 application | 主 Bot 處理所有 interaction，Agent Bot 只發訊息 |
| Discord 3 秒 Interaction 回應 deadline | Permission Prompt 可能超時 | `deferReply()` 立即回應，後續 `editReply()` |
| SQLite 並發寫入瓶頸 | Activity Events 高頻寫入 | 批次寫入佇列（已有 ActivityService 的 batch 機制） |
| Agent 排程失控燒 Token | 成本超支 | Budget Hard Stop（P0 最高優先） |
| Discord Bot Token 外洩 | 安全風險 | 環境變數、.gitignore、Secret Redaction in Logs |

---

## 四、系統架構拆解

### 核心能力層

| 模組 | 狀態 | 說明 |
|------|------|------|
| SDKQueryManager | ✅ 已有 | Claude SDK V1 查詢（stateless） |
| SDKSessionManager | ✅ 已有 | Claude SDK V2 session（cache 效率） |
| MessageProcessor | ✅ 已有 | 統一訊息處理管線（平台無關） |
| SessionManager | ✅ 已有 | Session 生命週期管理 |
| AgentLoader | ✅ 已有 | 動態掃描/載入 Agent 配置 |
| EventBus | ✅ 已有 | 型別化 pub/sub 事件中樞 |

### 平台適配層

| 模組 | 狀態 | 說明 |
|------|------|------|
| BaseAdapter | ✅ 已有 | 抽象 adapter（lifecycle 狀態機） |
| TelegramAdapter | ✅ 完整 | 1469 行，全功能（含 STT/TTS/Permission/Group） |
| DiscordAdapter | 🟡 基礎 | 300 行，僅文字收發，缺 16+ 個功能 |
| **DiscordInteractionHandler** | ❌ 缺失 | Button/Slash Command 處理 |
| **DiscordMainBot** | ❌ 缺失 | 系統級操作（Dashboard/Alerts/SlashCmd） |
| AdapterRegistry | ✅ 已有 | (platform, agentId) → adapter 映射 |
| PlatformOrchestrator | 🟡 部分 | Discord 啟動有，但管理功能只有 Telegram |

### 營運服務層

| 模組 | 狀態 | 說明 |
|------|------|------|
| **BudgetService** | ❌ 缺失 | 預算設定、檢查、自動暫停、警告 |
| **ExecutionRecordRepository** | ❌ 缺失 | 執行審計記錄 |
| **ActivityEventService** | ❌ 缺失 | 結構化活動事件（SQLite + Discord 雙寫） |
| **DashboardService** | ❌ 缺失 | Dashboard Embed 組合 + 定時更新 |
| **TaskService** | ❌ 缺失 | Forum 任務 CRUD + SQLite 同步 |
| **CostReportService** | ❌ 缺失 | 每日成本報告 Embed |
| QueryMetricsRepository | ✅ 已有 | Token/Cost 追蹤（但用 float USD） |
| ActivityService | ✅ 已有 | WebUI 活動追蹤（需要擴充為雙寫） |

### 多代理協作層

| 模組 | 狀態 | 說明 |
|------|------|------|
| GroupBroadcaster | ✅ 已有 | Telegram 群組路由 |
| DelegationHandler | ✅ 已有 | @mention 委派鏈 |
| InitiativeHandler | ✅ 已有 | 主動發言評估 |
| SocialHandler | ✅ 已有 | 社交模式能量管理 |
| AgentCallService | ✅ 已有 | 跨 Agent 呼叫（fire-and-forget / await） |
| ContextInjector | ✅ 已有 | 群組歷史注入 |

### Discord 特有缺口（與 Telegram 對比）

| 功能 | Telegram | Discord | 需要補的 |
|------|---------|---------|---------|
| sendPermissionPrompt | InlineKeyboard | no-op | Embed + Button + InteractionHandler |
| sendQuestionPrompt | InlineKeyboard | no-op | Embed + Button + InteractionHandler |
| sendExitPlanModePrompt | InlineKeyboard | no-op | Embed + Button + InteractionHandler |
| sendPhoto/Document/Audio/Video | 完整 | no-op | discord.js Attachment |
| Bot Commands | 10+ 命令 | 無 | Slash Commands |
| Rate Limiter | 完整 | 無 | 需補（防 429） |
| Group Chat | 完整 | 無 | 需移植 social/initiative |
| Status Message | 完整 | 無 | Embed edit 進度 |
| Connection Health | 完整 | 無 | 需補 |
| PlatformOrchestrator 管理 | reload/start/stop/status | 無 | 需擴充 |

---

## 五、開發 Roadmap

### 版本規劃總覽

```
Current (v1.25)
  ↓
v2.0-alpha「安全的公司」    ← Phase 0 + 1（基礎建設 + 安全網）
  ↓
v2.0-beta「看得見的公司」   ← Phase 2 + 3（Dashboard + Task Board）
  ↓
v2.0-rc「完整的公司」       ← Phase 4 + 5（審批 + 組織架構）
  ↓
v2.0「AI 公司辦公室」       ← 穩定 + 文件 + Discord 群組
  ↓
v2.1「成長的團隊」          ← MMORPG 遊戲化（第一波）
  ↓
v3.0「有聲音的辦公室」      ← Voice Channel + 高級功能
```

### 時間估算

| 版本 | 內容 | 預估時間 | 交付價值 |
|------|------|---------|---------|
| v2.0-alpha | Phase 0 + 1 | 7-10h | 有安全網的 Discord 基礎 |
| v2.0-beta | Phase 2 + 3 | 8-11h | 可視化 Dashboard + 任務管理 |
| v2.0-rc | Phase 4 + 5 | 5-7h | 審批流程 + 組織結構 |
| v2.0 | 穩定化 + Discord 群組 | 4-6h | 完整 AI 公司辦公室 |
| v2.1 | MMORPG 第一波 | 8-12h | Agent 成長可見性 |
| v3.0 | Voice + 高級 | 10-15h | 語音辦公室 |

---

## 六、任務拆分（Task Breakdown）

### Phase 0：基礎建設（前置條件，3-4h）

#### P0-1. DiscordAdapter Embed/Button/Forum 方法擴充
- **目標**：讓 DiscordAdapter 從「只能發文字」升級到「能發 Embed、Button、操作 Forum」
- **依賴**：無
- **技術方向**：
  - 新增 `sendEmbed(channelId, embeds, components?)` — 使用 `EmbedBuilder` + `ActionRowBuilder`
  - 新增 `editEmbed(channelId, messageId, embeds, components?)` — 使用 `message.edit()`
  - 新增 `createForumPost(forumChannelId, title, content, tagIds)` — `ThreadChannel.create()`
  - 新增 `updateForumPostTags(threadId, tagIds)` — `thread.setAppliedTags()`
  - 新增 `replyToThread(threadId, content)` — `thread.send()`
  - 新增 `archiveThread(threadId)` — `thread.setArchived(true)`
  - 新增 `sendToChannel(channelId, content)` — 跨 channel 發送（系統用）
- **改動檔案**：`src/adapters/DiscordAdapter.ts`, `src/adapters/types.ts`
- **風險**：Forum Channel 需要 `MANAGE_THREADS` permission
- **預估**：1.5h

#### P0-2. DiscordInteractionHandler 新增
- **目標**：處理 Discord Button click 和 Slash Command interaction
- **依賴**：P0-1
- **技術方向**：
  - 新增 `src/adapters/discord/DiscordInteractionHandler.ts`
  - 監聽 `client.on('interactionCreate')`
  - Button handler：解析 `customId`（格式 `action:requestId`），路由到對應 resolver
  - Slash Command handler：路由到對應處理函式
  - 與現有 `PermissionBridge` 架構對接（Telegram 用 callback_query，Discord 用 Button）
- **改動檔案**：新增 1 檔、修改 `DiscordAdapter.ts`
- **風險**：Interaction 3 秒 deadline 需要 `deferReply()`
- **預估**：1h

#### P0-3. Discord 主 Bot 設計與實作
- **目標**：新增一個系統級 Bot，負責 Slash Command、系統 Embed、跨 channel 操作
- **依賴**：P0-2
- **技術方向**：
  - 配置新增 `discord.mainBot.token` + `discord.mainBot.clientId`
  - 主 Bot 處理所有 `interactionCreate`（Slash Command + Button）
  - Agent Bot 只在自己的 channel 發訊息
  - 系統 channel（#dashboard, #system-log, #alerts）由主 Bot 操作
  - Slash Command 註冊（`REST.put(Routes.applicationGuildCommands(...))`）
- **改動檔案**：`src/config.ts`, `src/core/PlatformOrchestrator.ts`, 新增 `src/adapters/discord/DiscordMainBot.ts`
- **風險**：需要額外一個 Discord Bot Application
- **預估**：1h

#### P0-4. SQLite Schema 擴充（3 新表）
- **目標**：新增 `task_records`、`execution_records`、`activity_events` 三張表
- **依賴**：無
- **技術方向**：
  - `CREATE TABLE IF NOT EXISTS`（與現有做法一致）
  - 新增 `TaskRecordRepository.ts`、`ExecutionRecordRepository.ts`、`ActivityEventRepository.ts`
  - 索引策略：`idx_task_status`, `idx_task_assignee`, `idx_exec_agent`, `idx_exec_trigger`, `idx_activity_agent`, `idx_activity_type`
- **改動檔案**：`src/persistence/DatabaseManager.ts`, 新增 3 個 Repository 檔案, `src/persistence/types.ts`
- **風險**：低。`CREATE TABLE IF NOT EXISTS` 不會破壞現有資料
- **預估**：1h

---

### Phase 1：安全網 + 可見性（核心價值，4-6h）

#### P1-1. Budget Hard Stop
- **目標**：為每個 Agent 設定預算上限，超限自動暫停，防止失控花費
- **依賴**：P0-4
- **技術方向**：
  - `AgentConfig` schema 新增 `budget?: { dailyCents?: number, monthlyCents?: number, warningThreshold?: number }`
  - 新增 `BudgetService.ts`：
    - `checkBudget(agentId): BudgetStatus` — 查 `query_metrics` 計算今日/月累計
    - `isAgentPaused(agentId): boolean` — 是否已超預算
    - `pauseAgent(agentId)` — 標記暫停 + 發通知
  - `MessageProcessor`：query 後呼叫 `budgetService.checkBudget()`
  - `ScheduleExecutor`：執行前檢查、執行後檢查
  - `PlatformOrchestrator`：paused agent 跳過訊息處理
  - Discord 加碼：超 80% → #alerts 黃色 Embed；超 100% → #alerts 紅色 Embed + @Owner
- **改動檔案**：`src/types/agent.ts`, `src/config.ts`, 新增 `src/services/BudgetService.ts`, `src/core/MessageProcessor.ts`, `src/schedule/ScheduleExecutor.ts`, `src/core/PlatformOrchestrator.ts`
- **風險**：post-execution 檢查（同 Paperclip）——最後一次執行可能小幅超支，但下次會停止
- **預估**：2-3h

#### P1-2. Execution Audit Log
- **目標**：每次 SDK query 留下不可變記錄——觸發原因、tokens、cost、duration、status
- **依賴**：P0-4
- **技術方向**：
  - 每次 `SDKQueryManager.executeQuery()` 或 `SDKSessionManager.executeQuery()` 完成後記錄
  - 記錄欄位：`agent_id`, `trigger_type`（chat/schedule/agent_call）, `trigger_source`, `prompt_summary`（前 200 字）, `response_summary`（前 200 字）, `input_tokens`, `output_tokens`, `cost_cents`, `duration_ms`, `status`, `error_message`
  - 排程完成 → #system-log 發簡短 Embed
  - 錯誤 → #alerts 發 Embed + @Owner
- **改動檔案**：`src/core/MessageProcessor.ts`, `src/schedule/ScheduleExecutor.ts`, `src/services/AgentCallService.ts`
- **風險**：`prompt_summary` 需要 Secret Redaction（API key、token 等）
- **預估**：2h

#### P1-3. Activity Event Service（雙寫架構）
- **目標**：關鍵事件同時寫 SQLite + 發 Discord
- **依賴**：P0-4, P0-1
- **技術方向**：
  - 新增 `ActivityEventService.ts`（與現有 `ActivityService` 不同——後者是 WebUI 用的）
  - Event types：`chat.received`, `chat.responded`, `schedule.started/completed/failed`, `agent_call.sent/received`, `approval.requested/decided`, `budget.warning/exceeded`, `task.created/completed`, `error.occurred`
  - 普通事件 → #system-log（簡短文字行，不用 Embed 避免太重）
  - 錯誤/預算事件 → #alerts（Embed + Button）
  - 自動 Secret Redaction（regex 匹配 API key、JWT、password patterns）
  - 批次寫入佇列（每 2 秒或 20 筆刷新一次，已有 pattern）
- **改動檔案**：新增 `src/services/ActivityEventService.ts`, 各入口點呼叫
- **風險**：event 高頻發送可能觸發 Discord rate limit（5/5s/channel）→ 用佇列 + 合并
- **預估**：2h

#### P1-4. Agent Call Depth Tracking
- **目標**：防止 Agent A → B → C → A 無限迴圈
- **依賴**：無
- **技術方向**：
  - `AgentCallService` 新增 `depth` 參數（預設 0）
  - `MAX_CALL_DEPTH = 5`（比現有 delegation 的 3 更寬鬆——delegation 是自動觸發，agent-call 是明確請求）
  - 超過上限 → 拒絕呼叫 + 記錄 activity event
  - 注意：Delegation chain 已有 depth 3 限制（DelegationHandler），這裡是針對 `call_agent` MCP tool
- **改動檔案**：`src/services/AgentCallService.ts`, `src/tools/notifyAgentTool.ts`
- **風險**：極低
- **預估**：30min

---

### Phase 2：Dashboard + Cost Report（3-4h）

#### P2-1. DashboardService
- **目標**：#dashboard channel 固定一條 Embed 訊息，排程定時 edit 更新
- **依賴**：P1-2, P1-3（需要 execution_records 和 activity_events 資料）
- **技術方向**：
  - 啟動時在 #dashboard 發送多 Embed 訊息 → pin → 記錄 `messageId`
  - 排程每 15 分鐘 `message.edit({ embeds: [...] })`（不洗版）
  - 4 個 Embed 區塊：
    1. Agent 狀態總覽（🟢 idle / 🔵 busy / ⏸ paused）
    2. 今日花費 + 月累計（進度條：█░）
    3. 任務看板摘要（in-progress / pending / done 計數）
    4. 最近活動（最新 5 筆 activity event）
  - Button：[🔄 Refresh]（觸發即時更新）
  - 狀態變更時也觸發更新（Agent 開始/完成任務）
- **改動檔案**：新增 `src/services/DashboardService.ts`, `src/core/PlatformOrchestrator.ts`
- **風險**：需要在啟動時查找或重建 pinned message（如果 messageId 丟失）
- **預估**：2h

#### P2-2. Cost Report（每日報告）
- **目標**：每日 23:55 在 #cost-report 發送成本摘要 Embed
- **依賴**：P1-1（需要 BudgetService）
- **技術方向**：
  - 排程觸發（新增 YAML schedule 或 hardcoded cron）
  - Embed 包含：
    - 每個 Agent 的 today / month 花費 + 進度條
    - 月累計 / 月預算百分比
    - 🟢/🟡/🔴 狀態指示
  - Button：[📊 By Date]（切換 today/week/month 視圖）
- **改動檔案**：新增排程定義、`QueryMetricsRepository.ts` 可能需要新查詢
- **風險**：低
- **預估**：1h

#### P2-3. Integer Cents 遷移
- **目標**：`total_cost_usd: real` → `total_cost_cents: integer`，全局轉換
- **依賴**：無
- **技術方向**：
  - `QueryMetricsRepository`：所有 cost 相關 SQL + API 改用 cents
  - 計算時 `Math.round(costUsd * 100)` → 存 integer
  - 顯示時 `(cents / 100).toFixed(2)` → 顯示 USD
  - 遷移現有資料：`UPDATE query_metrics SET total_cost_cents = ROUND(total_cost_usd * 100)`
  - 新增 `total_cost_cents` 欄位，保留 `total_cost_usd` 作為 backward compatibility
- **改動檔案**：`src/persistence/QueryMetricsRepository.ts`, `src/persistence/types.ts`, `src/persistence/DatabaseManager.ts`
- **風險**：需要處理已有資料的遷移
- **預估**：1h

---

### Phase 3：Task Board（5-7h）

#### P3-1. TaskService 核心
- **目標**：Discord Forum 任務 CRUD + SQLite 雙層同步
- **依賴**：P0-1, P0-4
- **技術方向**：
  - `createTask(input)` → Forum post + SQLite insert
  - `updateTaskStatus(taskId, status)` → Forum tag update + SQLite update + thread reply
  - `assignTask(taskId, agentId)` → Forum tag + SQLite + notify agent channel
  - `completeTask(taskId)` → tag [✅ done] + SQLite + dashboard update + 計算累計 cost
  - Forum Tags（最多 20）：
    - Status: 📋 backlog | 🔄 in-progress | 👀 in-review | ✅ done | ❌ cancelled
    - Priority: 🔴 urgent | 🟡 medium | 🟢 low
    - Agent: 🤖 coder | 📝 writer | 🔧 admin | 🌐 seo | ...
- **改動檔案**：新增 `src/services/TaskService.ts`
- **風險**：Discord Forum tag 最多 20 個——需要合理規劃（8 status/priority + 8 agent = 16，夠用）
- **預估**：2.5h

#### P3-2. /task Slash Command
- **目標**：用 Slash Command 管理任務
- **依賴**：P0-2, P0-3, P3-1
- **技術方向**：
  - `/task create <title> [priority] [assignee]` — 建立任務
  - `/task list [status]` — 列出任務（Embed 格式）
  - `/task assign <id> <agent>` — 指派任務
  - `/task complete <id>` — 完成任務
  - `/task detail <id>` — 顯示任務詳情（含 cost、timeline）
  - 使用 `SlashCommandBuilder` + `StringSelectMenuBuilder`（agent 選擇）
  - 自動完成：agent 名稱、task ID
- **改動檔案**：`src/adapters/discord/DiscordInteractionHandler.ts`, 新增 command 定義
- **風險**：Guild Slash Command 每次更新需要 1 小時全球同步（或用 guild-specific 立即生效）
- **預估**：1.5h

#### P3-3. Agent 自動建任務（MCP tool）
- **目標**：Agent 在執行中可以主動建立/更新任務
- **依賴**：P3-1
- **技術方向**：
  - 新增 MCP tool `create_task`（加入 McpToolSetup）
  - Agent 呼叫 → TaskService.createTask() → Forum post + SQLite
  - 場景：Agent 發現 bug → 自動建 task → 指派給 coder
  - tool 參數：`{ title, description?, priority?, assigneeAgentId? }`
- **改動檔案**：新增 `src/tools/taskTool.ts`, `src/core/McpToolSetup.ts`
- **風險**：需要防止 Agent 瘋狂建任務（rate limit per agent per hour）
- **預估**：1h

#### P3-4. 任務-花費關聯
- **目標**：知道每個任務花了多少 Token 和錢
- **依賴**：P1-2, P3-1
- **技術方向**：
  - `execution_records.task_id` FK → `task_records.id`
  - 任務開始時，MessageProcessor 設定 current `task_id` 到 execution context
  - 任務完成時，`SUM(cost_cents) WHERE task_id = ?` 計算累計成本
  - 更新 `task_records.cost_cents`
  - 任務詳情 Embed 顯示：任務花費 breakdown（by execution）
- **改動檔案**：`src/core/MessageProcessor.ts`, `src/services/TaskService.ts`
- **風險**：Chat 觸發的 execution 可能沒有對應 task——允許 null task_id
- **預估**：1h

---

### Phase 4：Approval Gate（3-4h）

#### P4-1. Discord Permission Prompt（Embed + Button）
- **目標**：SDK 工具需要授權時，Discord 端用 Embed + Button（而非純文字 fallback）
- **依賴**：P0-1, P0-2
- **技術方向**：
  - Override `sendPermissionPrompt()` in DiscordAdapter
  - Embed：工具名、參數摘要、風險等級（顏色編碼）
  - Button：[✅ Allow] [🔁 Always Allow] [❌ Deny]
  - InteractionHandler 路由 button click → `permissionResolver(requestId, decision)`
  - 需要 `deferReply()` 因為 3 秒 deadline
  - 超時 120 秒（與 Telegram 一致）→ 自動 deny + 更新 Embed 顯示「⏰ Timed out」
  - 同時 override `updatePermissionPrompt()`（更新 Embed 狀態）和 `setPermissionResolver()`
- **改動檔案**：`src/adapters/DiscordAdapter.ts`
- **風險**：Interaction token 15 分鐘有效（但 120 秒超時遠在限制內）
- **預估**：1.5h

#### P4-2. Discord Question Prompt
- **目標**：SDK 的 AskUserQuestion 在 Discord 端有結構化 UI
- **依賴**：P4-1
- **技術方向**：
  - Embed 顯示問題 + 選項
  - 如果是開放問題 → Modal（`ModalBuilder` + `TextInputBuilder`）
  - 如果是選擇題 → `StringSelectMenuBuilder`
  - Override `sendQuestionPrompt()` / `setQuestionResolver()`
- **改動檔案**：`src/adapters/DiscordAdapter.ts`, `src/adapters/discord/DiscordInteractionHandler.ts`
- **風險**：Modal 有 5 個 TextInput 上限
- **預估**：1h

#### P4-3. Discord Plan Review
- **目標**：Plan mode 計畫審核用 Embed + Button
- **依賴**：P4-1
- **技術方向**：
  - Override `sendExitPlanModePrompt()` / `setExitPlanModeResolver()`
  - Embed 顯示計畫摘要（分段，因為可能很長）
  - Button：[✅ Approve Plan] [❌ Reject Plan]
  - 超時 → 自動 reject
- **改動檔案**：`src/adapters/DiscordAdapter.ts`
- **風險**：計畫文字可能超過 Embed 6000 字元限制 → 分多個 Embed
- **預估**：1h

#### P4-4. Agent Call Approval（高風險呼叫審批）
- **目標**：特定 Agent Call 需要使用者批准
- **依賴**：P4-1, P1-3
- **技術方向**：
  - `agent.json` 新增 `settings.agentCallApproval?: boolean`
  - 當 Agent A 呼叫 Agent B 且 B 的 `agentCallApproval = true` → 發 Embed 到 #approvals
  - Button：[✅ Approve] [❌ Deny]
  - 等待使用者決策後才執行呼叫
- **改動檔案**：`src/services/AgentCallService.ts`
- **風險**：增加延遲；需要設計合理的超時（60 秒？）
- **預估**：30min

---

### Phase 5：組織架構 + 系統完善（2-3h）

#### P5-1. Agent Config Discord 欄位擴充
- **目標**：Agent 配置支援 Discord 角色、分類、上級關係
- **依賴**：無
- **技術方向**：
  - `AgentConfig` schema 新增：
    ```
    discord?: {
      roles?: string[]        // Discord role names
      category?: string       // 所屬 category
      reportsTo?: string      // 上級 agent ID
    }
    ```
  - `ConfigTransformer` 處理新欄位
- **改動檔案**：`src/types/agent.ts`, 各 agent 的 `agent.json`
- **風險**：極低
- **預估**：30min

#### P5-2. Discord Server 初始化腳本
- **目標**：一鍵建立 Discord Server 結構（Categories、Channels、Roles、Tags）
- **依賴**：P5-1
- **技術方向**：
  - 新增 `scripts/setup-discord-server.ts`
  - 讀取所有 agent config → 建立對應 channel、role、permission overwrites
  - 建立系統 channel（#dashboard、#approvals、#cost-report、#alerts、#system-log）
  - 建立 Forum Channel + Tags（#task-board、#completed-tasks）
  - 輸出 channel ID 映射 → 寫入 config
- **改動檔案**：新增 script
- **風險**：需要 Bot 有 `MANAGE_CHANNELS`, `MANAGE_ROLES` 權限
- **預估**：1.5h

#### P5-3. Agent-Call 方向性
- **目標**：Agent Call 有方向性——Worker 向上呼叫 Manager，Manager 向下委派
- **依賴**：P5-1
- **技術方向**：
  - 讀取 `discord.reportsTo` 建立層級圖
  - `AgentCallService` 在 call 前檢查方向性：
    - Worker → Manager：允許
    - Manager → Worker：允許
    - Worker → Worker（同類）：需要通過 Manager（或直接允許但記錄）
  - 違規呼叫 → 記錄 activity event + 可選拒絕
- **改動檔案**：`src/services/AgentCallService.ts`
- **風險**：過度限制可能降低靈活性 → 先記錄不拒絕，觀察再調整
- **預估**：1h

---

### Phase 6：穩定化 + Discord 群組（v2.0 完成，4-6h）

#### P6-1. PlatformOrchestrator Discord 管理功能
- **目標**：Discord 端的 startBot/stopBot/reloadAgent/getBotStatus 與 Telegram 對等
- **依賴**：Phase 0
- **技術方向**：
  - 擴充 `startBotForAgent()` / `stopBotForAgent()` / `reloadAgent()` / `getBotStatusForAgent()` 支援 `discord` platform
  - `/agent pause <name>` / `/agent resume <name>` Slash Command
- **改動檔案**：`src/core/PlatformOrchestrator.ts`
- **風險**：低
- **預估**：1h

#### P6-2. Discord 群組模式移植
- **目標**：Discord #general / #watercooler 支援多 Bot 群組互動
- **依賴**：Phase 0
- **技術方向**：
  - DiscordAdapter 的 `isGroupChat` 改為動態判斷（config 中標記哪些 channel 是群組）
  - 移植 `GroupBroadcaster` 邏輯到 Discord
  - Bot-to-bot 訊息過濾（已有 `message.author.bot` check）
  - Social mode / Initiative mode 的 Discord 版本
  - #general 所有 Agent Bot 都監聽（而非只監聯自己的 channelId）
- **改動檔案**：`src/adapters/DiscordAdapter.ts`, `src/core/PlatformOrchestrator.ts`, `src/core/GroupBroadcaster.ts`
- **風險**：中。需要重構 DiscordAdapter 的 channel 概念（從單 channel → 多 channel）
- **預估**：3h

#### P6-3. Discord Rate Limiter
- **目標**：防止 Discord API 429 Too Many Requests
- **依賴**：無
- **技術方向**：
  - 複用 TelegramAdapter 的 `RateLimiter` 設計
  - Discord 限制：5 messages / 5s / channel；global 50 requests / s
  - 佇列化發送，超限時自動延遲
- **改動檔案**：`src/adapters/DiscordAdapter.ts`
- **風險**：低
- **預估**：1h

#### P6-4. Discord Media 發送
- **目標**：sendPhoto/Document/Audio/Video 在 Discord 端有實作
- **依賴**：無
- **技術方向**：
  - 使用 `AttachmentBuilder` 發送檔案
  - Override BaseAdapter 的 no-op 方法
- **改動檔案**：`src/adapters/DiscordAdapter.ts`
- **風險**：Discord 檔案大小限制（8MB free, 25MB Nitro）
- **預估**：30min

---

### Phase 7：MMORPG 遊戲化第一波（v2.1，8-12h）

> 注意：這個 Phase 不需要修改 `src/` 引擎代碼——全部透過 Agent 的 CLAUDE.md + Skills 實現。

#### P7-1. sys-agent-protocols 系統技能
- **目標**：主啟動技能，每個 session 開始時載入
- **依賴**：無
- **技術方向**：純 SKILL.md + references/ 文件
- **預估**：2h（設計 + 寫文件 + 測試觸發）

#### P7-2. sys-proficiency 技能熟練度追蹤
- **目標**：追蹤每個 Domain Skill 的使用次數和等級
- **依賴**：P7-1
- **技術方向**：
  - `references/levels.md` 記錄每個 skill 的使用計數 + 當前等級
  - 每次使用 Domain Skill 後自動 +1
  - 等級判定：Novice(0-9) → Apprentice(10-49) → Adept(50-199) → Expert(200-499) → Master(500+)
  - 衰退機制：30 天未用標記「閒置」、90 天降一級
- **預估**：2h

#### P7-3. sys-equipment 裝備管理
- **目標**：管理已裝備的 Skill 和 MCP Server，受容量限制
- **依賴**：P7-1
- **技術方向**：
  - `references/loadout.md` 記錄當前裝備
  - 容量限制：5 Domain Skills + 8 MCP Servers
  - 超出 → 拒絕新增，建議替換
  - 套裝加成定義
- **預估**：1.5h

#### P7-4. sys-achievements 成就系統
- **目標**：定義里程碑並追蹤解鎖
- **依賴**：P7-1
- **技術方向**：
  - `references/milestones.md` 定義成就條件
  - `references/unlocked.md` 記錄已解鎖成就
  - 範例成就：「首次完成排程任務」「連續 30 天活躍」「Master 一個技能」
- **預估**：1.5h

#### P7-5. sys-character-sheet 角色面板
- **目標**：彙整所有系統技能資料，提供單一狀態總覽
- **依賴**：P7-2, P7-3, P7-4
- **技術方向**：
  - 從其他系統技能讀取資料
  - 生成 `references/stats.md`：身份、能力評分、技能列表、裝備、成就、統計
  - Discord Embed 版本（用 /status slash command 觸發）
- **預估**：2h

#### P7-6. 成長循環（每日/每週/每月）
- **目標**：自動驅動的成長循環
- **依賴**：P7-5
- **技術方向**：
  - 每日：排程觸發晨間簡報 + 記憶回寫
  - 每週：週回顧 + 模式提煉
  - 每月：成長報告 + 等級晉升檢查
  - 報告存 `memory/monthly/YYYY-MM.md`
- **預估**：2h（排程 + 提示詞設計）

---

## 七、依賴關係圖

```
Phase 0: 基礎建設
├── P0-1 DiscordAdapter 擴充
├── P0-2 InteractionHandler ─────────────────────────┐
├── P0-3 主 Bot ─────────────────────────────────────┤
└── P0-4 SQLite Schema                              │
     │                                                │
     ├──→ Phase 1: 安全網                             │
     │    ├── P1-1 Budget Hard Stop                   │
     │    ├── P1-2 Execution Audit Log                │
     │    ├── P1-3 Activity Event Service ←───────────┤
     │    └── P1-4 Call Depth Tracking                │
     │         │                                      │
     │         ├──→ Phase 2: Dashboard                │
     │         │    ├── P2-1 DashboardService         │
     │         │    ├── P2-2 Cost Report              │
     │         │    └── P2-3 Integer Cents            │
     │         │                                      │
     ├──→ Phase 3: Task Board ←───────────────────────┤
     │    ├── P3-1 TaskService                        │
     │    ├── P3-2 /task Slash Command ←──────────────┘
     │    ├── P3-3 Agent 建任務
     │    └── P3-4 任務-花費關聯
     │
     ├──→ Phase 4: Approval Gate ←── P0-1, P0-2
     │    ├── P4-1 Permission Prompt
     │    ├── P4-2 Question Prompt
     │    ├── P4-3 Plan Review
     │    └── P4-4 Agent Call Approval
     │
     ├──→ Phase 5: 組織架構
     │    ├── P5-1 Config 擴充
     │    ├── P5-2 Server 初始化腳本
     │    └── P5-3 Call 方向性
     │
     └──→ Phase 6: 穩定化
          ├── P6-1 PlatformOrchestrator
          ├── P6-2 Discord 群組
          ├── P6-3 Rate Limiter
          └── P6-4 Media 發送

Phase 7: MMORPG（獨立，無引擎依賴）
├── P7-1 sys-agent-protocols
├── P7-2 sys-proficiency
├── P7-3 sys-equipment
├── P7-4 sys-achievements
├── P7-5 sys-character-sheet
└── P7-6 成長循環
```

**關鍵路徑**：Phase 0 → Phase 1 → Phase 2（最短可交付路徑：7-10h 得到「安全的公司」）

**平行路線**：Phase 1 完成後，Phase 2/3/4/5 可以任意順序或平行推進。

---

## 八、自我檢查與修正

### 檢查 1：願景 vs 計畫是否對齊？

| 願景元素 | 計畫覆蓋 | 狀態 |
|---------|---------|------|
| Telegram 即時通訊 | ✅ 已完成，不在此計畫範圍 | ✅ |
| Discord 公司辦公室 | ✅ Phase 0-6 完整覆蓋 | ✅ |
| Budget 安全網 | ✅ Phase 1 | ✅ |
| 執行審計 | ✅ Phase 1 | ✅ |
| Dashboard | ✅ Phase 2 | ✅ |
| Task Board | ✅ Phase 3 | ✅ |
| Approval Gate | ✅ Phase 4 | ✅ |
| 組織架構 | ✅ Phase 5 | ✅ |
| MMORPG 遊戲化 | ✅ Phase 7（第一波） | ✅ |
| 多 Bot 群組（Discord） | ✅ Phase 6 | ✅ |
| Voice Channel | ❌ 未規劃（v3.0） | 🟡 延後合理 |
| 知識合成/技能進化 | ❌ 未規劃（v2.1 之後） | 🟡 延後合理 |
| 開源框架 | ❌ 未規劃 | 🟡 延後合理 |

**結論**：核心願景 100% 覆蓋。延後的項目都是「nice-to-have」而非核心。

### 檢查 2：計畫中過度理想化的部分

| 項目 | 潛在問題 | 修正建議 |
|------|---------|---------|
| **主 Bot + Agent Bot 並存** | 多 Bot 管理複雜度、token 數量多 | ✅ 合理——每個 Agent 需要獨立身份（名字+頭像）。主 Bot 只處理系統操作。但需要確認 Discord 對同一 Server 的 Bot 數量有無限制（實測：無硬性限制，但建議 ≤25） |
| **Forum Channel = Ticket Board** | Forum 搜尋能力有限（無 SQL WHERE 級查詢） | ✅ 已用雙層架構解決（Discord UI + SQLite 查詢）——研究報告設計合理 |
| **Embed Dashboard** | 6000 字元 + 25 欄位限制 | ✅ 使用多 Embed（最多 10 個/訊息）。8 個 Agent 的狀態 + 成本完全放得下 |
| **15 分鐘 Dashboard 更新** | 可能不夠即時 | ✅ 可以加上事件驅動更新（Agent 開始/完成時觸發）。15 分鐘是基底保障 |
| **Discord Rate Limit** | 5/5s/channel 可能不夠高頻場景 | 🟡 需要合併通知——多個快速事件合併成一條訊息。Phase 6 的 Rate Limiter 解決 |
| **MMORPG 全靠 CLAUDE.md** | Agent 可能不穩定地執行遊戲化邏輯 | 🟡 這是架構決策——「Agent 自管理，引擎零感知」。風險：Agent 可能忘記更新。緩解：Stop Hook 提醒 |
| **20-28h 完成全部** | 時間估算可能偏樂觀 | 🟡 純開發時間估算合理。但 debug + 聯調 + Discord API 坑可能額外 30-50% 時間。**實際應準備 30-40h** |
| **Integer Cents 遷移** | 現有資料遷移 | ✅ 低風險——新增欄位 + 計算回填，不刪原欄位 |

### 檢查 3：遺漏項目

| 遺漏 | 影響 | 建議 |
|------|------|------|
| **Discord Bot Token 管理** | 需要 9+ 個 Bot Token（8 agent + 1 main） | 需要在 Discord Developer Portal 建立 9 個 Application。可以自動化但首次需手動。加入 Phase 0 前置準備 |
| **Telegram ↔ Discord 訊息同步** | 使用者在 Telegram 問的問題，Discord 端看不到 | 可以選擇性同步——Agent 完成重要任務時雙平台通知。但不是 P0 |
| **Discord 端的 /model、/reset 等命令** | Telegram 有的管理命令 Discord 沒有 | 用 Slash Command 實作。可以併入 Phase 0-3 或 Phase 6 |
| **Graceful Shutdown Discord** | 主 Bot + Agent Bot 都需要優雅關閉 | AppBootstrap 的 shutdown sequence 需要擴充。併入 Phase 6 |
| **Discord 連線健康監控** | Telegram 有 ConnectionHealthMonitor | 需要監控 Discord WebSocket 連線。併入 Phase 6 |
| **Config 格式：JSON → YAML** | 研究報告用 YAML 寫配置，但現有是 JSON | ⚠️ 現有 `agent.json` 是 JSON。Discord 新增欄位可以加入現有 JSON，不需要改格式 |

### 檢查 4：技術風險再評估

| 風險 | 嚴重度 | 緩解方案 | 驗證方式 |
|------|--------|---------|---------|
| Discord.js v14 API breaking change | 中 | 鎖定版本（package.json 已有） | 開發時跑 `npm audit` |
| multi-bot interaction 路由衝突 | 中 | 主 Bot 統一處理 interaction，Agent Bot 不監聽 interactionCreate | Phase 0 PoC 驗證 |
| Forum Channel 在私有 Server 的可用性 | 低 | Community Features 不需要啟用就能用 Forum Channel（Discord 2023 更新） | 建 test server 驗證 |
| SQLite WAL mode 並發寫入 | 低 | 已使用 `PRAGMA journal_mode=WAL`（假設 DatabaseManager 已設定） | 確認現有設定 |
| Agent Bot 同時監聽多 channel（群組） | 中 | Phase 6 需要重構 DiscordAdapter 的 channel 概念 | Phase 6 時處理 |

### 修正後的推薦執行順序

```
前置準備（0.5h）：
  - Discord Developer Portal 建立 9 個 Bot Application
  - 建立 Test Discord Server
  - 邀請所有 Bot 到 Test Server

Phase 0（3-4h）→ Phase 1（4-6h）
  = v2.0-alpha「安全的公司」

Phase 2（3-4h）→ Phase 3（5-7h）
  = v2.0-beta「看得見的公司」

Phase 4（3-4h）+ Phase 5（2-3h）+ Phase 6（4-6h）
  = v2.0「完整的 AI 公司辦公室」

Phase 7（8-12h）
  = v2.1「成長的團隊」

總計：30-42h（含 debug 和聯調緩衝）
```

---

## 九、與 Paperclip 最終比較

| 維度 | Paperclip | ClaudeCab v2.0（Phase 0-6 完成後） |
|------|-----------|----------------------------------|
| **代碼量** | ~50K+ 行 | ~20K 行 |
| **資料庫** | PostgreSQL 36 表 | SQLite 10 表 |
| **前端 UI** | React SPA 27 頁 | Discord Server（0 前端代碼） |
| **部署** | PostgreSQL + Node + React | SQLite + Node（單 process） |
| **即時互動** | Web form（慢） | ✅ Telegram + Discord（即時） |
| **行動端** | Web only | ✅ 原生 app（Telegram + Discord） |
| **Budget 控制** | ✅ | ✅（借鑑） |
| **Audit Trail** | ✅ | ✅（借鑑） |
| **Task Board** | ✅ 自建 | ✅ Discord Forum |
| **Org Chart** | ✅ 自建 | ✅ Discord Roles |
| **Approval** | ✅ 自建 | ✅ Discord Buttons |
| **Dashboard** | ✅ 自建 | ✅ Discord Embeds |
| **Skill 深度** | 操作手冊級 | 知識體系級 + MMORPG 遊戲化 |
| **Multi-runtime** | ✅ 9 種 | Claude only（不需要） |
| **Multi-tenant** | ✅ | 不需要 |
| **Agent 成長** | 無 | ✅ 熟練度 + 成就 + 技能合成 |
| **Group Chat** | 無 | ✅ 多 Bot 群組協作 |

> **用 1/3 的代碼量，達到 Paperclip 80%+ 的功能，且有更好的使用者體驗和 Agent 成長機制。**

---

## 附錄 A：Discord API 限制備忘

| 限制 | 數值 | 對我們的影響 |
|------|------|------------|
| Message 長度 | 2000 chars | sendMessage 已處理分割 |
| Embed fields | 25 per embed | Dashboard 夠用 |
| Embeds per message | 10 | Dashboard 用 4 個 |
| Total embed chars | 6000 | 夠用 |
| Buttons per ActionRow | 5 | Permission Prompt 用 3 個 |
| ActionRows per message | 5 | 夠用 |
| Forum tags | 20 per channel | 16 個（status + priority + agent）夠用 |
| Slash commands (guild) | 100 | 10 個以內 |
| Message send rate | 5 per 5s per channel | Rate Limiter 處理 |
| Interaction response | 3s deadline | deferReply() 處理 |
| Interaction token | 15 min validity | 120s 超時遠在限制內 |
| Webhook send rate | 30 per 60s | 不使用 webhook |
| Bot per server | 無硬性限制（建議 ≤25） | 9 個 Bot 沒問題 |
| File upload size | 8MB free / 25MB Nitro | 注意大檔案 |

## 附錄 B：新增/修改檔案清單（完整 Phase 0-6）

### 新增檔案

| 檔案 | Phase | 說明 |
|------|-------|------|
| `src/adapters/discord/DiscordInteractionHandler.ts` | P0-2 | Button/SlashCmd handler |
| `src/adapters/discord/DiscordMainBot.ts` | P0-3 | 系統級 Bot |
| `src/persistence/TaskRecordRepository.ts` | P0-4 | 任務 CRUD |
| `src/persistence/ExecutionRecordRepository.ts` | P0-4 | 執行審計 CRUD |
| `src/persistence/ActivityEventRepository.ts` | P0-4 | 活動事件 CRUD |
| `src/services/BudgetService.ts` | P1-1 | 預算控管 |
| `src/services/ActivityEventService.ts` | P1-3 | 活動事件雙寫 |
| `src/services/DashboardService.ts` | P2-1 | Dashboard 組合 |
| `src/services/TaskService.ts` | P3-1 | 任務管理 |
| `src/tools/taskTool.ts` | P3-3 | MCP tool: create_task |
| `scripts/setup-discord-server.ts` | P5-2 | Server 初始化 |

### 修改檔案

| 檔案 | Phase | 改動說明 |
|------|-------|---------|
| `src/adapters/DiscordAdapter.ts` | P0-1, P4-1/2/3, P6-2/3/4 | Embed/Button/Forum/Group/RateLimit/Media |
| `src/adapters/types.ts` | P0-1 | Discord config 新增欄位 |
| `src/config.ts` | P0-3, P1-1 | Discord 全域設定、Budget 解析 |
| `src/types/agent.ts` | P1-1, P5-1 | budget、discord 欄位 |
| `src/persistence/DatabaseManager.ts` | P0-4, P2-3 | 3 新表 + cents 遷移 |
| `src/persistence/types.ts` | P0-4, P2-3 | 新型別 |
| `src/persistence/QueryMetricsRepository.ts` | P2-3 | cents 轉換 |
| `src/core/MessageProcessor.ts` | P1-1, P1-2, P3-4 | Budget check + execution record + task context |
| `src/core/PlatformOrchestrator.ts` | P0-3, P1-1, P2-1, P6-1 | 主 Bot、paused agent、dashboard init、管理功能 |
| `src/core/McpToolSetup.ts` | P3-3 | 新增 task tool |
| `src/core/GroupBroadcaster.ts` | P6-2 | Discord 群組支援 |
| `src/schedule/ScheduleExecutor.ts` | P1-1, P1-2 | Budget check + execution record |
| `src/services/AgentCallService.ts` | P1-2, P1-4, P4-4, P5-3 | Execution record + depth + approval + 方向性 |
| `src/tools/notifyAgentTool.ts` | P1-4 | Depth 傳遞 |
| `src/AppBootstrap.ts` | P0-3, P1-3, P2-1 | 主 Bot 初始化、ActivityEvent 初始化、Dashboard 初始化 |

---

*文件結束。本規劃可作為 Spectra change proposal 的基礎。*
