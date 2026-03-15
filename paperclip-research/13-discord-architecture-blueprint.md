# ClaudeCab Discord 公司平台：架構藍圖

> 日期：2026-03-14
> 版本：v1.0
> 前提：Discord Server 作為「AI 公司辦公室」，Telegram 維持「即時通訊」

---

## 一、設計哲學

### 「Discord 就是 UI」原則

Paperclip 花了 ~50K 行代碼建了 React Dashboard + Express API + WebSocket。
我們用 Discord 原生功能替代，**零前端代碼**。

```
Paperclip 路線:     DB → API → WebSocket → React SPA → User
ClaudeCab 路線:     DB → DiscordAdapter → Discord Server → User
```

**省下的代碼用在真正有價值的地方：Agent 能力、Skill 深度、排程智慧。**

### 雙平台共存架構

```
                    ┌─────────────┐
                    │   User      │
                    └──────┬──────┘
                     ┌─────┴─────┐
              ┌──────┴──┐    ┌───┴────────┐
              │Telegram │    │  Discord   │
              │即時通訊  │    │  公司辦公室 │
              └────┬────┘    └─────┬──────┘
                   │               │
              ┌────┴────┐    ┌─────┴──────┐
              │Telegram │    │  Discord   │
              │Adapter  │    │  Adapter   │
              └────┬────┘    └─────┬──────┘
                   │               │
                   └───────┬───────┘
                           │
                    ┌──────┴──────┐
                    │  Platform   │
                    │Orchestrator │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴────┐ ┌────┴─────┐ ┌────┴────┐
        │ Message  │ │ Schedule │ │  Agent  │
        │Processor │ │ Executor │ │  Call   │
        └─────┬────┘ └────┬─────┘ └────┬────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────┴──────┐
                    │   Services  │
                    ├─────────────┤
                    │ Activity    │← 雙寫：SQLite + Discord
                    │ Budget      │← 超限通知 → Discord #alerts
                    │ Task        │← 同步：Forum ↔ SQLite
                    │ Dashboard   │← 排程更新 → Discord #dashboard
                    └─────────────┘
```

---

## 二、Discord Server 結構設計

### Channel 規劃

```
🏢 ClaudeCab HQ
│
├── 📁 ──── COMMAND CENTER ────
│   ├── 📋 #dashboard              [Embed, 定時更新]
│   │   └── 固定一條訊息，排程 edit
│   ├── 🔔 #approvals              [Button, 即時]
│   │   └── Agent 請求審批 → 按鈕決策
│   ├── 💰 #cost-report            [Embed, 每日]
│   │   └── 每日 cost summary embed
│   └── ⚠️ #alerts                 [Embed + @mention, 即時]
│       └── 預算超限、排程失敗、系統錯誤
│
├── 📁 ──── TASK MANAGEMENT ────
│   ├── 📝 #task-board (Forum)      [Forum Channel]
│   │   └── 每個任務 = 一篇 post
│   │       Tags: status + priority + assignee
│   └── 📊 #completed-tasks (Forum) [Forum Channel, 歸檔]
│       └── Done/cancelled 的任務移至此
│
├── 📁 ──── ENGINEERING ────
│   ├── 🤖 #coder                  [Agent 工作日誌]
│   └── 🤖 #oss-coder              [Agent 工作日誌]
│
├── 📁 ──── CONTENT ────
│   ├── 📝 #writer                  [Agent 工作日誌]
│   └── 🌐 #seo                    [Agent 工作日誌]
│
├── 📁 ──── OPERATIONS ────
│   ├── 🔧 #admin                  [Agent 工作日誌]
│   ├── 🎙 #transcriber            [Agent 工作日誌]
│   └── 🎨 #media                  [Agent 工作日誌]
│
├── 📁 ──── COLLABORATION ────
│   ├── 💬 #general                [全員，自由討論]
│   └── 🗣 #watercooler            [閒聊、社交模式]
│
└── 📁 ──── SYSTEM ────
    ├── 📊 #system-log              [Activity events]
    └── 🔧 #dev-log                [開發測試用]
```

### Role 設計

```
Role Hierarchy (top → bottom):
─────────────────────────
@Owner          ← 你（人類使用者）
@Admin          ← admin agent
@Engineer       ← coder, oss-coder
@Content        ← writer, seo
@Operations     ← transcriber, media
@Agent          ← 所有 agent 的基礎 role
─────────────────────────

Channel Permission Matrix:
                    Owner  Admin  Engineer  Content  Operations
#dashboard          RW     R      R         R        R
#approvals          RW     RW     -         -        -
#cost-report        R      RW     R         R        R
#alerts             R      RW     -         -        -
#task-board         RW     RW     RW        RW       RW
#coder              R      R      RW        -        -
#writer             R      R      -         RW       -
#general            RW     RW     RW        RW       RW
#system-log         R      RW     R         R        R

R = Read, W = Write, - = No access
```

---

## 三、核心服務架構

### 3.1 DiscordAdapter 擴充

**現狀：** 只有 text messaging
**目標：** 完整 Discord 互動支援

```typescript
// 需要新增的 DiscordAdapter 方法

class DiscordAdapter extends BaseAdapter {
  // === 現有 ===
  sendMessage(chatId, text, options?)
  sendTypingIndicator(chatId)

  // === 新增：Rich Messaging ===
  sendEmbed(channelId, embed: EmbedBuilder, components?: ActionRowBuilder[])
  editEmbed(channelId, messageId, embed: EmbedBuilder, components?)

  // === 新增：Forum ===
  createForumPost(forumChannelId, title, content, tags: string[])
  updateForumPostTags(threadId, tags: string[])
  replyToThread(threadId, content)
  archiveThread(threadId)

  // === 新增：Interactive ===
  sendPermissionPrompt(channelId, options)   // override BaseAdapter
  sendQuestionPrompt(channelId, options)     // override BaseAdapter
  handleInteraction(interaction)             // button click handler

  // === 新增：Slash Commands ===
  registerCommands(commands: SlashCommandBuilder[])
  handleSlashCommand(interaction)

  // === 新增：Multi-Channel ===
  getChannel(channelId): TextChannel | ForumChannel
  sendToChannel(channelId, content)          // 跨 channel 發送
}
```

**關鍵架構決策：Multi-Bot vs Single-Bot**

目前設計：每個 agent 一個 Discord bot（multi-bot）。
問題：Discord 不允許同一個 bot 帳號多次登入，但允許多個 bot 在同一 server。

```
推薦架構：Hybrid

主 Bot（ClaudeCab HQ Bot）
├── 管理 server 結構（channels, roles）
├── 處理 slash commands
├── 處理 button interactions
├── 發送系統 embeds（dashboard, alerts, cost）
└── 路由訊息到對應 agent

Agent Bots（每個 agent 一個）
├── 在自己的 channel 回覆
├── 用自己的名字和 avatar
└── 處理 agent-specific 互動

原因：
- Slash command 只能註冊在一個 bot 上
- Interaction handler 只有一個入口
- 但 agent 需要各自的身份識別（名字、頭像）
```

### 3.2 ActivityEventService（新增）

```typescript
class ActivityEventService {
  constructor(
    private db: DatabaseManager,
    private discordAdapter: DiscordAdapter,  // 主 bot
    private systemLogChannelId: string,
    private alertsChannelId: string
  ) {}

  async log(event: ActivityEvent): Promise<void> {
    // 1. 寫 SQLite
    await this.db.insertActivityEvent(event);

    // 2. 發 Discord（根據 event level）
    if (event.level === 'error') {
      await this.sendAlert(event);      // #alerts + @Owner
    } else {
      await this.sendSystemLog(event);  // #system-log
    }
  }

  private async sendSystemLog(event: ActivityEvent): Promise<void> {
    const emoji = EVENT_EMOJI_MAP[event.type]; // ⏰🤖✅❌💰
    const line = `${emoji} **${event.agentId}** ${event.action}`;
    // 用簡短文字而非 embed，避免 #system-log 太重
    await this.discordAdapter.sendToChannel(this.systemLogChannelId, line);
  }

  private async sendAlert(event: ActivityEvent): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle(`⚠️ ${event.type}`)
      .setColor(0xFF0000)
      .addFields(
        { name: 'Agent', value: event.agentId, inline: true },
        { name: 'Error', value: event.details?.error ?? 'Unknown' }
      )
      .setTimestamp();
    await this.discordAdapter.sendEmbed(
      this.alertsChannelId,
      embed,
      // 加上 Retry / Pause 按鈕
    );
  }
}
```

### 3.3 DashboardService（新增）

```typescript
class DashboardService {
  private dashboardMessageId: string | null = null;

  constructor(
    private db: DatabaseManager,
    private discordAdapter: DiscordAdapter,
    private dashboardChannelId: string
  ) {}

  async update(): Promise<void> {
    const agents = await this.getAgentStatuses();
    const costs = await this.getCostSummary();
    const tasks = await this.getTaskSummary();

    const embeds = [
      this.buildAgentStatusEmbed(agents),
      this.buildCostEmbed(costs),
      this.buildTaskEmbed(tasks),
    ];

    if (this.dashboardMessageId) {
      // Edit 現有訊息（不洗版）
      await this.discordAdapter.editEmbed(
        this.dashboardChannelId,
        this.dashboardMessageId,
        embeds
      );
    } else {
      // 首次建立
      const msg = await this.discordAdapter.sendEmbed(
        this.dashboardChannelId,
        embeds
      );
      this.dashboardMessageId = msg.id;
      // Pin 這條訊息
    }
  }

  private buildCostEmbed(costs: CostSummary): EmbedBuilder {
    const bars = costs.agents.map(a => {
      const pct = a.budgetCents > 0
        ? Math.round(a.spentCents / a.budgetCents * 100)
        : 0;
      const bar = this.progressBar(pct);
      return `\`${a.name.padEnd(12)}\` ${bar} $${(a.spentCents/100).toFixed(2)}`;
    });

    return new EmbedBuilder()
      .setTitle('💰 Cost Summary')
      .setDescription(bars.join('\n'))
      .setColor(costs.overBudget ? 0xFF0000 : 0x00FF00)
      .setTimestamp();
  }

  private progressBar(pct: number): string {
    const filled = Math.round(pct / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty) + ` ${pct}%`;
  }
}
```

### 3.4 TaskService（新增）

```typescript
class TaskService {
  constructor(
    private db: DatabaseManager,
    private discordAdapter: DiscordAdapter,
    private forumChannelId: string
  ) {}

  async createTask(task: CreateTaskInput): Promise<Task> {
    // 1. 建立 Forum post
    const thread = await this.discordAdapter.createForumPost(
      this.forumChannelId,
      task.title,
      this.formatTaskContent(task),
      this.resolveTags(task.status, task.priority, task.assigneeId)
    );

    // 2. 寫 SQLite
    const record = await this.db.insertTask({
      ...task,
      discordThreadId: thread.id,
    });

    return record;
  }

  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const task = await this.db.getTask(taskId);

    // 1. 更新 SQLite
    await this.db.updateTask(taskId, { status, updatedAt: new Date() });

    // 2. 更新 Discord Forum tag
    await this.discordAdapter.updateForumPostTags(
      task.discordThreadId,
      this.resolveTags(status, task.priority, task.assigneeId)
    );

    // 3. 回覆 thread 紀錄狀態變更
    await this.discordAdapter.replyToThread(
      task.discordThreadId,
      `📌 Status changed: **${task.status}** → **${status}**`
    );
  }
}
```

### 3.5 InteractionHandler（新增）

```typescript
class DiscordInteractionHandler {
  private pendingApprovals = new Map<string, ApprovalResolver>();

  constructor(private client: Client) {
    client.on('interactionCreate', (i) => this.handle(i));
  }

  private async handle(interaction: Interaction): Promise<void> {
    if (interaction.isButton()) {
      await this.handleButton(interaction);
    } else if (interaction.isChatInputCommand()) {
      await this.handleSlashCommand(interaction);
    }
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    const [action, requestId] = interaction.customId.split(':');

    switch (action) {
      case 'approve':
      case 'deny': {
        const resolver = this.pendingApprovals.get(requestId);
        if (resolver) {
          resolver.resolve(action === 'approve');
          this.pendingApprovals.delete(requestId);
          await interaction.update({
            content: `${action === 'approve' ? '✅' : '❌'} ${action} by ${interaction.user.displayName}`,
            components: [], // 移除按鈕
          });
        }
        break;
      }
      case 'refresh_dashboard':
        await this.dashboardService.update();
        await interaction.deferUpdate();
        break;
      case 'pause_agent':
        // ...
        break;
    }
  }
}
```

---

## 四、Slash Command 設計

```
/status                     — 顯示所有 agent 狀態
/status [agent]             — 顯示特定 agent 狀態
/cost                       — 今日花費摘要
/cost [agent] [range]       — 特定 agent 的花費
/task create [title]        — 建立新任務
/task list [status]         — 列出任務
/task assign [id] [agent]   — 指派任務
/budget set [agent] [amount]— 設定預算
/schedule list              — 列出排程
/schedule pause [id]        — 暫停排程
/agent pause [name]         — 暫停 agent
/agent resume [name]        — 恢復 agent
```

---

## 五、資料流設計

### 使用者發訊息流程
```
User types in #coder channel
  → Discord messageCreate event
  → DiscordAdapter.handleMessage()
  → UnifiedMessage { platform: 'discord', chatId: '#coder' }
  → PlatformOrchestrator routes to coder agent
  → MessageProcessor.processMessage()
  → Claude SDK query
  → Response sent to #coder channel
  → ActivityEventService.log({ type: 'chat.responded' })
  → #system-log: "🤖 coder responded to user"
```

### 排程執行流程
```
ScheduleExecutor fires cron
  → MessageProcessor.processMessage(schedulePrompt)
  → Claude SDK query
  → Response
  → ActivityEventService.log({ type: 'schedule.completed' })
  → #system-log: "⏰ admin completed daily-reflection"
  → BudgetService.check(agentId)
  → If over 80%: #alerts embed with warning
  → DashboardService.update() // 刷新 dashboard
```

### Agent Call 流程
```
Agent A uses agent-call tool
  → AgentCallService.call(targetAgent, message)
  → ActivityEventService.log({ type: 'agent_call.sent' })
  → #system-log: "🤖 coder called @writer"
  → Target agent processes in their session/channel
  → Response sent back to caller
  → ActivityEventService.log({ type: 'agent_call.received' })
```

### 任務生命週期
```
User: /task create "修復登入 bug"
  → TaskService.createTask()
  → Forum post created with tags [📋backlog, 🔴urgent]
  → SQLite task_records INSERT
  → #system-log: "📋 New task: 修復登入 bug"

User assigns to coder
  → TaskService.assignTask(taskId, 'coder')
  → Forum tags: [🔄in-progress, 🔴urgent, 🤖coder]
  → Coder's channel: "📌 New task assigned: 修復登入 bug"

Coder completes
  → TaskService.updateStatus(taskId, 'done')
  → Forum tags: [✅done, 🔴urgent, 🤖coder]
  → Thread reply: "✅ Task completed"
  → Dashboard updates task count
```

---

## 六、SQLite Schema 擴充

### 新增表（在現有 7 表基礎上）

```sql
-- 1. 任務記錄（雙層：Discord Forum + SQLite）
CREATE TABLE task_records (
  id TEXT PRIMARY KEY,
  discord_thread_id TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_agent_id TEXT,
  created_by_agent_id TEXT,
  created_by_user_id TEXT,
  parent_task_id TEXT REFERENCES task_records(id),
  cost_cents INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_task_status ON task_records(status);
CREATE INDEX idx_task_assignee ON task_records(assignee_agent_id, status);

-- 2. 執行記錄（Audit Trail）
CREATE TABLE execution_records (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,         -- chat|schedule|agent_call
  trigger_source TEXT,                -- schedule_id, calling_agent_id, user_id
  task_id TEXT REFERENCES task_records(id),
  prompt_summary TEXT,
  response_summary TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_cents INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  status TEXT NOT NULL,               -- success|error|timeout|budget_exceeded
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_exec_agent ON execution_records(agent_id, created_at);
CREATE INDEX idx_exec_trigger ON execution_records(trigger_type, created_at);

-- 3. 活動事件（Audit Log）
CREATE TABLE activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  actor_type TEXT NOT NULL,           -- system|user|agent
  event_type TEXT NOT NULL,
  event_action TEXT,
  entity_type TEXT,                   -- task|agent|schedule|approval
  entity_id TEXT,
  details TEXT,                       -- JSON, redacted
  discord_message_id TEXT,            -- 對應的 Discord 訊息 ID
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activity_agent ON activity_events(agent_id, created_at);
CREATE INDEX idx_activity_type ON activity_events(event_type, created_at);
```

**表數量：7 → 10（新增 3 表）**

對比 Paperclip 的 36 表，我們只取用了精華：
- task_records ≈ issues（簡化版）
- execution_records ≈ heartbeat_runs（簡化版）
- activity_events ≈ activity_log（簡化版）

---

## 七、Agent Config 擴充

```yaml
# agents/coder/config.yml — 新增欄位
name: coder
description: "..."
model: sonnet

# 現有
telegramBotToken: ${CODER_TG_TOKEN}
discordBotToken: ${CODER_DISCORD_TOKEN}
discordChannelId: "123456789"

# 新增：Discord 組織設定
discord:
  roles: ["Engineer"]          # Discord role names
  category: "ENGINEERING"      # 所屬 category
  reportsTo: "admin"           # 上級 agent（用於 agent-call 方向性）

# 新增：預算設定
budget:
  dailyCents: 500              # $5.00/day
  monthlyCents: 10000          # $100.00/month
  warningThreshold: 0.8        # 80% 時警告
```

---

## 八、Config 變更（全域）

```yaml
# config.yml — 新增 Discord 全域設定
discord:
  guildId: "xxx"               # Discord Server ID

  # 系統 channel IDs
  channels:
    dashboard: "xxx"
    approvals: "xxx"
    costReport: "xxx"
    alerts: "xxx"
    taskBoard: "xxx"           # Forum channel
    completedTasks: "xxx"      # Forum channel (archive)
    systemLog: "xxx"
    general: "xxx"

  # 主 bot（處理 slash commands、interactions、系統 embeds）
  mainBot:
    token: ${DISCORD_MAIN_BOT_TOKEN}
    clientId: "xxx"

  # Dashboard 更新頻率
  dashboard:
    updateIntervalMinutes: 15

  # Task board tag IDs（初始化後填入）
  tags:
    backlog: "xxx"
    inProgress: "xxx"
    inReview: "xxx"
    done: "xxx"
    cancelled: "xxx"
    urgent: "xxx"
    medium: "xxx"
    low: "xxx"
```

---

## 九、不做清單（維持不變）

| 項目 | 理由 |
|------|------|
| Multi-tenancy (companyId) | 個人工具，不需要 |
| Atomic Checkout | 無多 agent 搶任務場景 |
| Session Codec | 只用 Claude SDK |
| PostgreSQL migration | SQLite 足夠 |
| Runtime Services (Docker) | 不需要 per-workspace 服務 |
| Goal Alignment Chain | 過重 |
| Full React Dashboard | Discord Embed 替代 |
