# 設計：多機器人架構

## Decisions

### Session Key 複合鍵設計

Session Key 從 `platform::userId` 改為 `platform::agentId::userId`，確保同一用戶與不同 Agent 的對話互不干擾。

### PlatformOrchestrator 職責

新增 `PlatformOrchestrator` 作為所有平台 Adapter 的生命週期管理者。根據每個 Agent 的 config 中的 token 欄位自動判斷平台類型並建立對應 Adapter。

### 環境變數移除

移除全域 `TELEGRAM_BOT_TOKEN` 環境變數，Token 改為分散存放於各 Agent 的 `agent.json`。

## Risks / Trade-offs

- DB Schema 需升級至 v2（UNIQUE 約束加入 `agent_id`），舊 Session 不相容，重啟後自動建新 Session
- 每個 Agent 需要獨立申請 Telegram Bot Token，管理成本略增
- 若未來 Agent 數量大增，需注意 Telegram API rate limit 分散至多個 Bot 的影響

## Affected Components

- `src/core/PlatformOrchestrator.ts`（新增）
- `src/core/AdapterRegistry.ts`（修改為複合鍵）
- `src/adapters/TelegramAdapter.ts`（綁定 agentId）
- `src/index.ts`（使用 Orchestrator 啟動）
