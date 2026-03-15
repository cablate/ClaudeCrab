# ClaudeCab Discord 公司平台：落地實作計畫

> 日期：2026-03-14
> 前提：基於 12-discord-platform-reanalysis.md 和 13-discord-architecture-blueprint.md
> 目標：分階段將 ClaudeCab 從「Telegram bot 群」升級為「AI 公司辦公室」

---

## 實作原則

1. **每個 Phase 都能獨立交付價值** — 不需要做完全部才有用
2. **Discord 擴充不破壞 Telegram** — 兩個平台共存，不是替換
3. **SQLite first** — 核心邏輯在 DB，Discord 是展示層
4. **Embed edit > Embed send** — Dashboard 固定訊息 edit，不洗版

---

## Phase 0：基礎建設（前置條件）

> 預估時間：3-4 小時
> 依賴：無
> 交付：Discord rich interaction 能力

### 0.1 DiscordAdapter 擴充（核心）

**目標：** 讓 DiscordAdapter 從「只能發文字」升級到「能發 Embed、Button、操作 Forum」

**改動檔案：**
| 檔案 | 改動 |
|------|------|
| `src/adapters/DiscordAdapter.ts` | 新增 Embed/Button/Forum 方法 |
| `src/adapters/types.ts` | 新增 Discord-specific config 欄位 |
| `src/adapters/BaseAdapter.ts` | 確認 override 點位正確 |

**新增方法：**
```
sendEmbed(channelId, embeds, components?)
editEmbed(channelId, messageId, embeds, components?)
createForumPost(forumChannelId, title, content, tagIds)
updateForumPostTags(threadId, tagIds)
replyToThread(threadId, content)
archiveThread(threadId)
```

**新增 Intent：**
```typescript
// 現有
GatewayIntentBits.Guilds
GatewayIntentBits.GuildMessages
GatewayIntentBits.MessageContent

// 新增（必要）
// 不需要額外 intent，interaction 不需要 intent
```

### 0.2 InteractionHandler（新增）

**目標：** 處理 Discord Button click、Slash command interaction

**新增檔案：**
```
src/adapters/discord/DiscordInteractionHandler.ts
```

**核心邏輯：**
```
client.on('interactionCreate', (interaction) => {
  if (interaction.isButton()) → route to button handler
  if (interaction.isChatInputCommand()) → route to command handler
})
```

**與現有 resolver 架構對接：**
- `sendPermissionPrompt()` → 發 Embed + Button → 存 resolver → Button click 觸發 resolve
- 現有 Telegram 的 `setPermissionResolver()` 架構可以直接複用

### 0.3 主 Bot 設計

**目標：** 新增一個「主 Bot」負責系統級操作

**為什麼需要主 Bot：**
- Slash command 只能註冊在一個 application 上
- 系統 channel（#dashboard, #system-log）需要統一發送者
- Agent bot 只在自己的 channel 發言

**Config 新增：**
```yaml
discord:
  mainBot:
    token: ${DISCORD_MAIN_BOT_TOKEN}
    clientId: "xxx"
  guildId: "xxx"
  channels:
    dashboard: "xxx"
    # ...
```

### 0.4 SQLite Schema 擴充

**新增 3 張表：**
- `task_records` — 任務記錄
- `execution_records` — 執行審計
- `activity_events` — 活動日誌

（Schema 詳見 13-discord-architecture-blueprint.md 第六節）

**Migration 方式：** `CREATE TABLE IF NOT EXISTS`（現有做法）

---

## Phase 1：安全網 + 可見性（核心價值）

> 預估時間：4-6 小時
> 依賴：Phase 0
> 交付：Budget 控制 + Execution 審計 + Discord 活動記錄

### 1.1 Budget Hard Stop

**原始計畫（不變，來自 11-borrowing-plan.md）：**
- Agent config 新增 `budget.dailyCents` / `budget.monthlyCents`
- 每次 SDK query 後檢查累計花費
- 超限 → 標記 agent paused → 不回應對話/不執行排程

**Discord 加碼：**
- 超 80% → #alerts channel 發黃色 Embed warning
- 超 100% → #alerts channel 發紅色 Embed + @Owner mention
- 附帶 [⏸ Pause] [💰 Increase] 按鈕

**改動檔案：**
```
src/types/agent.ts        → 新增 budget config
src/config.ts             → 解析 budget 設定
MessageProcessor.ts       → query 後 budget check
ScheduleExecutor.ts       → 執行前後 budget check
PlatformOrchestrator.ts   → paused agent 跳過
新增 BudgetService.ts     → 集中 budget 邏輯
```

### 1.2 Execution Audit Log

**原始計畫（不變）：**
- 每次 SDK query 記錄到 `execution_records` 表
- 記錄 trigger_type、tokens、cost、duration、status

**Discord 加碼：**
- 排程執行完 → #system-log 發簡短記錄
- 錯誤時 → #alerts 發 Embed

**改動檔案：**
```
新增 ExecutionRecordRepository.ts
MessageProcessor.ts        → 記錄 execution
ScheduleExecutor.ts        → 記錄 execution
AgentCallService.ts        → 記錄 execution
```

### 1.3 Activity Event Service

**新增：雙寫架構**
- 關鍵事件同時寫 SQLite + 發 Discord
- Event types: chat、schedule、agent_call、approval、budget、error

**改動檔案：**
```
新增 ActivityEventService.ts
新增 ActivityEventRepository.ts
MessageProcessor.ts        → 呼叫 activityService
ScheduleExecutor.ts        → 呼叫 activityService
AgentCallService.ts        → 呼叫 activityService
```

### 1.4 Agent Call Depth Tracking

**原始計畫（不變）：**
- MAX_CALL_DEPTH = 5
- 每次 call depth + 1

---

## Phase 2：Dashboard + Cost Report

> 預估時間：3-4 小時
> 依賴：Phase 1（需要 execution_records 和 activity_events 資料）
> 交付：Discord Dashboard + 成本視覺化

### 2.1 Dashboard Service

**核心邏輯：**
1. 啟動時在 #dashboard 發一條 Embed → pin → 記錄 messageId
2. 排程每 15 分鐘 edit 這條訊息
3. 組合 4 個 Embed：Agent Status、Cost、Tasks、Recent Activity
4. 按鈕：[🔄 Refresh] [📊 Detail]

**改動檔案：**
```
新增 DashboardService.ts
新增 DashboardSchedule       → 排程定義
PlatformOrchestrator.ts     → 啟動時初始化 dashboard
```

### 2.2 Cost Report（每日）

**核心邏輯：**
1. 排程每日 23:55 生成 cost embed
2. 發到 #cost-report channel
3. 包含 by-agent breakdown、月累計進度條、budget 狀態

**改動檔案：**
```
新增 CostReportSchedule     → 排程定義
QueryMetricsRepository.ts   → 新增 by-agent summary API
```

### 2.3 Integer Cents 遷移

**原始計畫（不變）：**
- costUsd → costCents 全局轉換

---

## Phase 3：Task Board（Forum Channel）

> 預估時間：5-7 小時
> 依賴：Phase 0（Forum 操作能力）
> 交付：Discord Forum 任務看板 + SQLite 任務追蹤

### 3.1 Task Service

**核心功能：**
- `createTask(title, priority, assignee)` → Forum post + SQLite
- `updateTaskStatus(taskId, status)` → Forum tag + SQLite + thread reply
- `assignTask(taskId, agentId)` → Forum tag + SQLite + notify agent channel
- `completeTask(taskId)` → Forum tag + SQLite + dashboard update

### 3.2 Slash Command：/task

```
/task create [title] [priority] [assignee]
/task list [status]
/task assign [id] [agent]
/task complete [id]
/task detail [id]
```

### 3.3 Agent 自動建任務

**場景：** Agent 在執行中發現需要建子任務
- 新增 MCP tool `create_task`
- Agent 呼叫 → TaskService.createTask() → Forum post

### 3.4 任務-花費關聯

**場景：** 知道每個任務花了多少 token
- execution_records 加入 task_id FK
- 任務完成時計算累計 cost

---

## Phase 4：Approval Gate + Rich Permission Prompts

> 預估時間：3-4 小時
> 依賴：Phase 0（Button/Embed 能力）
> 交付：Button-based 審批 + Permission Prompt

### 4.1 Permission Prompt 升級

**目標：** Discord 版的 sendPermissionPrompt 用 Embed + Button

**改動：**
```typescript
// DiscordAdapter override
async sendPermissionPrompt(channelId, options) {
  const embed = buildPermissionEmbed(options);
  const row = buildApproveRejectButtons(requestId);
  const msg = await channel.send({ embeds: [embed], components: [row] });
  // InteractionHandler routes button click → resolver
}
```

### 4.2 Plan Review 升級

**目標：** Plan mode 的計畫審核用 Embed 展示 + Button 決策

### 4.3 Agent Call Approval

**目標：** 高風險 agent call 需要審批
- Agent call 帶 `requireApproval: true` flag
- #approvals channel 發 Embed
- 使用者 approve → call 執行

---

## Phase 5：組織架構 + 系統完善

> 預估時間：2-3 小時
> 依賴：Phase 0
> 交付：Agent 層級概念 + Discord Server 初始化

### 5.1 Agent Config 擴充

```yaml
discord:
  roles: ["Engineer"]
  category: "ENGINEERING"
  reportsTo: "admin"
```

### 5.2 Server 初始化腳本

**一鍵建立 Discord Server 結構：**
- 建立 Categories
- 建立 Channels（Text + Forum）
- 建立 Roles
- 設定 Permission Overwrites
- 建立 Forum Tags

### 5.3 Agent-Call 方向性

**借鑑 Paperclip 的 reportsTo：**
- Worker 可以向上呼叫 Manager
- Manager 可以向下委派 Worker
- 不允許平級跨 category 呼叫（除非通過 Manager）

---

## 依賴關係圖

```
Phase 0: 基礎建設
  ├── DiscordAdapter 擴充
  ├── InteractionHandler
  ├── 主 Bot
  └── SQLite Schema
        │
        ├──→ Phase 1: 安全網 + 可見性
        │     ├── Budget Hard Stop
        │     ├── Execution Audit
        │     ├── Activity Events
        │     └── Call Depth
        │           │
        │           └──→ Phase 2: Dashboard + Cost
        │                 ├── Dashboard Service
        │                 ├── Cost Report
        │                 └── Integer Cents
        │
        ├──→ Phase 3: Task Board
        │     ├── Task Service
        │     ├── /task Slash Command
        │     ├── Agent 建任務
        │     └── 任務-花費關聯
        │
        ├──→ Phase 4: Approval Gate
        │     ├── Permission Prompt
        │     ├── Plan Review
        │     └── Agent Call Approval
        │
        └──→ Phase 5: 組織架構
              ├── Config 擴充
              ├── Server 初始化
              └── Call 方向性
```

**Phase 1-5 互相獨立，都只依賴 Phase 0。**
可以根據心情和優先級任意挑選。

---

## 時間估算總覽

| Phase | 內容 | 預估時間 | 價值 |
|-------|------|---------|------|
| 0 | 基礎建設 | 3-4h | 🔧 前置 |
| 1 | 安全網 + 可見性 | 4-6h | 🔴 最高（防失控）|
| 2 | Dashboard + Cost | 3-4h | 🟡 高（可視化）|
| 3 | Task Board | 5-7h | 🟡 高（任務管理）|
| 4 | Approval Gate | 3-4h | 🟡 中（審批）|
| 5 | 組織架構 | 2-3h | 🟢 中（組織感）|
| **Total** | | **~20-28h** | |

**推薦順序：0 → 1 → 2 → 3 → 4 → 5**

Phase 0 + 1 完成後就有「安全的公司」。
Phase 2 + 3 完成後就有「看得到在做什麼的公司」。
Phase 4 + 5 完成後就是「完整的 AI 公司辦公室」。

---

## 與 Paperclip 的最終比較

| 維度 | Paperclip | ClaudeCab + Discord（Phase 5 完成後）|
|------|-----------|--------------------------------------|
| 代碼量 | ~50K+ 行 | ~20K 行（估計）|
| DB | PostgreSQL 36 表 | SQLite 10 表 |
| UI | React SPA 27 頁 | Discord Server（0 前端代碼）|
| 部署 | PostgreSQL + Node + React | SQLite + Node |
| 即時互動 | ❌ Web form | ✅ Telegram + Discord |
| 行動端 | ❌ Web only | ✅ 原生 app |
| Budget 控制 | ✅ | ✅（借鑑）|
| Audit Trail | ✅ | ✅（借鑑）|
| Task Board | ✅ 自建 | ✅ Discord Forum |
| Org Chart | ✅ 自建 | ✅ Discord Roles |
| Approval | ✅ 自建 | ✅ Discord Buttons |
| Dashboard | ✅ 自建 | ✅ Discord Embeds |
| Skill 深度 | 操作手冊 | 知識體系 |
| Multi-runtime | ✅ 9 種 | ❌ Claude only（但不需要）|
| Multi-tenant | ✅ | ❌（不需要）|

**結論：用 1/3 的代碼量，達到 Paperclip 80%+ 的功能，且有更好的使用者體驗。**

---

## Appendix：Discord API 限制備忘

| 限制 | 數值 |
|------|------|
| Message 長度 | 2000 chars |
| Embed fields | 25 per embed |
| Embeds per message | 10 |
| Total embed chars | 6000 |
| Buttons per ActionRow | 5 |
| ActionRows per message | 5 |
| Forum tags | 20 per channel |
| Slash commands (guild) | 100 |
| Message send rate | 5 per 5s per channel |
| Interaction response | 3s deadline（用 deferReply）|
| Interaction token | 15 min validity |
| Webhook send rate | 30 per 60s |
