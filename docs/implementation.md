# ClaudeCab 實作計劃

> 基於架構審查與 SDK 研究後的更新版（2026-01-26）

---

## 專案概況

| 項目 | 說明 |
|------|------|
| 專案狀態 | 初始化階段，僅有架構設計文檔 |
| 複雜度 | M（中型）- 因 SDK 內建多數功能 |
| 核心模組 | AgentLoader, ConfigTransformer, SessionStore, EventBus, AdapterRegistry, TelegramAdapter |
| 技術棧 | TypeScript 5.x, Node.js >= 18, Claude Agent SDK 0.2.x, grammy |

---

## 開發階段總覽

```
Phase 1 ─► Phase 2 ─► Phase 3 ─► Phase 4 ─► Phase 5 ─► Phase 5.5 ─► Phase 6 ─► Phase 7
 專案初始化   類型定義   AgentLoader  SessionStore  Telegram    安全性強化   整合測試   進階功能
  (0.5d)     (0.5d)     (2d)        (1.5d)       (2d)        (1d)        (1.5d)    (可選)
```

**預估總工時：9 天**

---

## Phase 1: 專案初始化

**目標**：建立 TypeScript 專案骨架

### 任務清單

- [ ] 1.1 初始化 npm 專案
  ```bash
  npm init -y
  ```
  - 設定 `"type": "module"` 啟用 ESM
  - 設定 `"engines": { "node": ">=18.0.0" }`

- [ ] 1.2 安裝依賴
  ```bash
  # 主要依賴
  npm install @anthropic-ai/claude-agent-sdk zod grammy dotenv uuid pino

  # 開發依賴
  npm install -D typescript @types/node @types/uuid tsx vitest eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser prettier
  ```

- [ ] 1.3 配置 tsconfig.json
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "strict": true,
      "outDir": "dist",
      "rootDir": "src",
      "declaration": true,
      "esModuleInterop": true,
      "skipLibCheck": true
    },
    "include": ["src/**/*"],
    "exclude": ["node_modules", "dist"]
  }
  ```

- [ ] 1.4 配置 package.json scripts
  ```json
  {
    "scripts": {
      "dev": "tsx watch src/index.ts",
      "build": "tsc",
      "start": "node dist/index.js",
      "test": "vitest",
      "test:coverage": "vitest --coverage",
      "lint": "eslint src --ext .ts",
      "lint:fix": "eslint src --ext .ts --fix"
    }
  }
  ```

- [ ] 1.5 建立目錄結構
  ```
  src/
  ├── core/
  ├── adapters/
  ├── types/
  ├── utils/
  └── index.ts
  agents/
  └── general/
  tests/
  ├── unit/
  └── integration/
  ```

- [ ] 1.6 建立 .env.example
  ```
  # Anthropic
  ANTHROPIC_API_KEY=

  # Telegram
  TELEGRAM_BOT_TOKEN=

  # App Config
  DEFAULT_AGENT=general
  LOG_LEVEL=info
  SESSION_TIMEOUT_MS=1800000
  MAX_SESSIONS=1000
  ```

- [ ] 1.7 建立 .gitignore
  ```
  node_modules/
  dist/
  .env
  *.log
  data/sessions/
  ```

- [ ] 1.8 配置 ESLint + Prettier

- [ ] 1.9 建立基礎 Logger (src/utils/logger.ts)
  ```typescript
  import pino from 'pino';

  export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  });
  ```

### 驗收標準

- [ ] `npm run dev` 可執行並輸出歡迎訊息
- [ ] `npm run build` TypeScript 編譯無錯誤
- [ ] `npm run lint` 無 ESLint 錯誤
- [ ] 目錄結構完整且符合設計

---

## Phase 2: 類型定義

**目標**：定義核心類型與 Schema

### 任務清單

- [ ] 2.1 建立 Agent 配置類型 (src/types/agent.ts)
  - `AgentConfig` interface
  - `LoadedAgent` interface
  - 使用 Zod 建立 `AgentConfigSchema`

- [ ] 2.2 建立 Hook 類型 (src/types/hook.ts)
  - `AgentHooks` interface
  - 對應 SDK 的 HookCallback

- [ ] 2.3 建立 Session 類型 (src/types/session.ts)
  - `SessionState` type
  - `UserSession` interface

- [ ] 2.4 建立事件類型 (src/types/events.ts)
  - `EventMap` type

- [ ] 2.5 建立錯誤類型 (src/types/errors.ts)
  - `ClaudeCabError` base class
  - `AgentLoadError`
  - `SessionError`
  - `RateLimitError`

- [ ] 2.6 建立 Adapter 類型 (src/adapters/types.ts)
  - `UnifiedMessage` interface
  - `SendOptions` interface

- [ ] 2.7 建立類型匯出 (src/types/index.ts)

### 驗收標準

- [ ] 所有類型定義完整
- [ ] TypeScript 編譯無錯誤且無 `any` 類型
- [ ] Zod Schema 可正確驗證 agent.json
- [ ] 類型與 SDK 相容

### 測試案例

```typescript
import { AgentConfigSchema } from './types/agent';

// 有效配置
const validConfig = {
  name: 'Test Agent',
  model: 'sonnet'
};
expect(() => AgentConfigSchema.parse(validConfig)).not.toThrow();

// 無效配置
const invalidConfig = { model: 'invalid-model' };
expect(() => AgentConfigSchema.parse(invalidConfig)).toThrow();
```

---

## Phase 3: AgentLoader 與 ConfigTransformer

**目標**：實作 Agent 目錄載入器與配置轉換器

### 任務清單

- [ ] 3.1 實作 EventBus (src/core/EventBus.ts)
  - 事件發布訂閱機制
  - 支援多訂閱者
  - 類型安全的事件處理

- [ ] 3.2 實作目錄掃描
  - 掃描 `agents/` 目錄
  - 過濾有效的 Agent 目錄（包含 agent.json）

- [ ] 3.3 實作 agent.json 載入
  - 讀取 JSON 檔案
  - 使用 Zod Schema 驗證
  - 錯誤處理（檔案不存在、格式錯誤）

- [ ] 3.4 實作 CLAUDE.md 載入
  - 支援 `systemPrompt` 直接定義
  - 支援 `systemPromptFile` 從檔案載入
  - 預設讀取 `CLAUDE.md`

- [ ] 3.5 實作 hooks.ts 動態載入
  - 使用 `pathToFileURL()` 處理 Windows 路徑
  - 使用動態 import 載入
  - 驗證 export 的 hooks 格式
  - 處理載入失敗情況（hooks 為可選）

- [ ] 3.6 實作 mcp.json 載入
  - 讀取 MCP 伺服器配置
  - 轉換為 SDK 格式

- [ ] 3.7 實作 Agent 繼承 (extends)
  - 解析 `extends` 欄位
  - 合併父 Agent 配置
  - 檢測循環繼承

- [ ] 3.8 實作 ConfigTransformer (src/core/ConfigTransformer.ts)
  - `toSDKOptions()` 方法
  - `mergeConfigs()` 方法

- [ ] 3.9 實作配置快取
  - 避免重複讀取檔案
  - 支援 reloadAgent 清除快取

- [ ] 3.10 建立範例 Agent (agents/general/)
  - agent.json
  - CLAUDE.md
  - hooks.ts（基本範例）

### 驗收標準

- [ ] 可正確載入 agents/general/
- [ ] 配置驗證失敗時拋出明確錯誤（AgentLoadError）
- [ ] toSDKOptions() 產出可被 SDK 使用的配置
- [ ] hooks.ts 動態載入成功（含 Windows 路徑）
- [ ] 載入 10 個 Agent 耗時 < 1 秒

### 測試案例

```typescript
// 成功載入
const loader = new AgentLoader('./agents');
await loader.loadAll();

const agent = loader.get('general');
expect(agent).toBeDefined();
expect(agent?.config.name).toBe('General Assistant');
expect(agent?.systemPrompt.length).toBeGreaterThan(0);

// SDK Options 轉換
const transformer = new ConfigTransformer();
const options = transformer.toSDKOptions(agent!);
expect(options.systemPrompt).toBe(agent?.systemPrompt);

// 錯誤處理
await expect(loader.loadAgent('nonexistent'))
  .rejects.toThrow(AgentLoadError);

// Agent 繼承
const coderAgent = loader.get('coder');
expect(coderAgent?.config.extends).toBe('general');
```

---

## Phase 4: SessionStore

**目標**：實作多用戶 Session 管理

### 任務清單

- [ ] 4.1 實作 Session 儲存結構
  - Map<string, UserSession> 以 `${platform}::${userId}` 為 key
  - 使用雙冒號避免 userId 包含單冒號時的碰撞

- [ ] 4.2 實作 getSession()
  - 查詢現有 Session
  - 更新 lastActiveAt

- [ ] 4.3 實作 createSession()
  - 建立新 Session
  - 使用 UUID 生成 sessionId
  - 整合 AgentLoader + ConfigTransformer 取得配置
  - 呼叫 SDK 的 query() 建立對話
  - 發布 'session:created' 事件

- [ ] 4.4 實作 Session 狀態機
  - `idle` → `processing` → `idle`/`error`
  - 防止同一 Session 並發處理

- [ ] 4.5 實作 switchAgent()
  - 關閉現有 Session
  - 使用新 Agent 建立新 Session
  - 發布 'session:switched' 事件

- [ ] 4.6 實作 closeSession()
  - 清理 Session 資源
  - 發布 'session:closed' 事件

- [ ] 4.7 實作 cleanupExpired()
  - 清理超時 Session（預設 30 分鐘）
  - 可配置清理間隔
  - 定時器自動執行

- [ ] 4.8 實作冪等性檢查
  - 記錄已處理的 message_id
  - 防止重複處理同一訊息

- [ ] 4.9 實作並發控制
  - 同一用戶的請求使用 mutex/佇列
  - 防止競態條件

### 驗收標準

- [ ] 可正確建立和取得 Session
- [ ] Agent 切換功能正常
- [ ] 超時清理機制運作
- [ ] 不同用戶的 Session 完全隔離
- [ ] 冪等性檢查正常
- [ ] 1000 個並發 Session 記憶體 < 500MB

### 測試案例

```typescript
const eventBus = new EventBus();
const loader = new AgentLoader('./agents');
const transformer = new ConfigTransformer();
const store = new SessionStore(loader, transformer, eventBus);

// 建立 Session
const session1 = await store.createSession('telegram', 'user123', 'general');
expect(session1.agentId).toBe('general');
expect(session1.state).toBe('idle');

// 取得 Session
const retrieved = store.getSession('telegram', 'user123');
expect(retrieved?.sessionId).toBe(session1.sessionId);

// 不同用戶隔離
const session2 = await store.createSession('telegram', 'user456', 'general');
expect(session1.sessionId).not.toBe(session2.sessionId);

// 切換 Agent
const newSession = await store.switchAgent('telegram', 'user123', 'coder');
expect(newSession.agentId).toBe('coder');
expect(newSession.sessionId).not.toBe(session1.sessionId);

// 冪等性
const processed = store.isMessageProcessed('msg-123');
expect(processed).toBe(false);
store.markMessageProcessed('msg-123');
expect(store.isMessageProcessed('msg-123')).toBe(true);

// 並發測試
const promises = Array.from({ length: 100 }, (_, i) =>
  store.createSession('telegram', `user${i}`, 'general')
);
const sessions = await Promise.all(promises);
const uniqueIds = new Set(sessions.map(s => s.sessionId));
expect(uniqueIds.size).toBe(100);
```

---

## Phase 5: TelegramAdapter

**目標**：實作 Telegram 通訊介面卡（使用 grammy）

### 任務清單

- [ ] 5.1 實作 BaseAdapter 抽象類 (src/adapters/BaseAdapter.ts)
  - 定義統一介面
  - EventEmitter 機制
  - `dispose()` 方法
  - `isReady()` 方法

- [ ] 5.2 實作 AdapterRegistry (src/core/AdapterRegistry.ts)
  - 註冊/取得 Adapter
  - `startAll()` / `stopAll()`

- [ ] 5.3 實作 TelegramAdapter (src/adapters/TelegramAdapter.ts)
  - 整合 grammy
  - Polling 模式（預設）

- [ ] 5.4 實作訊息接收
  - 監聽 Telegram 訊息
  - 轉換為 UnifiedMessage 格式
  - 透過 EventBus 發布 'message:received'

- [ ] 5.5 實作訊息發送
  - sendMessage() 方法
  - 支援長訊息分割（Telegram 上限 4096 字元）
  - 支援 Markdown 格式
  - 支援 typing indicator

- [ ] 5.6 實作速率限制
  - 請求佇列
  - 最小請求間隔 35ms（Telegram 限制約 30 msg/sec）

- [ ] 5.7 整合 SessionStore
  - 訊息來時查詢/建立 Session
  - 冪等性檢查（跳過已處理的 message_id）
  - 呼叫 SDK 處理訊息
  - 串流回應給用戶

- [ ] 5.8 實作指令處理
  - `/start` - 歡迎訊息
  - `/help` - 幫助資訊
  - `/switch <agent>` - 切換 Agent
  - `/list` - 列出可用 Agent
  - `/reset` - 重置對話

- [ ] 5.9 實作錯誤處理
  - API 錯誤重試（指數退避）
  - 用戶友善錯誤訊息
  - 記錄錯誤日誌

- [ ] 5.10 實作 Webhook 模式支援（可選）

### 驗收標準

- [ ] Bot 可正常啟動並接收訊息
- [ ] 訊息可正確轉發給 Claude SDK
- [ ] 串流回應可即時顯示
- [ ] 指令功能正常
- [ ] 錯誤處理完善
- [ ] 訊息回應延遲 < 2 秒（不含 Claude API 時間）

### 測試案例

```typescript
const adapter = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN!);
await adapter.initialize();

// 測試訊息轉換
const telegramMsg = {
  message_id: 123,
  from: { id: 456 },
  chat: { id: 789 },
  text: 'Hello',
  date: Date.now() / 1000
};
const unified = adapter.normalizeMessage(telegramMsg);
expect(unified.id).toBe('123');
expect(unified.userId).toBe('456');
expect(unified.text).toBe('Hello');

// 測試長訊息分割
const longText = 'a'.repeat(5000);
const chunks = adapter.splitMessage(longText);
expect(chunks.length).toBe(2);
expect(chunks[0].length).toBeLessThanOrEqual(4096);

// 測試速率限制
const rateLimiter = adapter.getRateLimiter();
const start = Date.now();
await Promise.all([
  rateLimiter.enqueue(() => Promise.resolve()),
  rateLimiter.enqueue(() => Promise.resolve()),
  rateLimiter.enqueue(() => Promise.resolve())
]);
const elapsed = Date.now() - start;
expect(elapsed).toBeGreaterThanOrEqual(70); // 至少 2 * 35ms
```

---

## Phase 5.5: 安全性強化（新增）

**目標**：實作基本安全機制

### 任務清單

- [ ] 5.5.1 實作用戶白名單
  - 配置允許使用 Bot 的用戶 ID 列表
  - 支援環境變數配置 `ALLOWED_USERS`
  - 未授權用戶收到拒絕訊息

- [ ] 5.5.2 實作審計日誌 (src/utils/audit.ts)
  - 記錄所有工具呼叫
  - 記錄用戶操作
  - 使用 pino 結構化日誌

- [ ] 5.5.3 實作輸入驗證
  - 訊息長度限制
  - 基本 Prompt Injection 檢測

- [ ] 5.5.4 實作敏感指令確認
  - 危險操作二次確認
  - 配置需確認的指令模式

### 驗收標準

- [ ] 未授權用戶無法使用 Bot
- [ ] 所有工具呼叫都有審計記錄
- [ ] 過長或可疑輸入被拒絕

---

## Phase 6: 整合測試

**目標**：端對端測試與優化

### 任務清單

- [ ] 6.1 建立 CLI 測試工具 (src/cli.ts)
  - 不透過 Telegram 直接測試
  - 便於開發除錯
  - 支援指定 Agent

- [ ] 6.2 建立整合測試腳本
  - 模擬完整對話流程
  - 測試 Agent 切換
  - 測試錯誤處理流程
  - 測試並發場景

- [ ] 6.3 效能測試
  - Agent 載入時間（目標 < 1 秒）
  - 訊息處理延遲（目標 < 2 秒）
  - 記憶體使用監控

- [ ] 6.4 撰寫 README.md
  - 快速開始指南
  - 配置說明
  - Agent 建立指南
  - 常見問題

- [ ] 6.5 建立 Docker 配置
  - Dockerfile
  - docker-compose.yml
  - 多階段建構優化

### 驗收標準

- [ ] 完整對話流程測試通過
- [ ] 多用戶並發測試通過
- [ ] 效能指標達標
- [ ] 文件完整
- [ ] Docker 可正常部署

### 測試場景

| 場景 | 描述 | 預期結果 |
|------|------|---------|
| 正常對話 | 用戶發送訊息並收到回應 | 回應正確且延遲 < 2 秒 |
| Agent 切換 | 使用 /switch 切換 Agent | 新 Agent 配置生效 |
| 錯誤恢復 | SDK 錯誤後重新發送訊息 | 系統正常恢復 |
| 並發處理 | 10 用戶同時發送訊息 | 所有用戶都收到回應 |
| Session 超時 | 用戶 30 分鐘未活動 | Session 被自動清理 |

---

## Phase 7: 進階功能（可選）

### 7.1 熱重載

- [ ] 使用 chokidar 監控 agents/ 目錄
- [ ] 檔案變更時自動重載 Agent
- [ ] 不中斷現有 Session

### 7.2 Web UI 管理介面

- [ ] Express 伺服器
- [ ] Agent 列表查看
- [ ] Session 監控
- [ ] 配置編輯器

### 7.3 其他平台 Adapter

- [ ] DiscordAdapter
- [ ] LineAdapter

### 7.4 Session 持久化

- [ ] SQLite 儲存
- [ ] 重啟後恢復對話

---

## 開發指引

### 程式碼風格

- 使用 ESLint + Prettier
- 函式與類別使用 JSDoc 註解
- 錯誤處理使用自訂 Error 類別
- 非同步操作一律使用 async/await
- 禁止使用 `any` 類型

### 日誌規範

```typescript
// 日誌層級
logger.debug('詳細除錯資訊');
logger.info('一般資訊');
logger.warn('警告訊息');
logger.error({ err }, '錯誤訊息');

// 結構化日誌
logger.info({
  event: 'session_created',
  sessionId: session.sessionId,
  agentId: session.agentId,
  platform: session.platform
}, 'Session created');
```

### 測試策略

| 類型 | 目標 | 工具 |
|------|------|------|
| 單元測試 | 每個模組獨立測試 | Vitest |
| 整合測試 | 模組間協作測試 | Vitest |
| 端對端測試 | 完整流程測試 | CLI 工具 |
| 覆蓋率 | > 70% | Vitest --coverage |

### Mock 策略

```typescript
// Mock Claude SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'assistant', content: [{ type: 'text', text: 'Hello!' }] };
      yield { type: 'result', subtype: 'success' };
    }
  })
}));

// Mock Telegram API
vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation(() => ({
    api: { sendMessage: vi.fn() },
    start: vi.fn(),
    stop: vi.fn()
  }))
}));
```

---

## 風險與緩解

| 風險 | 影響 | 機率 | 緩解策略 |
|------|------|------|---------|
| SDK API 變更 | 高 | 中 | 鎖定版本 `^0.2.19`，關注 changelog |
| Claude API 成本失控 | 高 | 中 | 使用 `maxBudgetUsd` 控制，設定每用戶上限 |
| hooks.ts 載入失敗 | 中 | 高 | 使用 `pathToFileURL()`，提供詳細錯誤 |
| Telegram API 限流 | 高 | 中 | 實作請求佇列，指數退避重試 |
| 並發競態條件 | 高 | 中 | 同一用戶請求使用 mutex |
| Windows 路徑問題 | 中 | 高 | 統一使用 `path.posix` 或 `pathToFileURL()` |

---

## 待確認事項

### P0（開始前必須確認）

- [ ] Anthropic API Key 取得方式
- [ ] Telegram Bot Token 申請（@BotFather）
- [ ] SDK 版本確認（目前鎖定 0.2.x）
- [ ] 目標 Node.js 版本（建議 20 LTS）

### P1（影響設計）

- [ ] 是否需要 Session 持久化？（建議 v1 先不做）
- [ ] 熱重載功能優先級？（建議 v1 先不做）
- [ ] 是否需要 Web UI？（建議 v1 先不做）
- [ ] 是否需要支援 Windows 平台？

### P2（影響後續擴充）

- [ ] 是否需要支援群組對話？
- [ ] 訊息最大長度限制？（建議 10000 字元）
- [ ] 多語言支援需求？

---

## 里程碑

| 里程碑 | 完成條件 | 交付物 |
|--------|---------|--------|
| **M1: 基礎完成** | Phase 1-2 完成 | 專案骨架、類型定義 |
| **M2: 核心完成** | Phase 3-4 完成 | AgentLoader、SessionStore、CLI 可測試 |
| **M3: MVP** | Phase 5-5.5 完成 | Telegram Bot 可用、基本安全機制 |
| **M4: 穩定版** | Phase 6 完成 | 測試通過、文件齊全、Docker 部署 |

---

## 變更記錄

| 版本 | 日期 | 變更內容 |
|------|------|---------|
| 2.0.0 | 2026-01-26 | 初版 |
| 2.1.0 | 2026-01-26 | 根據架構審查新增：ConfigTransformer、EventBus、AdapterRegistry、Phase 5.5 安全性強化、更完整的測試案例 |

---

*文件版本：2.1.0（審查後更新）*
*建立日期：2026-01-26*
