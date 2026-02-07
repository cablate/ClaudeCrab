# ADR-030: Agent Team Mode — 多 Agent 並行協作

**日期**：2026-02-06
**狀態**：📋 proposed（待討論）
**關聯**：SDKQueryManager、GroupBroadcaster、DelegationHandler、ScheduleExecutor

## 背景

ClaudeCab 目前是一個功能完整的**單人多 agent Telegram bot 框架**，但不是一個 **agent 協作平台**。Agent 間的互動僅限於：

- **Delegation**（ADR-021/022）：串行委派 — 一個 agent 做不了的事交給另一個，透過 Telegram group
- **Initiative**（ADR-023）：agent 主動發話，但仍然是面向使用者
- **Group Broadcast**：多 agent 在同一 Telegram 群組交流，但是面向使用者的對話

缺少的是：**Agent 間直接通訊**和**並行任務協調**。

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

### 已有的（可複用）

| 元件 | 現況 | 與 Team Mode 的關係 |
|------|------|---------------------|
| **SDKQueryManager** | 可對任意 agent 發起獨立 session，已支援並行 | Teammate 執行基礎 |
| **DelegationHandler** | 一個 agent 委託另一個做事，走 Telegram | 串行委派概念，但不是並行協作 |
| **GroupBroadcaster** | 多 agent 在同一群組交流 | 面向使用者，不是 agent 間直接通訊 |
| **ScheduleExecutor** | 無使用者介入下驅動 agent 執行 | 證明 agent 可脫離使用者獨立運作 |
| **Session 管理** | SessionManager 管理對話狀態 | 可擴展支援 team session |
| **DB 持久化** | SQLite + Repository pattern | 可擴充 task table、message table |
| **EventBus** | 事件驅動架構 | 可用於 team 事件通知 |

### 缺少的

| 缺口 | 複雜度 | 說明 |
|------|--------|------|
| **Agent Mailbox** | 中 | Agent 間直接傳訊通道，不經 Telegram。可用 SQLite table 或記憶體 Map |
| **Team Lifecycle** | 中 | spawnTeam → assign tasks → coordinate → cleanup。需 TeamManager |
| **Shared Task System** | 低 | 擴充現有 DB：每個 task 有 owner、status、team scope |
| **Parallel Execution** | 低 | SDKQueryManager 已支援並行，缺的是 orchestrator 層 |
| **Team Lead Protocol** | 中 | Lead agent 需特殊 system prompt，告知 teammate 清單、分派方式、收集機制 |
| **結果綜合** | 低 | Lead 收到所有 teammate 結果後，產出最終回覆 |

---

## 關鍵架構決策（待討論）

### 1. ClaudeCab 的 Team Mode 服務誰？

- **Claude Code 的 team mode**：開發者在 terminal 裡看多個 agent 並行寫 code
- **ClaudeCab 的 team mode 可能是**：使用者在 Telegram 發一個訊息 → 背後多個 agent 協作 → 回覆一個綜合結果

```
User (Telegram) → Lead Agent
                    ├→ Teammate A (research)  ──→ mailbox → Lead
                    ├→ Teammate B (analysis)  ──→ mailbox → Lead
                    └→ Teammate C (writing)   ──→ mailbox → Lead
                  Lead synthesizes → Reply to User
```

這跟現有 delegation 的差異：delegation 是「我做不了，交給你」（**串行**），team mode 是「分頭做，一起交」（**並行**）。

### 2. 通訊通道選擇

| 方案 | 優點 | 缺點 |
|------|------|------|
| **SQLite mailbox** | 持久化、可查詢歷史 | 需要輪詢或事件通知 |
| **記憶體 Map + EventBus** | 低延遲、即時 | 重啟後消失 |
| **檔案系統**（Claude Code 做法） | 簡單、與 Claude Code 一致 | 需要 watch 或輪詢 |
| **複用 Telegram** | 零開發成本 | 使用者會看到 agent 間對話 |

### 3. Team Scope

- Team 是**臨時的**（為一個任務建立，完成後解散）還是**持久的**（固定的 agent 組合）？
- ClaudeCab 的 agent 是持久實體（有自己的記憶、人格），這跟 Claude Code 的臨時 teammate 不同

### 4. Lead 選擇

- 誰是 lead？使用者直接對話的那個 agent？還是系統自動選？
- 還是需要一個專門的 orchestrator（不是任何一個 agent）？

### 5. 使用者可見性

- 使用者看得到 team 運作過程嗎？還是只看到最終結果？
- 是否需要在 Telegram 顯示「正在協調 3 個 agent 處理你的請求...」？

---

## 可能的實作路徑

### 路徑 A：漸進式 — 先做 Agent Mailbox

1. **Phase 1**：Agent Mailbox（agent 間直接通訊，不走 Telegram）
2. **Phase 2**：Parallel Task Dispatch（一個 prompt 分拆多個子任務並行）
3. **Phase 3**：Team Orchestrator（完整 team lifecycle）

### 路徑 B：直接整合 Claude Code Agent Teams

如果 ClaudeCab 的 agent 本質上就是 Claude Code session，可能可以直接利用 Claude Code 的 TeammateTool？需要確認 `claude-agent-sdk` 是否暴露 team 相關 API。

### 路徑 C：Lightweight Coordination

不做完整 team mode，而是強化現有 delegation：
- 支援**一對多委派**（一個 agent 同時委派給多個 agent）
- 委派結果自動收集和綜合
- 本質上是把 delegation 從串行變並行

---

## 影響範圍（預估）

如果走路徑 A：

| 檔案 | 操作 |
|------|------|
| `src/core/AgentMailbox.ts` | 新增：agent 間訊息佇列 |
| `src/core/TeamManager.ts` | 新增：team 生命週期管理 |
| `src/persistence/TeamRepository.ts` | 新增：team + task DB 操作 |
| `src/core/SDKQueryManager.ts` | 修改：支援 team context 注入 |
| `src/adapters/BaseAdapter.ts` | 修改：支援並行任務觸發 |
| DB schema | 新增：teams, team_tasks, agent_messages tables |

## 待解決問題

1. ClaudeCab team mode 的實際使用場景是什麼？（vs 現有 delegation 的差異）
2. `claude-agent-sdk` 是否支援 team 相關 API？
3. Agent 間通訊的延遲容忍度？（即時 vs 非同步）
4. 成本控制：並行 agent 的 token 消耗如何管理？
5. 使用者觸發方式：自動偵測需要協作？手動指定？Telegram 指令？
