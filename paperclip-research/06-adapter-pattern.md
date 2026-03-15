# Adapter 抽象層比對

## Paperclip: Multi-Runtime Adapter

### 概述
Paperclip 的 Adapter 是一個 **agent runtime 抽象層**。每種 agent runtime（Claude Code、Codex、Cursor、Gemini 等）都有對應的 adapter，負責：
1. 啟動 agent process
2. 傳遞 prompt 和 context
3. 收集 usage（token 數、cost）
4. 管理 session state
5. 環境檢查（是否安裝了所需 CLI）

### 支援的 Adapter（9 種）
| Adapter | Type | 說明 |
|---------|------|------|
| Claude Local | `claude_local` | 本地 Claude Code CLI |
| Codex Local | `codex_local` | OpenAI Codex CLI |
| Cursor | `cursor` | Cursor IDE |
| Gemini Local | `gemini_local` | Google Gemini CLI |
| OpenCode Local | `opencode_local` | OpenCode CLI |
| Pi Local | `pi_local` | Pi CLI |
| OpenClaw Gateway | `openclaw_gateway` | OpenClaw 雲端 |
| Process | `process` | 通用子程序（任意命令） |
| HTTP | `http` | HTTP API 呼叫 |

### Adapter Interface
```typescript
interface ServerAdapterModule {
  type: string;                          // adapter 識別碼
  execute: (ctx: AdapterExecutionContext) => Promise<AdapterExecutionResult>;
  testEnvironment?: (...) => Promise<AdapterEnvironmentTestResult>;
  sessionCodec?: AdapterSessionCodec;    // Session 序列化/反序列化
  models?: AdapterModel[];               // 支援的模型列表
  listModels?: () => Promise<AdapterModel[]>;
  supportsLocalAgentJwt: boolean;        // 是否支援 JWT 認證
  agentConfigurationDoc?: string;        // 設定說明文件
  hireApprovedHook?: (...) => Promise<HireApprovedHookResult>;
}
```

### Execution Context
```typescript
interface AdapterExecutionContext {
  agent: AdapterAgent;        // agent 基本資訊
  runtime: AdapterRuntime;    // session state + taskKey
  // ... invocation meta, workspace info, etc.
}
```

### Execution Result
```typescript
interface AdapterExecutionResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  errorMessage?: string;
  usage?: UsageSummary;       // { inputTokens, outputTokens, cachedInputTokens }
  sessionId?: string;         // Legacy
  sessionParams?: Record<string, unknown>;  // New: adapter-specific session state
  provider?: string;
  model?: string;
  billingType?: AdapterBillingType;  // "api" | "subscription" | "unknown"
  costUsd?: number;
  resultJson?: Record<string, unknown>;
  summary?: string;
  clearSession?: boolean;
  question?: { ... };         // 向人類提問
}
```

### Session Codec（關鍵設計）
```typescript
interface AdapterSessionCodec {
  deserialize(raw: unknown): Record<string, unknown> | null;
  serialize(params: Record<string, unknown> | null): Record<string, unknown> | null;
  getDisplayId?(params: Record<string, unknown> | null): string | null;
}
```
每個 adapter 知道如何序列化/反序列化自己的 session。Core 不需要知道 session 內部結構。

### 環境檢查
```typescript
interface AdapterEnvironmentTestResult {
  status: "pass" | "fail" | "warn";
  checks: AdapterEnvironmentCheck[];
}
```
- 檢查 CLI 是否安裝、版本是否相容
- UI 上顯示環境狀態

---

## ClaudeCab: BaseAdapter + Platform Adapters

### 概述
ClaudeCab 的 Adapter 是一個 **通訊平台抽象層**。每種平台（Telegram、Discord）有對應的 adapter，負責：
1. 連接到平台
2. 接收使用者訊息
3. 發送回應訊息
4. 處理 permission/question 互動 UI

### 支援的 Adapter
| Adapter | 說明 |
|---------|------|
| TelegramAdapter | Telegram Bot API |
| DiscordAdapter | Discord Bot（新增中） |

### BaseAdapter 抽象類別（442 行）
```typescript
abstract class BaseAdapter<TConfig extends AdapterConfig> {
  // Lifecycle
  abstract doInitialize(): Promise<void>;
  abstract doStart(): Promise<void>;
  abstract doStop(): Promise<void>;
  abstract doDispose(): Promise<void>;

  // Message I/O
  abstract sendMessage(chatId, text, options?): Promise<SendResult>;
  abstract sendTypingIndicator(chatId): Promise<void>;

  // Media（可選覆寫）
  async sendPhoto(chatId, filePath, caption?): Promise<SendResult>;
  async sendDocument(chatId, filePath, caption?): Promise<SendResult>;
  async sendAudio(chatId, audio, options?): Promise<SendResult>;
  async sendVideo(chatId, filePath, caption?): Promise<SendResult>;

  // Interactive UI
  async sendPermissionPrompt(chatId, options): Promise<PermissionPromptResult>;
  async sendQuestionPrompt(chatId, options): Promise<QuestionPromptResult>;
  async sendExitPlanModePrompt(chatId, options): Promise<ExitPlanModePromptResult>;

  // Resolvers（平台回調）
  setPermissionResolver(resolver): void;
  setQuestionResolver(resolver): void;
  setExitPlanModeResolver(resolver): void;
}
```

### State Machine
```
uninitialized → initializing → ready → starting → running → stopping → stopped
                                                                    ↓
                                                                  error
```

---

## 本質差異

**Paperclip Adapter = Agent Runtime 驅動器**
- 封裝不同 AI agent 工具（Claude Code CLI、Cursor、Codex）
- 負責「啟動 agent 做事」
- 無 UI 通訊職責

**ClaudeCab Adapter = 通訊平台驅動器**
- 封裝不同聊天平台（Telegram、Discord）
- 負責「接收訊息、發送回應」
- 無 agent runtime 職責

這是 **完全不同的抽象維度**。

## 比對分析

| 面向 | Paperclip | ClaudeCab |
|------|-----------|-----------|
| **抽象目標** | Agent runtime（如何執行 AI） | 通訊平台（如何收發訊息） |
| **支援數量** | 9 種 adapter | 2 種 adapter |
| **Session 管理** | ✅ Session codec per adapter | 不在 adapter 層（在 SessionManager） |
| **Usage 追蹤** | ✅ Adapter 回報 usage | 不在 adapter 層（在 SDK 層） |
| **Lifecycle** | execute() → result | init → start → stop → dispose |
| **多媒體** | 無（純 CLI 交互） | ✅ photo/doc/audio/video |
| **Interactive UI** | question（向人類提問） | permission/question/planReview |
| **環境檢查** | ✅ testEnvironment() | 無 |

## 值得借鑑

### 🟢 P2：Environment Check
- 在啟動時檢查所需外部工具是否可用
- ClaudeCab 可以在 `doInitialize()` 加入 Claude SDK 可用性檢查
- 但目前只用 Claude SDK，不太需要

### 💡 觀察：不同抽象，不衝突
- ClaudeCab 如果要支援多 agent runtime（不只 Claude Code）
- 需要新增一層 "Runtime Adapter"（類似 Paperclip 的 adapter）
- 現有的 "Platform Adapter" 保持不變
- 兩層可以正交存在

### 🟢 P2：Session Codec
- 如果未來支援 Codex、Cursor 等 runtime
- 每種 runtime 的 session format 不同
- Codec pattern 是乾淨的抽象方式
- 但目前只用 Claude Code，不急需
