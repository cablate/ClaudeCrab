# ClaudeCab 設定矩陣

## 必填

| 設定 | 位置 | 說明 |
|---|---|---|
| `DISCORD_ENABLED` | `.env`、cloud env、local overlay | Discord runtime 要設 `true`。 |
| `DISCORD_MAIN_BOT_TOKEN` | `.env` / cloud secret | 主 Bot token，負責 slash command 與系統互動。 |
| `DISCORD_MAIN_BOT_CLIENT_ID` | `.env` / cloud env | Discord Application ID，不是 guild ID。 |
| `DISCORD_GUILD_ID` | `.env` / cloud env | Discord server ID。 |
| `AGENTS_DIR` | `.env` / cloud env | agents 目錄，預設 `./agents`。 |
| `discordBotToken` | `agents/<id>/agent.json` | Agent Bot token。測試可和主 Bot 相同，正式建議分開。 |
| `discordChannelId` | `agents/<id>/agent.json` | Agent 監聽的 Discord channel ID。 |

## Operator 與 Admin

| 設定 | 位置 | 說明 |
|---|---|---|
| `DISCORD_OWNER_USER_ID` | `.env` / local overlay | operator gate、敏感維護指令、schedule 通知使用。 |
| `ADMIN_CONSOLE_ENABLED` | `.env` / local overlay | 預設 `false`。 |
| `ADMIN_CONSOLE_TOKEN` | `.env` / local overlay | 啟用 admin console 必填，請用長隨機字串。 |
| `ADMIN_CONSOLE_HOST` | `.env` / local overlay | 預設 `127.0.0.1`。對外綁定前先加 auth/proxy。 |
| `ADMIN_CONSOLE_PORT` | `.env` / local overlay | 預設 `47824`。 |
| `CLAUDECAB_LOCAL_CONFIG_PATH` | `.env` | 預設 `./data/claudecab.local.json`；admin console 的全域覆寫寫在這裡。 |

## Claude / Provider 認證

| 模式 | 設定位置 | 必要值 |
|---|---|---|
| Claude Code OAuth | 部署機器 | 跑 `claude login`；`ANTHROPIC_API_KEY` 與 `ANTHROPIC_BASE_URL` 留空。 |
| Anthropic API key | `.env`、cloud secret、agent settings | `ANTHROPIC_API_KEY`；通常不需要 base URL。 |
| DeepSeek/proxy/provider | 優先放 `agents/<id>/.claude/settings.local.json` | `env.ANTHROPIC_API_KEY` 或 `env.ANTHROPIC_AUTH_TOKEN`，以及 `env.ANTHROPIC_BASE_URL`。 |

## 變更後是否重啟

| 變更 | 建議動作 |
|---|---|
| `schedules/*.yaml` | 不用重啟，schedule watcher 會 reload。 |
| `.claude/settings.local.json` model/provider env | 關閉既有 SDK session 或重啟後再測。 |
| `agent.json` token/channel | 建議重啟。 |
| `.env` / local overlay 全域 runtime 設定 | 需要重啟。 |
| Admin console host/token | 需要重啟。 |
