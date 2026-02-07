# ADR-030: Agent Team Mode — 多 Agent 並行協作

**日期**：2026-02-06
**狀態**：📋 proposed（待討論）
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
- **Subagent**：在單一 session 內執行，只能回報給主 agent（單向、串行）
- **Teammate**：獨立 session，可以互相傳訊、挑戰彼此發現、自主協調（雙向、並行）

### 工具架構

| 工具 | 操作 | 說明 |
|------|------|------|
| **TeammateTool** | `spawnTeam` | 建立 team，產生 team 配置目錄 |
| | `cleanup` | 清理 team 資源 |
| **SendMessage** | `message` | 向特定 teammate 發送訊息 |
| | `broadcast` | 向所有 teammate 廣播 |
| | `shutdown_request` / `response` | 優雅關閉 teammate |
| | `plan_approval_response` | 回應 teammate 的計畫審批請求 |
| **TaskList** | 共享任務清單 | 所有 agent 可見，可認領、更新狀態 |

### 檔案結構

```
~/.claude/
├── teams/{team-name}/
│   ├── config.json          # team metadata、成員清單
│   └── messages/            # inter-agent mailbox（檔案系統）
└── tasks/{team-name}/       # team-scoped 共享任務
```

### 通訊機制

- **自動訊息傳遞**：teammate 發送的訊息自動送達收件者，lead 不需要輪詢
- **閒置通知**：teammate 完成工作後自動通知 lead
- **共享任務清單**：所有 agent 可以看到任務狀態並認領可用工作

### 顯示模式

- **In-process**（預設）：所有 teammate 在同一 terminal 內，Shift+Up/Down 切換
- **Split panes**：每個 teammate 獨立 terminal pane，需 tmux 或 iTerm2

### 最佳使用場景

1. **研究與審查**：多個 teammate 同時調查不同面向
2. **新模組/功能**：每個 teammate 負責一個獨立的部分
3. **競爭假說除錯**：多個 teammate 平行測試不同理論
4. **跨層協調**：前端、後端、測試各由不同 teammate 負責

### 已知限制

- Session resumption 不完整
- 不支援巢狀 team（team 裡的 team）
- 關閉行為有已知問題
- 仍為 experimental（需 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）

### 參考來源

- [Orchestrate teams of Claude Code sessions - 官方文檔](https://code.claude.com/docs/en/agent-teams)
- [Introducing Claude Opus 4.6 - Anthropic](https://www.anthropic.com/news/claude-opus-4-6)
- [Claude Code's Hidden Multi-Agent System - paddo.dev](https://paddo.dev/blog/claude-code-hidden-swarm/)
- [Building a C compiler with a team of parallel Claudes - Anthropic Engineering](https://www.anthropic.com/engineering/building-c-compiler)
- [Claude Code Swarms - Addy Osmani](https://addyosmani.com/blog/claude-code-agent-teams/)
- [Claude Code Agent Teams Setup Guide - marc0.dev](https://www.marc0.dev/en/blog/claude-code-agent-teams-multiple-ai-agents-working-in-parallel-setup-guide-1770317684454)

---

## ClaudeCab 現況盤點

### 通訊層：Telegram 群組 = Team 的通訊平台

ClaudeCab 的群組已經是 team mode 的基礎設施：

- **Telegram 群組**就是 agent 的通訊平台（≈ Claude Code 的檔案系統 mailbox）
- Bot 在群組中以平等的 **peers** 身份交流，不是「一個主 agent 管一堆下屬」
- 訊息是廣播式的（群組裡的所有 bot 都能看到），也支援 @mention 定向

**不需要另建「Agent Mailbox」**— Telegram 群組已經是 mailbox。

### 已有的協作元件

| 元件 | 現況 | 重新理解 |
|------|------|----------|
| **GroupBroadcaster** | 多 bot 在群組交流、路由、去重 | **已經是 team 通訊層** |
| **DelegationHandler** | 一個 bot 委託另一個做事 | 已有任務分派概念，但是串行的 |
| **Initiative** | Bot 主動發話 | Bot 可以主動參與，不只被動等 |
| **SDKQueryManager** | 並行 session 執行 | 底層已支援多 agent 同時運作 |
| **EventBus** | 事件驅動 | 可用於協調事件（任務完成、結果回報） |

### 核心差距

**群組收到一個複雜請求時，目前只有一個 bot 在跑，其他 bot 閒著。**

差三層：

| 層 | 說明 | 現況 |
|----|------|------|
| **並行觸發** | 一個訊息進來 → 拆成子任務 → 同時啟動多個 bot 的 SDK session | ❌ 一次只有一個 bot 處理 |
| **任務感知** | Bot 之間知道「誰在做什麼」，避免重工 | ❌ Bot 彼此不知道對方的工作狀態 |
| **收斂機制** | 所有人做完後，由某個角色綜合回覆 | ❌ 各自回覆，無人合併 |

---

## 關鍵架構決策（待討論）

### 1. ClaudeCab vs Claude Code 的根本差異

| | Claude Code Agent Teams | ClaudeCab |
|---|---|---|
| **Agent 本質** | 臨時 session，用完即棄 | 持久實體，有記憶、人格、角色 |
| **Team 定義** | 為特定任務臨時 spawn | **群組本身就是 team**，bot 是長期 peers |
| **通訊平台** | 檔案系統 mailbox | Telegram 群組 |
| **使用者可見性** | 在 terminal 看到過程 | 在 Telegram 群組看到過程 |
| **Lead** | 明確的一個 session | 待決定 |

核心洞察：**ClaudeCab 不需要 spawn team，team 已經存在（群組）。需要的是讓群組裡的 bot 更聰明地協作。**

### 2. 通訊：不需要新通道

Telegram 群組已經是通訊平台。不需要另建 Agent Mailbox。
使用者本來就在群組裡看到 bot 之間的交流，這是 feature 不是 bug。

問題不是「通訊通道」，而是**通訊的結構和品質**。

### 3. 並行 vs 串行

目前 delegation 是串行的。需要討論：
- **一對多委派**：一個 bot 同時請多個 bot 各做一部分
- **結果收集**：怎麼知道所有人都完成了？怎麼合併？
- **誰來綜合**？發起委派的那個 bot？還是讓每個 bot 直接回覆群組？

### 4. 任務感知

Bot 之間缺少「我們正在做什麼」的共享視圖：
- 是否需要 DB-backed 的 shared task list？
- 還是透過群組訊息本身就足夠（bot 讀到前文就知道大家在幹嘛）？
- Bot 能否主動認領未完成的任務？

### 5. 使用者角色

- 使用者在群組裡看得到整個協作過程（透明）
- 使用者可以隨時介入、糾正方向
- 這跟 Claude Code 的 team mode 不同 — Claude Code 的使用者需要切換 tab 看不同 agent

---

## 在現有基礎設施上的業務邏輯概念

基於「群組就是 team、Telegram 就是通訊平台」的前提，以下描述如何用現有元件填補三層差距。

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

**關鍵設計**：
- 協調者的選擇：就是 `shouldRespondToMessage` 決定的那個 bot（已有邏輯）
- 拆任務：由 bot 的 LLM 自行判斷（skill/protocol 裡教它怎麼判斷）
- 執行層：SDKQueryManager 已支援多 session 並行，不需改動

**與現有 delegation 的關係**：現有 delegation 是串行的一對一。需要擴充為「一對多扇出」，本質相同、只是並行化。

### Layer 2：任務感知 — Bot 之間知道「我們正在做什麼」

**現狀**：Bot 彼此不知道其他 bot 的工作狀態。

**概念**：

兩個層次的感知：

**a) 輕量級：群組訊息即感知**

協調者在群組裡公告任務分派：
```
Bot A：「收到，我來協調。任務分配：
  @BotB 負責市場分析
  @BotC 負責技術評估
  我負責財務模型
  各位完成後在群組回報。」
```
其他 bot 透過群組上下文就能知道誰在做什麼。**不需要額外基礎設施。**

**b) 結構化：DB-backed 任務追蹤（可選，Phase 2+）**

如果場景變複雜（多個並行任務交錯、需要持久化追蹤），可用 DB 記錄：
- `team_tasks` 表：task_id、group_id、initiator_bot_id、assignee_bot_id、description、status、result
- Bot 啟動 session 前查詢「這個群組有什麼進行中的任務？」避免重工
- 對標 Claude Code 的 TaskList 概念

**判斷**：Phase 1 先用群組訊息（零成本），如果不夠再加 DB。

### Layer 3：收斂機制 — 從「各自回覆」到「綜合回覆」

**現狀**：每個 bot 的回覆獨立發到群組，沒人合併。

**概念**：

**由協調者負責收斂。** 流程：

1. 協調者發出扇出委派後，進入「等待收集」狀態
2. 每個被委派的 bot 完成後，將結果回傳給協調者（透過群組回覆或 delegation response）
3. 協調者收到所有結果（或超時）後，啟動自己的 SDK session 做綜合
4. 綜合後在群組發出最終回覆

```
Bot B 完成 → 「@BotA 市場分析結果：...」
Bot C 完成 → 「@BotA 技術評估結果：...」
Bot A 自己完成財務模型
    ↓
Bot A：所有結果到齊 → 綜合
    ↓
Bot A：「綜合分析結果：
  📊 市場：...
  🔧 技術：...
  💰 財務：...
  📝 結論：...」
```

**關鍵設計**：
- **超時處理**：設定合理超時（如 5 分鐘），超時的任務標記為未完成，仍然綜合已有結果
- **回傳方式**：被委派 bot 用 @mention 協調者 → GroupBroadcaster 已支援路由
- **觸發綜合**：EventBus 監聽 `delegation:complete` 事件，全部到齊後觸發綜合

### 完整流程串接（以路徑 A 為例）

```
[使用者發訊息到群組]
        ↓
[GroupBroadcaster 路由] → shouldRespondToMessage → Bot A 回應
        ↓
[Bot A 的 SDK session 分析] → 判斷需要多 bot 協作
        ↓
[DelegationHandler.delegateToMultiple()]
    ├─ Bot B: SDKQueryManager.executeQuery(sessionB)
    ├─ Bot C: SDKQueryManager.executeQuery(sessionC)
    └─ Bot A: 自己繼續處理
        ↓ （並行執行）
[各 bot 完成 → 結果回傳到群組 @mention 協調者]
        ↓
[EventBus: all-delegations-complete]
        ↓
[Bot A 綜合 → 發出最終回覆]
```

### 需要修改 / 新增的元件

| 元件 | 修改內容 | 複雜度 |
|------|----------|--------|
| **DelegationHandler** | 新增 `delegateToMultiple()` — 並行發起多個委派，追蹤完成狀態 | 中 |
| **GroupBroadcaster** | 識別「delegation response」類型的訊息，路由給協調者 | 低 |
| **EventBus** | 新增事件：`delegation:started`、`delegation:complete`、`delegation:all-complete` | 低 |
| **Agent Skills / Protocols** | 教 bot 如何判斷「這個任務需要拆分」以及「如何綜合結果」 | 中（prompt 設計） |
| **SDKQueryManager** | **不需修改** — 已支援並行 session | — |
| **Telegram 群組** | **不需修改** — 已經是通訊平台 | — |

---

## 可能的實作路徑

### 路徑 A：強化現有群組協作（漸進式，推薦）

基於「群組就是 team」的認知，不另建通訊層，而是強化群組內的協作品質：

1. **Phase 1：並行委派** — DelegationHandler 支援一對多委派，同時請多個 bot 各做一部分
2. **Phase 2：共享任務感知** — 群組內的 bot 有結構化的方式知道「我們正在做什麼」（DB-backed 或群組訊息本身）
3. **Phase 3：結果收斂** — 發起者收集所有委派結果後綜合回覆

**優點**：複用現有 Telegram 通訊層，使用者可見整個過程
**影響範圍**：DelegationHandler、GroupBroadcaster、可能擴充 DB

### 路徑 B：混合 — 群組協作 + 背景並行

部分任務在群組裡公開協作（使用者可見），部分任務在背景並行執行（類似 ScheduleExecutor）：

- 簡單的協作 → 群組內 delegation（透明）
- 重型的並行任務 → 背景 SDKQueryManager 並行執行 → 結果匯入群組

**優點**：兼顧透明度和效率
**影響範圍**：需要 orchestrator 決定哪些走前台、哪些走背景

### 路徑 C：整合 Claude Code Agent Teams API

如果 `claude-agent-sdk` 暴露了 TeammateTool 相關 API，可以直接利用：

- ClaudeCab 的 bot 作為 Claude Code 的 team lead
- 子任務透過 Claude Code 原生 team 機制並行執行
- 結果回傳到 Telegram 群組

**優點**：省開發成本，用官方成熟機制
**前提**：需確認 SDK 支援程度

---

## 影響範圍（預估，路徑 A）

| 檔案 | 操作 |
|------|------|
| `src/groups/DelegationHandler.ts` | 修改：支援一對多並行委派 |
| `src/groups/GroupBroadcaster.ts` | 修改：支援結果收集與綜合 |
| `src/persistence/` | 可能新增：共享任務追蹤 |
| Agent skills / protocols | 修改：教 bot 如何主動認領任務 |

## 待解決問題

1. **並行委派的觸發**：bot 自己判斷何時需要並行？還是使用者指定？
2. **結果綜合的歸屬**：誰負責合併結果？發起者？還是群組裡自然收斂？
3. **任務感知的實作方式**：DB-backed task list vs 群組訊息上下文（bot 讀前文就知道）？
4. **成本控制**：並行 agent 的 token 消耗如何管理？
5. **`claude-agent-sdk` 是否暴露 team API**？如果有，路徑 C 可能最務實
6. **與現有 delegation 的關係**：是擴充 delegation 還是新建一個平行機制？
