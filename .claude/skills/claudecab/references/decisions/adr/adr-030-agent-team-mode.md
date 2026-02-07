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

### 真正缺少的

| 缺口 | 說明 |
|------|------|
| **並行委派** | Delegation 目前是串行的（A→B→回來），不支援「A 同時給 B 和 C 各分一部分」 |
| **共享任務感知** | Bot 之間不知道彼此在做什麼，沒有共享的 task list |
| **結果綜合** | 多個 bot 各自完成後，沒有人負責合併結果 |
| **主動認領** | Bot 不會看到「有待做的事」然後主動認領，只被動等 @mention 或 delegation |
| **協作品質** | 群組互動偏「輪流發言」，缺少結構化的分工和收斂 |

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
