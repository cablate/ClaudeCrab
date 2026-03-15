# Discord 載體重新分析：從「不做」到「必做」

> 日期：2026-03-14
> 前提：以 Discord Server 作為 ClaudeCab 的「公司辦公室」載體
> 結論：原報告 6 個「不做」項目中，5 個翻盤為「做」

---

## 背景：為什麼 Discord 改變了一切

原始報告（01-summary.md）基於 Telegram 的限制得出結論：Dashboard、Org Chart、Ticket System、Approval Gate 都標為「不做」。

但 Discord 提供了 Telegram 沒有的**結構化 UI 原語**：

| UI 原語 | Telegram | Discord |
|---------|:--------:|:-------:|
| 結構化頻道分類 | ❌ | ✅ Category + Channel |
| 討論板/Ticket | ❌ | ✅ Forum Channel |
| 互動按鈕 | ✅ InlineKeyboard | ✅ ButtonBuilder + ActionRow |
| 富格式卡片 | ❌ | ✅ EmbedBuilder（25 欄位、10 embed/訊息）|
| 結構化指令 | ❌（純文字） | ✅ Slash Command（自動完成、參數驗證）|
| 角色權限層級 | ❌ | ✅ Role hierarchy + channel overwrite |
| 主題討論串 | ❌ | ✅ Thread（自動歸檔）|
| 高頻通知 | ❌（rate limit 嚴格）| ✅ Webhook（30/60s）|

**核心洞察：Discord Server 本身就是一個輕量級的公司平台骨架。**

我們不需要寫 React Dashboard。Discord 就是 Dashboard。

---

## 模組 1：Issue/Ticket System → Discord Forum Channel

### 原始判斷（Telegram 時代）
> 「🟢 低借鑑價值 — 我們的任務流是 chat-based，加 ticket 反而增加摩擦」

### Discord 翻盤判斷
> **🔴 高借鑑價值 — Forum Channel 就是零開發成本的 Ticket Board**

### Paperclip 做了什麼
- `issues` 表：status、priority、assigneeAgentId、parentId（sub-issues）、billingCode
- SQL WHERE-based optimistic locking（atomic checkout）
- 7 種 status：backlog → todo → in_progress → in_review → blocked → done → cancelled
- Labels（M2M）、Comments（threaded）、Attachments

### Discord 如何原生實現

**Forum Channel = Ticket Board**
```
📝 #task-board (Forum Channel)
├── [🔴 urgent] [coder] 修復登入 bug          ← 一篇 post = 一張 ticket
│   ├── 接單回覆 by @coder-bot                ← thread 回覆 = 進度更新
│   ├── 提交 PR #123                          ← 自動更新
│   └── ✅ 完成                               ← tag 改為 done
├── [🟡 medium] [writer] 寫週報
└── [🟢 low] [general] 整理知識庫
```

**Tags 對應 Status + Priority + Assignee**（最多 20 個 tag）：
```
Status tags:  📋 backlog | 🔄 in-progress | 👀 in-review | ✅ done | ❌ cancelled
Priority tags: 🔴 urgent | 🟡 medium | 🟢 low
Agent tags:   🤖 coder | 📝 writer | 🔧 admin | 🌐 seo
```

### ClaudeCab 落地設計

**雙層架構：Discord Forum（UI）+ SQLite（資料）**

```
使用者/Agent 在 Discord 操作
        ↕ 同步
SQLite task_records 表（查詢、統計、排程用）
```

**為什麼需要 SQLite？**
- Forum Channel 無法做複雜查詢（「列出 coder 本週完成的所有 urgent 任務」）
- Discord API 有 rate limit，大量讀取不現實
- 排程和 agent-call 需要快速存取任務狀態

**SQLite Schema（輕量版 Paperclip）：**
```sql
CREATE TABLE task_records (
  id TEXT PRIMARY KEY,
  discord_thread_id TEXT UNIQUE,     -- Forum post ID
  title TEXT NOT NULL,
  status TEXT DEFAULT 'backlog',     -- backlog|in_progress|in_review|done|cancelled
  priority TEXT DEFAULT 'medium',    -- urgent|medium|low
  assignee_agent_id TEXT,
  created_by TEXT,                   -- agent_id or user_id
  parent_task_id TEXT,               -- sub-task support
  cost_cents INTEGER DEFAULT 0,      -- 累計花費
  created_at TEXT,
  updated_at TEXT,
  completed_at TEXT
);
```

**不需要從 Paperclip 借鑑的：**
- ❌ Atomic Checkout — 我們沒有多 agent 搶同一任務
- ❌ billingCode — 個人專案不需要成本分攤
- ❌ requestDepth — 用 agent-call depth tracking 替代
- ❌ executionLockedAt — 不需要鎖機制

**需要借鑑的精神：**
- ✅ 結構化 status 管理（不是自由文字）
- ✅ 任務-agent 綁定關係
- ✅ Sub-task 支援（parentId）
- ✅ 成本追蹤到任務級別

### 實作複雜度：🟡 中（4-6 小時）
- Forum Channel 設定 + Tag 定義
- SQLite 新表 + Repository
- DiscordAdapter 擴充：Forum post CRUD
- 同步邏輯：Discord ↔ SQLite

---

## 模組 2：Approval Gate → Discord Button + Embed

### 原始判斷
> 「你就是唯一決策者，Telegram 直接說就好」

### Discord 翻盤判斷
> **🔴 做 — Discord Button 讓審批比「打字回覆」更快、更結構化**

### Paperclip 做了什麼
- `approvals` 表：type、status（pending/approved/rejected/revision_requested）
- `approval_comments`：討論串
- `issue_approvals`：M2M 連結
- Board operator 在 Web Dashboard 審核

### Discord 如何原生實現

```
🔔 #approvals channel

┌─────────────────────────────────────────┐
│ 🔐 Permission Request                   │
│                                          │
│ Agent: @coder-bot                        │
│ Action: 刪除 dist/ 目錄 (rm -rf)        │
│ Context: 清理建置快取                     │
│ Risk: ⚠️ 中                             │
│                                          │
│ [✅ Approve] [❌ Deny] [📋 Details]      │
└─────────────────────────────────────────┘
```

**技術實現：**
```typescript
// EmbedBuilder + ActionRowBuilder
const embed = new EmbedBuilder()
  .setTitle('🔐 Permission Request')
  .setColor(0xFFA500) // orange for pending
  .addFields(
    { name: 'Agent', value: agent.name, inline: true },
    { name: 'Risk', value: '⚠️ 中', inline: true },
    { name: 'Action', value: '```\nrm -rf dist/\n```' },
  )
  .setTimestamp();

const row = new ActionRowBuilder<ButtonBuilder>()
  .addComponents(
    new ButtonBuilder().setCustomId(`approve:${requestId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`deny:${requestId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
  );
```

### ClaudeCab 落地設計

**三種審批場景：**

| 場景 | 觸發 | Channel | 回應方式 |
|------|------|---------|---------|
| Permission Prompt | SDK 工具需要授權 | #approvals | Button（3s deadline → deferReply） |
| Plan Review | Plan mode 產出計畫 | Agent 自己的 channel | Button + Embed |
| Agent Call Approval | Agent 要呼叫其他 agent | #approvals | Button |

**不需要從 Paperclip 借鑑的：**
- ❌ approval_comments — 不需要多人討論，你一個人決定
- ❌ revision_requested — 直接 deny + 留言原因
- ❌ decidedByUserId — 只有你一個 user

**需要借鑑的：**
- ✅ 結構化 status（pending → approved/rejected）
- ✅ Audit trail（誰在什麼時候批准了什麼）
- ✅ Payload 記錄（當時請求的具體內容）

**SQLite 擴充（可合併到 activity_events）：**
```sql
-- 不需要獨立 approvals 表，用 activity_events 記錄即可
-- event_type = 'approval'
-- details JSON 包含 { action, status, agent_id, context }
```

### 實作複雜度：🟡 中（3-4 小時）
- DiscordAdapter 實作 `sendPermissionPrompt()` 用 Embed + Button
- InteractionHandler 處理 button click
- 已有 Telegram 的 resolver 架構，Discord 只需對接

---

## 模組 3：Dashboard → Discord Embed Channel

### 原始判斷
> 「🟢 低 — Telegram UI 對個人場景足夠」

### Discord 翻盤判斷
> **🔴 做 — Discord Embed 就是原生 Dashboard，不需要寫 React**

### Paperclip 做了什麼
- React + Shadcn/ui + Tailwind，27 頁 SPA
- WebSocket live events
- 4 個 KPI：Agents Enabled、Tasks In Progress、Month Spend、Pending Approvals
- 圖表：Run Activity、Issues by Priority、Success Rate

### Discord 如何原生實現

**#dashboard channel — 定時更新的單一 Embed 訊息**

```
┌─────────────────────────────────────────┐
│ 🏢 ClaudeCab HQ — 戰情室               │
│ 最後更新：2026-03-14 15:30 UTC+8        │
│                                          │
│ 🤖 Agent 狀態                            │
│ ┌────────┬────────┬────────┬────────┐   │
│ │ coder  │ writer │ admin  │ seo    │   │
│ │ 🟢 idle│ 🔵 busy│ 🟢 idle│ ⏸ pause│   │
│ └────────┴────────┴────────┴────────┘   │
│                                          │
│ 💰 今日花費                              │
│ coder:  $2.34 (47 queries)              │
│ writer: $1.12 (23 queries)              │
│ 合計:   $3.46                            │
│                                          │
│ 📊 月累計                                │
│ ████████░░ $45.67 / $100.00 (45.7%)     │
│                                          │
│ 📋 任務狀態                              │
│ In Progress: 3 | Pending: 5 | Done: 12  │
│                                          │
│ [🔄 Refresh] [📊 Detail] [⚙️ Config]    │
└─────────────────────────────────────────┘
```

**技術關鍵：Edit 而非 Send**
- 在 #dashboard 固定一條訊息
- 排程每 15 分鐘 `message.edit({ embeds: [updatedEmbed] })`
- 不會洗版，永遠只有一條最新狀態
- Button 點擊觸發即時刷新或展開細節

**Embed 限制利用：**
- 25 fields × inline:true = 最多 8 行 × 3 列的 grid
- 多個 embed（最多 10 個/訊息）= 多個 section
- 6000 字元總量 = 足夠顯示所有 KPI

### ClaudeCab 落地設計

**Dashboard 組成：**

| Embed # | 內容 | 更新頻率 |
|---------|------|---------|
| 1 | Agent 狀態總覽 | 每 15 分鐘 + 狀態變更時 |
| 2 | 今日花費 + 月累計 | 每 15 分鐘 |
| 3 | 任務看板摘要 | 每 15 分鐘 |
| 4 | 最近活動（最新 5 筆）| 有新活動時 |

**進度條 Unicode 技巧：**
```
████████░░ 80%    → 用 █ 和 ░ 組合
🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜  → 或用 emoji
```

**不需要從 Paperclip 借鑑的：**
- ❌ WebSocket live events — Discord 本身就是即時的
- ❌ 27 頁 React SPA — Embed 一頁搞定
- ❌ 複雜圖表 — 用 ASCII/Unicode 圖表或外部圖表 API

**需要借鑑的：**
- ✅ KPI 選擇（agent count、cost、task status、pending approvals）
- ✅ 定時刷新機制
- ✅ Date range filter 概念（用 Button 切換 today/week/month）

### 實作複雜度：🟡 中（3-4 小時）
- DashboardService 組合資料
- DiscordAdapter 擴充 Embed 發送 + 編輯
- 排程觸發更新

---

## 模組 4：Organization Structure → Discord Role + Channel

### 原始判斷
> 「🟢 低 — 扁平結構已夠用」

### Discord 翻盤判斷
> **🟡 中 — Discord Role 讓組織層級自然顯現，且有實際功能（權限控制）**

### Paperclip 做了什麼
- `agents.reportsTo`（self-referencing FK）— 樹狀層級
- `agents.role`（CEO/manager/worker）
- Org Chart 視覺化頁面
- `assertNoCycle()` 防止循環報告

### Discord 如何原生實現

**Server 結構 = 組織架構**
```
🏢 ClaudeCab HQ (Discord Server)
│
├── 📁 MANAGEMENT (Category)
│   ├── 📋 #dashboard          — 全員可看
│   ├── 🔔 #approvals          — 管理層 + user
│   └── 💰 #cost-report        — 管理層 + user
│
├── 📁 ENGINEERING (Category)
│   ├── 🤖 #coder              — @Engineer role
│   └── 🤖 #oss-coder          — @Engineer role
│
├── 📁 CONTENT (Category)
│   ├── 📝 #writer             — @Content role
│   └── 🌐 #seo               — @Content role
│
├── 📁 OPERATIONS (Category)
│   ├── 🔧 #admin              — @Admin role
│   ├── 🎙 #transcriber        — @Operations role
│   └── 🎨 #media              — @Operations role
│
├── 📁 WORKSPACE (Category)
│   ├── 📝 #task-board (Forum)  — 全員
│   ├── 💬 #general            — 全員
│   └── 🗣 #watercooler        — 全員（閒聊）
│
└── 📁 SYSTEM (Category)
    ├── 📊 #system-log          — 系統事件
    └── ⚠️ #alerts              — 錯誤警報
```

**Role 層級 = Agent 層級**
```
@Owner          ← 你（最高權限）
@Admin          ← admin agent（管理權限）
@Engineer       ← coder, oss-coder
@Content        ← writer, seo
@Operations     ← transcriber, media
@Agent          ← 所有 agent 的基礎 role
```

### ClaudeCab 落地設計

**Agent Config 擴充：**
```yaml
# agents/coder/config.yml
discord:
  botToken: "xxx"
  channelId: "123"          # 自己的工作頻道
  roles: ["Engineer"]       # Discord role
  category: "ENGINEERING"   # 所屬分類
  reportsTo: "admin"        # 上級 agent
```

**不需要從 Paperclip 借鑑的：**
- ❌ 資料庫驅動的 org chart — Discord Server 結構就是 org chart
- ❌ assertNoCycle() — 我們的層級固定且簡單
- ❌ 動態 role assignment — 初始設定後很少變

**需要借鑑的精神：**
- ✅ 層級概念（reportsTo）讓 agent-call 有方向性
- ✅ Role-based 頻道可見性（Engineer 只看 Engineering channels）
- ✅ 管理層 vs 工作層的權限區分

### 實作複雜度：🟢 低（1-2 小時）
- 主要是 Discord Server 設定（手動 or 初始化腳本）
- Agent config 加幾個欄位
- 不需要寫太多程式碼

---

## 模組 5：Scheduling → Heartbeat + Discord 回報

### 原始判斷
> 「🟡 中借鑑 — Heartbeat 概念有用但 polling 不適合」

### Discord 翻盤判斷
> **🔴 高 — 排程執行結果有 Discord channel 可以沉澱，可見性大幅提升**

### Paperclip 做了什麼
- 30s polling loop（heartbeat）
- wakeup requests（queue-based triggering）
- Crash recovery（orphan run reaping）
- 所有結果存 heartbeat_runs 表

### ClaudeCab 現有做法
- ScheduleExecutor（cron-based）
- 執行結果只有 Pino log

### Discord 如何提升

**排程結果自動回報到 #system-log**
```
┌─────────────────────────────────────────┐
│ ⏰ Schedule Executed                     │
│                                          │
│ Agent: @admin-bot                        │
│ Schedule: daily-reflection               │
│ Time: 2026-03-14 23:00                   │
│ Status: ✅ Success                       │
│ Duration: 45s                            │
│ Tokens: 12,345 in / 3,456 out           │
│ Cost: $0.23                              │
└─────────────────────────────────────────┘
```

**錯誤時 ping user**
```
┌─────────────────────────────────────────┐
│ ⚠️ Schedule Failed                      │
│                                          │
│ Agent: @coder-bot                        │
│ Schedule: auto-code-review               │
│ Error: SDK timeout after 120s            │
│                                          │
│ @Owner 需要你關注                        │
│ [🔄 Retry] [⏸ Pause Schedule]           │
└─────────────────────────────────────────┘
```

### ClaudeCab 落地設計

**保持 cron-based，加上 Discord 可見層：**
1. ScheduleExecutor 執行完 → 寫 execution_records 表（Phase 1 就有）
2. 同時發 Embed 到 #system-log
3. 錯誤時額外發到 #alerts + mention @Owner
4. Agent 自己的 channel 也收到摘要

**不需要借鑑的：**
- ❌ Polling-based heartbeat — 我們的 cron 更簡潔
- ❌ wakeup request queue — 我們用 event-driven
- ❌ Orphan reaping — 我們的 process 模型不同

**需要借鑑的：**
- ✅ 結構化執行記錄（execution_records）
- ✅ 執行結果可視化回報
- ✅ 失敗自動通知 + 操作按鈕（retry/pause）

### 實作複雜度：🟢 低（2 小時）
- ScheduleExecutor post-hook 發 Discord embed
- 錯誤處理 + @mention

---

## 模組 6：Audit Log → Discord #system-log Channel

### 原始判斷
> 「🟡 中 — Pino log 夠用但結構化事件有價值」

### Discord 翻盤判斷
> **🔴 高 — Discord channel 就是天然的 append-only audit log，人類可讀**

### Paperclip 做了什麼
- `activity_log` 表：actorType、action、entityType、entityId、details（redacted JSON）
- Real-time WebSocket push
- 自動 redaction（API key、JWT、passwords）

### Discord 如何原生實現

**#system-log = 人類可讀的 Activity Feed**
```
[15:30] 🤖 coder started working on task #PAP-42
[15:31] 🤖 coder called @writer for content review
[15:32] 📝 writer accepted agent-call from @coder
[15:45] ✅ coder completed task #PAP-42 ($0.45)
[15:46] 💰 Budget alert: coder at 82% monthly budget
[16:00] ⏰ admin executed schedule: daily-reflection
```

**雙寫架構：**
```
Event 發生
  ├── 寫入 SQLite activity_events 表（查詢、統計）
  └── 發送 Discord Embed 到 #system-log（人類可讀）
```

### ClaudeCab 落地設計

**Activity Event 分類：**
```typescript
type EventType =
  | 'chat.received'      // 收到使用者訊息
  | 'chat.responded'     // 回覆使用者
  | 'schedule.started'   // 排程開始
  | 'schedule.completed' // 排程完成
  | 'schedule.failed'    // 排程失敗
  | 'agent_call.sent'    // 呼叫其他 agent
  | 'agent_call.received'// 收到 agent 呼叫
  | 'approval.requested' // 請求批准
  | 'approval.decided'   // 批准/拒絕
  | 'budget.warning'     // 預算警告 (80%)
  | 'budget.exceeded'    // 預算超限 (100%)
  | 'task.created'       // 任務建立
  | 'task.completed'     // 任務完成
  | 'error.occurred'     // 系統錯誤
```

**需要借鑑的：**
- ✅ 自動 redaction（API key、token 等敏感資訊）
- ✅ actorType 區分（system/user/agent）
- ✅ entityType + entityId 讓事件可追溯

**不需要借鑑的：**
- ❌ WebSocket push — Discord 本身就是即時的
- ❌ companyId scoping — 單租戶

### 實作複雜度：🟢 低（2 小時）
- ActivityEventService（SQLite + Discord 雙寫）
- 各入口點呼叫（MessageProcessor、ScheduleExecutor、AgentCallService）

---

## 模組 7：Cost/Budget → Discord 視覺化回報

### 原始判斷
> 「🔴 高借鑑 — Budget Hard Stop 是 P0」

### Discord 翻盤判斷
> **🔴 維持高 + 加碼 — Budget 不只是後端邏輯，Discord 讓它可視化**

### Paperclip 做了什麼
- Budget Hard Stop（auto-pause at 100%）
- Soft Alert（80% sidebar badge）
- Cost Dashboard（by-agent、by-project、date range）
- Integer cents

### Discord 加碼

**#cost-report channel — 每日 Embed**
```
┌─────────────────────────────────────────┐
│ 💰 Daily Cost Report — 2026-03-14       │
│                                          │
│ Agent      Today    Month    Budget      │
│ ─────────────────────────────────────    │
│ coder      $2.34    $32.10   ████████░░  │
│ writer     $1.12    $15.45   ███████░░░  │
│ admin      $0.56    $8.90    ████░░░░░░  │
│ seo        $0.23    $4.20    ██░░░░░░░░  │
│ ─────────────────────────────────────    │
│ Total      $4.25    $60.65   ██████░░░░  │
│                                          │
│ 🟢 All agents within budget             │
│                                          │
│ [📊 By Date] [📋 By Task] [⚙️ Budgets]  │
└─────────────────────────────────────────┘
```

**預算警告 Embed（自動觸發）**
```
┌─────────────────────────────────────────┐
│ ⚠️ Budget Warning                       │
│                                          │
│ Agent: @coder-bot                        │
│ Monthly: $42.50 / $50.00 (85%)           │
│ ████████████████░░░░ 85%                │
│                                          │
│ Remaining: $7.50                         │
│ Estimated depletion: 2026-03-18          │
│                                          │
│ [⏸ Pause Agent] [💰 Increase Budget]    │
└─────────────────────────────────────────┘
```

### 實作複雜度：🟡 中（Phase 1 budget logic 2-3h + Phase 2 Discord visualization 2h）

---

## 模組對照總結：原始 vs Discord 重新評估

| 模組 | 原始判斷 | Discord 重新評估 | 翻盤原因 |
|------|---------|-----------------|---------|
| **Issue/Ticket** | 🟢 低（不做）| 🔴 高（做）| Forum Channel = 原生 ticket board |
| **Approval Gate** | 🟢 低（不做）| 🔴 高（做）| Button + Embed = 零摩擦審批 |
| **Dashboard** | 🟢 低（不做）| 🔴 高（做）| Embed = 免費 Dashboard |
| **Org Chart** | 🟢 低（不做）| 🟡 中（做）| Role + Category = 原生 org chart |
| **Scheduling** | 🟡 中（部分借鑑）| 🔴 高（做）| Discord 讓執行結果可視化 |
| **Audit Log** | 🟡 中（做）| 🔴 高（加碼）| Discord channel = 人類可讀 audit |
| **Cost/Budget** | 🔴 高（做）| 🔴 高（加碼）| Discord Embed = 視覺化報告 |
| **Multi-tenancy** | 🟢 低（不做）| 🟢 低（不做）| 仍然不需要 |

**翻盤比分：5/8 項從「不做」→「做」**

---

## 模組 8：Group Chat → Discord Multi-Bot Channel

### 原始 ClaudeCab 能力
- Telegram group chat：多個 agent bot 在同一群組
- Social mode / initiative mode 控制發言節奏
- Energy threshold 防止搶話

### Discord 如何提升

**Discord 天然支援 multi-bot：**
- 每個 agent bot 都可以在 #general 或 #watercooler 發言
- 各 bot 有自己的名字和 avatar（身份清晰）
- Telegram group 的問題：所有 bot 的訊息混在一起，分不清誰是誰
- Discord 的改善：每條訊息有 bot 名字 + avatar，一目了然

**新的互動模式：**
```
#general channel（全員）
├── @coder-bot: 剛修完那個 API bug，PR #45
├── @writer-bot: 收到，我更新一下文件
├── @admin-bot: 今天大家的 token 用量正常
└── @Owner: 辛苦了，明天繼續
```

**Thread 自動分流：**
- 複雜討論自動開 Thread，不污染主 channel
- Agent-call 的來回可以在 Thread 裡進行
- 完成後 Thread auto-archive

### 實作考量
- 現有 `isGroupChat: false` 需要改為 `true`（Phase 1 已標 stub）
- 需要處理 bot-to-bot 訊息防止迴圈（已有 `if (message.author.bot) return`）
- Social mode / initiative mode 的 Discord 版本需要設計

### 實作複雜度：🟡 中（3 小時）
- 移植 Telegram group chat 的 social/initiative 邏輯
- 處理 multi-channel group（#general 是群組，#coder 是 1:1）

---

## 延伸機會：Discord Voice Channel + TTS

ClaudeCab 已有 TTS 功能（TTSService），Discord 有 Voice Channel。

**可能性：**
- Agent 完成任務時自動用語音播報結果
- 使用 `@discordjs/voice` + `@discordjs/opus` 加入 voice channel
- Agent 用 TTS 產出的音檔直接播放
- 這是 Paperclip 完全沒有的能力

**評估：** 有趣但不急。先把文字互動做好，Voice 是 Phase 6+ 的事。

---

## Telegram vs Discord：不是二選一

**重要：Discord 不取代 Telegram，兩者共存。**

| 用途 | Telegram | Discord |
|------|---------|---------|
| **即時對話** | ✅ 主力（手機隨時用）| 🟡 備用 |
| **任務管理** | ❌ 不適合 | ✅ Forum Channel |
| **審批** | ✅ InlineKeyboard | ✅ Button（更好）|
| **Dashboard** | ❌ 做不到 | ✅ Embed |
| **系統監控** | ❌ 會洗版 | ✅ 專用 channel |
| **Knowledge Base** | ❌ 對話流會沖掉 | ✅ Forum 永久保留 |
| **Group Chat** | ✅ 已實作 | 🟡 未來 |

**建議定位：**
- **Telegram** = 你跟 agent 的即時通訊（手機端、快速互動）
- **Discord** = 公司辦公室（監控、任務管理、記錄沉澱、組織可見性）

兩個平台同時運行，agent 同時有 Telegram bot 和 Discord bot。使用者日常用 Telegram 下指令，需要看全局時開 Discord。

---

## 與 Paperclip 的終極比較

| 維度 | Paperclip | ClaudeCab + Discord |
|------|-----------|-------------------|
| **Dashboard** | 自建 React SPA（27 頁）| Discord Embed（0 前端代碼）|
| **Ticket System** | 自建 PostgreSQL | Discord Forum + SQLite |
| **Approval** | 自建 Web Form | Discord Button |
| **Org Chart** | 自建 React 元件 | Discord Server 結構 |
| **Audit** | 自建 Activity Log UI | Discord #system-log |
| **即時互動** | ❌（Web Dashboard 操作）| ✅（Telegram 對話）|
| **行動端** | ❌（網頁版）| ✅（Telegram + Discord app）|
| **Skill 深度** | 操作手冊級 | 知識體系級 |
| **開發成本** | ~50K+ 行 | ~20K 行（估計）|
| **部署成本** | PostgreSQL + React + Express | SQLite + 單 process |

**結論：ClaudeCab + Discord 可以用 1/3 的代碼量達到 Paperclip 80% 的功能，且有更好的即時互動體驗。**

這就是「站在巨人肩膀上，但走自己的路」。
