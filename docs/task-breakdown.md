# ClaudeCab 開發任務清單與版本規劃

> 基於 implementation.md 與 architecture.md 的詳細任務拆分
>
> 文件版本：1.0.0
> 建立日期：2026-01-26

---

## 版本規劃總覽

| 版本 | 里程碑 | 預估工時 | 主要交付物 |
|------|--------|----------|-----------|
| **v0.1.0** | 專案初始化 | 4 小時 | 專案骨架、開發環境 |
| **v0.2.0** | 類型定義完成 | 4 小時 | 完整類型系統、Schema 驗證 |
| **v0.3.0** | 核心模組完成 | 16 小時 | AgentLoader、ConfigTransformer、EventBus |
| **v0.4.0** | Session 管理完成 | 12 小時 | SessionStore、並發控制 |
| **v0.5.0** | Telegram 整合完成 | 16 小時 | TelegramAdapter、完整指令系統 |
| **v0.6.0** | 安全性強化 | 8 小時 | 用戶白名單、審計日誌、輸入驗證 |
| **v1.0.0** | 穩定版發布 | 12 小時 | 整合測試、文件、Docker 部署 |
| **v1.x.0** | 進階功能（可選） | - | 熱重載、Web UI、其他平台 |

**總計：約 72 小時（9 工作天）**

---

## v0.1.0 - 專案初始化

### 階段名稱：Project Bootstrap

### 任務列表

| 編號 | 任務描述 | 預估時間 | 依賴項 | 風險等級 |
|------|---------|---------|--------|---------|
| 1.1 | 初始化 npm 專案並配置 ESM 模式 | 15 分鐘 | 無 | 低 |
| 1.2 | 安裝主要依賴（@anthropic-ai/claude-agent-sdk, zod, grammy, dotenv, uuid, pino） | 15 分鐘 | 1.1 | 低 |
| 1.3 | 安裝開發依賴（typescript, @types/*, tsx, vitest, eslint, prettier） | 15 分鐘 | 1.1 | 低 |
| 1.4 | 配置 tsconfig.json（ES2022, NodeNext, strict mode） | 20 分鐘 | 1.3 | 低 |
| 1.5 | 配置 package.json scripts（dev, build, start, test, lint） | 15 分鐘 | 1.4 | 低 |
| 1.6 | 建立目錄結構（src/core, src/adapters, src/types, src/utils, agents/, tests/） | 20 分鐘 | 1.1 | 低 |
| 1.7 | 建立 .env.example 範本檔 | 10 分鐘 | 1.6 | 低 |
| 1.8 | 建立 .gitignore | 10 分鐘 | 1.6 | 低 |
| 1.9 | 配置 ESLint（@typescript-eslint/eslint-plugin） | 30 分鐘 | 1.4 | 低 |
| 1.10 | 配置 Prettier 並整合 ESLint | 20 分鐘 | 1.9 | 低 |
| 1.11 | 建立基礎 Logger（src/utils/logger.ts，使用 pino） | 30 分鐘 | 1.2, 1.6 | 低 |
| 1.12 | 建立 src/index.ts 入口點並測試執行 | 20 分鐘 | 1.11 | 低 |

### 交付物

- 完整專案骨架
- TypeScript 編譯環境
- ESLint + Prettier 配置
- 基礎日誌系統
- 開發與生產 scripts

### 驗收標準

- [ ] `npm run dev` 可執行並輸出歡迎訊息
- [ ] `npm run build` TypeScript 編譯無錯誤
- [ ] `npm run lint` 無 ESLint 錯誤
- [ ] 目錄結構符合設計文檔
- [ ] Logger 可正常輸出結構化日誌

---

## v0.2.0 - 類型定義

### 階段名稱：Type System Foundation

### 任務列表

| 編號 | 任務描述 | 預估時間 | 依賴項 | 風險等級 |
|------|---------|---------|--------|---------|
| 2.1 | 建立 AgentConfig interface（src/types/agent.ts） | 30 分鐘 | v0.1.0 | 低 |
| 2.2 | 使用 Zod 建立 AgentConfigSchema 驗證 | 45 分鐘 | 2.1 | 中 |
| 2.3 | 建立 LoadedAgent interface | 20 分鐘 | 2.1 | 低 |
| 2.4 | 建立 AgentHooks interface（src/types/hook.ts，對應 SDK HookCallback） | 30 分鐘 | v0.1.0 | 中 |
| 2.5 | 建立 SessionState type 與 UserSession interface（src/types/session.ts） | 25 分鐘 | v0.1.0 | 低 |
| 2.6 | 建立 EventMap type（src/types/events.ts） | 20 分鐘 | 2.3, 2.5 | 低 |
| 2.7 | 建立 ClaudeCabError 基類（src/types/errors.ts） | 25 分鐘 | v0.1.0 | 低 |
| 2.8 | 建立 AgentLoadError、SessionError、RateLimitError | 30 分鐘 | 2.7 | 低 |
| 2.9 | 建立 UnifiedMessage 與 SendOptions interface（src/adapters/types.ts） | 20 分鐘 | v0.1.0 | 低 |
| 2.10 | 建立類型匯出檔（src/types/index.ts） | 10 分鐘 | 2.1-2.9 | 低 |
| 2.11 | 撰寫類型單元測試（Zod Schema 驗證測試） | 45 分鐘 | 2.2 | 低 |

### 交付物

- 完整類型定義系統
- Zod Schema 驗證邏輯
- 自訂錯誤類別
- 類型單元測試

### 驗收標準

- [ ] 所有類型定義完整，無 `any` 類型
- [ ] TypeScript 編譯無錯誤
- [ ] Zod Schema 可正確驗證有效/無效的 agent.json
- [ ] 類型與 Claude Agent SDK 相容
- [ ] 類型測試通過

---

## v0.3.0 - AgentLoader 與 ConfigTransformer

### 階段名稱：Agent Configuration System

### 任務列表

| 編號 | 任務描述 | 預估時間 | 依賴項 | 風險等級 |
|------|---------|---------|--------|---------|
| 3.1 | 實作 EventBus 類別（src/core/EventBus.ts） | 45 分鐘 | v0.2.0 | 低 |
| 3.2 | EventBus 支援多訂閱者與類型安全 | 30 分鐘 | 3.1 | 低 |
| 3.3 | 實作 AgentLoader 目錄掃描功能 | 45 分鐘 | v0.2.0 | 低 |
| 3.4 | 實作 agent.json 載入與 Zod 驗證 | 45 分鐘 | 3.3 | 中 |
| 3.5 | 實作 CLAUDE.md 載入邏輯 | 30 分鐘 | 3.4 | 低 |
| 3.6 | 支援 systemPrompt 直接定義或 systemPromptFile 檔案載入 | 20 分鐘 | 3.5 | 低 |
| 3.7 | 實作 hooks.ts 動態載入（使用 pathToFileURL） | 60 分鐘 | 3.4 | 高 |
| 3.8 | 驗證 hooks export 格式正確性 | 30 分鐘 | 3.7 | 中 |
| 3.9 | 實作 mcp.json 載入與轉換 | 40 分鐘 | 3.4 | 中 |
| 3.10 | 實作 Agent 繼承（extends）解析 | 60 分鐘 | 3.4 | 中 |
| 3.11 | 實作循環繼承檢測 | 30 分鐘 | 3.10 | 中 |
| 3.12 | 實作 ConfigTransformer.toSDKOptions() | 45 分鐘 | 3.4 | 中 |
| 3.13 | 實作 ConfigTransformer.mergeConfigs() | 30 分鐘 | 3.12 | 低 |
| 3.14 | 實作配置快取機制 | 30 分鐘 | 3.4 | 低 |
| 3.15 | 實作 reloadAgent() 清除快取功能 | 20 分鐘 | 3.14 | 低 |
| 3.16 | 建立範例 Agent（agents/general/） | 45 分鐘 | 3.4-3.9 | 低 |
| 3.17 | 建立繼承範例 Agent（agents/coder/） | 30 分鐘 | 3.10, 3.16 | 低 |
| 3.18 | 撰寫 AgentLoader 單元測試 | 60 分鐘 | 3.3-3.15 | 低 |
| 3.19 | 撰寫 ConfigTransformer 單元測試 | 45 分鐘 | 3.12-3.13 | 低 |
| 3.20 | 效能測試：載入 10 個 Agent < 1 秒 | 30 分鐘 | 3.18 | 低 |

### 交付物

- EventBus 事件系統
- AgentLoader 完整實作
- ConfigTransformer 完整實作
- 範例 Agent 配置（general, coder）
- 完整單元測試

### 驗收標準

- [ ] 可正確載入 agents/general/
- [ ] 配置驗證失敗時拋出 AgentLoadError 並包含明確錯誤訊息
- [ ] toSDKOptions() 產出可被 SDK 使用的配置
- [ ] hooks.ts 動態載入成功（含 Windows 路徑處理）
- [ ] 載入 10 個 Agent 耗時 < 1 秒
- [ ] Agent 繼承功能正常運作
- [ ] 循環繼承可被正確檢測並報錯

---

## v0.4.0 - SessionStore

### 階段名稱：Multi-User Session Management

### 任務列表

| 編號 | 任務描述 | 預估時間 | 依賴項 | 風險等級 |
|------|---------|---------|--------|---------|
| 4.1 | 實作 Session 儲存結構（Map<string, UserSession>） | 30 分鐘 | v0.3.0 | 低 |
| 4.2 | 實作 getSessionKey() 使用雙冒號避免碰撞 | 15 分鐘 | 4.1 | 低 |
| 4.3 | 實作 getSession() 查詢與 lastActiveAt 更新 | 30 分鐘 | 4.2 | 低 |
| 4.4 | 實作 createSession() 基本邏輯 | 45 分鐘 | 4.1 | 中 |
| 4.5 | 整合 AgentLoader + ConfigTransformer 於 createSession | 45 分鐘 | 4.4 | 中 |
| 4.6 | 整合 SDK query() 建立對話 | 60 分鐘 | 4.5 | 高 |
| 4.7 | 實作 Session 狀態機（idle → processing → idle/error） | 45 分鐘 | 4.4 | 中 |
| 4.8 | 實作狀態鎖定防止同一 Session 並發處理 | 45 分鐘 | 4.7 | 中 |
| 4.9 | 實作 switchAgent() 功能 | 45 分鐘 | 4.4 | 中 |
| 4.10 | 實作 closeSession() 功能 | 20 分鐘 | 4.4 | 低 |
| 4.11 | 整合 EventBus 發布 session 事件 | 30 分鐘 | 4.4, 4.9, 4.10 | 低 |
| 4.12 | 實作 cleanupExpired() 定時清理 | 45 分鐘 | 4.1 | 低 |
| 4.13 | 配置清理間隔與超時時間 | 20 分鐘 | 4.12 | 低 |
| 4.14 | 實作冪等性檢查（記錄已處理 message_id） | 45 分鐘 | 4.1 | 中 |
| 4.15 | 實作 mutex/佇列並發控制 | 60 分鐘 | 4.8 | 高 |
| 4.16 | 撰寫 SessionStore 單元測試 | 60 分鐘 | 4.1-4.15 | 低 |
| 4.17 | 撰寫並發測試（100 用戶同時建立 Session） | 45 分鐘 | 4.15, 4.16 | 中 |
| 4.18 | 記憶體使用測試（1000 Session < 500MB） | 30 分鐘 | 4.16 | 低 |

### 交付物

- SessionStore 完整實作
- Session 狀態機
- 並發控制機制
- 冪等性檢查
- 自動清理機制
- 完整測試套件

### 驗收標準

- [ ] 可正確建立和取得 Session
- [ ] Agent 切換功能正常
- [ ] 超時清理機制每分鐘運作
- [ ] 不同用戶的 Session 完全隔離
- [ ] 冪等性檢查可防止重複處理
- [ ] 1000 個並發 Session 記憶體 < 500MB
- [ ] 並發測試通過（100 用戶同時操作）

---

## v0.5.0 - TelegramAdapter

### 階段名稱：Telegram Platform Integration

### 任務列表

| 編號 | 任務描述 | 預估時間 | 依賴項 | 風險等級 |
|------|---------|---------|--------|---------|
| 5.1 | 實作 BaseAdapter 抽象類（src/adapters/BaseAdapter.ts） | 45 分鐘 | v0.4.0 | 低 |
| 5.2 | 定義 initialize(), start(), stop(), dispose(), isReady() | 30 分鐘 | 5.1 | 低 |
| 5.3 | 實作 AdapterRegistry（src/core/AdapterRegistry.ts） | 45 分鐘 | 5.1 | 低 |
| 5.4 | 實作 AdapterRegistry.startAll() / stopAll() | 30 分鐘 | 5.3 | 低 |
| 5.5 | 實作 TelegramAdapter 基本結構（整合 grammy） | 60 分鐘 | 5.1 | 中 |
| 5.6 | 實作 Polling 模式啟動 | 45 分鐘 | 5.5 | 中 |
| 5.7 | 實作訊息接收與 UnifiedMessage 轉換 | 45 分鐘 | 5.5 | 低 |
| 5.8 | 整合 EventBus 發布 'message:received' | 20 分鐘 | 5.7 | 低 |
| 5.9 | 實作 sendMessage() 基本功能 | 30 分鐘 | 5.5 | 低 |
| 5.10 | 實作長訊息分割（4096 字元上限） | 45 分鐘 | 5.9 | 中 |
| 5.11 | 支援 Markdown 格式發送 | 30 分鐘 | 5.9 | 低 |
| 5.12 | 實作 typing indicator | 20 分鐘 | 5.9 | 低 |
| 5.13 | 實作速率限制器（35ms 最小間隔） | 60 分鐘 | 5.9 | 高 |
| 5.14 | 實作請求佇列 | 45 分鐘 | 5.13 | 中 |
| 5.15 | 整合 SessionStore 於訊息處理 | 60 分鐘 | 5.7 | 高 |
| 5.16 | 實作冪等性檢查整合 | 30 分鐘 | 5.15 | 中 |
| 5.17 | 實作 SDK 串流回應處理 | 60 分鐘 | 5.15 | 高 |
| 5.18 | 實作 /start 指令 | 20 分鐘 | 5.5 | 低 |
| 5.19 | 實作 /help 指令 | 20 分鐘 | 5.5 | 低 |
| 5.20 | 實作 /switch <agent> 指令 | 30 分鐘 | 5.5, 5.15 | 低 |
| 5.21 | 實作 /list 指令（列出可用 Agent） | 20 分鐘 | 5.5 | 低 |
| 5.22 | 實作 /reset 指令（重置對話） | 20 分鐘 | 5.5, 5.15 | 低 |
| 5.23 | 實作 API 錯誤重試（指數退避） | 45 分鐘 | 5.9 | 中 |
| 5.24 | 實作用戶友善錯誤訊息 | 30 分鐘 | 5.23 | 低 |
| 5.25 | 撰寫 TelegramAdapter 單元測試 | 60 分鐘 | 5.5-5.24 | 低 |
| 5.26 | 撰寫整合測試（Mock Telegram API） | 60 分鐘 | 5.25 | 中 |

### 交付物

- BaseAdapter 抽象類
- AdapterRegistry 管理器
- TelegramAdapter 完整實作
- 指令系統（/start, /help, /switch, /list, /reset）
- 速率限制與重試機制
- 完整測試套件

### 驗收標準

- [ ] Bot 可正常啟動並接收訊息
- [ ] 訊息可正確轉發給 Claude SDK
- [ ] 串流回應可即時顯示給用戶
- [ ] 所有指令功能正常
- [ ] 長訊息正確分割發送
- [ ] 錯誤處理完善，用戶收到友善訊息
- [ ] 訊息回應延遲 < 2 秒（不含 Claude API 時間）
- [ ] 速率限制正常運作

---

## v0.6.0 - 安全性強化

### 階段名稱：Security Hardening

### 任務列表

| 編號 | 任務描述 | 預估時間 | 依賴項 | 風險等級 |
|------|---------|---------|--------|---------|
| 6.1 | 實作用戶白名單配置載入（ALLOWED_USERS 環境變數） | 30 分鐘 | v0.5.0 | 低 |
| 6.2 | 實作白名單驗證中介軟體 | 45 分鐘 | 6.1 | 低 |
| 6.3 | 實作未授權用戶拒絕訊息 | 20 分鐘 | 6.2 | 低 |
| 6.4 | 實作審計日誌模組（src/utils/audit.ts） | 45 分鐘 | v0.5.0 | 低 |
| 6.5 | 整合工具呼叫審計記錄 | 45 分鐘 | 6.4 | 中 |
| 6.6 | 整合用戶操作審計記錄 | 30 分鐘 | 6.4 | 低 |
| 6.7 | 實作訊息長度限制驗證 | 30 分鐘 | v0.5.0 | 低 |
| 6.8 | 實作基本 Prompt Injection 檢測 | 60 分鐘 | v0.5.0 | 高 |
| 6.9 | 實作敏感指令確認機制 | 60 分鐘 | v0.5.0 | 中 |
| 6.10 | 配置需確認的指令模式（pattern matching） | 30 分鐘 | 6.9 | 低 |
| 6.11 | 撰寫安全性測試 | 60 分鐘 | 6.1-6.10 | 中 |

### 交付物

- 用戶白名單機制
- 完整審計日誌系統
- 輸入驗證與過濾
- 敏感指令確認流程
- 安全性測試

### 驗收標準

- [ ] 未授權用戶無法使用 Bot，收到拒絕訊息
- [ ] 所有工具呼叫都有審計記錄
- [ ] 過長輸入被拒絕並通知用戶
- [ ] 可疑輸入觸發警告或拒絕
- [ ] 敏感操作需二次確認
- [ ] 安全性測試全部通過

---

## v1.0.0 - 穩定版發布

### 階段名稱：Production Ready Release

### 任務列表

| 編號 | 任務描述 | 預估時間 | 依賴項 | 風險等級 |
|------|---------|---------|--------|---------|
| 7.1 | 建立 CLI 測試工具（src/cli.ts） | 60 分鐘 | v0.6.0 | 低 |
| 7.2 | CLI 支援指定 Agent 測試 | 30 分鐘 | 7.1 | 低 |
| 7.3 | 建立整合測試腳本（完整對話流程） | 60 分鐘 | 7.1 | 中 |
| 7.4 | 建立 Agent 切換整合測試 | 30 分鐘 | 7.3 | 低 |
| 7.5 | 建立錯誤處理流程測試 | 45 分鐘 | 7.3 | 中 |
| 7.6 | 建立並發場景整合測試（10 用戶同時） | 45 分鐘 | 7.3 | 中 |
| 7.7 | 效能測試：Agent 載入時間驗證 | 30 分鐘 | 7.1 | 低 |
| 7.8 | 效能測試：訊息處理延遲驗證 | 30 分鐘 | 7.1 | 低 |
| 7.9 | 效能測試：記憶體使用監控 | 30 分鐘 | 7.1 | 低 |
| 7.10 | 撰寫 README.md（快速開始指南） | 60 分鐘 | v0.6.0 | 低 |
| 7.11 | 撰寫配置說明文件 | 45 分鐘 | 7.10 | 低 |
| 7.12 | 撰寫 Agent 建立指南 | 45 分鐘 | 7.10 | 低 |
| 7.13 | 撰寫常見問題（FAQ） | 30 分鐘 | 7.10 | 低 |
| 7.14 | 建立 Dockerfile（多階段建構） | 45 分鐘 | v0.6.0 | 中 |
| 7.15 | 建立 docker-compose.yml | 30 分鐘 | 7.14 | 低 |
| 7.16 | Docker 映像優化與測試 | 45 分鐘 | 7.15 | 中 |
| 7.17 | 最終程式碼審查與重構 | 60 分鐘 | 7.1-7.16 | 低 |
| 7.18 | 更新 CHANGELOG 與版本標記 | 30 分鐘 | 7.17 | 低 |

### 交付物

- CLI 測試工具
- 完整整合測試套件
- 效能測試報告
- README.md 與完整文件
- Docker 部署配置
- v1.0.0 Release

### 驗收標準

- [ ] 完整對話流程測試通過
- [ ] 多用戶並發測試通過（10 用戶）
- [ ] 效能指標達標：
  - Agent 載入 < 1 秒
  - 訊息處理 < 2 秒
  - 1000 Session < 500MB
- [ ] README 包含完整使用說明
- [ ] Docker 可正常建構與部署
- [ ] 所有測試覆蓋率 > 70%

---

## v1.x.0 - 進階功能（可選）

### 階段名稱：Advanced Features

### 任務列表（依優先級排序）

| 編號 | 功能 | 任務描述 | 預估時間 | 依賴項 |
|------|------|---------|---------|--------|
| 8.1 | 熱重載 | 使用 chokidar 監控 agents/ 目錄 | 2 小時 | v1.0.0 |
| 8.2 | 熱重載 | 檔案變更時自動重載 Agent | 2 小時 | 8.1 |
| 8.3 | 熱重載 | 確保不中斷現有 Session | 1.5 小時 | 8.2 |
| 8.4 | Web UI | 建立 Express 伺服器 | 2 小時 | v1.0.0 |
| 8.5 | Web UI | Agent 列表查看頁面 | 2 小時 | 8.4 |
| 8.6 | Web UI | Session 監控頁面 | 2 小時 | 8.4 |
| 8.7 | Web UI | 配置編輯器 | 3 小時 | 8.4 |
| 8.8 | 其他平台 | DiscordAdapter 實作 | 4 小時 | v1.0.0 |
| 8.9 | 其他平台 | LineAdapter 實作 | 4 小時 | v1.0.0 |
| 8.10 | 持久化 | SQLite Session 儲存 | 3 小時 | v1.0.0 |
| 8.11 | 持久化 | 重啟後對話恢復 | 2 小時 | 8.10 |

---

## 任務依賴關係圖

```
v0.1.0 (專案初始化)
    │
    ▼
v0.2.0 (類型定義)
    │
    ▼
v0.3.0 (AgentLoader + ConfigTransformer)
    │
    ├──────────────────┐
    ▼                  ▼
v0.4.0 (SessionStore)  ← 依賴 EventBus (3.1-3.2)
    │
    ▼
v0.5.0 (TelegramAdapter)
    │
    ▼
v0.6.0 (安全性強化)
    │
    ▼
v1.0.0 (穩定版發布)
    │
    ▼
v1.x.0 (進階功能) [可選]
```

---

## 關鍵路徑（Critical Path）

以下任務位於關鍵路徑上，延遲將影響整體進度：

1. **3.7** - hooks.ts 動態載入（Windows 路徑處理，高風險）
2. **4.6** - 整合 SDK query() 建立對話（高風險）
3. **4.15** - mutex/佇列並發控制（高風險）
4. **5.13** - 速率限制器（高風險）
5. **5.15** - 整合 SessionStore（高風險）
6. **5.17** - SDK 串流回應處理（高風險）

---

## 風險緩解策略

| 風險項目 | 緩解策略 |
|---------|---------|
| hooks.ts Windows 路徑 | 使用 `pathToFileURL()` 轉換，提前測試 |
| SDK API 變更 | 鎖定版本 `^0.2.19`，關注 changelog |
| Telegram API 限流 | 實作請求佇列 + 指數退避，保守設定間隔 |
| 並發競態條件 | 使用成熟的 mutex 套件（如 async-mutex） |
| 記憶體洩漏 | 定期清理 + 監控，設定 Session 上限 |

---

## 開發建議

1. **每日完成 2-3 個任務**，保持穩定進度
2. **優先完成高風險任務**，及早暴露問題
3. **每個版本完成後進行整合測試**，確保模組協作正常
4. **遵循 TDD**，先寫測試再實作
5. **保持程式碼審查習慣**，每個 PR 都需自我審查
