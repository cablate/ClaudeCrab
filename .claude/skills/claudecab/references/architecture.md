# ClaudeCab 架構設計

## 目錄

1. [設計原則](#設計原則)
2. [核心模組](#核心模組)
3. [Agent 配置結構](#agent-配置結構)
4. [資料流](#資料流)
5. [核心型別定義](#核心型別定義)

---

## 設計原則

- **SDK 優先**：充分利用 Claude Agent SDK 內建功能，避免重複造輪子
- **TypeScript 嚴格模式**：確保類型安全，禁用 `any`
- **配置驅動**：透過 JSON 配置 Agent，降低使用門檻
- **模組化設計**：便於擴充與測試
- **依賴反轉**：介面優先

---

## 核心模組

### AgentLoader (`src/core/AgentLoader.ts`)

從 `agents/` 目錄載入所有代理配置：
- 掃描子目錄
- 讀取 `agent.json` 配置
- 載入 `CLAUDE.md` 系統提示詞
- 支援代理繼承（extends）
- Zod 驗證配置結構

```typescript
interface IAgentRepository {
  get(agentId: string): LoadedAgent | undefined;
  list(): string[];
}
```

### SessionManager (`src/core/SessionManager.ts`)

管理用戶會話狀態：
- 會話建立與查詢（`platform::userId` 作為 key）
- 代理切換
- 訊息去重（idempotency）
- 分散式鎖（async-mutex，防止並發處理）
- 自動清理過期會話
- **SDK Session ID 存儲**：儲存 `sdkSessionId` 供 resume 使用

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

處理訊息流程，支援兩種模式：

**SDK 模式（預設，`USE_CLAUDE_AGENT_SDK=true`）**：
1. 接收 UnifiedMessage
2. 取得/建立 Session
3. SDKQueryManager 呼叫 `query()`
4. SDK 管理對話歷史（resume option）
5. 透過 Adapter 發送回應

**Legacy 模式（`USE_CLAUDE_AGENT_SDK=false`）**：
1. 直接使用 @anthropic-ai/sdk
2. 手動管理對話歷史（conversations Map + SQLite）

### EventBus (`src/core/EventBus.ts`)

類型安全的事件發布訂閱機制：
- `message:received` / `message:sent`
- `session:created` / `session:closed` / `session:switched`
- `agent:loaded` / `agent:reloaded`
- `error`

### TelegramAdapter (`src/adapters/TelegramAdapter.ts`)

Telegram 平台整合：
- grammy Bot 封裝
- 訊息分割（超過 4096 字元）
- 打字指示器
- 速率限制（35ms 最小間隔）
- 指令處理：`/start`, `/help`, `/list`, `/switch`, `/reset`

### Persistence 層 (`src/persistence/`)

SQLite 持久化：
- `DatabaseManager.ts` - 連線管理、Schema 初始化、WAL 模式
- `SessionRepository.ts` - Session CRUD、過期清理、`sdkSessionId` 存儲
- `ConversationRepository.ts` - 對話歷史 CRUD（僅 Legacy 模式使用）

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
  "extends": "general",
  "settings": {
    "permissionMode": "default",
    "maxTurns": 20
  }
}
```

### CLAUDE.md

SDK 會自動載入此檔案作為系統提示（透過 SDKQueryManager 明確傳遞）。

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
│     - systemPrompt = agent 的 CLAUDE.md      │
│     - resume = sdkSessionId（如有）           │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  4. 處理回應                                  │
│     - 擷取 session_id 存入 SessionManager    │
│     - 收集 assistant 回應文字                 │
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
