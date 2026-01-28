# ClaudeCab 架構設計

## 目錄

1. [設計原則](#設計原則)
2. [核心模組](#核心模組)
3. [Agent 配置結構](#agent-配置結構)
4. [Agent 記憶運作機制](#agent-記憶運作機制)
5. [資料流](#資料流)
6. [核心型別定義](#核心型別定義)

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

**關鍵設計（Agent Isolation）**：
- `settingSources: ['local']` - 只讀取 agent 的 `.claude/settings.local.json`
- `systemPrompt` 參數 - 明確傳遞 agent 的 CLAUDE.md 內容
- **原因**：SDK 會遞迴向上搜尋父目錄的 CLAUDE.md（.git 不是邊界），必須明確傳遞避免載入錯誤的系統提示詞

**功能**：
- 管理 Query 生命週期
- 使用 `resume` option 恢復對話歷史
- 從 SDK 訊息擷取 `session_id`
- 支援重試邏輯

### MessageProcessor (`src/core/MessageProcessor.ts`)

處理訊息流程（SDK 模式）：
1. 接收 UnifiedMessage
2. 取得/建立 Session
3. **動態讀取 systemPrompt**（v1.5.1）：透過 `getSystemPrompt(agentId)` 函數注入，每次查詢前從磁碟重新讀取 CLAUDE.md，確保 Agent 自主更新的內容即時生效
4. SDKQueryManager 呼叫 `query()`（帶 `resume: sdkSessionId`）
5. SDK 管理對話歷史（resume option）
6. **Resume 失敗自動重試**（v1.4.1）：帶 resume 呼叫失敗時，清除 sdkSessionId，不帶 resume 重試一次
7. 持久化訊息到資料庫（供 WebUI 查看）
8. 透過 Adapter 發送回應

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

### TelegramAdapter (`src/adapters/TelegramAdapter.ts`)

Telegram 平台整合（每個 Agent 一個 Bot 實例）：
- grammy Bot 封裝
- 建構時綁定 `agentId`
- 訊息分割（超過 4096 字元）
- 打字指示器
- 速率限制（35ms 最小間隔）
- 指令處理：`/start`, `/help`, `/reset`

### Persistence 層 (`src/persistence/`)

SQLite 持久化：
- `DatabaseManager.ts` - 連線管理、Schema 初始化（v2）、WAL 模式
- `SessionRepository.ts` - Session CRUD、過期清理、`sdkSessionId` 存儲（UNIQUE: platform + agent_id + user_id）
- `ConversationRepository.ts` - 對話歷史 CRUD（SDK 訊息持久化，供 WebUI 查看）

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

### Agent Workspace 檔案（記憶系統）

Agent 可擁有額外的 workspace 檔案，由 CLAUDE.md 中的指令驅動 agent 自行讀寫：

```
agents/general/
├── .claude/
│   └── settings.local.json   # Agent 權限配置
├── agent.json                 # ClaudeCab 元資料
├── CLAUDE.md                  # 系統提示詞（含記憶協議 + Lessons Learned）
├── BOOTSTRAP.md               # 首次啟動儀式（完成後由 agent 自行刪除）
├── SOUL.md                    # 人格定義（穩定，緩慢演化）
├── USER.md                    # 使用者檔案（身份、偏好）
├── IDENTITY.md                # AI 身份（名字、風格）
├── MEMORY.md                  # 長期記憶（篩選過的持久事實）
└── memory/                    # 每日日誌
    └── YYYY-MM-DD.md
```

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
