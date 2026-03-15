# Paperclip vs ClaudeCab 深度研究：總結 & 結論

> 研究日期：2026-03-14
> 研究範圍：Paperclip 全部原始碼 vs ClaudeCab 對應模組

---

## TL;DR

**結論：不需要捨棄 ClaudeCab。**

Paperclip 和 ClaudeCab 解決的是**不同問題**：

| | Paperclip | ClaudeCab |
|---|-----------|-----------|
| **定位** | 「零人公司」AI agent 編排平台 | 個人 AI 助理團隊 |
| **目標用戶** | 想用 AI 跑整間公司的人 | 想要一群 AI 助理幫忙日常工作的人 |
| **互動方式** | Web Dashboard | Telegram 對話 + Discord 公司辦公室 |
| **Agent 模型** | Agent = 員工（有職稱、上司、預算） | Agent = 工具人（各有專長，平等協作） |
| **核心循環** | Issue → Heartbeat → Execute → Report | Message → Process → Reply |
| **驅動方式** | Polling-based（heartbeat 打卡） | Event-driven（訊息觸發） |
| **DB** | PostgreSQL（36 tables） | SQLite（7 tables） |
| **代碼量** | ~50K+ 行 | ~15K 行 |

---

## Paperclip 的好用在哪？

### 真正的優勢
1. **Budget Hard Stop** — 超預算自動暫停，防止失控花費
2. **完整的執行審計** — 每次 heartbeat run 都有不可變記錄（contextSnapshot + sessionBefore/After + usage + log）
3. **Task-level Session** — 切換任務時自動切換 context，不會混雜
4. **Multi-runtime 支援** — Claude Code、Codex、Cursor、Gemini 通吃
5. **Config Versioning** — 每次改 agent 設定都有 before/after 快照，可 rollback
6. **Web Dashboard** — 即時監控所有 agent 的狀態和花費

### 設計上的問題
1. **`spentMonthlyCents` 不會自動重置** — 名字說「月度」，實際是累計
2. **2599 行的 heartbeat.ts** — 單檔案過於巨大，職責過多
3. **Polling overhead** — 即使沒有工作，agent 也要定時打卡
4. **36 表 schema** — 對很多場景來說過於沉重

---

## 多燒 Token 嗎？

### Paperclip 的 Token 消耗模式
- **Heartbeat 本身不燒 token** — 只是 DB 操作 + 子程序啟動
- **Token 消耗在 adapter execution** — 實際呼叫 Claude Code / Codex 時
- **Skills injection 會增加 system prompt 長度** — 但跟 ClaudeCab 的 CLAUDE.md + skills 差不多
- **Context snapshot 不進 LLM** — 只存 DB，不增加 token

### 比較
- **Paperclip 可能更省 token**：Task session resume 讓 agent 不需要每次重新理解 context
- **Paperclip 可能更費 token**：Goal alignment chain 注入 system prompt 增加了 input tokens
- **結論**：兩者差異不大。Token 消耗主要取決於任務本身，不取決於框架。

---

## ClaudeCab 的優勢

Paperclip 不具備但 ClaudeCab 已有的：

1. **深度 Skill 系統** — SKILL.md + references/ + 三層進化機制，遠超 Paperclip 的操作手冊級 skills
2. **Telegram 原生 UX** — 不需要開瀏覽器，手機隨時互動
3. **Permission Prompt UI** — 即時互動式授權（Telegram InlineKeyboard）
4. **Plan Mode** — 複雜操作先生成計畫，使用者審核
5. **Agent Call with Session Sharing** — Agent 間呼叫共用使用者 session，無割裂感
6. **Event-driven 架構** — 訊息驅動比 polling 更即時、更省資源
7. **輕量部署** — SQLite + 單 process，不需要 PostgreSQL
8. **Group Chat** — 多 agent 群組協作（Paperclip 沒有）

---

## 模組比對速覽

| 模組 | Paperclip | ClaudeCab | 差距 | 借鑑價值 |
|------|-----------|-----------|------|---------|
| 排程 | Heartbeat（2599 行） | ScheduleExecutor（231 行） | ⬛⬛⬛⬜⬜ | 🟡 中 |
| 成本 | Budget + Cost Events | QueryMetrics（追蹤不控管） | ⬛⬛⬛⬛⬜ | 🔴 高 |
| Session | 三層模型 | 單層模型 | ⬛⬛⬛⬜⬜ | 🟡 中 |
| 任務 | Issue System | 無（對話式） | ⬛⬛⬛⬛⬛ | 🟢 低 |
| Adapter | 9 種 runtime | 2 種平台 | 不同維度 | 🟢 低 |
| 組織 | Org Chart + Goals | 扁平 | ⬛⬛⬛⬛⬜ | 🟢 低 |
| 審計 | Activity Log + Config Versioning | Pino log | ⬛⬛⬛⬛⬜ | 🟡 中 |
| Skills | 操作手冊級 | 知識體系級 | ClaudeCab 勝 | N/A |
| DB | PostgreSQL（36 tables） | SQLite（7 tables） | 不同規模 | 🟢 低 |
| UI | Web Dashboard | Telegram 原生 | 不同路線 | 🟢 低 |

---

## 具體行動計畫

### 立即做（Phase 1，防線）
| # | 項目 | 預估時間 | 來源 |
|---|------|---------|------|
| 1 | Budget Hard Stop（預算上限 + 自動暫停） | 2-3h | Paperclip cost system |
| 2 | Execution Audit Log（結構化執行記錄） | 2-3h | Paperclip heartbeat_runs |
| 3 | Agent Call Depth Tracking（防無限迴圈） | 30min | Paperclip requestDepth |

### 近期做（Phase 2，可觀測性）
| # | 項目 | 預估時間 | 來源 |
|---|------|---------|------|
| 4 | Integer Cents 成本單位 | 1h | Paperclip costCents pattern |
| 5 | Cost Summary 增強（Admin 日報） | 1h | Paperclip cost dashboard |
| 6 | Structured Activity Events | 1.5h | Paperclip activity_log |

### 按需做（Phase 3，架構）
| # | 項目 | 預估時間 | 來源 |
|---|------|---------|------|
| 7 | Task-level Session | 2h | Paperclip agent_task_sessions |
| 8 | Config Change Tracking | 1.5h | Paperclip agent_config_revisions |
| 9 | Migration System | 2h | Paperclip Drizzle migrations |

### 不做
- Web Dashboard（Telegram 夠用）
- Multi-tenancy（個人工具不需要）
- Org Chart（扁平結構夠用）
- Atomic Checkout（無搶佔場景）
- Session Codec（單一 runtime）

---

## 最終評價

**Paperclip 是一個設計精良的 SaaS 平台**，適合「想用 AI 跑公司」的人。它的 36 表 schema、2599 行 heartbeat 引擎、9 種 adapter 支援、完整的審計系統，都展現了企業級的工程水準。

**但它跟 ClaudeCab 是不同賽道。**

ClaudeCab 的核心優勢是：
- **即時互動**（Telegram 對話 vs web dashboard 操作）
- **深度 skill**（知識體系 vs 操作手冊）
- **輕量部署**（SQLite + 單 process vs PostgreSQL + React + Express）
- **個人化**（一個人的 AI 團隊 vs 零人公司）

值得從 Paperclip 借鑑的是**安全網**（budget control + audit log）和**可觀測性**（structured events + cost summary），這些可以在不改變 ClaudeCab 核心架構的情況下增量添加。

**不要因為 Paperclip 有 22K stars 就覺得它一定更好。Stars 反映的是市場定位和行銷，不是技術優劣。**

---

## 📌 重要更新：Discord 載體重新分析（2026-03-14）

以 Discord Server 作為「公司辦公室」載體後，原報告 6 個「不做」項目中 **5 個翻盤為「做」**：

| 模組 | 原始判斷 | Discord 重新評估 |
|------|---------|-----------------|
| Issue/Ticket | 🟢 不做 | **🔴 做** — Forum Channel = 原生 ticket board |
| Approval Gate | 🟢 不做 | **🔴 做** — Button + Embed = 零摩擦審批 |
| Dashboard | 🟢 不做 | **🔴 做** — Embed = 免費 Dashboard |
| Org Chart | 🟢 不做 | **🟡 做** — Role + Category = 原生 org chart |
| Scheduling | 🟡 部分 | **🔴 做** — Discord 讓執行結果可視化 |

**詳見：**
- `12-discord-platform-reanalysis.md` — 逐模組重新分析
- `13-discord-architecture-blueprint.md` — 架構藍圖
- `14-discord-implementation-plan.md` — 落地實作計畫
