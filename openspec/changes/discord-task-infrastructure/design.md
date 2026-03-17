## Context

ClaudeCab 已有三個獨立運作的模組：

| 模組 | 狀態 | 缺口 |
|------|------|------|
| **TaskService** + TaskRecordRepository | SQLite + Forum 雙層 CRUD 已實作 | 任務只是靜態記錄，不與執行流程串接 |
| **AgentCallService** | 跨 Agent 呼叫（fire-and-forget / await）已實作 | 不知道任務存在，無法綁定 taskId |
| **ActivityEventService** | 雙寫（SQLite queue + Discord）已實作 | 觸發點不完整，任務生命週期事件未串接 |
| **taskTool** (MCP) | create_task, list_tasks, update_task 已實作 | 缺 post_to_thread, request_review, read_task |
| **DiscordInteractionHandler** | 基礎 Button handler 已有 | 無品管閘門 Button 處理 |

秘書 SOP 已定義完整工作流程（task-routing.md, quality-gate.md, escalation.md），但引擎層缺乏對應的結構化支撐。

**關鍵限制**：ClaudeCab 的 agent 執行過程中所有 assistant message 都會推送到 chatId 對應的頻道/討論串。因此 chatId 的選擇直接決定了使用者在 Discord 裡看到什麼。

## Goals / Non-Goals

**Goals:**

- 讓任務的 Discord Forum thread 成為**乾淨的摘要看板**——只有關鍵節點和使用者互動，不被 agent 的執行過程灌滿
- Agent Call 與任務綁定——秘書分派任務時，agent 的執行自動關聯到任務
- Agent 的完整執行過程在自己 channel 的 per-task thread 裡，不外洩到主 thread
- 使用者在主 thread 留言 → 路由到秘書 → 秘書處理後推結果回主 thread
- 品管閘門結構化——`request_review` → Discord Embed + Button → 審核結果回傳
- MCP tools 讓 agent 在執行中與任務系統互動（推摘要、請求審核、讀上下文）

**Non-Goals:**

- 不做主 Bot 架構改造（現有 multi-bot 架構不變）
- 不做 Budget 系統整合（已有 BudgetService，本次不動）
- 不做 Dashboard 更新邏輯（DashboardService 已有，只需新增觸發點）
- 不做排程系統與任務的自動綁定（排程是獨立機制）
- 不做 Forum tag 自動更新（Discord API 限制多，先用 thread reply 記錄狀態）

## Decisions

### 兩層 Thread 架構（核心決策）

這是本次最核心的架構決策。所有 agent（包含秘書）一視同仁，零特例。

**問題**：Agent 的 SDK 執行過程會產生大量 assistant message（工具呼叫結果、中間思考、進度輸出）。如果 chatId 指向主 thread，主 thread 會被灌滿執行細節，失去摘要看板的價值。

**決策**：分成兩層 thread。

| | 主 Thread（#task-board Forum） | Agent Per-Task Thread（agent 自己的 channel） |
|---|---|---|
| **定位** | 摘要看板 + 使用者互動介面 | Agent 的完整工作空間 |
| **內容** | 系統訊息 + agent 推送的摘要 + 使用者留言 + 秘書推送的回覆 | Agent 的所有 assistant message、工具呼叫、完整對話 |
| **chatId** | 不是任何 agent 的 chatId | 是對應 agent 的 chatId |
| **誰會看** | 使用者、秘書 | 想深挖某個 agent 執行細節時才看 |
| **建立時機** | 建任務時 | Agent 被 call 時（按需建立） |

**效果**：
```
#task-board Forum
  └── [主 Thread] 每週內容 W12          ← 乾淨：只有摘要 + 使用者互動
       ├── [系統] 指派給 writer
       ├── [writer] 📦 3 篇初稿完成
       ├── [使用者] 第 2 篇觀點太軟
       ├── [秘書] 收到，已通知 Writer 修改
       ├── [writer] 📦 修改版完成
       └── [系統] 任務完成，花了 $2.34

#秘書 channel
  └── [Thread] 📋 任務：每週內容 W12    ← 秘書的完整執行過程
       ├── 秘書收到使用者指令...
       ├── 判斷要分給 writer...
       ├── call_agent writer...
       └── ...

#writer channel
  └── [Thread] 📋 任務：每週內容 W12    ← Writer 的完整執行過程
       ├── 收到秘書的指令...
       ├── 讀取 research 素材...
       ├── [tool: read_file]
       ├── 開始寫第一篇...
       ├── [tool: write_file]
       └── ...（50+ 條 assistant message）
```

**替代方案考慮**：

| 方案 | 問題 |
|------|------|
| chatId = 主 thread | Agent 的所有 assistant message 灌滿主 thread，失去摘要價值 |
| 秘書做特例（chatId = 主 thread） | 違反統一規則，秘書做重活時也會灌滿主 thread |
| 不用 thread 只用 channel | 同一 channel 混著多個任務的訊息，無法隔離 |

### Agent Per-Task Thread 的 Session 機制

**現狀**：Session key = `platform::agentId::userId`。chatId 只決定回覆去哪裡。

**決策**：當 agent call 綁定 taskId 時：
- `userId` = `task:{taskId}`（每個任務有獨立 session）
- `chatId` = agent channel 裡的 per-task thread ID

**效果**：
```
秘書第一次 call Writer 做任務 X：
  → 系統在 #writer 建一個 thread「📋 任務：每週內容 W12」
  → chatId = 這個新 thread
  → session key = 'discord::writer::task:abc123'
  → Writer 在這個 thread 裡工作

秘書第二次 call Writer（退回修改）：
  → chatId = 同一個 #writer 的 thread（已存在）
  → session key 不變 → 同一個 session → Writer 記得前情

Writer 同時做任務 Y：
  → 在 #writer 建另一個 thread
  → session key = 'discord::writer::task:def456'
  → 獨立 session，互不干擾
```

**SessionManager 不需要改動**——它不關心 userId 的內容，只當作 key 的一部分。

**Per-task thread 建立機制**：AgentCallService 在 call 時檢查是否已存在對應的 thread。不存在則用 DiscordAdapter 在 agent 的 channel 裡建立 thread（從一條初始訊息建立）。thread ID 存入 TaskRecordRepository 的新欄位 `agent_thread_ids`（JSON，key = agentId, value = threadId）。

### 使用者在主 Thread 留言的路由

**決策**：使用者在主 Thread 打字 → 系統路由到秘書的 per-task thread → 秘書處理 → 秘書推結果到主 thread。

```
使用者在主 thread 說：「第 2 篇觀點太軟」
  → TaskService Forum listener 偵測到人類訊息（非 bot）
  → 查 SQLite：thread_id → 找到對應任務
  → 構造 UnifiedMessage，注入任務 context
  → 路由到秘書的 per-task thread（AgentCallService.callAgent）
  → 秘書在 #秘書 的 thread 裡處理
  → 秘書用 post_to_thread 推結果到主 thread：「收到，已通知 Writer 修改」
  → 秘書 call_agent Writer 帶 taskId → Writer 在 #writer 的 thread 裡改
  → Writer 改完，用 post_to_thread 推到主 thread
```

**使用者體感**：在主 thread 打字 → 看到秘書回覆 → 看到員工回覆。不需要跑去其他 channel。

### Agent Call 完成後自動 Callback 秘書（品管閘門驅動）

**問題**：秘書 fire-and-forget call 員工後，秘書的 session 就結束了。員工做完後沒有機制通知秘書回來審核。

**決策**：AgentCallService 的 `executeInBackground` 完成後，如果有 taskId，系統自動 callback 秘書（任務的建立者 agent）進行品管。

```
秘書 call_agent('writer', '寫 3 篇', { taskId })
  → Writer 在 per-task thread 工作...
  → Writer 完成（call 結束）
  → 系統自動 call 秘書（callback）：
      taskId = 同一個
      message = 「Writer 完成了任務 X，以下是回覆摘要：...，請品管審核」
  → 秘書在 per-task thread 裡審核
    → 通過 → post_to_thread 到主 thread：「✅ 品管通過，請 review」
             → 主 thread 出現最終審核按鈕（給使用者）
    → 不通過 → call_agent('writer', '第 2 篇要改...', { taskId })
               → Writer 同一個 session，記得前情
               → Writer 改完 → 又 callback 秘書
               → 來回直到通過
```

**兩層品管**：

| 層級 | 誰審 | 觸發方式 | 在哪裡 |
|------|------|---------|--------|
| 第一層 | 秘書（自動） | Agent call 完成 → 系統 callback | 秘書的 per-task thread |
| 第二層 | 使用者（手動） | 秘書品管通過 → 主 thread 審核按鈕 | 主 thread |

**使用者體感**：你只在秘書品管通過後才被打擾。員工和秘書之間的來回修改你看不到（除非你主動去看 per-task thread）。主 thread 裡只出現最終結果。

**Callback 不觸發的情況**：
- 不帶 taskId 的 agent call（向後相容，跟以前一樣）
- await 模式的 call（呼叫者自己等回覆，不需要 callback）

**替代方案**：讓員工主動 `request_review` 通知秘書。問題是依賴員工記得呼叫 tool，容易漏。自動 callback 更可靠。

### 任務驅動的 Agent Call 流程

**主模式（秘書手動 call）**：
```
秘書自己判斷後：
  1. create_task('每週內容 W12')              → 建任務卡 + Forum 主 thread
  2. call_agent('writer', '寫 3 篇', { taskId })  → 手動帶 taskId
     → 系統在 #writer 建 per-task thread
     → Writer 工作 → 完成
     → 系統 callback 秘書 → 秘書品管
     → 通過 → 主 thread 出現使用者審核按鈕
```

**可選模式（autoCall）**：
```
秘書一步到位：
  assign_task('writer', { autoCall: true })
  = 指派 + 自動 call_agent 一步完成
```

**決策**：autoCall 預設 false（向後相容）。兩者底層邏輯完全相同——都是 AgentCallService.callAgent 帶 taskId。

### AgentCallService taskId 傳遞機制

AgentCallOptions 新增 `taskId?: string`。當 taskId 存在時：

1. **userId 改寫**：`effectiveUserId = 'task:{taskId}'`
2. **chatId 改寫**：查找或建立 agent 的 per-task thread，用其 ID 作為 chatId
3. enrichedMessage 注入任務上下文（標題、描述、目前狀態、前序產出）
4. ExecutionRecord 綁定 taskId（花費歸因）

**傳遞方式**：taskId 透過 UnifiedMessage.metadata 向下傳遞到 MessageProcessor → SDK query → 執行記錄。

**向後相容**：不帶 taskId 的 agent call 行為完全不變。

### MCP Tools 設計

擴充現有 `task-mgmt` MCP server，新增三個 tool：

| Tool | 參數 | 行為 |
|------|------|------|
| `post_to_thread` | `taskId`, `content`, `type?: 'progress' \| 'deliverable' \| 'note'` | 推訊息到任務的**主 thread**（不是 agent 的 per-task thread）。type 決定格式前綴 |
| `request_review` | `taskId`, `summary`, `deliverables?: string[]` | 任務狀態 → in_review，**主 thread** 發審核 Embed + Button，通知秘書/Owner |
| `read_task` | `taskId` | 回傳任務上下文 + 主 thread 最近訊息摘要 |

**重要**：`post_to_thread` 推的是**主 thread**（摘要看板），不是 agent 自己的 per-task thread。Agent 在自己的 thread 裡工作，到了關鍵節點才推摘要到主 thread。

**決策**：MCP tool 主動呼叫。Agent 的 CLAUDE.md / SOP 告訴它何時該推進度。不用也行，主 thread 至少有系統自動訊息。

### 品管閘門 Button 互動

品管按鈕有兩個使用場景：

**場景 A：秘書品管通過後，推給使用者最終審核**
```
秘書品管通過
  → 秘書用 post_to_thread 推到主 thread：「✅ 品管通過，請最終 review」
  → 秘書用 request_review 在主 thread 發審核 Embed
  → 使用者點按鈕
    → approve: 任務完成
    → reject: Modal 填理由 → 秘書收到 → 安排修改
```

**場景 B：員工直接 request_review（跳過秘書品管）**
```
員工直接呼叫 request_review
  → 主 thread 出現按鈕 → 使用者/秘書點
```

InteractionHandler 處理 Button click + reject Modal 的邏輯相同。

**退回次數**：TaskRecordRepository 新增 `review_count`。引擎只記錄次數，不阻斷。留給秘書 SOP 判斷。

### 通知路由

| 事件 | 推送目標 | 格式 |
|------|---------|------|
| 任務建立 | 主 thread + assignee 的 agent channel | 系統訊息 |
| 任務開始（agent call 發起） | 主 thread + #system-log | 系統訊息 + ActivityEvent |
| Agent 推送摘要（post_to_thread） | 主 thread | agent 格式化訊息 |
| 員工完成 → callback 秘書 | 秘書的 per-task thread（自動） | 帶員工回覆摘要的 call |
| 秘書品管通過 → 使用者審核 | 主 thread | Embed + Button（秘書用 request_review 觸發） |
| 審核通過/退回（使用者點按鈕） | 主 thread + 秘書 per-task thread | 文字（+ 退回理由） |
| 使用者留言 | 秘書的 per-task thread（路由） | 帶任務 context 的訊息 |
| 任務完成 | 主 thread + #system-log | 文字 + cost 摘要 |
| 升級（review_count >= 3） | #alerts + @Owner | Embed |

### 主 Thread 內容格式

主 thread 是乾淨的摘要看板：

```
[Forum Post] 🟡 每週內容 W12 — AI Agent 實務應用 × 3 篇
  Priority: medium | Assignee: writer | Created by: general

[系統] 📌 指派給 writer
[writer] 📝 進度：開始研究素材
[writer] 📦 交付：3 篇初稿完成
[秘書] ✅ 品管通過，請最終 review
[系統] 📋 審核請求 [✅ 通過] [❌ 退回]    ← 給使用者的按鈕

[使用者] 第 2 篇觀點太軟                    ← 使用者退回
[秘書] 收到，已通知 Writer 修改
[writer] 📦 修改版完成
[秘書] ✅ 品管通過，請最終 review
[系統] 📋 審核請求 [✅ 通過] [❌ 退回]

[系統] ✅ 全部通過
[系統] 💰 累計花費：$2.34 | 耗時：45min
```

注意：秘書跟員工之間的品管來回（退回修改、重新提交）不在主 thread，而是在各自的 per-task thread 裡完成。主 thread 只看到最終結果。

## Risks / Trade-offs

| 風險 | 緩解 |
|------|------|
| Discord API Rate Limit（5/5s/channel）— 多個 thread 更新 | post_to_thread 內部節流（同一 task 5 秒合併），agent per-task thread 不受此限制（由 SDK 自然節奏控制） |
| Agent 不使用 MCP tools（忘記推摘要到主 thread） | Agent 的 SOP/CLAUDE.md 要求關鍵節點呼叫；主 thread 至少有系統自動訊息（指派、狀態、完成），不會空白 |
| 品管 Button 超時（Discord interaction 3s deadline） | deferReply() 立即回應，後續 editReply() |
| review_count 重設時機 | 進入 in_review 時 +1，任務重新分派時歸零 |
| autoCall 在不適當時機觸發 | 預設 false，需明確啟用 |
| Forum thread 被手動刪除後 SQLite 不同步 | 寫入 thread 失敗時不阻斷 SQLite 操作（best effort） |
| Per-task thread 數量多（每個任務每個 agent 一個） | Discord channel 最多 1000 個 thread（含已歸檔）。任務完成後 per-task thread 可歸檔 |
| 使用者在主 thread 留言但秘書離線 | 訊息排隊在秘書的 per-task thread，秘書下次上線時處理。可加系統回覆「已收到，秘書稍後處理」 |
| TaskRecordRepository 需要存多個 agent thread ID | 新增 `agent_thread_ids` JSON 欄位（key=agentId, value=threadId），一個任務可能有多個 agent 參與 |
