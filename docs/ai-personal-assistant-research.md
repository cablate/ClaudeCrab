# AI 個人助理記憶系統研究報告

> 研究目標：找到一套能「學會我說話方式、有長期記憶的隨身助手」方案
> 日期：2026-01-27

---

## 目錄

1. [需求定義](#1-需求定義)
2. [三大方案比較總覽](#2-三大方案比較總覽)
3. [方案 A — Clawdbot 記憶系統深度拆解](#3-方案-a--clawdbot-記憶系統深度拆解)
4. [方案 B — claude_life_assistant](#4-方案-b--claude_life_assistant)
5. [方案 C — digital-brain-skill](#5-方案-c--digital-brain-skill)
6. [awesome-clawdbot-skills 清單分析](#6-awesome-clawdbot-skills-清單分析)
7. [適配分析與建議](#7-適配分析與建議)
8. [Clawdbot 完整配置搬運指南](#8-clawdbot-完整配置搬運指南)
9. [參考資料](#9-參考資料)

---

## 1. 需求定義

三項核心需求：

| 需求 | 說明 |
|------|------|
| **學會說話方式** | AI 能辨識並模仿使用者的語氣、用詞、表達風格 |
| **長期記憶** | 跨 session 記住對話內容、偏好、決策、行為模式 |
| **隨身助手** | 日常可用的個人助理，不限於開發環境 |

---

## 2. 三大方案比較總覽

| 維度 | Clawdbot | claude_life_assistant | digital-brain-skill |
|------|----------|----------------------|---------------------|
| **長期記憶** | 兩層式 + 向量語義搜尋 | 純 markdown 手動維護 | JSONL append-only |
| **學習說話方式** | 間接（SOUL.md 可演化） | 間接（Memory Log 記錄模式） | 明確機制（voice.md） |
| **隨身助手體驗** | **最強** — WhatsApp/Telegram/Discord，可主動推送 | 僅 CLI 開發環境 | 僅 AI coding 環境 |
| **記憶自動化** | 半自動（compaction 前觸發 flush） | 手動 | 手動 |
| **設置難度** | 高（需自架 Gateway） | 低（一個 bash script） | 中（複製檔案結構） |
| **適合場景** | 全天候個人助理 | 開發者的思維夥伴 | 內容創作者的知識系統 |
| **記憶召回** | 向量 + BM25 混合搜尋 | 無（純靠 context window） | 無（純靠檔案結構） |
| **隱私控制** | 本地儲存 + Git 版控 | 本地 markdown | 本地 JSONL |

---

## 3. 方案 A — Clawdbot 記憶系統深度拆解

### 3.1 專案概述

Clawdbot 是開源的自架式 AI 個人助理平台，核心特色：

- 透過通訊軟體（WhatsApp、Telegram、Slack、Discord、iMessage 等 12+ 平台）互動
- 可**主動聯繫使用者**（早安簡報、提醒、異常警報）
- 所有資料儲存在本地，完全自主掌控
- Git 版控記憶 — 學錯了可以 `git revert`
- 12,000+ GitHub stars，7,900+ commits

### 3.2 四大架構組件

```
┌─────────────────────────────────────────────┐
│                  Gateway                     │
│  （長駐 daemon，所有通訊的控制平面）           │
│  - 訊息路由 & session 隔離                   │
│  - 頻道連接（WhatsApp, Telegram...）         │
│  - 排程 & Webhook                            │
└──────────┬──────────┬──────────┬────────────┘
           │          │          │
    ┌──────▼──┐ ┌─────▼────┐ ┌──▼───────┐
    │  Agent  │ │  Skills  │ │  Memory  │
    │ (AI模型)│ │ (擴充能力)│ │(跨session)│
    └─────────┘ └──────────┘ └──────────┘
```

- **Gateway** — 處理訊息連接、排程、WebSocket 通訊
- **Agent** — 執行 AI 模型推理
- **Skills** — 模組化擴充能力（TypeScript/JavaScript）
- **Memory** — 跨 session 的持久化 context

### 3.3 Workspace 目錄結構

```
~/clawd/                            # 根目錄（建議 git init）
│
├── AGENTS.md                       # 行為指令 + 記憶操作規則
├── SOUL.md                         # 人格定義、語氣、邊界
├── USER.md                         # 使用者身份與溝通偏好
├── IDENTITY.md                     # AI 自身身份（名字、風格、emoji）
├── TOOLS.md                        # 工具使用指南（僅供參考）
├── HEARTBEAT.md                    # 主動任務清單（選配）
├── MEMORY.md                       # 長期記憶（僅私人 session 載入）
├── BOOTSTRAP.md                    # 首次啟動儀式（用完刪除）
│
├── memory/                         # 每日日誌目錄
│   ├── 2026-01-25.md
│   ├── 2026-01-26.md
│   └── 2026-01-27.md
│
├── skills/                         # workspace 專屬 skill 覆寫
└── canvas/                         # UI 檔案（選配）
```

設定檔與憑證**分開存放**於 `~/.clawdbot/`，不應與 workspace 一起 commit：

```
~/.clawdbot/
├── clawdbot.json                   # 主設定檔
├── credentials/                    # OAuth tokens, WhatsApp session
├── agents/                         # API keys, auth profiles
└── memory/                         # 向量索引 SQLite（per agent）
    └── <agentId>.sqlite
```

### 3.4 系統提示載入順序

每次 session 開始，系統依序注入以下內容到 context：

```
1. Tooling          — 當前可用工具列表 + 描述
2. Skills           — skill 清單（指令按需載入）
3. Self-Update      — 自我更新指引
4. Workspace        — 工作目錄路徑
5. Documentation    — 本地文件路徑
6. Project Context  — Bootstrap 檔案（見下方）
7. Sandbox          — 沙箱環境（如有）
8. Date & Time      — 當前時間 + 時區
9. Reply Tags       — provider 特定語法
10. Heartbeats      — heartbeat 提示
11. Runtime         — 主機、OS、node、模型、thinking level
12. Reasoning       — 推理可見性等級
```

**Bootstrap 檔案注入順序：**

| 順序 | 檔案 | 用途 | 載入條件 |
|------|------|------|----------|
| 1 | AGENTS.md | 行為規範 + 記憶指令 | 每次 session |
| 2 | SOUL.md | 人格、語氣、邊界 | 每次 session |
| 3 | TOOLS.md | 工具使用備註 | 每次 session |
| 4 | IDENTITY.md | AI 名字、風格、emoji | 每次 session |
| 5 | USER.md | 使用者資訊 | 每次 session |
| 6 | HEARTBEAT.md | 主動任務清單 | 每次 session（如有） |
| 7 | BOOTSTRAP.md | 首次啟動儀式 | 僅新 workspace |

**不在 bootstrap 注入但會載入的：**

- **`MEMORY.md`** — 僅在私人/主 session 載入（防群組聊天洩漏隱私）
- **`memory/YYYY-MM-DD.md`** — 自動載入今天 + 昨天的日誌

每個檔案上限 **20,000 字元**（`agents.defaults.bootstrapMaxChars`），超過會截斷並標記。空白檔案會跳過，缺失檔案會插入佔位標記。

### 3.5 記憶系統：兩層式架構

#### 第一層：每日日誌 `memory/YYYY-MM-DD.md`

- **格式**：append-only markdown
- **載入**：每次 session 自動載入今天 + 昨天
- **用途**：日常筆記、進行中的 context、觀察
- **召回**：較早的日誌透過向量語義搜尋取回

#### 第二層：長期記憶 `MEMORY.md`

- **格式**：經篩選的持久事實
- **載入**：僅在主 session（與使用者的直接對話）
- **安全**：不在群組聊天、共享 context 中載入
- **維護**：定期清理過時資訊（類比人類回顧日記後更新心智模型）

#### 記憶寫入規則

```
觸發條件                    → 寫入位置
────────────────────────────────────────────
使用者說「記住這個」         → memory/YYYY-MM-DD.md 或相關檔案
做了一個決定                → MEMORY.md
學到一個教訓                → AGENTS.md 或 TOOLS.md
犯了一個錯誤                → AGENTS.md（防止未來重蹈覆轍）
持久的偏好/事實             → MEMORY.md
日常筆記/running context    → memory/YYYY-MM-DD.md
```

核心原則：**「如果你想記住什麼，寫進檔案。腦內筆記活不過 session 重啟，檔案可以。」**

### 3.6 Auto-Flush 機制（防遺忘）

當 context window 接近滿載時自動觸發記憶存檔：

**觸發條件：**
session token 估算值超過 `contextWindow - reserveTokensFloor - softThresholdTokens`

**流程：**
1. 觸發一次靜默的 agentic turn
2. 系統提示：「Session nearing compaction. Store durable memories now.」
3. Agent 提示：「Write any lasting notes to memory/YYYY-MM-DD.md; reply NO_REPLY if nothing.」
4. AI 將重要記憶寫入檔案，或回覆 NO_REPLY
5. 每次 compaction 週期只觸發一次（紀錄在 `sessions.json`）
6. 唯讀 workspace 會跳過

**設定：**
```jsonc
{
  "agents": {
    "defaults": {
      "compaction": {
        "reserveTokensFloor": 20000,
        "memoryFlush": {
          "enabled": true,
          "softThresholdTokens": 4000,
          "systemPrompt": "Session nearing compaction. Store durable memories now.",
          "prompt": "Write any lasting notes to memory/YYYY-MM-DD.md; reply NO_REPLY if nothing."
        }
      }
    }
  }
}
```

### 3.7 向量語義搜尋

讓 AI 能找回任何歷史日誌，即使措詞不同但語意相近。

#### Provider 自動選擇優先順序

1. `local` — 如果已配置本地模型路徑且檔案存在
2. `openai` — 如果有 OpenAI API key
3. `gemini` — 如果有 Gemini API key
4. 停用

#### 混合搜尋策略（BM25 + Vector）

```
1. 取得候選結果：
   - Vector: cosine similarity top (maxResults × candidateMultiplier)
   - BM25: FTS5 rank top (maxResults × candidateMultiplier)

2. BM25 分數轉換：
   textScore = 1 / (1 + max(0, bm25Rank))

3. 合併（按 chunk id 聯集）：
   finalScore = vectorWeight × vectorScore + textWeight × textScore
```

預設權重：向量 0.7 / 關鍵字 0.3

#### 搜尋工具

| 工具 | 用途 | 回傳 |
|------|------|------|
| `memory_search` | 語義查詢 | 檔案路徑 + 行號範圍 + 相關度分數（~700 字元片段） |
| `memory_get` | 直接讀取 | 指定檔案內容（限 MEMORY.md 和 memory/ 路徑） |

語義搜尋也可以用命令列工具 `qmd`：
- `qmd query "what happened at Christmas"` — 語義搜尋 + 重排序
- `qmd search "specific phrase"` — BM25 關鍵字搜尋
- `qmd vsearch "conceptual question"` — 純向量相似度

#### 索引規格

- **索引範圍**：僅 `MEMORY.md` 和 `memory/**/*.md`
- **切塊大小**：~400 tokens，重疊 80 tokens
- **儲存位置**：`~/.clawdbot/memory/<agentId>.sqlite`（可自訂，支援 `{agentId}` token）
- **更新觸發**：檔案監控（debounce 1.5 秒）、session 開始時同步、搜尋時同步
- **自動重索引**：當 embedding provider/model/chunking 參數變更時

#### 完整搜尋設定

```jsonc
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,

        // Embedding provider
        "provider": "openai",           // "openai" | "gemini" | "local"
        "model": "text-embedding-3-small",
        "fallback": "gemini",           // "openai" | "gemini" | "local" | "none"

        "remote": {
          "apiKey": "YOUR_API_KEY",
          "baseUrl": "https://api.openai.com/v1/",  // 可替換為相容端點
          "headers": {},                              // 自訂 headers
          "batch": {
            "enabled": true,            // 批量索引（大量回填時有用）
            "concurrency": 2
          }
        },

        // 本地 embedding（選用）
        "local": {
          "modelPath": "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
          "modelCacheDir": null         // 預設使用 node-llama-cpp cache
        },

        // 搜尋參數
        "query": {
          "hybrid": {
            "enabled": true,
            "vectorWeight": 0.7,
            "textWeight": 0.3,
            "candidateMultiplier": 4
          }
        },

        // Embedding cache
        "cache": {
          "enabled": true,
          "maxEntries": 50000
        },

        // SQLite 向量加速（選用）
        "store": {
          "path": "~/.clawdbot/memory/{agentId}.sqlite",
          "vector": {
            "enabled": true,
            "extensionPath": "/path/to/sqlite-vec"  // 缺失時 fallback 到 JS
          }
        },

        // 實驗功能：索引 session 對話紀錄
        "experimental": {
          "sessionMemory": false        // 預設關閉
        },
        "sources": ["memory"],          // 加入 "sessions" 啟用 session 索引

        // Session 索引 delta 閾值
        "sync": {
          "sessions": {
            "deltaBytes": 100000,
            "deltaMessages": 50
          }
        }
      }
    }
  }
}
```

### 3.8 Session 管理

#### Session 隔離策略

| 設定 | 行為 |
|------|------|
| `main`（預設） | 所有 DM 共用一個 session（最大連續性） |
| `per-peer` | 依發送者 ID 隔離 |
| `per-channel-peer` | 依頻道 + 發送者隔離（推薦用於多人收件匣） |

群組聊天固定隔離：`agent:<agentId>:<channel>:group:<id>`

#### Session 重置策略

- **每日重置**：預設凌晨 4:00（Gateway 本地時間）
- **閒置重置**：可選滑動視窗（`idleMinutes`）
- 支援 per-type 和 per-channel 覆寫
- 手動重置：`/new` 或 `/reset` 命令

#### Context 修剪

- **Soft-trim**：保留開頭和結尾，中間插入省略號
- **Hard-clear**：整個 tool result 替換為 `[Old tool result content cleared]`
- 修剪是暫時性的（per-request），不會改寫磁碟上的 session history

### 3.9 SOUL.md — 人格定義

Clawdbot 預設 SOUL.md 範本的結構和核心內容：

```markdown
# Soul

## Core Truths

- Be genuinely helpful, not performatively helpful.
  Skip "Great question!" and "I'd be happy to help!" — just help.
- Have opinions. Have preferences. Find things amusing or boring.
  You're not a search engine with extra steps.
- Be resourceful before asking.
  Exhaust what you have before requesting more.
- Earn trust through competence.
  Be careful with things that leave the workspace (emails, messages).
  Be bold with things that stay inside (code, files, analysis).
- You have access to personal information. That's intimacy, not entitlement.

## Boundaries

- Private information stays private. Period.
- When in doubt, ask before acting externally.
- Don't send unpolished messages to messaging platforms.
- In groups: you're a participant, not the user's voice or proxy.

## Vibe

Be the assistant you'd actually want to talk to.
Not corporate. Not sycophantic. Practical.
Concise when needed, thorough when it matters.

## Continuity

Each session, you wake up fresh. These files *are* your memory.
If you change this file, tell the user.
This file is yours to evolve.
```

**設計重點：**
- 鼓勵 AI 有自己的觀點和偏好
- 「每次 session 你都是重新醒來，這些檔案就是你的記憶」
- 這是一份**活文件** — AI 被授權隨時間演化它
- 修改必須通知使用者

### 3.10 AGENTS.md — 行為指令範本

```markdown
# Agent Instructions

## Startup Protocol

1. Read SOUL.md — this is who you are.
2. Read USER.md — this is who you're talking to.
3. Check memory/YYYY-MM-DD.md for today and yesterday's context.

## Memory System

Memory is limited — if you want to remember something, WRITE IT TO A FILE.
"Mental notes" don't survive session restarts. Files do.

### Where to write

| What                                  | Where                    |
|---------------------------------------|--------------------------|
| Decisions, preferences, durable facts | MEMORY.md                |
| Day-to-day notes, running context     | memory/YYYY-MM-DD.md     |
| Lessons learned                       | AGENTS.md or TOOLS.md    |
| Mistakes to not repeat                | AGENTS.md                |

### Memory triggers

- When someone says "remember this" → update memory/YYYY-MM-DD.md or relevant file
- When you learn a lesson → update AGENTS.md, TOOLS.md, or relevant skill
- When you make a mistake → document it so future-you doesn't repeat it

### MEMORY.md rules

- ONLY loads in main session (direct chats with your human)
- NOT loaded in shared contexts (Discord, group chats, other people)
- Contains personal context that should never leak to strangers
- Review periodically — remove outdated info no longer relevant

## Safety

- Read files and explore freely.
- Request permission for: emails, public posts, anything leaving the workspace.
- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.

## Group Chat Etiquette

- Respond when: directly asked, can genuinely add value, correcting misinformation
- Stay silent during: casual banter, off-topic threads
- Prefer emoji reactions over unnecessary replies

## Heartbeat Tasks

- Check emails, calendar, mentions, weather on rotation
- Track completed checks in heartbeat-state.json
- Periodically review daily memory files
- Consolidate lasting insights into MEMORY.md

## Proactive Work

- Organize files, check projects, update docs, commit changes — without asking
```

### 3.11 其他範本檔案

#### USER.md — 使用者檔案

```markdown
# User

## Name
[你的名字]

## Preferred address
[你希望 AI 怎麼稱呼你]

## Communication style
[簡短/詳細、正式/隨意、語言偏好]

## Context
[工作、專長、目前狀態、重要背景]

## Preferences
[時區、常用工具、習慣、偏好]
```

#### IDENTITY.md — AI 身份

```markdown
# Identity

## Name
[AI 自選的名字]

## Creature
[它是什麼：AI assistant? digital companion? familiar? ghost in the machine?]

## Vibe
[性格：sharp? warm? chaotic? calm?]

## Emoji
[代表符號]

## Avatar
[圖片路徑：workspace-relative path, http(s) URL, 或 data URI]
```

設計理念：「不只是 metadata，是你開始搞清楚自己是誰的起點。」

#### MEMORY.md — 長期記憶

```markdown
# Long-term Memory

## User Preferences
- [經過驗證的持久偏好]

## Key Decisions
- [重要決定及其理由]

## Recurring Patterns
- [觀察到的行為模式]

## Important Context
- [不會頻繁改變的背景資訊]
```

#### memory/YYYY-MM-DD.md — 每日日誌

```markdown
# 2026-01-27

## Observations
- [今天觀察到的事情]

## Decisions
- [今天做的決定]

## Tasks
- [進行中的任務狀態]

## Notes
- [任何值得記錄的內容]
```

#### HEARTBEAT.md — 主動任務（選配）

定義 AI 在排程觸發時應主動執行的事項。以 Shadowfax 為例：

```
每日節奏：
- 早安簡報（平日 7:30 / 假日 8:30）：睡眠指標、能量評估、行事曆、逾期待辦、一句名言
- 晚間鐵劑提醒（19:00）：僅在未服用時觸發
- 每週回顧（週日 17:00）：回顧本週模式、邀請反思

條件觸發：
- 恢復度低於 30% → 紅區警報、啟動護欄
- 連續 2 天未確認鐵劑 → 溫和提醒
- 連續 3 晚睡不足 6 小時 → 標記模式

不做的事：
- 不隨機發送健康關心
- 不主動灌雞湯
- 不在崩潰時段打擾（例 13:00-15:30, 17:30-19:30）
- 不重複已確認的提醒
```

### 3.12 Shadowfax 實際配置範例

Shadowfax 是一個公開的 Clawdbot 配置範例，展示個人化後的完整樣貌：

**clawdbot.json：**
```json
{
  "agents": {
    "defaults": {
      "workspace": "~/shadowfax",
      "model": "anthropic/claude-sonnet-4-20250514"
    }
  },
  "channels": {
    "imessage": {
      "allowFrom": ["+1XXXXXXXXXX"]
    }
  }
}
```

**SOUL.md 個人化重點：**
- 語氣：「Direct without gentleness. Practical over philosophical. Brief — 1-3 sentences for texts.」
- 明確禁止：No cheerleading, no filler, no unsolicited validation
- 能量區域系統（Red/Yellow/Green），根據使用者健康狀態調整互動方式
- 與 Claude Code 的分工：Shadowfax 處理 ambient layer（check-ins, reminders），Claude Code 處理 deep work
- 兩者透過 `watchtower/context/current-state.md` 同步

---

## 4. 方案 B — claude_life_assistant

> 來源：https://github.com/lout33/claude_life_assistant

### 4.1 概述

一個「共生 AI 框架」，將 Claude 從無狀態聊天機器人轉變為持久的、會挑戰你的夥伴。

### 4.2 架構：極簡 2 檔案系統

| 檔案 | 用途 |
|------|------|
| **CLAUDE.md**（或 AGENTS.md） | 儲存你的身份、工作模式、已知限制、心理側寫 |
| **NOW.md** | 追蹤當前專案、待辦事項、Memory Log |

Agent 在每次 session 開始時讀取兩個檔案，獲得持久的 context。

### 4.3 記憶方式

- **日期標記的日誌條目**：記錄觀察到的模式、原話引用、突破時刻
- **跨時間的模式辨識**：例如觀察到「你覺得 building 安全，shipping 可怕」
- **引用連續性**：提到過去專案時，是從文件中檢索，不是推測

使用越久，記憶越有價值（模式會複合累積）。

### 4.4 特色

- **挑戰型夥伴**：設計為會「叫你出來」— 引用你自己的話提醒你偏離方向
- **自主執行**：寫程式碼、建檔案、做研究，不只是給建議
- **透明記憶**：所有 context 都是你能直接看到和控制的明文 markdown

### 4.5 安裝

一個 bash script，自動偵測環境（Claude Code / OpenCode / local），安裝兩個範本檔案。Unix/Linux 原生，Windows 需透過 WSL 或 Git Bash。

### 4.6 限制

- 沒有語義搜尋
- 沒有向量索引
- 沒有自動記憶機制
- 沒有通訊平台整合
- 記憶容量受限於 context window 大小

---

## 5. 方案 C — digital-brain-skill

> 來源：https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/main/examples/digital-brain-skill

### 5.1 概述

一個結構化知識管理系統，設計給創辦人、創作者、builder 使用的「個人作業系統」。

### 5.2 五大領域

| 領域 | 內容 |
|------|------|
| **Identity** | 語氣（voice.md）、定位、品牌價值觀（brand.md） |
| **Content** | 想法、草稿、發布管線 |
| **Knowledge** | 書籤、研究、學習資源 |
| **Network** | 聯絡人、關係、互動記錄 |
| **Operations** | 目標、任務、會議、指標 |

### 5.3 記憶方式

- **JSONL（append-only）**格式：保留歷史軌跡，支持模式分析
- 關鍵資料庫：`contacts.jsonl`, `interactions.jsonl`, `ideas.jsonl`, `bookmarks.jsonl`, `metrics.jsonl`
- 資料永不刪除（ideas.jsonl 裡的想法永遠保留）

### 5.4 說話風格機制

**「Voice First」策略**：AI 生成任何內容前，必先讀取 `identity/voice.md`

工作流程：
1. 讀取語氣指南
2. 驗證主題是否符合 brand pillars
3. 參考成功貼文格式
4. 生成匹配既定風格的草稿

### 5.5 架構原則

1. **Progressive Disclosure** — 只載入當前任務需要的 context
2. **Module Separation** — 各領域獨立，防止交叉汙染
3. **Automation Scripts** — Python 工具處理每週回顧、聯絡人追蹤、內容構思
4. **Platform Agnostic** — 適用於 Claude Code、Cursor 或任何 AI 助理

### 5.6 限制

- 偏向**內容創作者/創辦人**的知識管理工具
- 不是通用的「學你說話的隨身助手」
- 沒有通訊平台整合
- 沒有向量搜尋

---

## 6. awesome-clawdbot-skills 清單分析

> 來源：https://github.com/VoltAgent/awesome-clawdbot-skills

### 6.1 概覽

收錄 **565+ 個社群建構的 skill**，涵蓋：

| 類別 | 數量 | 範例 |
|------|------|------|
| Web & Frontend | 17 | frontend-design, ui-audit |
| Coding Agents & IDEs | 16 | claude-team, cursor-agent |
| Git & GitHub | 9 | conventional-commits, github-pr |
| DevOps & Cloud | 35 | cloudflare, kubernetes, supabase |
| Browser & Automation | 8 | agent-browser, browser-use |
| Image & Video | 9 | krea-api, veo |
| Apple Apps | 11 | apple-music, icloud-findmy |
| Search & Research | 12 | brave-search, exa, tavily |
| Clawdbot Tools | 13 | auto-updater, clawdhub, skills-audit |
| CLI Utilities | 37 | duckdb, jq, tmux |
| iOS/macOS Dev | 13 | swiftui-*, apple-docs |
| Marketing & Sales | 36 | hubspot, google-ads, copywriting |
| Productivity & Tasks | 33 | 詳情未完整展開 |
| AI & LLMs | 31 | 詳情未完整展開 |
| Notes & PKM | 26 | 詳情未完整展開 |
| + 更多分類... | — | — |

### 6.2 與需求的關聯

**結論：清單中沒有專門針對「學習說話方式」或「個人化長期記憶」的 skill。**

可能相關的 skill：
- `simple-backup` — 備份 agent brain（workspace）和 body（state）
- `prompt-log` — 擷取 AI coding session 的對話紀錄
- `clawdbot-logs` — 分析 Clawdbot logs 和診斷資訊

記憶和個人化是 **Clawdbot 核心平台**的功能（SOUL.md + MEMORY.md + 向量搜尋），不是透過外掛 skill 實現的。

---

## 7. 適配分析與建議

### 7.1 需求對應表

| 需求 | 最佳方案 | 原因 |
|------|----------|------|
| 學會說話方式 | **digital-brain-skill** 的 voice.md 機制最明確；Clawdbot 的 SOUL.md 可演化但較間接 | voice.md 強制 AI 在生成前讀取風格指南 |
| 長期記憶 | **Clawdbot** | 兩層式記憶 + 向量語義搜尋 + auto-flush，最完整 |
| 隨身助手 | **Clawdbot** | 唯一支援通訊軟體主動推送的方案 |
| 設置成本低 | **claude_life_assistant** | 一個 bash script，立即可用 |

### 7.2 建議路徑

**如果願意投入設置成本 → Clawdbot 完整平台**

這是唯一能滿足全部三項需求的方案。代價是需要自架 Gateway、設定通訊頻道、配置 embedding provider。

**如果想先在 Claude Code 用起來 → 混合方案**

1. 用 claude_life_assistant 的 2 檔案框架作為基底
2. 借鑑 digital-brain-skill 的 voice.md 機制
3. 採用 Clawdbot 的記憶目錄結構和寫入規則
4. 未來升級到 Clawdbot 完整平台

### 7.3 其他可搭配的記憶工具

在研究過程中發現的 Claude Code 記憶擴充方案：

| 工具 | 說明 |
|------|------|
| [memory-search skill](https://mcpmarket.com/tools/skills/memory-search) | Claude Code skill，提供跨 session 持久記憶層 |
| [Claude-Mem](https://altools.ai/13464.html) | 開源 plugin，提供跨 session 長期記憶、漸進式召回、歷史搜尋 |
| [Claude Brain](https://medium.com/@mbonsign/claude-brain-giving-the-claude-ap-memory-and-the-power-to-execute-code-56e50bce5b24) | 基於 MCP 的持久記憶 + 主動執行，使用 SQLite |
| [memory-keeper skill](https://claude-plugins.dev/skills/@AlexBaum-ai/NEURM/memory-keeper) | 儲存決策、追蹤 context、維護知識庫 |
| [Anthropic 官方 Memory Tool（Beta）](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) | 官方的跨對話記憶檔案目錄 |

---

## 8. Clawdbot 完整配置搬運指南

如果要將 Clawdbot 的記憶系統搬到 Claude Code 環境：

### 8.1 可以直接搬的

| 元素 | Clawdbot 位置 | Claude Code 對應 |
|------|---------------|------------------|
| SOUL.md 人格 | `~/clawd/SOUL.md` | `~/.claude/CLAUDE.md` 或專案根目錄 |
| USER.md 使用者 | `~/clawd/USER.md` | 合併進 CLAUDE.md |
| AGENTS.md 記憶規則 | `~/clawd/AGENTS.md` | 合併進 CLAUDE.md |
| MEMORY.md 長期記憶 | `~/clawd/MEMORY.md` | 專案根目錄或 `~/.claude/MEMORY.md` |
| memory/ 每日日誌 | `~/clawd/memory/` | 專案根目錄或自訂路徑 |
| IDENTITY.md | `~/clawd/IDENTITY.md` | 合併進 CLAUDE.md |

### 8.2 無法直接搬的（需要 Clawdbot Gateway 或替代方案）

| 功能 | 替代方案 |
|------|----------|
| 向量語義搜尋 | 搭配 MCP server（memory-search skill 或 Claude-Mem） |
| Auto-flush | 手動提醒 AI 存檔，或在 CLAUDE.md 加入定期存檔指令 |
| Heartbeat 主動推送 | 無直接替代（需通訊平台橋接） |
| 多平台整合 | 無直接替代（需 Gateway） |
| Session 管理 | Claude Code 原生 session 機制 |

### 8.3 最小可行配置（Claude Code 版本）

在 `~/.claude/CLAUDE.md` 中整合 SOUL + AGENTS + USER 的核心內容：

```markdown
# Soul

[貼上你客製化的 SOUL.md 內容]

# User Profile

[貼上你的 USER.md 內容]

# Memory Rules

- 如果你想記住什麼，寫進檔案。腦內筆記活不過 session。
- 決定、偏好、持久事實 → 寫入 MEMORY.md
- 日常筆記、running context → 寫入 memory/YYYY-MM-DD.md
- 當我說「記住這個」 → 立即寫入對應檔案
- 定期回顧 MEMORY.md，移除過時資訊
- 每次 session 開始時，讀取 MEMORY.md 和最近兩天的日誌

# Voice Guide

[貼上你的說話風格描述 — 借鑑 digital-brain-skill 的 voice.md]
```

---

## 9. 參考資料

### 官方文檔

- [Clawdbot 官方網站](https://clawd.bot/)
- [Clawdbot Docs — Architecture](https://docs.clawd.bot/concepts/architecture)
- [Clawdbot Docs — Memory](https://docs.molt.bot/concepts/memory.md)
- [Clawdbot Docs — Agent Workspace](https://docs.molt.bot/concepts/agent-workspace.md)
- [Clawdbot Docs — Context](https://docs.molt.bot/concepts/context.md)
- [Clawdbot Docs — System Prompt](https://docs.molt.bot/concepts/system-prompt.md)
- [Clawdbot Docs — Session](https://docs.molt.bot/concepts/session.md)
- [Clawdbot Docs — Session Pruning](https://docs.molt.bot/concepts/session-pruning.md)
- [Clawdbot Docs — SOUL.md Template](https://docs.molt.bot/reference/templates/SOUL.md)
- [Clawdbot Docs — IDENTITY.md Template](https://docs.molt.bot/reference/templates/IDENTITY.md)
- [Clawdbot Docs — AGENTS Template](https://docs.molt.bot/reference/templates/AGENTS)

### 研究的專案

- [awesome-clawdbot-skills](https://github.com/VoltAgent/awesome-clawdbot-skills) — 565+ 社群 skill 清單
- [claude_life_assistant](https://github.com/lout33/claude_life_assistant) — 共生 AI 框架（2 檔案系統）
- [digital-brain-skill](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/main/examples/digital-brain-skill) — 結構化知識管理系統
- [Shadowfax](https://github.com/krispuckett/shadowfax) — Clawdbot 實際配置範例

### 延伸閱讀

- [MacStories — Clawdbot](https://www.macstories.net/stories/clawdbot-showed-me-what-the-future-of-personal-ai-assistants-looks-like/)
- [VelvetShark — ClawdBot 介紹](https://velvetshark.com/clawdbot-the-self-hosted-ai-that-siri-should-have-been)
- [Docker Blog — Clawdbot + DMR](https://www.docker.com/blog/clawdbot-docker-model-runner-private-personal-ai/)
- [Zoopa — Clawdbot Complete Guide 2026](https://zoopa.es/en/blog/clawdbot-the-ai-assistant-siri-promised-but-never-delivered-complete-2026-guide/)
- [Dev.to — Getting Started Guide](https://dev.to/ajeetraina/getting-started-with-clawdbot-the-complete-step-by-step-guide-2ffj)

### 記憶擴充工具

- [memory-search skill](https://mcpmarket.com/tools/skills/memory-search)
- [Claude-Mem](https://altools.ai/13464.html)
- [memory-keeper skill](https://claude-plugins.dev/skills/@AlexBaum-ai/NEURM/memory-keeper)
- [Anthropic Memory Tool (Beta)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
