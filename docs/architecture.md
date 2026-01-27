# ClaudeCab 架構設計文檔

> 最終版本 v3.1 - 經過架構審查與 SDK 研究後的設計（2026-01-26）

---

## 1. 專案概述

ClaudeCab 是一個基於 Claude Agent SDK 的「套皮」型框架系統。

**核心概念**：「目錄即代理」——每個資料夾代表一個獨立的對話實體，具備自己的設定與行為模式。

**設計原則**：
- 充分利用 SDK 內建功能，避免重複造輪子
- TypeScript 優先，確保類型安全
- 配置驅動，降低使用門檻
- 模組化設計，便於擴充
- 依賴反轉，介面優先

---

## 2. 技術選型

| 項目 | 選擇 | 原因 |
|------|------|------|
| 語言 | TypeScript 5.x | 類型安全、IDE 支援、與 SDK 類型定義契合 |
| 執行環境 | Node.js >= 18 | LTS 版本，支援 ESM |
| SDK | @anthropic-ai/claude-agent-sdk 0.2.x | 官方 SDK，功能完整 |
| Schema 驗證 | Zod 3.x | 輕量、TypeScript 原生支援 |
| Telegram Bot | **grammy** | 原生 TypeScript、內建中介軟體、更好的錯誤處理 |
| 檔案監控 | chokidar | 熱重載用（可選） |
| 日誌 | pino | 高效能結構化日誌 |
| 測試 | Vitest | 快速、原生 ESM 支援 |

---

## 3. SDK 內建功能（不需自行實作）

經過 SDK 研究，以下功能由 SDK 提供，**不需要自行實作**：

| 功能 | SDK 選項 | 說明 |
|------|---------|------|
| Subagent 系統 | `agents` | 可定義多個子代理 |
| Hooks 系統 | `hooks` | PreToolUse, PostToolUse, SessionStart 等 12 種事件 |
| MCP 整合 | `mcpServers` | 支援 stdio/sse/http/sdk 四種模式 |
| Session 管理 | `resume`, `forkSession` | 內建 session 持久化與分支 |
| 權限控制 | `canUseTool`, `permissionMode` | 完整權限回調 |
| 工具限制 | `allowedTools`, `disallowedTools` | 工具白名單/黑名單 |
| 對話歷史 | SDK 內部管理 | 自動維護上下文 |
| 串流回應 | AsyncGenerator | 內建串流支援 |
| 預算控制 | `maxBudgetUsd` | API 成本上限 |
| 檔案檢查點 | `enableFileCheckpointing` | 檔案變更追蹤與復原 |
| 結構化輸出 | `outputFormat` | JSON Schema 驗證輸出 |

### SDK Hooks 完整事件列表

| Hook 事件 | 觸發時機 | 典型用途 |
|-----------|---------|---------|
| `PreToolUse` | 工具執行前 | 阻止危險命令、驗證輸入 |
| `PostToolUse` | 工具執行後 | 記錄檔案變更、審計日誌 |
| `PostToolUseFailure` | 工具執行失敗 | 錯誤處理和記錄 |
| `UserPromptSubmit` | 用戶提交提示 | 注入額外上下文 |
| `Stop` | 代理停止執行 | 保存 session 狀態 |
| `SubagentStart` | 子代理初始化 | 追蹤平行任務 |
| `SubagentStop` | 子代理完成 | 聚合結果 |
| `PreCompact` | 對話壓縮前 | 歸檔完整記錄 |
| `PermissionRequest` | 權限對話 | 自訂權限處理 |
| `SessionStart` | Session 初始化 | 初始化日誌和遙測 |
| `SessionEnd` | Session 終止 | 清理臨時資源 |
| `Notification` | 代理狀態訊息 | 推送至監控系統 |

---

## 4. 核心模組（需自行開發）

| 模組 | 職責 |
|------|------|
| **AgentLoader** | 掃描 agents/ 目錄，載入並解析配置 |
| **ConfigTransformer** | 將 AgentConfig 轉換為 SDK Options（單一職責） |
| **SessionStore** | 管理 platform + userId → Session 的對應 |
| **AdapterRegistry** | 管理多個 Adapter 實例 |
| **BaseAdapter** | 定義統一通訊介面 |
| **TelegramAdapter** | Telegram 平台實作（使用 grammy） |
| **EventBus** | 事件發布訂閱機制 |

---

## 5. 專案目錄結構

```
ClaudeCab/
├── src/
│   ├── core/
│   │   ├── AgentLoader.ts           # 載入 agents/ 目錄
│   │   ├── ConfigTransformer.ts     # 配置轉換（AgentConfig → SDK Options）
│   │   ├── SessionStore.ts          # Session 管理
│   │   ├── AdapterRegistry.ts       # Adapter 註冊中心
│   │   ├── EventBus.ts              # 事件發布訂閱
│   │   └── index.ts
│   │
│   ├── adapters/
│   │   ├── types.ts                 # 統一訊息格式
│   │   ├── BaseAdapter.ts           # 介面卡基類
│   │   └── TelegramAdapter.ts       # Telegram 實作
│   │
│   ├── types/
│   │   ├── agent.ts                 # Agent 配置類型
│   │   ├── hook.ts                  # Hook 類型
│   │   ├── session.ts               # Session 類型
│   │   ├── events.ts                # 事件類型
│   │   ├── errors.ts                # 錯誤類型
│   │   └── index.ts
│   │
│   ├── utils/
│   │   ├── logger.ts                # 日誌（pino）
│   │   └── errors.ts                # 錯誤處理
│   │
│   └── index.ts                     # 程式進入點
│
├── agents/                          # 目錄即代理
│   ├── general/
│   │   ├── agent.json              # 基本配置
│   │   ├── CLAUDE.md        # System Prompt
│   │   ├── hooks.ts                # TypeScript Hooks（可選）
│   │   └── mcp.json                # MCP 伺服器（可選）
│   │
│   └── coder/
│       ├── agent.json
│       ├── CLAUDE.md
│       └── hooks.ts
│
├── data/                            # 執行時資料
│   └── sessions/                    # Session 快照
│
├── tests/
│   ├── unit/
│   └── integration/
│
├── docs/
│   ├── architecture.md              # 本文件
│   └── implementation.md            # 實作計劃
│
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## 6. 核心類型定義

### 6.1 AgentConfig（agent.json Schema）

```typescript
/**
 * agent.json 的 Schema
 */
export interface AgentConfig {
  // 基本資訊
  name: string;
  description?: string;
  version?: string;
  extends?: string;                  // 繼承自其他 Agent

  // Model 配置
  model?: 'sonnet' | 'opus' | 'haiku';
  maxTokens?: number;
  maxThinkingTokens?: number;

  // Prompt 配置
  systemPrompt?: string;             // 直接寫入
  systemPromptFile?: string;         // 或從檔案載入（預設：CLAUDE.md）

  // 工具配置
  allowedTools?: string[];
  disallowedTools?: string[];

  // MCP 配置
  mcpConfigFile?: string;            // 預設：mcp.json

  // 額外設定
  settings?: {
    maxHistoryLength?: number;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
    maxTurns?: number;
    maxBudgetUsd?: number;           // 成本控制
  };
}
```

### 6.2 LoadedAgent（載入後的 Agent 實例）

```typescript
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * 載入後的完整 Agent 實例
 * 注意：toSDKOptions() 已移至 ConfigTransformer
 */
export interface LoadedAgent {
  id: string;                        // 目錄名稱
  path: string;                      // 完整路徑
  config: AgentConfig;
  systemPrompt: string;              // 解析後的 prompt
  hooks?: AgentHooks;
  mcpServers?: Record<string, McpServerConfig>;
}
```

### 6.3 AgentHooks（Hooks 定義）

```typescript
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';

/**
 * Agent 的 Hooks 定義
 * 對應 SDK 的 HookEvent
 */
export interface AgentHooks {
  preToolUse?: HookCallback;
  postToolUse?: HookCallback;
  postToolUseFailure?: HookCallback;
  notification?: HookCallback;
  userPromptSubmit?: HookCallback;
  sessionStart?: HookCallback;
  sessionEnd?: HookCallback;
  stop?: HookCallback;
  subagentStart?: HookCallback;
  subagentStop?: HookCallback;
  preCompact?: HookCallback;
  permissionRequest?: HookCallback;
}
```

### 6.4 UserSession（Session 定義）

```typescript
import type { Query } from '@anthropic-ai/claude-agent-sdk';

export type SessionState = 'idle' | 'processing' | 'error';

export interface UserSession {
  sessionId: string;
  agentId: string;
  platform: string;
  userId: string;
  query: Query;
  state: SessionState;
  createdAt: Date;
  lastActiveAt: Date;
}
```

### 6.5 UnifiedMessage（統一訊息格式）

```typescript
export interface UnifiedMessage {
  id: string;                        // 訊息 ID（用於冪等性檢查）
  platform: string;
  userId: string;
  chatId: string;
  text: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface SendOptions {
  parseMode?: 'Markdown' | 'HTML';
  replyToMessageId?: string;
}
```

### 6.6 事件類型（新增）

```typescript
export type EventMap = {
  'message:received': UnifiedMessage;
  'message:sent': { chatId: string; text: string };
  'session:created': UserSession;
  'session:closed': { sessionId: string; reason: string };
  'session:switched': { oldAgentId: string; newAgentId: string };
  'agent:loaded': LoadedAgent;
  'agent:reloaded': LoadedAgent;
  'error': ClaudeCabError;
};
```

### 6.7 錯誤類型（新增）

```typescript
export class ClaudeCabError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean,
    public readonly userMessage?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ClaudeCabError';
  }
}

export class AgentLoadError extends ClaudeCabError {
  constructor(agentId: string, cause: Error) {
    super(
      `Failed to load agent "${agentId}": ${cause.message}`,
      'AGENT_LOAD_FAILED',
      true,
      '代理載入失敗，請檢查配置',
      cause
    );
  }
}

export class SessionError extends ClaudeCabError {
  constructor(code: 'NOT_FOUND' | 'SDK_ERROR' | 'TIMEOUT', message: string) {
    super(message, `SESSION_${code}`, code !== 'SDK_ERROR', '對話處理失敗');
  }
}

export class RateLimitError extends ClaudeCabError {
  constructor(public readonly retryAfter: number) {
    super(
      `Rate limited, retry after ${retryAfter}ms`,
      'RATE_LIMITED',
      true,
      '請求過於頻繁，請稍後再試'
    );
  }
}
```

---

## 7. 核心模組設計

### 7.1 AgentLoader

**職責**：
- 掃描 `agents/` 目錄
- 載入並解析 agent.json
- 載入 CLAUDE.md
- 動態載入 hooks.ts
- 載入 mcp.json
- 處理 Agent 繼承（extends）

**主要 API**：

```typescript
interface IAgentRepository {
  get(agentId: string): LoadedAgent | undefined;
  list(): string[];
}

class AgentLoader implements IAgentRepository {
  constructor(agentsDir?: string);

  loadAll(): Promise<LoadedAgent[]>;
  loadAgent(agentId: string): Promise<LoadedAgent>;
  get(agentId: string): LoadedAgent | undefined;
  list(): string[];
  reloadAgent(agentId: string): Promise<LoadedAgent>;
  watch(): void;
  unwatch(): void;
}
```

### 7.2 ConfigTransformer（新增）

**職責**：
- 將 LoadedAgent 轉換為 SDK Options
- 單一職責，便於測試與維護

**主要 API**：

```typescript
import type { Options } from '@anthropic-ai/claude-agent-sdk';

class ConfigTransformer {
  toSDKOptions(agent: LoadedAgent): Partial<Options>;

  // 合併多個配置（用於繼承）
  mergeConfigs(base: AgentConfig, override: AgentConfig): AgentConfig;
}
```

### 7.3 SessionStore

**職責**：
- 管理 platform + userId → Session 的對應
- 處理 Session 建立、取得、切換
- Session 狀態機管理
- Session 超時清理

**主要 API**：

```typescript
class SessionStore {
  constructor(
    private readonly agents: IAgentRepository,
    private readonly transformer: ConfigTransformer,
    private readonly eventBus: EventBus
  );

  getSession(platform: string, userId: string): UserSession | undefined;

  createSession(
    platform: string,
    userId: string,
    agentId: string
  ): Promise<UserSession>;

  switchAgent(
    platform: string,
    userId: string,
    newAgentId: string
  ): Promise<UserSession>;

  closeSession(platform: string, userId: string): void;
  cleanupExpired(maxIdleMs?: number): void;

  // 取得 Session Key（使用雙冒號避免碰撞）
  private getSessionKey(platform: string, userId: string): string {
    return `${platform}::${userId}`;
  }
}
```

### 7.4 AdapterRegistry（新增）

**職責**：
- 管理多個 Adapter 實例
- 統一生命週期管理

**主要 API**：

```typescript
class AdapterRegistry {
  register(adapter: BaseAdapter): void;
  get(platform: string): BaseAdapter | undefined;
  getAll(): BaseAdapter[];

  async startAll(): Promise<void>;
  async stopAll(): Promise<void>;
}
```

### 7.5 EventBus（新增）

**職責**：
- 提供事件發布訂閱機制
- 支援多訂閱者

**主要 API**：

```typescript
class EventBus {
  on<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void
  ): void;

  off<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void
  ): void;

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void;
}
```

### 7.6 BaseAdapter

**職責**：
- 定義統一的通訊介面
- 訊息格式標準化

**主要 API**：

```typescript
abstract class BaseAdapter {
  abstract readonly platform: string;

  abstract initialize(): Promise<void>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract dispose(): Promise<void>;  // 資源清理
  abstract isReady(): boolean;        // 狀態檢查

  abstract sendMessage(
    chatId: string,
    text: string,
    options?: SendOptions
  ): Promise<void>;

  onMessage(handler: (msg: UnifiedMessage) => void): void;
}
```

---

## 8. 資料流

```
使用者發送訊息
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Adapter 接收訊息                                              │
│     - TelegramAdapter (grammy) 接收 Telegram 訊息                 │
│     - 轉換為 UnifiedMessage                                       │
│     - EventBus.emit('message:received', msg)                     │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. SessionStore 處理                                            │
│     - 冪等性檢查（已處理過的 message_id 跳過）                      │
│     - 查詢現有 Session                                            │
│     - 或建立新 Session（使用 AgentLoader + ConfigTransformer）     │
│     - 更新 Session 狀態為 'processing'                            │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Claude Agent SDK                                             │
│     - 使用 ConfigTransformer.toSDKOptions() 取得配置              │
│     - 呼叫 query() 或使用 resume 繼續 session                     │
│     - SDK 內部處理 hooks、MCP、工具執行                           │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 串流處理回應                                                   │
│     - for await (const msg of session.query)                     │
│     - 根據 msg.type 處理不同訊息類型                               │
│     - 錯誤處理與重試邏輯                                           │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Adapter 發送回應                                              │
│     - 長訊息分割（Telegram 上限 4096 字元）                        │
│     - adapter.sendMessage() 發送給使用者                          │
│     - 更新 Session 狀態為 'idle'                                  │
│     - EventBus.emit('message:sent', ...)                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Agent 配置範例

### agents/general/agent.json

```json
{
  "name": "General Assistant",
  "description": "通用助理，可以處理各種問題",
  "version": "1.0.0",
  "model": "sonnet",
  "systemPromptFile": "CLAUDE.md",
  "allowedTools": ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
  "settings": {
    "maxHistoryLength": 50,
    "permissionMode": "default",
    "maxBudgetUsd": 1.0
  }
}
```

### agents/general/CLAUDE.md

```markdown
你是一個友善且專業的助理。

## 行為準則
- 以繁體中文回應
- 保持簡潔明瞭
- 需要時主動詢問更多資訊

## 能力範圍
- 回答一般問題
- 協助搜尋資料
- 提供建議和分析
```

### agents/general/hooks.ts

```typescript
import type { HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';

export const preToolUse: HookCallback = async (input, toolUseId, { signal }) => {
  const preInput = input as PreToolUseHookInput;
  console.log(`[Hook] Tool "${preInput.tool_name}" is about to be used`);

  // 範例：攔截危險指令
  if (preInput.tool_name === 'Bash') {
    const command = (preInput.tool_input as any).command as string;
    if (command.includes('rm -rf')) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: '危險操作被攔截'
        }
      };
    }
  }

  return {};
};

export const sessionStart: HookCallback = async (input) => {
  console.log(`[Hook] Session started: ${input.session_id}`);
  return {};
};
```

### agents/general/mcp.json

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "./data"]
  }
}
```

---

## 10. 風險評估

### 技術風險

| 風險 | 影響 | 機率 | 緩解策略 |
|------|------|------|---------|
| Claude API 呼叫限制 | 高 | 中 | 使用 `maxBudgetUsd` 控制成本 |
| SDK 版本變更 | 高 | 中 | 鎖定版本，關注 changelog |
| Telegram API 限流 | 高 | 中 | 實作請求佇列與速率限制 |
| hooks.ts 動態載入 | 中 | 中 | 使用 `pathToFileURL()` 處理 Windows 路徑 |
| Session 記憶體洩漏 | 中 | 低 | 定期清理過期 Session |
| 並發競態條件 | 高 | 中 | 同一用戶請求使用 mutex/佇列 |

### 效能考量

| 項目 | 目標 | 緩解策略 |
|------|------|---------|
| Agent 載入時間 | < 1 秒（10 個 Agent）| 延遲載入，首次使用時才載入 |
| 訊息回應延遲 | < 2 秒（不含 API）| 串流回應，即時顯示 |
| Session 數量 | 上限 1000 | 設定上限，定期清理 |
| 記憶體使用 | < 500MB（1000 Session）| 監控與限制 |

---

## 11. 擴充性設計

### 新增平台

1. 繼承 `BaseAdapter` 並實作必要方法
2. 在 `AdapterRegistry` 註冊

```typescript
class DiscordAdapter extends BaseAdapter {
  readonly platform = 'discord';

  async initialize() { /* ... */ }
  async start() { /* ... */ }
  async stop() { /* ... */ }
  async dispose() { /* ... */ }
  isReady() { /* ... */ }
  async sendMessage(chatId: string, text: string) { /* ... */ }
}

// 註冊
adapterRegistry.register(new DiscordAdapter(token));
```

### 新增 Agent

在 `agents/` 目錄建立新資料夾：

```
agents/
└── my-new-agent/
    ├── agent.json           # 必要
    ├── CLAUDE.md     # 建議
    ├── hooks.ts             # 可選
    └── mcp.json             # 可選
```

### Agent 繼承

```json
{
  "name": "Coder",
  "extends": "general",
  "allowedTools": ["Read", "Write", "Edit", "Bash"]
}
```

---

## 12. 安全性考量

### 已規劃的安全機制

| 機制 | 說明 |
|------|------|
| 工具白名單 | 使用 `allowedTools` 限制可用工具 |
| 成本控制 | 使用 `maxBudgetUsd` 限制 API 成本 |
| 危險指令攔截 | 透過 `PreToolUse` Hook 攔截 |
| 冪等性檢查 | 防止重複處理同一訊息 |

### 待實作的安全機制

| 機制 | 優先級 | 說明 |
|------|--------|------|
| 用戶白名單 | P1 | 限制可使用 Bot 的用戶 |
| 審計日誌 | P1 | 記錄所有工具呼叫 |
| 敏感資料過濾 | P2 | 避免記錄敏感資訊 |
| Prompt Injection 防護 | P2 | 驗證用戶輸入 |

---

## 13. 參考資料

- [Claude Agent SDK - TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK - Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Claude Agent SDK - MCP](https://platform.claude.com/docs/en/agent-sdk/mcp)
- [Claude Agent SDK - Sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Claude Agent SDK - Hosting](https://platform.claude.com/docs/en/agent-sdk/hosting)
- [GitHub - claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [grammy - Telegram Bot Framework](https://grammy.dev/)

---

*文件版本：3.1.0（審查後更新）*
*建立日期：2026-01-26*
