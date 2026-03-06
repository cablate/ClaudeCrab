# Tasks

- [x] 新增 `PlatformOrchestrator` 統一管理所有 Adapter 生命週期
- [x] 修改 `AdapterRegistry` 支援 `platform::agentId::userId` 複合鍵
- [x] 修改 `TelegramAdapter` 綁定 agentId，從 `agent.json` 讀取 token
- [x] 修改 `src/index.ts` 使用 Orchestrator 啟動
- [x] 移除 `/switch`、`/list` 指令與 `switchAgent()` 方法
- [x] 移除全域 `TELEGRAM_BOT_TOKEN` 環境變數
- [x] DB Schema 升級至 v2（UNIQUE 約束加入 `agent_id`）
