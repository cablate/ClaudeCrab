# ClaudeCab

Discord conversation workbench powered by Claude Agent SDK.

Single-agent Discord bot with session management, schedule system, and observability dashboard.

## Features

- **Discord-Only**: 透過 Discord thread 進行對話，每則訊息自動建立 thread
- **Session Management**: 自動 session 管理、過期清理、SQLite 持久化
- **Session Guard**: Token-based session 長度警告，cache TTL 過期提醒
- **Schedule System**: Agent 排程任務，cron 驅動，結果發送到 Discord thread
- **Security**: 使用者白名單、訊息驗證、Prompt injection 偵測
- **Observability**: Dashboard、Cost Report、OAuth Rate-Limit 監控

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- Anthropic API Key
- Discord Bot Token

### 1. 安裝

```bash
git clone https://github.com/punkcanyang/ClaudeCab.git
cd ClaudeCab
npm install
```

### 2. 快速設定（推薦）

```bash
npm run setup
```

互動式精靈會引導你設定 API Key 並建立第一個 Agent。

<details>
<summary>或者手動設定</summary>

### 2a. 環境設定

```bash
cp .env.example .env
```

編輯 `.env`：

```env
# 必填
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### 3. 設定 Agent

每個 agent 在 `agents/<id>/agent.json` 設定：

```json
{
  "name": "我的助手",
  "description": "一個通用助手",
  "model": "sonnet",
  "discordBotToken": "your-discord-bot-token"
}
```

</details>

### 4. 啟動

```bash
# 開發模式（Hot Reload）
npm run dev

# 生產模式
npm run build && npm start
```

### 5. 驗證

在 Discord 對 bot 發送訊息，bot 會自動建立 thread 並回覆。

## Quality Gate

所有變更必須通過 quality gate：

```bash
npm run quality-gate
```

包含 5 個 gate：
1. TypeScript 型別檢查
2. 編譯
3. 殘留子系統掃描（確保已移除的 Telegram/WebUI/Social 不會回來）
4. Session Guard 語意掃描（確保維持 token-based，不漂移成 messageCount）
5. 全部測試套件

## Environment Variables

| 變數 | 必填 | 預設 | 說明 |
|------|------|------|------|
| `ANTHROPIC_API_KEY` | ✅ | - | Anthropic API 金鑰 |
| `ALLOWED_USERS` | - | (全部) | 允許的 Discord user ID（逗號分隔） |
| `ENABLE_PERSISTENCE` | - | `false` | 啟用 SQLite 持久化 |
| `DB_PATH` | - | `./data/claudecab.db` | 資料庫路徑 |
| `LOG_LEVEL` | - | `info` | 日誌等級 |
| `SESSION_GUARD_ENABLED` | - | `true` | 啟用 session 長度警告 |
| `SESSION_GUARD_TOKEN_THRESHOLD` | - | `300000` | Token 數量警告閾值 |
| `SESSION_GUARD_CACHE_TTL_MS` | - | `1800000` | Cache TTL 過期警告（30 分鐘） |

## Development

```bash
npm run setup           # 互動式首次設定精靈
npm run dev             # 開發模式（Hot Reload）
npm run build           # 編譯 TypeScript
npm run typecheck       # 類型檢查
npm test                # 執行測試（watch mode）
npm run test:run        # 執行測試（single run）
npm run quality-gate    # 完整品質驗證
npm run lint            # Linting
npm run lint:logs       # Log 格式驗證
```

## Architecture

完整的架構說明、模組地圖、對話 pipeline、SDK 整合機制、排程系統、可觀測性等細節請見：

**[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**

## Project Structure

```
claudecab/
├── src/
│   ├── adapters/        # Discord adapter
│   ├── conversation/    # Conversation pipeline
│   ├── core/            # SessionManager, MessageProcessor, SDK integration
│   ├── persistence/     # SQLite repositories
│   ├── schedule/        # Cron schedule system
│   ├── services/        # Budget, Activity, TTS services
│   ├── types/           # TypeScript types
│   └── utils/           # Logging, events, security
├── agents/              # Agent 目錄（每個子目錄 = 一個 agent）
├── scripts/             # 工具腳本（quality-gate, setup, etc.）
├── tests/               # Unit + integration tests
└── data/                # SQLite 資料庫
```

## License

MIT
