# ADR-030: Agent Team Mode — 多 Agent 並行協作

**日期**：2026-02-06
**狀態**：✅ implemented (Tier 1 + Tier 1.1~1.3)
**關聯**：SDKQueryManager、GroupBroadcaster、DelegationHandler、ScheduleExecutor

## 背景

ClaudeCab 已經是一個多 agent 協作框架。**Telegram 群組就是 team**：多個 bot 作為 peers 在群組中交流、協作，這跟 Claude Code Agent Teams 用檔案系統做 mailbox 是同一層概念 — Telegram 是通訊平台，不是仲裁者。

### 現有協作機制

| 機制 | 說明 | 對標 Claude Code |
|------|------|------------------|
| **Telegram 群組** | Bot 之間的通訊平台 | ≈ 檔案系統 mailbox |
| **GroupBroadcaster** | 訊息路由、@mention、去重 | ≈ SendMessage（broadcast） |
| **Delegation**（ADR-021/022） | 一個 bot 請另一個 bot 處理 | ≈ Task assignment |
| **Initiative**（ADR-023） | Bot 主動發話 | ≈ Idle notification |

### 現有機制的局限

1. **Delegation 是串行的**：A 交給 B，B 做完回來。不支援「A 同時請 B 和 C 各做一部分」
2. **缺少結構化任務追蹤**：群組裡的 bot 不知道彼此「正在做什麼」，沒有共享任務清單
3. **缺少結果綜合**：多個 bot 各自回覆，沒有人負責把結果合在一起
4. **協作是被動的**：bot 只在被 @mention 或 delegation 時參與，缺少主動認領任務的機制

---

## 參照物：Claude Code Agent Teams

2026-02-05 隨 Opus 4.6 發布的 [Agent Teams](https://code.claude.com/docs/en/agent-teams) 是 Claude Code 官方的多 agent 協作機制。以下完整記錄其架構，作為 ClaudeCab 設計的參考。

### 核心概念

Agent Teams 讓多個 Claude Code instance 作為一個 team 協作。一個 session 作為 **team lead**，負責分工、協調、綜合結果。其餘 **teammates** 各自在獨立 context window 工作，可直接互相通訊。

**與 Subagent 的關鍵差異**：

|  | Subagent | Teammate |
|--|----------|----------|
| **Context** | 獨立 context window，結果回傳 caller | 獨立 context window，完全獨立 |
| **通訊** | 只能回報給主 agent（單向） | 可互相傳訊、挑戰彼此發現（雙向） |
| **協調** | 主 agent 管理一切 | 共享任務清單 + 自主認領 |
| **適用** | 只需要結果的聚焦任務 | 需要討論、挑戰和協調的複雜工作 |
| **Token 成本** | 較低（結果摘要回主 context） | 較高（每個 teammate 獨立 Claude instance） |

### Lead 機制（關鍵）

**Lead = 建立 team 的那個 session。固定不變，整個 team 生命週期都是它。**

Lead 的產生方式：
1. **使用者主動要求**：「Create an agent team to...」→ 當前 session 成為 lead
2. **Claude 自己判斷**：Claude 認為任務適合並行 → 向使用者提議 → 確認後建立

Lead 的職責：

| 職責 | 說明 |
|------|------|
| **分工** | 拆任務、建立 shared task list |
| **派工** | 明確指派 or 讓 teammate 自行認領 |
| **協調** | 監控進度、重新分配卡住的任務 |
| **綜合** | 收集所有結果、產出最終回覆 |

**Delegate Mode**：按 Shift+Tab 啟用，限制 lead 只能用協調工具（spawn、message、shutdown、task），不能自己寫 code。確保 lead 專注於 orchestration。

> **注意**：官方承認 lead 有時會自己動手實作而不是等 teammate。delegate mode 就是為了解決這個問題。如果發現 lead 在做事：「Wait for your teammates to complete their tasks before proceeding」。

### 工具架構

官方文檔公開的操作：

| 域 | 工具 | 操作 | 說明 |
|----|------|------|------|
| **Team 生命週期** | TeammateTool | `spawnTeam` | 建立 team，產生配置目錄 |
| | | `cleanup` | 清理 team 資源（lead 專用，需先關閉所有 teammate） |
| **通訊** | SendMessage | `message` | 點對點訊息（向特定 teammate） |
| | | `broadcast` | 向所有 teammate 廣播（謹慎使用，token 成本隨 team 人數線性增長） |
| **計畫審批** | | `approvePlan` / `rejectPlan` | Lead 審批 teammate 的計畫 |
| **優雅關閉** | | `requestShutdown` | 請求關閉 teammate（teammate 可批准或拒絕） |
| **任務** | TaskList | 共享任務清單 | 所有 agent 可見，可認領、更新狀態 |

> **逆向工程補充**（來自 [paddo.dev](https://paddo.dev/blog/claude-code-hidden-swarm/)，未經官方確認）：
> 二進位分析發現共 13 個操作，除上述外還包括 `discoverTeams`、`requestJoin`/`approveJoin`/`rejectJoin`、`approveShutdown`/`rejectShutdown` 等。這些可能是內部操作或已移除的功能。

### 檔案結構（Filesystem-based State Model）

```
~/.claude/
├── teams/{team-name}/
│   ├── config.json              # team metadata、members 陣列（name, agentId, agentType）
│   └── messages/{session-id}/   # per-session mailbox（非同步，無共享記憶體）
└── tasks/{team-name}/           # team-scoped 共享任務（file locking 防競爭）
```

環境變數標識 agent 身份：`CLAUDE_CODE_TEAM_NAME`、`CLAUDE_CODE_AGENT_ID`、`CLAUDE_CODE_AGENT_TYPE`

### 任務系統

- **狀態**：pending → in progress → completed
- **相依性**：任務可依賴其他任務，被 block 的任務不能被認領
- **認領方式**：Lead 明確指派 or teammate 自行認領下一個未被認領、未被 block 的任務
- **競爭控制**：file locking 防止多個 teammate 同時認領同一任務
- **自動解鎖**：teammate 完成任務後，依賴它的其他任務自動 unblock

### 通訊機制

- **自動訊息傳遞**：teammate 發送的訊息自動送達收件者，lead 不需要輪詢
- **閒置通知**：teammate 完成工作後自動通知 lead
- **直接互動**：使用者可直接跟任何 teammate 對話（不需經過 lead）。這意味著 **teammate 不只是 worker** — 使用者可以繞過 lead 直接介入、給額外指示、問後續問題或改變方向

### Context 繼承

- Teammate spawn 時載入與一般 session 相同的專案 context：**CLAUDE.md、MCP servers、skills**
- 同時收到 lead 的 **spawn prompt**（任務描述）
- **不繼承 lead 的對話歷史** — 這是與 subagent 的關鍵差異之一

### 計畫審批（Plan Approval）

對於複雜或高風險任務，可要求 teammate 先規劃再實作：
1. Teammate 進入 read-only plan mode
2. 完成規劃後向 lead 提交計畫
3. Lead 審批（approve → 開始實作）或退回（reject + feedback → 修改後重提）
4. Lead 的審批決策是自主的，可透過 prompt 影響判斷標準

### 品質控制 Hooks

| Hook | 觸發時機 | 作用 |
|------|----------|------|
| `TeammateIdle` | Teammate 即將閒置 | exit code 2 = 發 feedback 讓 teammate 繼續工作 |
| `TaskCompleted` | 任務即將標記完成 | exit code 2 = 阻止完成並發 feedback |

### 顯示模式

- **In-process**（預設）：所有 teammate 在同一 terminal 內，Shift+Up/Down 切換
- **Split panes**：每個 teammate 獨立 terminal pane，需 tmux 或 iTerm2
- 設定 `"auto"`（預設）= 在 tmux 內自動用 split，否則 in-process

### 最佳使用場景

1. **研究與審查**：多個 teammate 同時調查不同面向，互相挑戰發現
2. **新模組/功能**：每個 teammate 負責一個獨立的部分，不互相踩踏
3. **競爭假說除錯**：多個 teammate 平行測試不同理論，存活的理論最可能是真因
4. **跨層協調**：前端、後端、測試各由不同 teammate 負責

### 任務粒度建議

- **太小**：協調 overhead > 收益
- **太大**：teammate 工作太久沒 check-in，浪費風險增加
- **剛好**：自包含的單位，產出明確交付物（function、test file、review）
- 建議每個 teammate 5-6 個任務，保持產能並讓 lead 可重新分配

### 已知限制

- **Lead 固定**：不能換人、不能 promote teammate 為 lead
- **不支援 session resumption**（in-process teammates）
- **不支援巢狀 team**（teammate 不能 spawn 自己的 team）
- **每個 session 只能管一個 team**
- **Permission 在 spawn 時固定**（繼承 lead 的 permission，之後可個別改但不能在 spawn 時指定）
- 仍為 experimental（需 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）

### 參考來源

- [Orchestrate teams of Claude Code sessions - 官方文檔](https://code.claude.com/docs/en/agent-teams)
- [Introducing Claude Opus 4.6 - Anthropic](https://www.anthropic.com/news/claude-opus-4-6)
- [Claude Code's Hidden Multi-Agent System - paddo.dev](https://paddo.dev/blog/claude-code-hidden-swarm/)
- [Building a C compiler with a team of parallel Claudes - Anthropic Engineering](https://www.anthropic.com/engineering/building-c-compiler)
- [Claude Code Swarms - Addy Osmani](https://addyosmani.com/blog/claude-code-agent-teams/)
- [Claude Code Agent Teams Setup Guide - marc0.dev](https://www.marc0.dev/en/blog/claude-code-agent-teams-multiple-ai-agents-working-in-parallel-setup-guide-1770317684454)

---

## Swarm 完整生命週期

以下是 Claude Code Agent Teams 的完整行為流程，作為 ClaudeCab 實作的參照。

### Phase 0：觸發

```
使用者給了一個複雜任務
  → Claude 判斷「這個任務適合並行處理」
  → 提議建立 team（或使用者主動要求）
  → 使用者確認
```

Team 的建立是明確的決策點，不是自動發生的。

### Phase 1：建立 Team + 分工

```
Lead session 呼叫 spawnTeam
  → 建立 team config（config.json）
  → 拆任務 → 建立 shared task list（含 dependency）
  → Spawn N 個 teammate session
     每個 teammate 收到：
     - 專案 context（CLAUDE.md、MCP、skills）
     - Lead 的 spawn prompt（任務描述 + 角色定義）
     - 不繼承 lead 的對話歷史
```

### Phase 2：並行執行

```
每個 teammate 獨立工作：
  - 認領一個 task（file locking 防競爭）
  - 在自己的 context window 執行
  - 完成後標記 task completed → 依賴它的 task 自動 unblock
  - 自動認領下一個可用 task
  
同時：
  - Teammate 可以互相發訊息（peer-to-peer，不需經 lead）
  - Teammate 可以挑戰彼此的發現
  - 使用者可以繞過 lead 直接跟任何 teammate 對話
  - Lead 監控進度（收到閒置通知）
```

### Phase 3：收斂

```
所有 task 完成（或 lead 判斷夠了）
  → Lead 綜合所有 teammate 的成果
  → 產出最終結果
  → 向 teammate 發送 shutdown request
  → Cleanup（移除 team 資源）
```

---

## Swarm → ClaudeCab 完整對映

### 逐項對映

| Swarm 行為 | Claude Code 實作 | ClaudeCab 現有 | 差距 |
|-----------|-----------------|---------------|------|
| **通訊平台** | 檔案系統 mailbox（per-session inbox） | Telegram 群組（廣播式） | ✅ 已有，語義不同但功能等價 |
| **Team = 一組 agent** | 臨時 spawn 的 session 群 | 群組裡的 bot peers（持久存在） | ✅ 已有，且更好（持久實體有記憶和人格） |
| **Lead 選擇** | 建立 team 的 session = lead | `getRespondingBot()` 選出的 bot | ✅ 已有機制 |
| **Spawn teammate** | 啟動新 Claude Code instance | 不需要 — bot 已在群組裡 | ✅ 不需要（bot 是持久的） |
| **點對點訊息** | `message`（SendMessage） | @mention 特定 bot | ✅ 已有 |
| **廣播** | `broadcast`（SendMessage） | 群組訊息（天然廣播） | ✅ 已有 |
| **分工 / 拆任務** | Lead 建立 shared task list | Bot LLM 判斷後 @mention 多個 bot | ⚠️ 有但不結構化 |
| **並行執行** | 每個 teammate 獨立 session | SDKQueryManager 支援並行 session | ⚠️ 底層支援，但 delegation 是串行的 |
| **Shared task list** | 檔案系統 + file locking | — | ❌ 缺少 |
| **Task dependency** | task 可 block 其他 task | — | ❌ 缺少 |
| **自行認領** | teammate 完成後自動認領下一個 | — | ❌ 缺少 |
| **結果綜合** | Lead 收集 + 綜合 | 各自回覆，無人合併 | ❌ 缺少 |
| **Plan approval** | Lead 審批 teammate 計畫 | — | ❌ 缺少（低優先） |
| **Delegate mode** | 限制 lead 只能協調 | — | ❌ 缺少（低優先） |
| **Quality hooks** | TeammateIdle / TaskCompleted | — | ❌ 缺少（低優先） |
| **使用者直接介入** | 使用者可跟任何 teammate 對話 | 使用者在群組 @mention 任何 bot | ✅ 已有，且更自然 |
| **透明度** | 需要切換 tab 看不同 agent | 群組裡全程可見 | ✅ 已有，且更好 |

### ClaudeCab 的天然優勢（不需要建的）

| Claude Code 的限制 | ClaudeCab 的現況 |
|-------------------|-----------------|
| Teammate 是臨時 session，用完即棄 | Bot 是持久實體，有記憶、人格、專長 |
| 不繼承 lead 對話歷史 | Bot 有群組 context injection（自動看到前文） |
| 使用者需要切換 tab 看不同 agent | 群組裡全程可見，天然透明 |
| 不支援 session resumption | Bot 的 session 可 resume |
| 一個 session 只能管一個 team | 群組本身就是 team，無需管理 |
| Teammate 不能 spawn 自己的 team | Bot 可以繼續委派（depth-limited） |

### 核心洞察

**ClaudeCab 不需要 spawn team — team 已經存在（群組）。不需要建通訊層 — Telegram 就是通訊平台。需要的是讓群組裡的 bot 更聰明地協作。**

核心差距只有一句話：**群組收到複雜請求時，目前只有一個 bot 在跑，其他 bot 閒著。**

差三層：

| 層 | 說明 | 現況 |
|----|------|------|
| **並行觸發** | 一個訊息進來 → 拆成子任務 → 同時啟動多個 bot 的 SDK session | ❌ 一次只有一個 bot 處理 |
| **任務感知** | Bot 之間知道「誰在做什麼」，避免重工 | ❌ Bot 彼此不知道對方的工作狀態 |
| **收斂機制** | 所有人做完後，由某個角色綜合回覆 | ❌ 各自回覆，無人合併 |

---

## 需要擴建的（按優先級）

### Tier 1：最小可行 Team Mode — 讓並行跑起來

**1a. 並行委派**

- 現有：DelegationHandler `for...await`（串行）
- 擴建：`Promise.allSettled()`（並行），1 個 target 維持原邏輯，2+ targets 並行
- 改動：DelegationHandler 一個方法
- 複雜度：低

**1b. 結果收斂**

- 現有：不存在
- 擴建：並行委派完成後，協調者收集結果 → 注入 synthesis prompt → 產出綜合回覆
- 改動：DelegationHandler 新增 `executeParallelDelegation()`
- 複雜度：中

**1c. isSynthesis 安全旗標**

- 現有：不存在
- 擴建：仿照 `isInitiative` 模式，防止 synthesis 回覆觸發二次委派
- 改動：BotRepliedPayload + MessageProcessor + DelegationHandler
- 複雜度：低

**1d. 協調者（Lead）選擇**

- 沿用現有機制，不新增邏輯
- `getRespondingBot()` 選出回應的 bot → bot 的 LLM 判斷是否分工 → @mention 其他 bot → 自動成為協調者
- 對標 Claude Code：「建立 team 的 session = lead」

### Tier 2：結構化任務感知 — 讓協作更智慧

**2a. Shared Task List（DB-backed）**

- 對標：Claude Code 的 TaskList
- 擴建：新增 `team_tasks` 表（task_id, group_id, initiator_bot_id, assignee_bot_id, description, status, depends_on, result）
- Bot 啟動處理前可查「這個群組有什麼進行中的任務？」避免重工
- 改動：新增 DB table + repository + 注入到 bot context
- 複雜度：中

**2b. Task Dependency**

- 對標：Claude Code 的 task blocking/unblocking
- 擴建：team_tasks 表加 `blocked_by` 欄位，完成任務自動 unblock 依賴
- 複雜度：低（DB schema），中（邏輯）

**2c. 自行認領**

- 對標：Claude Code 的 teammate 自動認領下一個任務
- 擴建：Bot 完成任務後，從 shared task list 認領下一個可用任務
- 需要 bot 的 protocol/skill 教它「做完了就看看有沒有其他事」
- 改動：Agent skills + EventBus 事件
- 複雜度：中（prompt 設計）

### Tier 3：進階協作機制（長期）

**3a. Plan Approval**

- 對標：Claude Code 的 approvePlan/rejectPlan
- 擴建：協調者可要求被委派的 bot 先提計畫再動手
- 複雜度：高

**3b. Delegate Mode（協調者不動手）**

- 對標：Claude Code 的 delegate mode
- 擴建：限制協調者只能分工 + 綜合，不能自己做任務（透過 system prompt injection）
- 複雜度：中

**3c. Quality Hooks**

- 對標：Claude Code 的 TeammateIdle / TaskCompleted
- 擴建：任務完成時觸發檢查（測試通過？code review？）
- 複雜度：高

---

## 業務邏輯概念（Tier 1 實作路徑）

基於「群組就是 team、Telegram 就是通訊平台」的前提，以下描述 Tier 1 如何用現有元件填補三層差距。

### Layer 1：並行觸發 — 從「一人回應」到「一人協調、多人工作」

**現狀**：GroupBroadcaster 的 `shouldRespondToMessage` 決定哪個 bot 回應 → 只有一個 bot 啟動 SDK session。

**概念**：

收到複雜請求時，**回應的 bot 成為協調者**（不是管理者），它做兩件事：
1. **拆任務** — 判斷這個請求需要哪些能力 → 對應到哪些 bot
2. **扇出委派** — 透過 DelegationHandler 同時向多個 bot 發起委派，每個委派各自啟動獨立的 SDK session

```
使用者：「分析這個產品的市場、技術、財務」
    ↓
Bot A 收到 → 判斷需要三個面向
    ├─ 委派 Bot B：「分析市場定位」 → SDK session B
    ├─ 委派 Bot C：「分析技術可行性」 → SDK session C
    └─ 自己處理：「分析財務模型」    → SDK session A
    （三個 session 並行跑）
```

### Layer 2：任務感知 — Bot 之間知道「我們正在做什麼」

**Phase 1（零成本）**：協調者在群組公告分工，其他 bot 透過 context injection 看到。

**Phase 2+（DB-backed）**：`team_tasks` 表，Bot 啟動 session 前查詢進行中的任務。

### Layer 3：收斂機制 — 從「各自回覆」到「綜合回覆」

**由協調者負責收斂。** 並行委派全部完成後：
1. 收集各 bot 的回覆結果（從 `ProcessingResult.response`）
2. 建立 synthesis prompt（包含所有結果）
3. 注入給協調者 → 產出綜合回覆

### 完整流程

```
[使用者發訊息到群組]
        ↓
[GroupBroadcaster] → getRespondingBot → Bot A 回應
        ↓
[Bot A 的 LLM] → 回覆中 @mention Bot B 和 Bot C
        ↓
[DelegationHandler.processDelegation()]
    targets.length >= 2 → executeParallelDelegation()
        ├─ Bot B: processMessage() → SDK session（並行）
        ├─ Bot C: processMessage() → SDK session（並行）
        └─ Promise.allSettled() 等待全部完成
        ↓
    收集結果 → 建立 synthesis prompt
        ↓
    processMessage(synthesisPrompt, Bot A, { isSynthesis: true })
        ↓
[Bot A 綜合回覆] → 發到群組（isSynthesis 阻擋二次委派）
```

### Tier 1 修改範圍

| 元件 | 修改內容 | 複雜度 |
|------|----------|--------|
| **DelegationHandler** | 並行化 + `executeParallelDelegation()` + 結果收集 + synthesis 注入 | 中 |
| **MessageProcessor** | options + emitBotRepliedEvent 傳遞 `isSynthesis` | 低 |
| **BotRepliedPayload** | 新增 `isSynthesis?: boolean` | 低 |
| **SDKQueryManager** | **不需修改** — 已支援並行 session | — |
| **GroupBroadcaster** | **不需修改** — handleBotReplied 已足夠 | — |
| **Telegram 群組** | **不需修改** — 已經是通訊平台 | — |

---

## 協調者自動選擇：Initiative 機制改進提案

### 現況問題

目前 `getRespondingBot()` 在無 @mention、無 reply-to 時 return null（沒有 bot 回應），
接著走 ADR-023 的 `InitiativeHandler.evaluateInitiatives()`。

但 Initiative 機制的設計目標是「讓相關 bot 主動加入討論」，不是「選一個協調者」：

| | Initiative（ADR-023 現有） | 協調者自動選擇（提案） |
|---|---|---|
| **目的** | 讓相關 bot 主動加入討論 | 選一個 bot 負責分工協調 |
| **Query 數量** | N 個 bot × N 次 `evaluator.shouldRespond()` | **1 次** centralized query |
| **輸入** | 單一 bot 的 description + 訊息 | **所有 bot 的 descriptions** + 訊息 |
| **輸出** | 每個 bot 各自 true/false | **排序結果**：最適合的 1 個 bot |
| **回應數** | 0~N 個 bot 各自回覆 | **只有 1 個** bot 回覆 |
| **isInitiative** | true（阻擋委派鏈） | **false**（走正常路徑，可觸發委派） |
| **Token 成本** | O(N) 次 query | O(1) 次 query |
| **後續行為** | 各 bot 獨立回覆，互不關聯 | 被選中 bot 可分工 @mention → 並行委派 |

### 提案：Centralized Responder Selection

在 `getRespondingBot()` 的 Case 3（無 @mention、無 reply-to）加入：

```
1 次 LLM query，輸入：
  - 使用者訊息
  - 群組所有 bot 的 { agentId, name, description }

輸出：
  - respondingAgentId: string（最適合的 bot）
  - reason: string（為什麼選它）

→ 該 bot 成為正式 respondingBot
→ 走正常 processMessage 路徑（非 isInitiative）
→ 可觸發委派（如果回覆中 @mention 其他 bot）
```

### 與 Initiative 的關係

- Initiative 機制不刪除，保留作為「輔助加入」（某 bot 被選為協調者後，其他 bot 仍可主動補充）
- Centralized selection 優先級高於 Initiative（先選協調者 → 若選中則不走 Initiative）
- 若 centralized selection 判斷「沒有 bot 適合回應」→ fallback 到 Initiative 機制

### 工作模式 vs 閒聊模式（設計備忘）

Centralized Selection 不應完全取代 Initiative。兩種情境需要相反的行為：

- **工作請求**（「幫我分析 X」「請大家報告」）→ 選 1 個 coordinator 統籌，其他人閉嘴等委派
- **閒聊**（「大家覺得怎樣」「今天天氣好」）→ 多 bot 自由參與，像真人群聊

設計方向：Centralized Selection 的 query 可回傳「不需指定一人，讓大家自由聊」→ fallback 到 Initiative。或在 query 中同時判斷訊息意圖（work vs chat）再分流。

### 實作時機

此改動屬於 **Tier 1.5**（介於 Tier 1 和 Tier 2 之間），可在驗證 Tier 1 並行委派穩定後立即進行。

---

## 已知限制

### Synthesis 不等子委派（Tier 1 設計取捨）

```
leader → 並行委派 coder + general
  coder 回覆「分析如下...@bot-x 請補充」→ processMessage return
    └─ bot:replied → bot-x 子委派（背景執行）
  general 回覆 → processMessage return
leader synthesis 開始 ← 此時 bot-x 可能還沒完成
```

- `executeParallelDelegation` 的 `Promise.allSettled()` 只等直接被委派 bot 的 `processMessage()` return
- 不追蹤子委派樹（bot:replied 觸發的後續委派是 fire-and-forget）
- Synthesis 拿到的是 coder 的回覆文字（含「@bot-x 請補充」），不是 bot-x 的結果
- bot-x 的回覆會獨立出現在群組中，使用者看得到，但不在 leader 的綜合裡

**解決方案（Tier 2）**：shared task list + dependency tracking，synthesis 等整棵委派樹完成再跑。

---

## 實測發現的缺口：協作失控防護

> 2026-02-06 基於 Tier 1 實測結果補充。原規畫聚焦「怎麼讓協作更強」，但實測暴露了「怎麼讓協作不失控」的問題。

### 問題 vs 規畫涵蓋度

| # | 實測觀察到的問題 | 原 Tier 涵蓋？ | 缺口說明 |
|---|-----------------|---------------|----------|
| G1 | **禮貌性 @mention → 非預期委派** | ❌ 無 | bot 回覆「感謝 @leader 的指派」觸發新委派鏈 |
| G2 | **Sub-delegation 未完成，synthesis 已跑** | ✅ Tier 2 | shared task list + dependency tracking |
| G3 | **多 bot Initiative 噪音** | ⚠️ Tier 1.5 部分 | 選了協調者後 Initiative 是否靜默？沒定義 |
| G4 | **Delegation 進行中，Initiative 對新訊息觸發** | ⚠️ Tier 2 間接 | task awareness 存在但 Initiative 要不要看 task list 沒定義 |
| G5 | **Bot 記憶寫入通知出現在群組** | ❌ 無 | prompt 層問題，不在架構規畫內 |
| G6 | **被委派 bot 回覆 @mention coordinator → 二次委派** | ❌ 同 G1 | 同「禮貌性 @mention」問題 |

### G1/G6：委派意圖判斷（Delegation Intent Detection）

**問題根因**：`detectDelegationTargets()` 只看「回覆裡有沒有 @mention」，無法區分：
- 「@coder 請分析這段程式碼」 → 有委派意圖
- 「感謝 @leader 的指派，以下是結果」 → 無委派意圖（禮貌性）
- 「@leader 我已完成」 → 無委派意圖（回報）

**解決方向**：

| 方案 | 說明 | 複雜度 | 準確度 |
|------|------|--------|--------|
| **A. 啟發式規則** | 回覆開頭/結尾的 @mention 不算委派；delegation 回覆中 @mention coordinator 不算委派 | 低 | 中 |
| **B. isDelegationResponse flag** | 被委派的 bot 回覆自動帶 flag，DelegationHandler 對帶 flag 的回覆不再掃描 @mention | 低 | 高（針對 G6） |
| **C. LLM 意圖判斷** | 用小模型判斷 @mention 是否有委派意圖 | 中 | 高 |
| **D. 混合** | B（系統層阻擋回報性 @mention）+ A（啟發式過濾禮貌性 @mention） | 低-中 | 高 |

**建議**：方案 D — 先用 B 解決最明確的 G6（delegation response 不再觸發委派），再用 A 的啟發式規則處理一般禮貌性 @mention。

**優先級**：🔴 高 — 這是目前最嚴重的 cascade 源。

### G3/G4：Initiative 與 Delegation 的狀態隔離

**問題根因**：Initiative 和 Delegation 是兩套獨立機制，互不感知。

- 場景 A：coordinator 已選定並開始委派 → Initiative 仍對同一訊息評估 → 額外 bot 回覆（噪音）
- 場景 B：delegation 進行中 → 使用者發新訊息 → Initiative 照常觸發 → 可能與進行中的委派衝突

**解決方向**：

| 方案 | 說明 | 複雜度 |
|------|------|--------|
| **A. Delegation 期間靜默 Initiative** | GroupBroadcaster 追蹤「chatId 有進行中的 delegation」→ 期間 Initiative 不觸發 | 低 |
| **B. Centralized Selection 取代 Initiative（Tier 1.5）** | 選了協調者就不走 Initiative | 中 |
| **C. Initiative 查 task list（Tier 2）** | Initiative 啟動前查 `team_tasks`，有進行中的任務就跳過 | 中 |

**建議**：方案 A 作為短期修復（在 GroupBroadcaster 加 delegation-in-progress 狀態），方案 B 作為中期替代。

**優先級**：🟡 中 — 產生噪音但不會造成迴圈。

### G5：群組噪音控制（Group Noise Control）

**問題根因**：bot 的 LLM 回覆中包含記憶寫入通知（如「📝 已記錄到 MEMORY.md」）、工具呼叫狀態更新等，這些在私聊有用但在群組是噪音。

**解決方向**：

| 方案 | 說明 | 複雜度 |
|------|------|--------|
| **A. Prompt 層指示** | 在群組 context injection 中加入「群組中不要回報記憶操作結果」 | 低 |
| **B. ContextInjector 群組模式** | 注入群組專用行為指示，包含噪音過濾規則 | 低 |
| **C. 回覆後處理** | MessageProcessor 在發送前過濾掉已知噪音 pattern | 中 |

**建議**：方案 A+B — 在 ContextInjector 的群組 context 中加入行為指示，零程式碼改動，靠 prompt 解決。

**優先級**：🟢 低 — 不影響功能，純粹使用者體驗。

### 修訂後的實作路線圖

```
Tier 1   ✅ 並行委派 + 結果收斂 + isSynthesis（已完成）
  │
  ├─ Tier 1.1  🔴 委派意圖判斷（G1/G6）
  │    └─ isDelegationResponse flag + 啟發式規則
  │
  ├─ Tier 1.2  🟡 Delegation 期間靜默 Initiative（G3/G4 短期）
  │    └─ GroupBroadcaster delegation-in-progress 狀態追蹤
  │
  ├─ Tier 1.3  🟢 群組噪音控制（G5）
  │    └─ ContextInjector 群組行為指示
  │
  ├─ Tier 1.5  協調者自動選擇（取代 Initiative 的 N 查詢）
  │
Tier 2   結構化任務感知（task list + dependency + 認領）
  │
Tier 3   進階協作（plan approval + delegate mode + quality hooks）
```

---

## 待解決問題

1. **成本控制**：並行 agent 的 token 消耗如何管理？
2. **`claude-agent-sdk` 是否暴露 team API**？如果有，可考慮整合
3. **Tier 2 時機**：何時從群組訊息感知升級到 DB-backed task list？
4. **Centralized Responder Selection 的 evaluator 設計**：用 haiku 壓成本？prompt 怎麼寫？
5. **isDelegationResponse flag 的傳遞路徑**：需要穿過 processMessage → emitBotRepliedEvent → bot:replied payload
6. **delegation-in-progress 狀態的生命週期**：何時開始、何時結束？parallel delegation 的 Promise.allSettled 完成算結束嗎？synthesis 完成才算？