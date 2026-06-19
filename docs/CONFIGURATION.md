# ClaudeCab 設定說明

這份文件只回答一件事：要把 ClaudeCab 跑起來，到底要設定哪些檔案。

最小安裝只需要三個地方：

1. `.env`
2. `agents/example/agent.json`
3. `agents/example/.claude/settings.local.json`

其他 session、cache、schedule、dashboard、STT 設定都有預設值。第一次安裝不要急著改。

## 最小可跑設定

### 1. `.env`

先複製範本：

```bash
cp .env.example .env
```

最少只需要填這幾個：

```env
DISCORD_ENABLED=true
DISCORD_MAIN_BOT_TOKEN=你的主BotToken
DISCORD_MAIN_BOT_CLIENT_ID=你的主BotApplicationId
DISCORD_GUILD_ID=你的DiscordServerId

AGENTS_DIR=./agents

ANTHROPIC_API_KEY=你的AnthropicApiKey
ENABLE_PERSISTENCE=true
DB_PATH=./data/claudecab.db
```

如果你要用 Claude Code 訂閱登入，而不是 API key：

```bash
claude login
```

然後 `.env` 裡讓 `ANTHROPIC_API_KEY` 保持空白。

### 2. `agents/example/agent.json`

這是 agent 自己的 Discord Bot 設定。

最少要填：

```json
{
  "name": "Example",
  "description": "Starter Discord agent profile",
  "model": "sonnet",
  "discordBotToken": "你的AgentBotToken",
  "discordChannelId": "這個Agent要回覆的DiscordChannelId",
  "settings": {
    "permissionMode": "default",
    "maxTurns": 20
  }
}
```

主 Bot 和 Agent Bot 可以先用不同 Discord application。這樣職責最清楚：

- 主 Bot：slash command、按鈕、系統功能。
- Agent Bot：在指定頻道裡代表 agent 回話。

### 3. `agents/example/.claude/settings.local.json`

第一次安裝保持預設即可：

```json
{
  "model": "sonnet",
  "permissions": {
    "allow": [],
    "deny": []
  },
  "env": {}
}
```

如果某個 agent 要走不同 API key 或 proxy，才把它放到這裡：

```json
{
  "model": "sonnet",
  "env": {
    "ANTHROPIC_API_KEY": "agent-specific-key",
    "ANTHROPIC_BASE_URL": "https://your-compatible-endpoint.example.com"
  }
}
```

### 其他模型服務 / Anthropic-compatible proxy

如果你要接 DeepSeek、第三方 proxy，或任何相容 Anthropic API 的服務，不建議只填全域 `.env`。

建議放在該 agent 的：

```text
agents/example/.claude/settings.local.json
```

例如：

```json
{
  "model": "sonnet",
  "permissions": {
    "allow": [],
    "deny": []
  },
  "env": {
    "ANTHROPIC_API_KEY": "你的ProviderKey",
    "ANTHROPIC_BASE_URL": "https://你的ProviderEndpoint"
  }
}
```

這裡有一個重要細節：

只要 ClaudeCab 在 agent 的 `.claude/settings.local.json` 裡讀到 `env.ANTHROPIC_API_KEY`，就會自動做兩件事：

1. 把 `CLAUDE_CONFIG_DIR` 指到該 agent 的 `.claude` 目錄。
2. 把 `ANTHROPIC_AUTH_TOKEN` 清空。

原因是 Claude Code 預設可能會讀主機上的 OAuth 憑證。如果你要走 API key 或第三方 provider，就要避免它誤用主機的 Claude Code OAuth。這個 redirect 由 ClaudeCab 自動處理，一般不需要手動設定 `CLAUDE_CONFIG_DIR`。

簡單判斷：

| 使用方式 | 設定位置 | `ANTHROPIC_BASE_URL` | 備註 |
| --- | --- | --- | --- |
| Claude Code 訂閱 / OAuth | 主機跑 `claude login` | 不要設定 | 使用主機 OAuth 憑證 |
| Anthropic API key | `.env` 或 agent settings | 通常不需要 | 單一 agent 可先放 `.env` |
| 其他模型服務 / proxy | agent `.claude/settings.local.json` 的 `env` | 要設定 | 會自動 redirect `CLAUDE_CONFIG_DIR` |

## 哪些設定一般人不用管

這些都有預設值，第一次部署不要改：

| 設定 | 預設行為 | 什麼時候才改 |
| --- | --- | --- |
| `SESSION_IDLE_CLOSE_MS` | SDK process 閒置 2 小時後關閉，之後可 resume | 機器記憶體很小，想更快釋放資源 |
| `SESSION_EPHEMERAL` | 預設保留 live session | 想每次問完就釋放 SDK process |
| `CACHE_KEEPALIVE_*` | 自動維持 prompt cache | 確認 cache 成本/命中率後再調 |
| `SESSION_GUARD_*` | 避免超長上下文或過期 cache | 只有大量長對話時才需要調 |
| `SCHEDULE_ENABLED` | 預設開啟 schedule loader | 不使用 schedule 時可關 |
| `DISCORD_CHANNEL_*` | 不填也能聊天 | 想要 dashboard、成本報告、alert 頻道才填 |
| `STT_*` | 預設關閉語音轉文字 | 要處理語音附件才填 |
| `ALLOWED_USERS` | 空白代表所有人可用 | 公開伺服器要限制使用者才填 |

## 最簡安裝流程

1. `npm install`
2. `cp .env.example .env`
3. 填 `.env` 的 Discord 主 Bot 與 Claude 認證。
4. 填 `agents/example/agent.json` 的 Agent Bot token 和 channel id。
5. `npm run dev`
6. 到指定 Discord channel 對 agent bot 發訊息。

如果 agent 有回覆，代表最小安裝完成。

## Discord 權限

兩個 Bot 都建議給這些權限：

- View Channels
- Send Messages
- Create Public Threads
- Send Messages in Threads
- Read Message History
- Attach Files
- Use Slash Commands

如果只想先測聊天，最少要有：

- View Channels
- Send Messages
- Read Message History

## 常見錯誤

### Bot 在線但沒有回覆

檢查：

- `DISCORD_ENABLED=true`
- `agents/example/agent.json` 有填 `discordBotToken`
- `agents/example/agent.json` 有填 `discordChannelId`
- Bot 有該頻道的 View / Send / Read Message History 權限

### 啟動後沒有 agent

檢查：

- `.env` 的 `AGENTS_DIR=./agents`
- `agents/example/agent.json` 存在
- `agent.json` 是合法 JSON

### Claude 認證失敗

二選一：

- `.env` 填 `ANTHROPIC_API_KEY`
- 或先在部署機器執行 `claude login`，並保持 `ANTHROPIC_API_KEY` 空白

如果使用 Claude Code OAuth，不要設定 `ANTHROPIC_BASE_URL`。

如果使用 Anthropic-compatible proxy 或其他模型服務，建議設定在 agent 的 `.claude/settings.local.json`：

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "你的ProviderKey",
    "ANTHROPIC_BASE_URL": "https://你的ProviderEndpoint"
  }
}
```
