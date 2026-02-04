# ClaudeCab 架構設計

## 目錄

1. [技術棧](#技術棧)
2. [目錄結構](#目錄結構)
3. [設計原則](#設計原則)
4. [核心模組](#核心模組)
5. [Agent 配置結構](#agent-配置結構)
6. [Agent 記憶運作機制](#agent-記憶運作機制)
7. [資料流](#資料流)
8. [核心型別定義](#核心型別定義)

---

## 技術棧

| 類別 | 技術 | 版本 |
|------|------|------|
| 語言 | TypeScript | 5.x (strict) |
| 執行環境 | Node.js | >= 20 |
| AI SDK | @anthropic-ai/claude-agent-sdk | ^0.2.19 |
| Telegram | grammy | ^1.39.3 |
| 驗證 | Zod | ^4.3.6 |
| 持久化 | better-sqlite3 | ^12.6.2 |
| WebUI | Express + EJS | ^5.2.1 |
| CSS | TailwindCSS (CDN) | ^3.4.19 |
| 測試 | Vitest | ^4.0.18 |

---

## 目錄結構

```
claudecab/
├── src/
│   ├── index.ts           # 精簡入口（~20 行，委派給 AppBootstrap）
│   ├── config.ts           # 集中化環境變數解析（AppConfig）
│   ├── AppBootstrap.ts     # 應用生命週期管理（初始化 + 關機序列）
│   ├── core/              # AgentLoader, SessionManager, SDKQueryManager, EventBus, PlatformOrchestrator, StatusMessageManager, InteractionHandler
│   ├── persistence/       # SQLite 持久化層
│   ├── adapters/          # TelegramAdapter, BaseAdapter
│   ├── webui/             # Express + EJS 管理介面
│   │   ├── WebUIServer.ts
│   │   ├── routes/        # 頁面路由
│   │   ├── api/           # API 端點
│   │   ├── services/      # 業務邏輯
│   │   └── views/         # EJS 模板（元件化）
│   ├── types/             # TypeScript 型別定義
│   └── utils/             # logger, security, audit, retry, format
├── public/                # 靜態資源 (JS)
├── agents/                # Agent 配置（每個子目錄 = 一個代理）
│   ├── general/           # 通用助手（含記憶系統 workspace）
│   │   ├── .claude/
│   │   │   ├── settings.local.json  # 權限配置
│   │   │   └── skills/              # Agent Skills
│   │   │       ├── agent-protocols/ # 核心協議（啟動、記憶、安全）
│   │   │       └── persona/         # 人格定義（soul, identity）
│   │   ├── CLAUDE.md      # 系統提示（引導 → skills）
│   │   ├── BOOTSTRAP.md   # 首次啟動儀式（完成後自動刪除）
│   │   ├── USER.md        # 使用者檔案
│   │   ├── MEMORY.md      # 長期記憶
│   │   └── memory/        # 每日日誌
│   └── coder/             # 程式碼助手
├── tests/                 # 284 tests, 19 files
└── data/                  # SQLite 資料庫
```

---

## 設計原則

- **SDK 優先**：充分利用 Claude Agent SDK 內建功能，避免重複造輪子
- **TypeScript 嚴格模式**：確保類型安全，禁用 `any`
- **配置驅動**：透過 JSON 配置 Agent，降低使用門檻
- **模組化設計**：便於擴充與測試
- **依賴反轉**：介面優先
- **SDKQueryManager 可獨立抽離**：SDKQueryManager 只負責接收 `systemPrompt` 字串 + `cwd` 路徑並呼叫 SDK `query()`，不注入任何業務邏輯（如記憶系統）。設計目標是可以從 ClaudeCab 中整個帶走到其他專案使用
- **Agent 自主管理**：記憶、人格等進階功能完全由 Agent 透過 CLAUDE.md 指令自行操作，引擎層（`src/`）零感知。不建立「組裝層」注入記憶內容到 systemPrompt

---

## 核心模組

### AgentLoader (`src/core/AgentLoader.ts`)

從 `agents/` 目錄載入所有代理配置：
- 掃描子目錄
- 讀取 `agent.json` 配置
- 載入 `CLAUDE.md` 系統提示詞
- 支援代理繼承（extends）
- Zod 驗證配置結構
- **動態 SystemPrompt 讀取**（v1.5.1）：`readSystemPrompt(agentId)` 每次從磁碟重新讀取 CLAUDE.md，支援 Agent 在 runtime 自主更新系統提示詞

```typescript
interface IAgentRepository {
  get(agentId: string): LoadedAgent | undefined;
  list(): string[];
}
```

### SessionManager (`src/core/SessionManager.ts`)

管理用戶會話狀態：
- 會話建立與查詢（`platform::agentId::userId` 作為 key）
- 每個 Agent + 用戶 + 平台的組合擁有獨立 Session
- 訊息去重（idempotency）
- 分散式鎖（async-mutex，防止並發處理）
- 自動清理過期會話（僅從記憶體移除，DB 行保留）
- **SDK Session ID 存儲**：儲存 `sdkSessionId` 供 resume 使用
- **對話連續性**（v1.4.1）：`createSession()` 建立新 session 前查 DB 取回先前的 `session_id` + `sdk_session_id`，重用舊 session ID（保持 FK 關聯）並繼承 `sdkSessionId`
- **DB 保留策略**：`cleanupExpired()` 只從記憶體移除，不刪 DB 行。`restoreSessions()` 僅清理超過 `dbRetentionMs`（預設 30 天）的古老 session

### SDKQueryManager (`src/core/SDKQueryManager.ts`)

封裝 Claude Agent SDK `query()` 函數：

**關鍵設計（Agent Isolation + Skills）**：
- `settingSources: ['project']` - 載入 agent 的設定檔（`.claude/settings.local.json`）**和 skills**（`.claude/skills/`）
- `systemPrompt` 參數 - 明確傳遞 agent 的 CLAUDE.md 內容（覆蓋 SDK 搜尋到的）
- **原因**：`'local'` 無法載入 skills；改用 `'project'` 後，仍透過明確傳遞 `systemPrompt` 確保 agent isolation
- **變更歷史**：v1.11.0 從 `['local']` 改為 `['project']`

**功能**：
- 管理 Query 生命週期
- 使用 `resume` option 恢復對話歷史
- 從 SDK 訊息擷取 `session_id`
- 支援重試邏輯
- **中間訊息串流**（v1.6.0）：`onIntermediateMessage` optional callback，每收到 assistant 訊息即呼叫，支援即時回饋而非等全部完成

### PermissionBridge (`src/core/PermissionBridge.ts`)

Promise-based 非同步權限橋接，用於連接 SDK 的 `canUseTool` callback 與 Telegram InlineKeyboard 審批 UI：
- 管理 `requestId → deferred Promise` 映射，每個工具審批請求對應一個 pending Promise
- SDK 呼叫 `canUseTool` 時建立 deferred，Telegram 使用者按下按鈕時 resolve
- **120 秒 timeout** — 超時自動 deny，避免 Promise 永遠 pending
- **AbortSignal 支援** — 外部可取消等待中的請求
- **cancelAll()** — 一次取消所有 pending 請求（如 session 結束時清理）
- 不直接依賴 Adapter 或 SDK，純粹的 Promise 協調層

### MessageProcessor (`src/core/MessageProcessor.ts`)

處理訊息流程（SDK 模式），v1.17.0 重構後約 1,065 行，職責分離至 InteractionHandler 和 StatusMessageManager：
1. 接收 UnifiedMessage
2. 取得/建立 Session
3. **動態讀取 systemPrompt**（v1.5.1）：透過 `getSystemPrompt(agentId)` 函數注入
4. **委派 InteractionHandler**（v1.17.0）：建立 InteractionHandler 處理 canUseTool callback
5. **委派 StatusMessageManager**（v1.17.0）：建立 StatusMessageManager 處理即時狀態訊息
6. SDKQueryManager 呼叫 `query()`（帶 `resume: sdkSessionId` + `onIntermediateMessage` callback + `canUseTool` via `additionalOptions`）
7. **中間訊息即時串流**（v1.6.0）：SDK 每產生 assistant 訊息，透過 callback 即時發送到 Telegram
8. **Resume 失敗自動重試**（v1.4.1）：帶 resume 呼叫失敗時，清除 sdkSessionId，不帶 resume 重試一次
9. **Post-query 處理**（v1.17.0 拆分為 private methods）：`saveSDKSessionId()` → `updateInjectionCursor()` → `persistConversation()` → `sendFinalResponse()` → `emitBotRepliedEvent()`

### InteractionHandler (`src/core/InteractionHandler.ts`)

v1.17.0 從 MessageProcessor 抽出，封裝 Permission/Question 互動橋接：
- 建構時設置 PermissionBridge + QuestionBridge + Adapter 解析器
- `buildCanUseTool()` 回傳 SDK 可用的 canUseTool callback
- 攔截 `AskUserQuestion` 工具，透過 Telegram 按鈕呈現選項
- 一般工具則走 PermissionBridge 審批流程
- `dispose()` 清理所有 pending 請求

### StatusMessageManager (`src/core/StatusMessageManager.ts`)

v1.17.0 從 MessageProcessor 抽出，封裝即時狀態訊息管理：
- Tool event 追蹤和 debounced 更新（避免 Telegram 429）
- 狀態訊息建立/更新/結算生命週期
- 中間 assistant 訊息發送時 finalize 當前 batch，下次 tool event 建新 status message
- `isStatusCapable()` 型別守衛檢查 adapter 是否支援狀態訊息

### PathValidator (`src/core/PathValidator.ts`)

工作區隔離強制執行（v1.13.0）：
- 透過 PreToolUse hook 攔截所有檔案操作工具（Read, Write, Edit, Glob, Grep, Bash）
- 在 MessageProcessor 中自動注入，Agent 無需維護 hooks.ts
- **Bash 特殊處理**：從命令字串提取路徑（引號內、絕對、相對），轉換為實際路徑後驗證

**權限規則**：
| 路徑 | 讀取 | 寫入 |
|------|------|------|
| 自己的工作區 `agents/{id}/` | ✅ | ✅ |
| 共享區 `_shared/knowledge/` | ✅ | ❌ |
| 自己的命名空間 `_shared/knowledge/{id}/` | ✅ | ✅ |
| 其他 agent 工作區 | ❌ | ❌ |

### constants (`src/core/constants.ts`)

集中管理核心常數與 hook 建構函式：
- **MEMORY_CHECKPOINT_CONTEXT**（v1.7.1）：記憶檢查提醒文字，透過 UserPromptSubmit hook 注入，提醒 agent 在回覆前檢查上一輪對話是否有值得記錄的內容
- **buildMemoryStopCheckpoint(groupChatId?)**（v1.18.0, v1.19.0 修正）：Stop hook 記憶檢查；群組對話時明確指示「群組事件寫 groups/{chatId}/，不寫 memory/*.md」
- **buildPromptContext(chatId?, isNewSession?, groupChatId?)**：UserPromptSubmit hook context；群組對話時顯示 `【群組日誌路徑】` 取代個人 `【日誌路徑】`

### EventBus (`src/core/EventBus.ts`)

類型安全的事件發布訂閱機制：
- `message:received` / `message:sent`
- `session:created` / `session:closed`
- `agent:loaded` / `agent:reloaded`
- `error`

### PlatformOrchestrator (`src/core/PlatformOrchestrator.ts`)

管理所有平台 Adapter 的生命週期：
- 掃描 Agent 配置中的平台 token（如 `telegramBotToken`）
- 為每個有 token 的 Agent 建立獨立的 Adapter 實例
- 單一 Agent 啟動失敗不影響其他 Agent
- 支援 `reloadAgent(agentId)` — 重載 Agent 配置並重啟其 Adapter
- 提供 `getRunningAdapters()` 供 WebUI 監控
- 通用設計，未來可擴展到 Slack、Discord 等平台

### AdapterRegistry (`src/core/AdapterRegistry.ts`)

管理 Adapter 實例註冊：
- Key 為 `platform::agentId` 複合鍵
- 支援按平台+Agent 查詢 Adapter

### BaseAdapter (`src/adapters/BaseAdapter.ts`)

所有平台 Adapter 的抽象基底類別：
- 定義 `sendMessage`、`sendTypingIndicator` 等抽象方法
- **權限審批預設方法**（v1.7.0）：提供 `sendPermissionPrompt`、`updatePermissionPrompt`、`setPermissionResolver` 三個預設方法（no-op / auto-deny），子類可 override 實作平台特定的審批 UI

### TelegramAdapter (`src/adapters/TelegramAdapter.ts`)

Telegram 平台整合（每個 Agent 一個 Bot 實例）：
- grammy Bot 封裝
- 建構時綁定 `agentId`
- 訊息分割（超過 4096 字元）
- 打字指示器
- 速率限制（35ms 最小間隔）
- 指令處理：`/start`, `/help`, `/reset`
- **權限審批 UI**（v1.7.0）：Override `sendPermissionPrompt`、`updatePermissionPrompt`、`setPermissionResolver` 三個方法；發送 InlineKeyboard（Allow / Deny 按鈕）；註冊 `callback_query` handler 處理使用者按鈕回應
- **Fire-and-forget message handler**（v1.7.0）：message handler 不 await processMessage，避免阻塞 grammy polling loop 造成 callback_query 死鎖
- **allowed_updates**（v1.7.0）：`doStart` 明確指定 `allowed_updates: ['message', 'callback_query']` 確保接收按鈕回調事件

### Persistence 層 (`src/persistence/`)

SQLite 持久化：
- `DatabaseManager.ts` - 連線管理、Schema 初始化（v7）、WAL 模式、線性 migration 鏈（v1→v7）
- `SessionRepository.ts` - Session CRUD、過期清理、`sdkSessionId` 存儲（UNIQUE: platform + agent_id + user_id）
- `ConversationRepository.ts` - 對話歷史 CRUD（SDK 訊息持久化，供 WebUI 查看）
- `GroupMemberRepository.ts`（v1.18.0）- 群組成員持久化（platform + chat_id + agent_id），供重啟後還原成員關係
- `QueryMetricsRepository.ts`（v1.19.0）- 每次 SDK query 的 token 用量、成本、回應時間追蹤；提供 per-agent 聚合統計和每日統計

---

## Agent 配置結構

每個 agent 是一個獨立的 Claude Code 專案：

```
agents/general/
├── .claude/
│   └── settings.local.json   # Agent 權限配置
├── agent.json                 # ClaudeCab 元資料
└── CLAUDE.md                  # 系統提示詞
```

### .claude/settings.local.json

```json
{
  "model": "sonnet",
  "permissions": {
    "allow": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    "deny": []
  }
}
```

> **重要**：使用 `settings.local.json` 而非 `settings.json`，搭配 `settingSources: ['local']` 避免 SDK 搜尋父目錄。

### Output Style（僅 CLI 支援，SDK 不支援）

Output Style 是 Claude Code **CLI** 的功能，允許自訂回覆風格。

> **⚠️ 重要：SDK 不支援 Output Style**
>
> ClaudeCab 透過 `@anthropic-ai/claude-agent-sdk` 的 `query()` 函數呼叫，SDK 的 `Options` 型別中**沒有 `outputStyle` 參數**。即使在 `settings.local.json` 設定 `"outputStyle": "..."`，SDK 也會忽略此設定。
>
> **替代方案**：把輸出風格指令直接寫在 CLAUDE.md 中（如 `## Output Style` 區段）。

以下為 CLI 原生 Output Style 的參考資訊（ClaudeCab 不適用）：

**檔案位置**：`.claude/output-styles/<style-name>.md`

**檔案格式**：
```markdown
---
name: My Custom Style
description: 顯示在 /output-style 選單的描述
keep-coding-instructions: false
---

# 自訂指令
[內容會加到系統提示末尾...]
```

**Frontmatter 選項**：

| 欄位 | 說明 | 預設值 |
|------|------|--------|
| `name` | 風格名稱 | 從檔案名稱繼承 |
| `description` | 風格描述 | 無 |
| `keep-coding-instructions` | 是否保留編碼指令 | `false`（會排除編碼指令）|

### agent.json

```json
{
  "name": "General Assistant",
  "description": "通用助手",
  "version": "1.0.0",
  "model": "sonnet",
  "telegramBotToken": "123456:ABC-DEF...",
  "extends": "general",
  "settings": {
    "permissionMode": "default",
    "maxTurns": 20
  }
}
```

### CLAUDE.md

SDK 會自動載入此檔案作為系統提示（透過 SDKQueryManager 明確傳遞）。

### Agent Skills（v1.11.0）

Claude Code 原生 Skills 機制，用於模組化 Agent 的協議和人格定義：

```
agents/general/.claude/skills/
├── agent-protocols/              # 核心行為規範
│   ├── SKILL.md                  # 協議索引（觸發入口）
│   └── references/
│       ├── startup-protocol.md   # Session 啟動流程
│       ├── memory-system.md      # 記憶寫入規則
│       ├── safety.md             # 安全規則
│       ├── scheduling.md         # 排程建立指引
│       ├── guidelines.md         # 回覆準則
│       └── output-style.md       # 輸出格式（📝 標記）
└── persona/                      # 人格定義（可攜帶）
    ├── SKILL.md                  # 人格入口
    └── references/
        ├── soul.md               # 核心價值觀、說話風格
        └── identity.md           # 名字、角色、定位
```

**Skill 載入機制**：
- Skill metadata（name, description）在 session 開始時自動載入
- Agent 透過 Skill 工具調用 `/skill-name` 載入完整內容
- CLAUDE.md 引導 agent 在啟動時調用 `/agent-protocols`

**設計原則**：
- **協議與人格分離**：agent-protocols 定義「怎麼做」，persona 定義「是誰」
- **可攜帶性**：persona skill 可複製到其他 agent 快速部署相同人格
- **環境狀態獨立**：USER.md、MEMORY.md、memory/ 是環境特定狀態，不放入 skill

### Agent Workspace 檔案（記憶系統）

Agent 可擁有額外的 workspace 檔案，由 CLAUDE.md 中的指令驅動 agent 自行讀寫：

```
agents/general/
├── .claude/
│   ├── settings.local.json   # Agent 權限配置
│   └── skills/               # Agent Skills（見上方）
├── agent.json                 # ClaudeCab 元資料
├── CLAUDE.md                  # 系統提示詞（引導 → skills）
├── BOOTSTRAP.md               # 首次啟動儀式（完成後由 agent 自行刪除）
├── USER.md                    # 使用者檔案（身份、偏好）
├── MEMORY.md                  # 長期記憶（篩選過的持久事實）
├── EQUIPMENT.md               # 已安裝工具清單
├── knowledge/                 # 私有知識產出（草稿區）
│   ├── tools/                 # 工具評估
│   ├── cases/                 # 案例研究
│   └── research/              # 研究筆記
├── groups/                    # 群組記憶（v1.18.0）
│   └── {chatId}/
│       ├── MEMORY.md          # 群組持久記憶（共識、決策、任務分配）
│       └── YYYY-MM-DD.md      # 群組每日討論紀錄
└── memory/                    # 每日日誌
    └── YYYY-MM-DD.md
```

### 共享知識區（v1.12.0）

跨 Agent 的知識共享機制，讓 bot 產出的知識資產可被其他 bot 參考：

```
agents/
├── _shared/
│   └── knowledge/
│       ├── general/           # general 發布的內容
│       │   ├── tools/
│       │   └── cases/
│       └── nitterbot/         # nitterbot 發布的內容
```

**權限規則**：
- 讀取：所有 bot 可讀整個 `_shared/knowledge/`
- 寫入：只能寫入自己的命名空間 `_shared/knowledge/{agentId}/`
- 禁止：存取其他 bot 的私有 `knowledge/` 目錄

詳見 [shared-knowledge.md](shared-knowledge.md)

> **v1.11.0 變更**：SOUL.md、IDENTITY.md 移至 `.claude/skills/persona/references/`，成為可攜帶的 skill

> **重要**：這些檔案不由引擎層管理。Agent 在 session 啟動時依 CLAUDE.md 指示自行讀取，對話中自行寫入。SDKQueryManager 完全不知道這些檔案的存在。
>
> **BOOTSTRAP.md**（v1.5.2）：一次性首次啟動儀式。Agent 偵測到此檔案存在時，執行 onboarding 流程（認識使用者、定義自己），完成後刪除檔案。不存在 = 已啟動過。

---

## Agent 記憶運作機制

Agent 的記憶系統採用「零程式碼」設計 — 完全透過 CLAUDE.md 指令驅動，不修改引擎任何一行程式碼。

### 運作原理

```
AgentLoader 讀取 CLAUDE.md（啟動時快取 + 每次查詢時從磁碟重新讀取）
       │
       ▼
作為 systemPrompt 字串傳入 SDKQueryManager
       │
       ▼
SDK 以 cwd=agents/<name>/ 執行 agent
       │
       ▼
Agent 看到 systemPrompt 裡的記憶協議
       │
       ▼
Agent 用 Read/Write 工具自行讀寫 workspace 檔案
```

### 為什麼不在引擎層注入記憶

- **SDKQueryManager 可獨立抽離**：設計目標是可以把 SDKQueryManager 整個帶走到其他專案使用，因此不在此層注入記憶、人格等業務邏輯
- **不需要「組裝層」**：不在 MessageProcessor 或任何中間層把記憶內容拼接進 systemPrompt
- **Agent 自主管理**：Agent 本身就有 Read/Write 工具能力，CLAUDE.md 告訴它要讀什麼寫什麼，它自己操作

### 分層邊界

| 層級 | 職責 | 知道記憶系統？ |
|------|------|:---:|
| `SDKQueryManager` | 接收 systemPrompt + cwd，呼叫 SDK query() | ✗ |
| `MessageProcessor` | 管理訊息處理流程、Session 狀態；透過函數注入取得即時 systemPrompt | ✗ |
| `AgentLoader` | 讀取 CLAUDE.md 內容（啟動時快取 + `readSystemPrompt()` 即時讀取） | ✗（只是讀檔案）|
| `CLAUDE.md`（agent 層）| 定義記憶協議、啟動讀取順序、寫入規則 | ✓ |
| Agent（runtime）| 執行 CLAUDE.md 指令，讀寫 workspace 檔案 | ✓ |

---

## 資料流

```
使用者發送訊息
       │
       ▼
┌─────────────────────────────────────────────┐
│  1. TelegramAdapter 接收訊息                  │
│     - grammy 接收 Telegram 訊息               │
│     - 轉換為 UnifiedMessage                   │
│     - EventBus.emit('message:received')      │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  2. MessageProcessor 處理                    │
│     - 冪等性檢查（已處理過的 message_id 跳過）  │
│     - 查詢/建立 Session（SessionManager）     │
│     - 更新 Session 狀態為 'processing'        │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  3. SDKQueryManager 執行查詢                  │
│     - cwd = agent 目錄                        │
│     - settingSources: ['local']              │
│     - systemPrompt = 從磁碟重新讀取的 CLAUDE.md│
│     - resume = sdkSessionId（如有）           │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  4. 處理回應                                  │
│     - 擷取 session_id 存入 SessionManager    │
│     - 收集 assistant 回應文字                 │
│     - 持久化 user/assistant 訊息到 DB        │
│     - 更新 Session 狀態為 'idle'              │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  5. TelegramAdapter 發送回應                  │
│     - 長訊息分割（4096 字元）                  │
│     - EventBus.emit('message:sent')          │
└─────────────────────────────────────────────┘
```

---

## 核心型別定義

### AgentConfig

```typescript
interface AgentConfig {
  name: string;
  description?: string;
  version?: string;
  extends?: string;
  model?: 'sonnet' | 'opus' | 'haiku';
  maxTokens?: number;
  telegramBotToken?: string;  // 每個 Agent 獨立的 Telegram Bot Token
  systemPrompt?: string;
  systemPromptFile?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  settings?: {
    maxHistoryLength?: number;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
    maxTurns?: number;
    maxBudgetUsd?: number;
  };
}
```

### LoadedAgent

```typescript
interface LoadedAgent {
  id: string;           // 目錄名稱
  path: string;         // 完整路徑
  config: AgentConfig;
  systemPrompt: string; // 解析後的 prompt
}
```

### UserSession

```typescript
interface UserSession {
  sessionId: string;
  agentId: string;
  platform: string;
  userId: string;
  state: 'idle' | 'processing' | 'error';
  sdkSessionId?: string;  // SDK session ID for resume
  createdAt: Date;
  lastActiveAt: Date;
  processedMessageIds: Set<string>;
}
```

### UnifiedMessage

```typescript
interface UnifiedMessage {
  id: string;
  platform: string;
  userId: string;
  chatId: string;
  text: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
```

### Permission Types（v1.7.0）

```typescript
// 權限提示選項（Adapter 發送審批 UI 時使用）
interface PermissionPromptOptions {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  chatId: string;
}

// 權限提示結果（使用者按下按鈕後回傳）
interface PermissionPromptResult {
  messageId: number;  // 用於後續更新訊息狀態
}

// 權限解析回調（Adapter 呼叫以通知 PermissionBridge 使用者決定）
type PermissionResolver = (requestId: string, allowed: boolean) => void;
```
