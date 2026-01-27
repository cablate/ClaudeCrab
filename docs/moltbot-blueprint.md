# 個人 AI 助理：記憶系統設計藍圖

> 一份從需求出發、經過多方案研究、最終收斂到可執行架構的完整紀錄。
> 目標讀者：未來的自己，以及任何要接手這個規劃的 AI agent。
> 日期：2026-01-27

---

## 目錄

1. [我到底要什麼](#1-我到底要什麼)
2. [研究過程與方案篩選](#2-研究過程與方案篩選)
3. [Moltbot 專案全貌](#3-moltbot-專案全貌)
4. [選定方案：Moltbot 純檔案記憶架構](#4-選定方案moltbot-純檔案記憶架構)
5. [系統全貌：六個檔案如何協作](#5-系統全貌六個檔案如何協作)
6. [每個檔案的設計意圖與使用方式](#6-每個檔案的設計意圖與使用方式)
7. [記憶的生命週期：從產生到沉澱](#7-記憶的生命週期從產生到沉澱)
8. [這個系統刻意不做的事](#8-這個系統刻意不做的事)
9. [已知邊界與應對策略](#9-已知邊界與應對策略)
10. [安全性考量](#10-安全性考量)
11. [未來演進路徑](#11-未來演進路徑)
12. [參考資料](#12-參考資料)

---

## 1. 我到底要什麼

三個核心需求，按優先順序：

**一、長期記憶。** 跨 session 記住對話內容、我的偏好、做過的決策、觀察到的行為模式。不是每次都從零開始。

**二、學會我的說話方式。** 不只是「知道我喜歡什麼」，而是能辨識並逐漸貼近我的語氣、用詞習慣、表達節奏。

**三、隨身助手。** 日常可用的個人助理，理想上不限於開發環境，但可以先從 CLI 開始。

底層訴求是：**我想要一個越用越懂我的 AI，而不是一個每次見面都要重新自我介紹的陌生人。**

---

## 2. 研究過程與方案篩選

### 2.1 調查了什麼

研究了三個方向的方案：

| 方案 | 來源 | 核心思路 |
|------|------|----------|
| **Moltbot 記憶系統**（原 Clawdbot） | [官方文檔](https://docs.molt.bot/) + [awesome-clawdbot-skills](https://github.com/VoltAgent/awesome-clawdbot-skills)（565+ 社群 skill 清單） | 自架式 AI 助理平台，內建兩層記憶（markdown 檔案 + 向量語義搜尋），支援 13+ 通訊平台 |
| **claude_life_assistant** | [GitHub](https://github.com/lout33/claude_life_assistant) | 極簡 2 檔案系統（CLAUDE.md + NOW.md），把 Claude 變成會挑戰你的持久夥伴 |
| **digital-brain-skill** | [GitHub](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/main/examples/digital-brain-skill) | 結構化知識管理系統，五大領域（Identity/Content/Knowledge/Network/Operations），JSONL append-only |

### 2.2 為什麼淘汰另外兩個

**claude_life_assistant** — 概念好（挑戰型夥伴、引用你自己的話提醒你），但太簡陋。沒有記憶分層、沒有搜尋機制、沒有日誌結構。兩個 markdown 檔案撐不起長期使用。

**digital-brain-skill** — 「Voice First」機制（生成前必讀 voice.md）是三個方案裡對「學說話方式」最明確的設計。但整體偏向內容創作者的知識管理工具，不是通用個人助理。五大領域的架構對我來說太重了。

**Moltbot** — 記憶架構最完整，而且有一個關鍵的設計特性：**核心層（純檔案）和增強層（向量搜尋）是完全解耦的。** 這表示我可以只用最簡單的部分就跑起來，未來再按需加東西。

### 2.3 最終決定

採用 **Moltbot 的純檔案記憶架構**，不啟用向量語義搜尋和資料庫。

原因：

- 記憶系統的根基是「寫進檔案」，不是「搜尋技術」。官方自己說：*"the files are the source of truth; the model only 'remembers' what gets written to disk."*
- 向量搜尋解決的問題是「找回三天前以上的舊日誌」，但如果我維護好 MEMORY.md（定期把重要內容提煉進去），這個問題就被手動解決了
- 零外部依賴。不需要 API key、不需要 embedding model、不需要 SQLite。六個 markdown 檔案就是全部
- 向量搜尋是獨立的增強層，隨時可以後掛，不影響核心架構

---

## 3. Moltbot 專案全貌

> 這個章節記錄 Moltbot 這個專案本身的完整資訊：它是什麼、從哪來、怎麼運作、能做什麼、有什麼風險。
> 目的是讓未來的自己（或任何接手的人）不需要重新爬文就能理解全貌。

### 3.1 專案身世

**Moltbot**（原名 Clawdbot）是開源的自架式 AI 個人助理平台。

| 項目 | 說明 |
|------|------|
| 創建者 | Peter Steinberger（PSPDFKit 創辦人，奧地利開發者） |
| 起源 | 2025 年底，Steinberger 為自己打造的 AI 助手，角色是一隻太空龍蝦叫 Clawd |
| 開源時間 | 2025-11-24 |
| 改名時間 | 2026-01-27 |
| 現行名稱 | Moltbot（mascot: Molty） |
| GitHub | [github.com/moltbot/moltbot](https://github.com/moltbot/moltbot) |
| 官網 | [molt.bot](https://molt.bot/) |
| 文檔 | [docs.molt.bot](https://docs.molt.bot/) |
| 授權 | MIT |
| GitHub Stars | 65,000+（截至 2026-01） |
| Forks | 8,000+ |
| Commits | 8,195+ |
| 社群 | 8,900+ Discord 成員 |

**一句話定位：** 「The AI that actually does things」— 一個跑在你自己機器上、透過你已經在用的通訊軟體互動、有持久記憶、能主動行動的個人 AI 助理。

### 3.2 改名事件：Clawdbot → Moltbot

2026-01-27，Anthropic 對 Steinberger 發出商標請求，因為「Clawd」與「Claude」語音太像。Steinberger 接受了改名，新名字 Moltbot 取自龍蝦的「蛻殼」（molt）— 龍蝦透過蛻殼成長，專案也在蛻掉舊身份。

**改名對照：**

| 舊 | 新 |
|---|---|
| Clawdbot | Moltbot |
| Clawd | Molty |
| @clawdbot | @moltbot |
| clawd.bot | molt.bot |
| docs.clawd.bot | docs.molt.bot |

**改名事故：** Steinberger 同時改 GitHub organization 和 X/Twitter handle 時出了差錯 — 在釋出舊名和搶註新名的空隙中，加密貨幣詐騙者在**約 10 秒內**搶走了兩個舊帳號。假的 $CLAWD token 在 Solana 上一度達到 1600 萬美元市值，Steinberger 公開否認後暴跌。他聲明從未發行任何 token，也沒有計劃這麼做。

**現狀：** 專案以 Moltbot 名稱繼續運作，程式碼庫相同。部分文檔和 CLI 指令可能仍殘留 `clawdbot` 字樣（例如設定目錄仍為 `~/.clawdbot/`）。

### 3.3 系統需求與安裝

**最低需求：**

| 項目 | 需求 |
|------|------|
| Runtime | Node.js ≥ 22 |
| CPU | 1 核心 |
| RAM | 1 GB |
| Disk | 0.5 GB |
| OS | macOS / Linux / Windows (WSL2) |

**成本：** VPS 每月 $4-5（如果自架），加上 AI 模型費用 $20-200/月（依使用量）。也可以用 Docker Model Runner 在本地 GPU 跑免費模型。

**安裝方式：**

```bash
# 方法 1：一鍵安裝腳本（推薦）
curl -fsSL https://molt.bot/install.sh | bash

# 方法 2：Windows PowerShell
iwr -useb https://molt.bot/install.ps1 | iex

# 方法 3：手動 npm 安裝
npm install -g moltbot@latest
moltbot onboard --install-daemon

# 方法 4：從原始碼
git clone https://github.com/moltbot/moltbot.git
cd moltbot && pnpm install && pnpm ui:build && pnpm build
pnpm moltbot onboard --install-daemon
```

安裝後：
- `moltbot doctor` — 系統健康檢查
- `moltbot status` / `moltbot health` — Gateway 狀態
- `moltbot dashboard` — 開啟 Web 管理介面

**更新頻道：**

| 頻道 | 說明 | npm dist-tag |
|------|------|-------------|
| stable | 正式版（vYYYY.M.D） | `latest` |
| beta | 預覽版（vYYYY.M.D-beta.N） | `beta` |
| dev | main 分支最新 | `dev` |

切換：`moltbot update --channel stable|beta|dev`

### 3.4 完整架構

```
WhatsApp / Telegram / Slack / Discord / Google Chat / Signal /
iMessage / BlueBubbles / Microsoft Teams / Matrix / Zalo / WebChat
    │
    ▼
┌───────────────────────────────────────────┐
│            Gateway（控制平面）              │
│         ws://127.0.0.1:18789              │
│                                           │
│  - 訊息路由 & session 隔離                 │
│  - 頻道連接 & 事件處理                     │
│  - 排程（cron）& Webhook                  │
│  - 串流 & 分塊回覆                         │
│  - Typing indicators & 在線狀態            │
│  - 模型 failover                          │
└──────────┬────────────────────────────────┘
           │
    ┌──────┼──────┬──────────┬──────────┐
    │      │      │          │          │
    ▼      ▼      ▼          ▼          ▼
  Agent  Skills  Memory   Browser    Nodes
  (AI)   (擴充)  (持久化)  (瀏覽器)   (裝置)
```

**四大核心組件：**

| 組件 | 說明 |
|------|------|
| **Gateway** | 長駐 daemon，單一控制平面管理所有訊息表面、工具執行、客戶端連接。WebSocket API |
| **Agent** | AI 模型推理。支援 `provider/model` 格式（如 `anthropic/claude-opus-4-5`）。推薦 Anthropic Pro/Max + Opus 4.5（長 context 強度 + prompt injection 抗性） |
| **Skills** | 模組化擴充能力。TypeScript/JavaScript。可從 [ClawdHub](https://clawdhub.com) 搜尋安裝 |
| **Memory** | 純檔案記憶系統 + 可選的向量語義搜尋。詳見第 4-7 章 |

**Agent Loop（推理迴圈）：**

```
訊息進入
  │
  ▼
Entry & Validation → 驗證參數、解析 session、回傳 runId
  │
  ▼
Preparation → 解析模型、載入 skills、取得 session lock、組裝 system prompt
  │
  ▼
Inference & Execution → 模型推理 → 工具執行 → 串流回覆 → 持久化
  │
  ▼
Completion → lifecycle end/error event，回傳最終狀態 + 計時
```

關鍵機制：
- **序列化**：每個 session key 的 run 是序列化的，防止 tool/session race condition
- **Prompt 組裝**：遵守模型特定的限制和 compaction 保留 token 數
- **Reply Shaping**：過濾 `NO_REPLY` token、去除重複的 messaging tool output
- **Timeout**：Agent 預設 600 秒，`agent.wait` 預設 30 秒

### 3.5 支援的通訊平台（13+）

| 平台 | 底層技術 |
|------|----------|
| WhatsApp | Baileys |
| Telegram | grammY |
| Slack | Bolt |
| Discord | discord.js |
| Google Chat | — |
| Signal | signal-cli |
| iMessage | imsg |
| BlueBubbles | — |
| Microsoft Teams | — |
| Matrix | — |
| Zalo | — |
| Zalo Personal | — |
| WebChat | 內建 |

所有頻道支援群組路由、mention gating、reply tags、per-channel chunking。

### 3.6 完整功能清單

**核心功能：**
- Local-first Gateway（WebSocket 控制平面）
- 多頻道統一收件匣
- 持久記憶（markdown 檔案 + 可選向量搜尋）
- 多 Agent 路由（隔離的 workspace、session、auth）
- Voice Wake + Talk Mode（macOS/iOS/Android，ElevenLabs 整合）
- Live Canvas（Agent 驅動的視覺工作區）
- Cron 排程 + Webhook
- Gmail Pub/Sub（email 觸發自動化）

**工具 & 自動化：**
- Browser control（專屬 Chrome/Chromium，CDP 協議，快照、動作、上傳、profile 管理）
- Canvas（A2UI push/reset、eval、snapshot）
- Nodes（相機拍照/錄影、螢幕錄製、定位、通知）
- 50+ 整合（Spotify、Obsidian、GitHub、Gmail、Twitter 等）

**Companion Apps：**
- **macOS App** — Menu bar 控制、Voice Wake、PTT overlay、WebChat、debug 工具、遠端 Gateway 控制
- **iOS Node** — Canvas、Voice Wake、Talk Mode、相機、螢幕錄製、Bonjour 配對
- **Android Node** — Canvas、Talk Mode、相機、螢幕錄製、選配 SMS
- **macOS Node Mode** — system.run/notify + canvas/camera 暴露

**Chat Commands（在通訊軟體中可用）：**

| 指令 | 功能 |
|------|------|
| `/status` | Session 狀態（模型 + token 數 + 費用） |
| `/new` 或 `/reset` | 重置 session |
| `/compact` | 壓縮 session context（摘要） |
| `/think <level>` | 調整思考深度：off/minimal/low/medium/high/xhigh |
| `/verbose on\|off` | 詳細模式 |
| `/usage off\|tokens\|full` | 每次回覆的用量報告 |
| `/restart` | 重啟 Gateway（群組中僅 owner） |
| `/activation mention\|always` | 群組觸發模式 |

### 3.7 多 Agent 路由

一個 Gateway 可以運行多個完全隔離的 AI Agent：

```
Gateway
  │
  ├─ Agent A（個人助理）── workspace A ── sessions A ── auth A
  │    路由：WhatsApp DM from +886...
  │
  ├─ Agent B（工作助手）── workspace B ── sessions B ── auth B
  │    路由：Slack #work-channel
  │
  └─ Agent C（Discord bot）── workspace C ── sessions C ── auth C
       路由：Discord guild 12345
```

每個 Agent 有：
- 獨立的 workspace（各自的 AGENTS.md、SOUL.md、MEMORY.md）
- 獨立的 state directory（`~/.clawdbot/agents/<agentId>/agent`）
- 獨立的 session 儲存（`~/.clawdbot/agents/<agentId>/sessions`）
- 獨立的 auth profiles

路由優先順序：specific peer → guild/team ID → account ID → channel → default fallback。

Agent 間預設完全隔離。如需跨 Agent 溝通，可透過 `agentToAgent` 工具或 `sessions_send` 跨 session 訊息。

### 3.8 DM 安全策略

| 策略 | 說明 |
|------|------|
| `dmPolicy="pairing"`（預設） | 未知發送者收到配對碼，bot 不處理訊息 |
| 手動核准 | `moltbot pairing approve <channel> <code>` 加入白名單 |
| 公開入站 | 需要明確 opt-in：`dmPolicy="open"` + `"*"` in allowlist |

`moltbot doctor` 可以掃描危險/誤設的 DM 策略。

### 3.9 遠端存取

Gateway 可以跑在小型 Linux VPS 上，客戶端透過以下方式連接：

| 方式 | 說明 |
|------|------|
| Tailscale Serve | Tailnet 內部 HTTPS（用 Tailscale identity headers） |
| Tailscale Funnel | 公開 HTTPS（需設定密碼 auth） |
| SSH Tunnel | 傳統 SSH 通道 |

裝置 Node（macOS/iOS/Android）透過 `node.invoke` 單獨配對，執行裝置本地操作。

### 3.10 設定結構

**主設定檔：** `~/.clawdbot/moltbot.json`（設定目錄仍名為 `.clawdbot`）

```jsonc
{
  "agents": {
    "defaults": {
      "workspace": "~/clawd",
      "model": "anthropic/claude-opus-4-5",
      // 記憶、搜尋、compaction 設定（見第 4 章）
    }
  },
  "channels": {
    "whatsapp": {
      "allowFrom": ["+886XXXXXXXXX"]
    },
    "telegram": { /* ... */ },
    "imessage": { /* ... */ }
  }
}
```

**目錄結構（完整）：**

```
~/.clawdbot/                        # 設定 & 憑證（不要 commit）
├── moltbot.json                    # 主設定檔
├── credentials/                    # OAuth tokens, WhatsApp session
├── agents/                         # per-agent 目錄
│   └── <agentId>/
│       ├── agent/                  # agent state
│       ├── sessions/               # session transcripts (*.jsonl)
│       └── auth-profiles.json      # per-agent credentials
└── memory/                         # 向量索引
    └── <agentId>.sqlite            # embedding 索引 SQLite

~/clawd/                            # workspace（可 Git 版控）
├── AGENTS.md
├── SOUL.md
├── USER.md
├── IDENTITY.md
├── TOOLS.md
├── HEARTBEAT.md
├── MEMORY.md
├── BOOTSTRAP.md
├── memory/
│   └── YYYY-MM-DD.md
├── skills/                         # workspace-specific skill 覆寫
└── canvas/                         # UI 檔案
```

---

## 4. 選定方案：Moltbot 純檔案記憶架構

### 4.1 架構定位

這套系統借鑑了 Moltbot 的記憶設計，但**只取核心層**：

```
Moltbot 完整架構                      我要用的
──────────────────                    ────────────
Gateway（長駐 daemon）                ✗ 不用
通訊平台橋接（WhatsApp 等 13+）       ✗ 不用
Agent 模型推理 + Agent Loop           ✗ 不用（用 Claude Code 自帶的）
Skills 擴充系統 + ClawdHub            ✗ 不用
Voice Wake + Talk Mode               ✗ 不用
Browser control                      ✗ 不用
Canvas + Nodes                       ✗ 不用
向量語義搜尋（SQLite + Embeddings）    ✗ 暫不用（未來可加）
Auto-flush（compaction 前自動存檔）    △ 用指令模擬
多 Agent 路由                         ✗ 暫不用（未來可加）
純檔案記憶系統                        ✓ 完整採用
Bootstrap 載入機制                    ✓ 用 CLAUDE.md 模擬
```

### 4.2 Workspace 目錄結構

```
~/clawd/                             # workspace 根目錄
│
├── SOUL.md                          # 人格定義：我是誰、怎麼說話、什麼不做
├── AGENTS.md                        # 行為手冊：記憶規則、啟動流程、安全邊界
├── USER.md                          # 使用者檔案：你是誰、偏好、背景
├── IDENTITY.md                      # AI 身份：名字、風格、emoji
├── MEMORY.md                        # 長期記憶：篩選過的持久事實（手動策展）
│
└── memory/                          # 每日日誌
    ├── 2026-01-25.md
    ├── 2026-01-26.md
    └── 2026-01-27.md
```

六個檔案 + 一個目錄。零依賴。Git 版控。

### 4.3 系統提示載入順序（Moltbot 原始設計）

在完整的 Moltbot 中，每次 session 開始時系統依序注入：

```
 1. Tooling          — 當前可用工具列表 + 描述
 2. Skills           — skill 清單（指令按需載入）
 3. Self-Update      — 自我更新指引
 4. Workspace        — 工作目錄路徑
 5. Documentation    — 本地文件路徑
 6. Project Context  — Bootstrap 檔案（下方表格）
 7. Sandbox          — 沙箱環境（如有）
 8. Date & Time      — 當前時間 + 時區
 9. Reply Tags       — provider 特定語法
10. Heartbeats       — heartbeat 提示
11. Runtime          — 主機、OS、node、模型、thinking level
12. Reasoning        — 推理可見性等級
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

每個檔案上限 **20,000 字元**（`agents.defaults.bootstrapMaxChars`），超過會截斷並標記。空白檔案跳過，缺失檔案插入佔位標記。

**Prompt Mode：**

| 模式 | 包含內容 | 使用場景 |
|------|----------|----------|
| `full` | 所有 12 個區段 | 主 session |
| `minimal` | 省略 Skills、Self-Update、Reply Tags、Heartbeats | sub-agent |
| `none` | 僅 identity 行 | 最輕量 |

---

## 5. 系統全貌：六個檔案如何協作

### 5.1 角色分工

```
                 ┌──────────┐
                 │ SOUL.md  │  ← 人格基底（穩定，緩慢演化）
                 └────┬─────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
   ┌─────▼────┐ ┌────▼─────┐ ┌───▼──────┐
   │AGENTS.md │ │ USER.md  │ │IDENTITY.md│
   │行為規則   │ │使用者資料 │ │ AI 身份   │
   └─────┬────┘ └──────────┘ └──────────┘
         │
         │ 規則驅動記憶讀寫
         │
   ┌─────▼──────────────────────────┐
   │         記憶儲存層              │
   │                                │
   │  MEMORY.md     memory/今天.md  │
   │  (長期事實)    (當日 context)   │
   │                memory/昨天.md  │
   │                (前日 context)   │
   └────────────────────────────────┘
```

### 5.2 每次 session 的載入流程

AI 每次「醒來」時看到的東西，依序：

```
1. AGENTS.md    → 知道自己該遵守什麼規則、怎麼操作記憶
2. SOUL.md      → 知道自己是什麼樣的存在、怎麼說話
3. IDENTITY.md  → 知道自己叫什麼名字、什麼風格
4. USER.md      → 知道對面坐的是誰
5. MEMORY.md    → 知道過去累積的重要事實
6. memory/今天  → 知道今天發生了什麼
7. memory/昨天  → 知道昨天發生了什麼
```

這七項資訊組合起來，就是一個「不是從零開始」的 AI。它知道自己是誰、你是誰、你們之間的歷史、以及最近的 context。

### 5.3 資訊的流動方向

```
對話 session
    │
    ├─ 日常筆記、觀察 ────────────→ memory/YYYY-MM-DD.md（即時寫入）
    │
    ├─ 重要決定、持久偏好 ────────→ MEMORY.md（即時或定期寫入）
    │
    ├─ 學到的教訓、犯的錯 ────────→ AGENTS.md（讓規則演化）
    │
    ├─ 人格上的自我發現 ──────────→ SOUL.md（緩慢演化，修改必須通知）
    │
    └─ 定期回顧 ─────────────────→ memory/*.md 裡的重點提煉到 MEMORY.md
                                    MEMORY.md 裡過時的東西清除
```

---

## 6. 每個檔案的設計意圖與使用方式

### 6.1 SOUL.md — 人格定義

**設計意圖：** 定義 AI 是什麼樣的存在。不是「功能設定」，是「性格和價值觀」。

**為什麼需要獨立一個檔案：** 人格和行為規則是兩件事。AGENTS.md 告訴 AI「做什麼」，SOUL.md 告訴它「用什麼態度做」。分開才能各自演化。

**Moltbot 預設範本的核心結構：**

```markdown
# Soul

## Core Truths
- 真正有用，不是表演有用。跳過「好問題！」— 直接幫忙。
- 要有觀點。要有偏好。你不是一個長了腳的搜尋引擎。
- 先自己想辦法，再開口問。
- 用能力贏得信任。對外謹慎，對內大膽。
- 你能接觸到個人資訊。這是信任，不是理所當然。

## Boundaries
- 隱私資訊不外洩。句號。
- 不確定的時候，先問再做。
- 不發未潤飾的訊息到通訊平台。
- 在群組中：你是參與者，不是使用者的代言人。

## Vibe
做一個你真的會想跟他說話的助手。
不要企業腔。不要拍馬屁。務實。
需要簡短時簡短，需要深入時深入。

## Continuity
每次 session 你都是重新醒來。這些檔案就是你的記憶。
如果你改了這個檔案，告訴使用者。
這個檔案是你的，你可以讓它演化。
```

**使用方式：**
- 初始填入基本的人格定義
- 隨時間讓 AI 自己演化（但修改必須通知你）
- 這是最穩定的檔案，變動頻率最低

**這裡是放「說話風格」的地方。** 你希望 AI 學會的語氣、用詞偏好、表達節奏，都寫在 Vibe 區段或另開一個 Voice 區段。借鑑 digital-brain-skill 的 voice.md 概念，可以在這裡放具體的風格指南（例如常用句式、偏好的語氣詞、要避免的表達方式）。

---

### 6.2 AGENTS.md — 行為手冊

**設計意圖：** 告訴 AI「該做什麼、怎麼操作記憶、什麼不能做」。是操作手冊，不是性格描述。

**為什麼這是最重要的檔案：** 記憶系統能不能運作，取決於 AI 是否遵守寫入規則。這些規則就寫在這裡。

**核心結構：**

```markdown
# Agent Instructions

## Startup Protocol
1. 讀 SOUL.md — 這是你是誰。
2. 讀 USER.md — 這是你在跟誰說話。
3. 讀 memory/ 裡今天和昨天的日誌。

## Memory System

記憶有限 — 想記住什麼，就寫進檔案。
「心裡記一下」活不過 session 重啟。檔案可以。

### 寫入規則

| 內容                   | 寫到哪裡               |
|------------------------|------------------------|
| 決定、偏好、持久事實    | MEMORY.md              |
| 日常筆記、進行中 context| memory/YYYY-MM-DD.md   |
| 學到的教訓             | AGENTS.md 或 TOOLS.md  |
| 犯過的錯               | AGENTS.md              |

### 觸發條件
- 使用者說「記住這個」→ 立即寫入對應檔案
- 學到教訓 → 更新 AGENTS.md
- 犯了錯 → 記錄下來，防止未來重蹈覆轍

### MEMORY.md 管理
- 定期回顧每日日誌，把重點提煉進 MEMORY.md
- 清除過時的資訊
- 這就像人類回顧日記後更新心智模型

## Safety
- 讀檔案、探索目錄：自由。
- 發郵件、公開發文、任何離開 workspace 的動作：先問。
- 不洩漏隱私資料。永遠不。
```

**使用方式：**
- 這是 AI 的「工作手冊」，要寫得像給新員工的 onboarding 文件
- 教訓和錯誤會持續累積到這個檔案裡（AI 自己寫或你指示它寫）
- 變動頻率中等 — 隨著使用經驗累積，規則會越來越精準

---

### 6.3 USER.md — 使用者檔案

**設計意圖：** 讓 AI 知道它在跟誰說話。不是對話記錄，是你的「身份證」。

```markdown
# User

## Name
[你的名字]

## Preferred address
[你希望被怎麼稱呼]

## Communication style
[你的溝通偏好：語言、詳細度、正式程度]

## Context
[你的工作、專長、目前的生活/工作狀態]

## Preferences
[時區、常用工具、習慣、地雷]
```

**使用方式：** 初始填好，狀態變了就更新。變動頻率低。

---

### 6.4 IDENTITY.md — AI 身份

**設計意圖：** 讓 AI 有「自我感」。不只是功能，是一個有名字、有風格的存在。

```markdown
# Identity

## Name
[AI 自選的名字]

## Creature
[它是什麼：AI? digital companion? familiar? ghost in the machine?]

## Vibe
[性格形容詞：sharp? warm? calm? chaotic?]

## Emoji
[代表符號]
```

Moltbot 的設計理念：「這不只是 metadata，是你開始搞清楚自己是誰的起點。」

**使用方式：** 可在首次啟動時讓 AI 自己填，或直接定義。變動頻率極低。

---

### 6.5 MEMORY.md — 長期記憶

**設計意圖：** 經過篩選的持久事實。不是流水帳，是精華。

```markdown
# Long-term Memory

## User Preferences
- [驗證過的持久偏好]

## Key Decisions
- [重要決定及理由]

## Recurring Patterns
- [觀察到的行為模式]

## Important Context
- [不常變動的背景資訊]
```

**這個檔案是整個系統的記憶核心。** 在不使用向量搜尋的情況下，它就是 AI 對你的全部「長期理解」。

**使用方式：**
- 重要的事情即時寫入
- 定期把每日日誌的重點提煉到這裡
- 定期清理過時資訊 — 不是越多越好，是越精準越好
- 上限 20,000 字元，膨脹了就精簡

**為什麼要手動策展而不是自動累積：** 自動累積 = 雜訊越來越多。手動策展 = 只留真正重要的東西。Moltbot 的比喻是「人類回顧日記後更新心智模型」— 你不會把每天寫的日記全文背下來，你會記住重要的事、忘掉不重要的。MEMORY.md 就是這個「更新後的心智模型」。

---

### 6.6 memory/YYYY-MM-DD.md — 每日日誌

**設計意圖：** 當天的 running context。append-only，低門檻，什麼都可以記。

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

**使用方式：**
- AI 在對話中隨時 append 內容
- 每次 session 自動載入今天 + 昨天的日誌
- 三天前以上的日誌不會自動載入（這就是向量搜尋要解決的問題，但 MEMORY.md 策展機制可以替代）
- 不需要結構化 — 自由記錄就好

---

## 7. 記憶的生命週期：從產生到沉澱

一段資訊在這個系統裡的典型旅程：

```
第 1 天：對話中提到「我比較喜歡用繁體中文」
         │
         ▼
  memory/2026-01-27.md 記錄：
  「使用者表示偏好繁體中文」
         │
         │ （當天或隔天）
         ▼
  MEMORY.md 寫入：
  「## User Preferences
   - 語言偏好：繁體中文」
         │
         │ （往後每次 session）
         ▼
  AI 看到 MEMORY.md，知道要用繁體中文
  memory/2026-01-27.md 裡的那條記錄已經完成使命
```

另一個例子 — 教訓的生命週期：

```
第 1 天：AI 不小心用了簡體中文回覆
         │
         ▼
  使用者糾正。AI 記錄到 memory/今天.md
         │
         ▼
  AI 在 AGENTS.md 加入規則：
  「回覆一律使用繁體中文，不使用簡體」
         │
         │ （往後每次 session）
         ▼
  AI 讀到 AGENTS.md 的規則，不再犯同樣的錯
```

再一個 — 模式辨識：

```
第 1-30 天：AI 在每日日誌中多次記錄到
  「使用者在下午容易焦慮」
  「使用者提到晚上比較有創造力」
  「使用者又在下午說要放棄某個計畫」
         │
         ▼
  定期回顧時，AI 提煉到 MEMORY.md：
  「## Recurring Patterns
   - 下午容易焦慮、衝動決策；晚上創造力和判斷力較好
   - 下午提出的『放棄計畫』傾向通常不是最終決定」
         │
         ▼
  往後 AI 在下午對話時會意識到這個模式
  可以選擇提醒、或調整回應方式
```

**這就是「越用越懂你」的機制。** 不是黑箱的機器學習，是透明的、你能看到和修改的文字檔案在累積理解。

---

## 8. 這個系統刻意不做的事

理解系統「不做什麼」跟理解它「做什麼」一樣重要：

### 8.1 不自動錄製所有對話

記憶寫入需要明確觸發（使用者要求、AI 判斷值得記錄）。這是 Moltbot 的刻意設計，官方承認這個機制「is still evolving」。

**為什麼：** 自動錄製 = 大量雜訊。有意識地選擇記什麼 = 記憶品質高。代價是偶爾會漏記，但漏記比記太多好。

### 8.2 不在群組 context 載入隱私

MEMORY.md 只在私人 session 載入。群組聊天看不到你的個人記憶。

**為什麼：** MEMORY.md 可能包含「我最近在找工作」「我跟某人吵架了」這類資訊，不應該在群組聊天中洩漏。

### 8.3 不讓 AI 擅自對外行動

讀檔案、分析資料 = 自由。發郵件、發訊息、公開發文 = 必須先問。

**為什麼：** 對內犯錯可以撤銷，對外犯錯不能。

### 8.4 不追求記憶的完整性

MEMORY.md 主動清理過時資訊。每日日誌老了就不載入。

**為什麼：** 記憶的價值不在「量」，在「精準」。人類也會忘事，但忘掉不重要的事是一種能力。

---

## 9. 已知邊界與應對策略

### 9.1 MEMORY.md 膨脹

| 面向 | 說明 |
|------|------|
| **問題** | 用了半年後可能接近 20,000 字元上限 |
| **嚴重度** | 中 |
| **應對** | 定期精簡。舊的 pattern 合併、過時的 decision 刪除。MEMORY.md 的目標是「當前的心智模型」，不是「完整的歷史紀錄」 |

### 9.2 舊日誌無法搜尋

| 面向 | 說明 |
|------|------|
| **問題** | 三天前的 memory/YYYY-MM-DD.md 不會自動載入，AI 看不到 |
| **嚴重度** | 低（前提是有維護好 MEMORY.md） |
| **應對** | 重要的東西會提煉到 MEMORY.md。真的需要回溯時，你可以手動打開對應日期的日誌給 AI 看。或者未來啟用向量搜尋 |

### 9.3 寫入紀律

| 面向 | 說明 |
|------|------|
| **問題** | 系統依賴「AI 有意識地寫入記憶」，如果 AI 忘了寫，資訊就丟了 |
| **嚴重度** | 中 |
| **應對** | 在 AGENTS.md 裡把觸發條件寫清楚。養成自己提醒 AI「記住這個」的習慣。Moltbot 有 auto-flush 機制（compaction 前自動提醒存檔），在純 Claude Code 環境可以在長對話結束前主動說「把重要的東西存一下」 |

### 9.4 Context window 限制

| 面向 | 說明 |
|------|------|
| **問題** | 所有 bootstrap 檔案 + MEMORY.md + 近兩天日誌，加起來要佔 context window 的空間 |
| **嚴重度** | 低（只要別把檔案寫太長） |
| **應對** | 每個檔案 20,000 字元上限。實務上 SOUL.md (~500字) + AGENTS.md (~1000字) + USER.md (~500字) + IDENTITY.md (~200字) + MEMORY.md (~5000字) + 近兩天日誌 (~2000字) ≈ 不到 10,000 字，佔 context window 的比例很低 |

---

## 10. 安全性考量

> 這段很重要。Moltbot 是一個能讀你的檔案、發你的訊息、執行你的指令的 AI agent。安全問題不是假設，是已經發生過的事。

### 10.1 已知的安全事件

2026 年初，安全研究者發現了 Moltbot（當時還叫 Clawdbot）的多項安全漏洞：

| 問題 | 說明 |
|------|------|
| **公開暴露的實例** | 透過 Shodan 搜尋 "Clawdbot Control" 可找到數百個未設防的公開實例，包含完整 API keys、OAuth secrets、對話歷史 |
| **Prompt injection** | 研究者 Matvey Kukuy 發了一封含惡意指令的 email，Moltbot 讀了 email 後相信是合法指令，5 分鐘內將使用者最近 5 封 email 轉發到攻擊者地址 |
| **缺乏目錄沙箱** | Hacker News 共識：「It's terrifying. No directory sandboxing.」 |
| **潛在 RCE** | 多項程式碼缺陷可能導致遠端程式碼執行 |

### 10.2 我們用純檔案架構的安全優勢

在 Phase 0（純檔案 + Claude Code 環境）下，上述風險大部分不適用：

- **沒有公開的 Gateway** — 不架 daemon，不暴露任何端口
- **沒有通訊平台橋接** — 不處理外部來源的訊息，不受 prompt injection from email 影響
- **沒有自動對外行動** — AGENTS.md 明確規定對外操作需要先問
- **記憶是明文檔案** — 你能直接看到所有被記住的東西，`git diff` 可以追蹤每一個變更

### 10.3 未來升級到完整 Moltbot 時的安全清單

如果將來要架設 Gateway 和通訊平台，需要注意：

- [ ] 設定 `channels.*.allowFrom` 白名單（限制誰能跟 bot 說話）
- [ ] 啟用 `dmPolicy="pairing"`（未知發送者需要配對碼）
- [ ] 跑 `moltbot doctor` 掃描誤設的 DM 策略
- [ ] 不要把 `~/.clawdbot/` 目錄 commit 到公開 repo（包含 credentials）
- [ ] 考慮 `agents.defaults.sandbox.mode: "non-main"`（非主 session 跑在 Docker 沙箱）
- [ ] 不要公開暴露 Gateway — 用 Tailscale Serve（tailnet-only）而非 Funnel（公開）
- [ ] 如果用 Funnel，必須設定 `gateway.auth.mode: "password"`
- [ ] 定期更新：`moltbot update --channel stable`

---

## 11. 未來演進路徑

這個系統的設計允許漸進式升級，每一步都是獨立的，不會破壞前面的東西：

### Phase 0（現在）— 純檔案記憶

```
六個 markdown 檔案 + memory/ 目錄
零依賴
手動策展 MEMORY.md
環境：Claude Code
```

**解鎖條件：** 建好檔案，開始用。

---

### Phase 1 — 說話風格精煉

在 SOUL.md 裡加入具體的 Voice Guide：

```markdown
## Voice Guide

### 我的表達特徵
- [具體的用詞習慣]
- [句式偏好]
- [語氣詞]
- [要避免的表達]

### 範例對照
- 不要這樣說：「我認為這個方案值得考慮」
- 要這樣說：「這個方案可以」
```

借鑑 digital-brain-skill 的「Voice First」策略：AI 在生成任何回覆前先讀 voice guide，確保輸出匹配你的風格。

**解鎖條件：** 用了一段時間後，累積了夠多的對話樣本，能提煉出具體的風格規則。

---

### Phase 2 — 向量語義搜尋

當每日日誌累積到幾十天以上，開始覺得「舊的東西找不到」時：

```jsonc
// moltbot.json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "provider": "openai",           // 或 "gemini"、"local"
        "model": "text-embedding-3-small",
        "query": {
          "hybrid": {
            "enabled": true,
            "vectorWeight": 0.7,        // 語義相似度權重
            "textWeight": 0.3           // BM25 關鍵字權重
          }
        }
      }
    }
  }
}
```

搜尋工具：
- `memory_search` — 語義查詢（「我之前提過一個關於旅行的想法」）
- `memory_get` — 直接讀取特定日誌
- 命令列 `qmd query` / `qmd search` / `qmd vsearch`

索引規格：MEMORY.md + memory/**/*.md，切塊 ~400 tokens，重疊 80 tokens，存在 `~/.clawdbot/memory/<agentId>.sqlite`。

**解鎖條件：** 日誌多到手動策展 MEMORY.md 已經不夠用。

---

### Phase 3 — Auto-flush 記憶保護

在長對話的 context window 快滿之前，自動觸發記憶存檔：

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

觸發時機：`contextWindow - reserveTokensFloor - softThresholdTokens`。每次 compaction 週期觸發一次，靜默執行。

**解鎖條件：** 開始有很長的對話 session，擔心重要內容在 compaction 時丟失。

---

### Phase 4 — 安裝完整 Moltbot + 通訊平台

架設 Moltbot Gateway，解鎖通訊軟體整合：

```bash
npm install -g moltbot@latest
moltbot onboard --install-daemon
```

```jsonc
// moltbot.json
{
  "agents": {
    "defaults": {
      "workspace": "~/clawd",
      "model": "anthropic/claude-opus-4-5"
    }
  },
  "channels": {
    "telegram": {
      "allowFrom": ["YOUR_TELEGRAM_ID"]
    }
  }
}
```

解鎖功能：
- 透過 WhatsApp / Telegram / Discord / iMessage 等 13+ 平台對話
- AI 主動推送（早安簡報、提醒、異常警報）— 透過 HEARTBEAT.md + cron
- `/status`、`/reset`、`/compact` 等 chat commands
- 瀏覽器自動化（Browser control + CDP）
- Gmail Pub/Sub email 觸發

安全必做事項：見第 10.3 節。

**解鎖條件：** 想要「不打開電腦也能跟 AI 對話」的體驗。

---

### Phase 5 — 多 Agent 協作

像 [Shadowfax](https://github.com/krispuckett/shadowfax) 的做法，在一個 Gateway 上跑多個隔離 Agent：

```jsonc
// moltbot.json
{
  "agents": {
    "assistant": {
      "workspace": "~/clawd/assistant",
      "model": "anthropic/claude-sonnet-4-20250514"
    },
    "deepwork": {
      "workspace": "~/clawd/deepwork",
      "model": "anthropic/claude-opus-4-5"
    }
  }
}
```

- **Agent A（隨身助手）** — ambient layer：check-ins、reminders、日常對話。路由到 WhatsApp/iMessage
- **Agent B（深度工作）** — deep work：程式碼、分析、長文。路由到 Slack/CLI
- 兩者透過共享 context 檔案或 `sessions_send` 跨 session 溝通
- 每個 Agent 有獨立的 SOUL.md、MEMORY.md、session 儲存

**解鎖條件：** 有明確的任務分工需求。

---

### Phase 6 — Voice + Companion Apps

解鎖語音互動和行動裝置：

- **Voice Wake + Talk Mode** — macOS/iOS/Android 語音喚醒，ElevenLabs TTS
- **macOS Menu Bar App** — 常駐 menu bar 控制
- **iOS/Android Node** — 行動裝置上的 Canvas、相機、螢幕錄製、定位

**解鎖條件：** 想要完全免手打的語音互動體驗。

---

### 各 Phase 之間的關係

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3
純檔案      說話風格    向量搜尋    自動存檔

 ◄────── 純 Claude Code 環境可做 ──────►


Phase 4 ──→ Phase 5 ──→ Phase 6
通訊平台    多 Agent    語音 + App

 ◄───── 需要安裝 Moltbot Gateway ─────►
```

每一步都是獨立的、可選的、不影響前面已建好的東西。
不需要一次到位，遇到痛點再升級。

---

## 12. 參考資料

### Moltbot 官方資源

| 資源 | 連結 |
|------|------|
| 官網 | [molt.bot](https://molt.bot/) |
| GitHub | [github.com/moltbot/moltbot](https://github.com/moltbot/moltbot) |
| 文檔首頁 | [docs.molt.bot](https://docs.molt.bot/) |
| 安裝指南 | [docs.molt.bot/install](https://docs.molt.bot/install) |
| Getting Started | [docs.molt.bot/start/getting-started](https://docs.molt.bot/start/getting-started) |
| FAQ | [docs.molt.bot/start/faq](https://docs.molt.bot/start/faq) |
| Discord 社群 | discord.gg/clawd |

### Moltbot 技術文檔

| 文檔 | 說明 |
|------|------|
| [Memory](https://docs.molt.bot/concepts/memory.md) | 記憶系統完整技術文檔 |
| [Agent Workspace](https://docs.molt.bot/concepts/agent-workspace.md) | workspace 目錄結構 |
| [Agent](https://docs.molt.bot/concepts/agent.md) | Agent 設定與 bootstrap |
| [Agent Loop](https://docs.molt.bot/concepts/agent-loop.md) | 推理迴圈流程 |
| [Context](https://docs.molt.bot/concepts/context.md) | context 組裝方式 |
| [System Prompt](https://docs.molt.bot/concepts/system-prompt.md) | 系統提示模板結構 |
| [Session](https://docs.molt.bot/concepts/session.md) | session 管理 |
| [Session Pruning](https://docs.molt.bot/concepts/session-pruning.md) | context 修剪 |
| [Multi-Agent](https://docs.molt.bot/concepts/multi-agent.md) | 多 Agent 路由 |
| [SOUL.md Template](https://docs.molt.bot/reference/templates/SOUL.md) | 人格定義範本 |
| [IDENTITY.md Template](https://docs.molt.bot/reference/templates/IDENTITY.md) | AI 身份範本 |
| [AGENTS Template](https://docs.molt.bot/reference/templates/AGENTS) | 行為指令範本 |

### 改名事件相關

| 資源 | 說明 |
|------|------|
| [DEV.to — From Clawdbot to Moltbot](https://dev.to/sivarampg/from-clawdbot-to-moltbot-how-a-cd-crypto-scammers-and-10-seconds-of-chaos-took-down-the-4eck) | 改名事件完整始末 |
| [Hacker News 討論](https://news.ycombinator.com/item?id=46778307) | Anthropic 商標爭議社群反應 |
| [CoinFomania — 創辦人否認 Token](https://coinfomania.com/moltbot-founder-denies-token-launch-and-warns-of-crypto-scams/) | 加密貨幣詐騙事件 |
| [Yahoo Finance — Fake Token](https://finance.yahoo.com/news/fake-clawdbot-ai-token-hits-121840801.html) | $CLAWD 假 token 報導 |
| [SocRadar — Is It Safe?](https://socradar.io/blog/clawdbot-is-it-safe/) | 安全性分析報告 |
| [ForkLog — Critical Vulnerabilities](https://forklog.com/en/critical-vulnerabilities-found-in-clawdbot-ai-agent-for-cryptocurrency-theft/) | 安全漏洞技術報告 |

### 研究過但未採用的方案

| 專案 | 說明 | 借鑑了什麼 |
|------|------|------------|
| [claude_life_assistant](https://github.com/lout33/claude_life_assistant) | 2 檔案共生框架 | 「挑戰型夥伴」的概念 |
| [digital-brain-skill](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/main/examples/digital-brain-skill) | 結構化知識管理 | Voice First 機制（生成前讀 voice.md） |
| [awesome-clawdbot-skills](https://github.com/VoltAgent/awesome-clawdbot-skills) | 565+ skill 清單 | 確認了記憶是平台核心功能，不是 skill |

### 實際配置範例

| 專案 | 說明 |
|------|------|
| [Shadowfax](https://github.com/krispuckett/shadowfax) | 完整的 Moltbot 個人化配置範例（SOUL.md + HEARTBEAT.md + iMessage 整合） |

### 未來可能用到的記憶擴充工具

| 工具 | 說明 |
|------|------|
| [memory-search skill](https://mcpmarket.com/tools/skills/memory-search) | Claude Code 的跨 session 記憶層 |
| [Claude-Mem](https://altools.ai/13464.html) | 開源長期記憶 plugin（漸進式召回、歷史搜尋） |
| [memory-keeper skill](https://claude-plugins.dev/skills/@AlexBaum-ai/NEURM/memory-keeper) | 儲存決策、追蹤 context |
| [Anthropic Memory Tool (Beta)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) | 官方跨對話記憶 |

### 延伸閱讀

- [MacStories — Clawdbot/Moltbot](https://www.macstories.net/stories/clawdbot-showed-me-what-the-future-of-personal-ai-assistants-looks-like/)
- [VelvetShark — ClawdBot](https://velvetshark.com/clawdbot-the-self-hosted-ai-that-siri-should-have-been)
- [Docker Blog — Clawdbot + DMR](https://www.docker.com/blog/clawdbot-docker-model-runner-private-personal-ai/)
- [Zoopa — Complete Guide 2026](https://zoopa.es/en/blog/clawdbot-the-ai-assistant-siri-promised-but-never-delivered-complete-2026-guide/)
- [DEV.to — Getting Started](https://dev.to/ajeetraina/getting-started-with-clawdbot-the-complete-step-by-step-guide-2ffj)
- [Collabnix — Architecture Deep Dive](https://collabnix.com/what-is-clawdbot-and-why-is-it-getting-popular/)
- [PANews — Founder Story](https://www.panewslab.com/en/articles/b58b5897-8d1d-4bd3-a98e-a77fe3b4b315)
- [Trending Topics — Austrian Developer](https://www.trendingtopics.eu/austrian-developer-creates-clawdbot-an-open-source-ai-assistant-that-runs-locally/)
- [Implicator — Build for $5/month](https://www.implicator.ai/clawbot-how-to-build-your-own-ai-assistant-for-five-dollars-a-month/)
- [MagicShot — Features & Pros/Cons](https://magicshot.ai/news/clawdbot-the-self-hosted-ai-assistant-redefining-personal-automation/)
