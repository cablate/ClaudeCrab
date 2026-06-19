# ClaudeCab

Discord conversation workbench powered by the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk).

Single-agent Discord bot with persistent V2 SDK sessions, schedule system, and observability dashboard.

## Features

- **Discord-Native**: 透過 Discord thread 進行對話，每則訊息自動建立 thread
- **Session Management**: 自動 session 管理、過期清理、SQLite 持久化
- **V2 SDK Sessions**: Persistent CLI processes for ~95%+ prompt cache hit rate
- **Dual Session Modes**: 省資源的 ephemeral 模式 or 高效能的 persistent 模式
- **Session Guard**: Token-based session 長度警告、cache TTL 過期提醒（可關閉）
- **Schedule System**: Agent 排程任務，cron 驅動，結果發送到 Discord thread
- **Security**: 使用者白名單、訊息驗證、Prompt injection 偵測
- **Observability**: Dashboard Embed、Cost Report、OAuth Rate-Limit 監控

---

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- Anthropic API Key (或 OAuth token)
- Discord Bot Token（一個 main bot + 每個 agent 各自一個 bot）

### 1. 安裝

```bash
git clone https://github.com/cablate/ClaudeCrab.git
cd ClaudeCab
npm install
```

### 2. 環境設定

```bash
cp .env.example .env
```

編輯 `.env`，至少設定：

```env
# 必填
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Discord
DISCORD_ENABLED=true
DISCORD_MAIN_BOT_TOKEN=your-bot-token
DISCORD_MAIN_BOT_CLIENT_ID=your-client-id
DISCORD_GUILD_ID=your-server-id
```

### 3. 設定 Agent

Agent 設定檔放在 `AGENTS_DIR`（預設 `./agents/`），每個 agent 一個子目錄，內含 `agent.json`：

```json
{
  "name": "我的助手",
  "description": "一個通用助手",
  "model": "sonnet",
  "discordBotToken": "your-discord-bot-token"
}
```

### 4. 啟動

```bash
# 開發模式（tsx 即時轉譯）
npm run dev

# 生產模式
npm run build && npm start
```

### 5. 驗證

在 Discord 對 bot 發送訊息，bot 會自動建立 thread 並回覆。訊息格式：

```
@bot 你好，今天天氣如何？
```

---

## Configuration

完整環境變數參考（`.env`）：

### 認證

| 變數 | 預設 | 說明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | — | Anthropic API 金鑰。設此值走 API Key 模式 |
| `ANTHROPIC_BASE_URL` | — | 第三方 proxy 端點（如 DeepSeek），需相容 Anthropic API 協定。OAuth 模式下不可設 |

**OAuth 模式**：不設 `ANTHROPIC_API_KEY`，系統會自動讀取 `~/.claude/credentials.json`。在部署機器上先執行 `claude login` 即可。

### Agent 目錄

| 變數 | 預設 | 說明 |
|------|------|------|
| `AGENTS_DIR` | `./agents` | Agent 設定檔的根目錄。可指向外部路徑（如 `D:\_CabLate_Agents`） |

### Discord

| 變數 | 預設 | 說明 |
|------|------|------|
| `DISCORD_ENABLED` | `true` | 啟用 Discord bot |
| `DISCORD_MAIN_BOT_TOKEN` | — | **必填**。Main bot token（slash commands、dashboard） |
| `DISCORD_MAIN_BOT_CLIENT_ID` | — | **必填**。Discord Application ID |
| `DISCORD_GUILD_ID` | — | **必填**。Discord Server ID |
| `DISCORD_OWNER_USER_ID` | — | 你的 Discord User ID（接收 DM 通知） |
| `DISCORD_CHANNEL_DASHBOARD` | — | 系統儀表板頻道 ID |
| `DISCORD_CHANNEL_COST_REPORT` | — | 每日成本報告頻道 ID |
| `DISCORD_CHANNEL_ALERTS` | — | 錯誤/警告通知頻道 ID |
| `DISCORD_CHANNEL_SYSTEM_LOG` | — | 系統日誌頻道 ID |
| `IN_CHAT_USAGE_SUMMARY_ENABLED` | `true` | 設 `false` 隱藏對話內 tool 狀態訊息（events、usage card） |
| `USAGE_CARD_ENABLED` | `true` | 設 `false` 隱藏對話結束後的用量卡片（cache/tokens/cost embed） |
| `DISCORD_DASHBOARD_UPDATE_MINUTES` | `15` | Dashboard Embed 更新間隔（分鐘） |

### Session Management

| 變數 | 預設 | 說明 |
|------|------|------|
| `SESSION_EPHEMERAL` | `false` | 設 `true` 進入 ephemeral 模式：每次 query 用完即銷毀 CLI process（省 ~150MB RAM），resume 資料保留在磁碟 JSONL，下次自動恢復 |
| `SESSION_IDLE_CLOSE_MS` | `7200000`（2h） | Persistent mode only. Close the live SDK CLI process after real-query idle time; keep app session and `sdkSessionId` so the next message resumes. Set `0` to disable. |
| `SESSION_QUERY_HARD_TIMEOUT_MS` | `3600000`（1h） | Active query protection. Interrupt a V2 query that stays running longer than this. Set `0` to disable. |
| `SESSION_QUERY_HARD_TIMEOUT_GRACE_MS` | `30000`（30s） | After timeout interrupt, force-close the live SDK CLI process if the query is still running. |
| `SESSION_TIMEOUT_MS` | `3600000`（1h） | Session 閒置多久後自動清理 |
| `CLEANUP_INTERVAL_MS` | `60000`（1m） | 清理檢查間隔 |
| `MAX_SESSIONS` | `1000` | 最大同時 session 數 |
| `DB_RETENTION_MS` | `2592000000`（30d） | 資料保留時間 |

### Session Guard（對話長度 / 閒置保護）

| 變數 | 預設 | 說明 |
|------|------|------|
| `SESSION_GUARD_ENABLED` | `true` | 設 `false` 完全關閉所有 guard 檢查 |
| `SESSION_GUARD_TOKEN_THRESHOLD` | `150000` | Token 超過此值跳出「Session 太長」對話 |
| `SESSION_GUARD_CACHE_TTL_MS` | `300000`（5m） | 閒置超過此毫秒跳出「Cache 已過期」對話 |

### Cache Keepalive（Prompt Cache 保活）

| 變數 | 預設 | 說明 |
|------|------|------|
| `CACHE_KEEPALIVE_ENABLED` | `true` | 主開關。設 `false` 完全不發 keepalive ping |
| `CACHE_KEEPALIVE_INTERVAL_MS` | `60000`（1m） | Keepalive 間隔 |
| `CACHE_KEEPALIVE_SKIP_RECENT_MS` | `15000`（15s） | 使用者剛互動時跳過 ping |
| `CACHE_KEEPALIVE_DETECTED_TTL_RATIO` | `0.6` | 偵測到 TTL 後，以此比例調整 keepalive 間隔 |
| `CACHE_KEEPALIVE_MIN_INTERVAL_MS` | `30000`（30s） | Keepalive 間隔下限 |
| `CACHE_KEEPALIVE_QUERYING_RETRY_MS` | `15000`（15s） | Query 執行中的重試間隔 |
| `CACHE_KEEPALIVE_ALERT_COOLDOWN_MS` | `3600000`（1h） | 異常告警冷卻時間 |
| `CACHE_EFFICIENCY_WARN_THRESHOLD` | `50` | Cache hit 低於此值記錄警告 |
| `CACHE_KEEPALIVE_POST_QUERY_WARMUP_MS` | `5000`（5s） | Query 完成後暖機延遲 |

### 排程

| 變數 | 預設 | 說明 |
|------|------|------|
| `SCHEDULE_ENABLED` | `true` | 啟用排程任務（每日成本報告等） |

### STT（語音辨識）

| 變數 | 預設 | 說明 |
|------|------|------|
| `STT_ENABLED` | `false` | 啟用語音辨識 |
| `STT_PROVIDER` | `groq` | 目前僅支援 Groq |
| `STT_API_KEY` | — | Groq API 金鑰 |
| `STT_MODEL` | `whisper-large-v3-turbo` | Whisper 模型 |

### 安全性

| 變數 | 預設 | 說明 |
|------|------|------|
| `ALLOWED_USERS` | （全部允許） | 逗號分隔的 Discord User ID 白名單 |
| `MAX_MESSAGE_LENGTH` | `10000` | 單則訊息最大字元數 |
| `PROMPT_INJECTION_DETECTION` | `true` | 啟用提示注入偵測 |

### 資料庫

| 變數 | 預設 | 說明 |
|------|------|------|
| `ENABLE_PERSISTENCE` | `false` | 啟用 SQLite 持久化 |
| `DB_PATH` | `./data/claudecab.db` | SQLite 資料庫路徑 |

### 日誌

| 變數 | 預設 | 說明 |
|------|------|------|
| `LOG_LEVEL` | `info` | 日誌等級：`debug` / `info` / `warn` / `error` |
| `AUDIT_LOGGING` | `true` | 啟用審計日誌 |

### Claude Code CLI

| 變數 | 預設 | 說明 |
|------|------|------|
| `CLAUDE_CLI_PATH` | （SDK bundle） | 指定外部安裝的 `claude.exe` 路徑，留空則用 SDK 自帶的 CLI |

---

## Session 模式：Persistent vs Ephemeral

ClaudeCab 支援兩種 session 行為，透過 `SESSION_EPHEMERAL` 切換：

### Persistent（預設）— 高效能模式

- SDK CLI process 啟動後保持常駐
- Keepalive ping 維持 prompt cache 不失效
- 每條 session 約佔 ~150MB RAM
- 適合：**Discord 連續對話**，快取命中率 ~95%+

### Ephemeral — 省資源模式

```
Query 來 → 開 CLI → 回覆 → 關 CLI（釋放 150MB）
                         ↓
                  JSONL 留在磁碟
下次 Query → resume(sessionId) → 恢復對話脈絡
```

- 每次 query 用完即銷毀 CLI process
- Resume 資料保留在 JSONL 檔，下次自動恢復
- Idle 時不佔記憶體，適合高併發但低活躍度場景
- 建議搭配 `CACHE_KEEPALIVE_ENABLED=false`

### 推薦設定組合

**Discord 連續對話（預設）：**
```env
SESSION_EPHEMERAL=false
CACHE_KEEPALIVE_ENABLED=true
SESSION_GUARD_ENABLED=true
```

**Q&A Bot / 資源受限：**
```env
SESSION_EPHEMERAL=true
CACHE_KEEPALIVE_ENABLED=false
SESSION_GUARD_ENABLED=false
MAX_SESSIONS=50
```

---

## 第三方模型整合

### Anthropic 第三方 Proxy

透過 `ANTHROPIC_BASE_URL` 可將 LLM 請求指向第三方 proxy（需實作 Anthropic API 協定，如 DeepSeek、自建 gateway）：

```env
ANTHROPIC_BASE_URL=https://your-proxy.com/v1
```

注意：
- 此變數由 SDK 直接讀取，ClaudeCab 不主動管理
- OAuth 模式下不可設 `ANTHROPIC_BASE_URL`
- Agent 層級也可在 `.claude/settings.local.json` 設定 `ANTHROPIC_API_KEY`，實現不同 agent 用不同 key/proxy

### STT（語音轉文字）

---

## Deployment

### Docker

一鍵啟動：

```bash
docker compose up -d
```

多階段 Dockerfile 特性：
- **Alpine base**，production image 不包含原始碼或 build tools
- **非 root 使用者**（uid/gid 1001）
- **tini init**：正確處理 signal forwarding
- **資源限制**：production profile 限定 1 CPU + 512MB RAM
- **健康檢查**：每 30 秒，3 次失敗視為不健康
- **日誌輪換**：每個檔案最大 10MB，保留 3 份

開發模式：

```bash
docker compose --profile dev up -d
```

開發 profile 會 mount `./src` 實現 hot reload。

### Cloud VM

```bash
git clone https://github.com/cablate/ClaudeCrab.git
cd ClaudeCab
cp .env.example .env
# 編輯 .env 填入 secrets
npm ci --production
npm run build
node start.ts
```

建議搭配 PM2 或 systemd 管理 process lifecycle。

### OAuth on Cloud

雲端 VM 不需要寫死 API Key：

```bash
# 先登入（手動一次）
claude login

# 不要設 ANTHROPIC_API_KEY
# 系統會自動讀取 ~/.claude/credentials.json 走 OAuth
```

> **注意**：OAuth token 有 expiry，需確保 credential file 在 container 內可讀（掛載 volume 或 build 時寫入）。

---

## Agent 設定

每個 agent 在 `AGENTS_DIR/<agent-id>/` 目錄下：

```
agents/
└── my-assistant/
    ├── agent.json          # Agent 設定（必填）
    ├── CLAUDE.md           # Agent 系統提示詞
    ├── .claude/
    │   └── skills/         # Agent skills
    └── projects/           # Agent 專案
```

### agent.json

```json
{
  "name": "My Assistant",
  "description": "A general-purpose assistant",
  "discordBotToken": "xxxx",
  "model": "sonnet",
  "settings": {
    "agentCwd": "/path/to/cwd"
  }
}
```

---

## Project Structure

```
claudecab/
├── src/
│   ├── adapters/        # Discord adapter
│   ├── conversation/    # Conversation pipeline
│   ├── core/            # SessionManager, MessageProcessor, SDK integration
│   ├── persistence/     # SQLite repositories
│   ├── schedule/        # Cron schedule system
│   ├── services/        # OAuth usage and keepalive ROI services
│   ├── types/           # TypeScript types
│   └── utils/           # Logging, events, security, formatting
├── docs/                # Architecture docs, upgrade guides
├── scripts/             # Build-time scripts (patch-sdk-v2.cjs)
├── agents/              # Agent 目錄（外部管理，不走 git）
├── data/                # SQLite 資料庫（runtime 生成）
├── logs/                # 執行日誌（runtime 生成）
├── dist/                # 編譯輸出
├── Dockerfile           # 多階段容器 build
├── docker-compose.yml   # Production + Dev profiles
└── .env.example         # 環境變數範本
```

## Architecture

完整的架構說明、模組地圖、對話 pipeline、SDK 整合機制、排程系統、可觀測性等細節請見：

**[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**

---

## Development

```bash
npm run dev              # 開發模式（tsx 即時轉譯）
npm run build            # 編譯 TypeScript → dist/
npm run typecheck        # 型別檢查（tsc --noEmit）
npm test                 # 測試（watch mode）
npm run test:run         # 測試（single run）
npm run lint             # ESLint
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier format
npm run format:check     # Prettier check
```

## License

MIT
