# ClaudeCab 安裝與設定

這份文件是新使用者的主路徑：從零安裝、填必要設定、啟動、驗證。

最小安裝只需要設定三個地方：

1. `.env`
2. `agents/example/agent.json`
3. `agents/example/.claude/settings.local.json`

其他 session、cache、schedule、dashboard、STT 設定都有預設值。第一次安裝先不要改。

## 你需要準備什麼

- Node.js 20+
- 一個你能管理的 Discord server
- Discord Developer Portal 裡的兩個 Bot
- Claude 認證，二選一：
  - `ANTHROPIC_API_KEY`
  - 或在部署機器上跑過 `claude login`

## 1. 安裝專案

```bash
git clone https://github.com/cablate/ClaudeCrab.git
cd ClaudeCab
npm install
cp .env.example .env
```

## 2. 建 Discord Bot

最簡單先建兩個 Bot：

- 主 Bot：填到 `.env`，負責 slash command、互動按鈕、系統訊息。
- Agent Bot：填到 `agents/example/agent.json`，負責在 Discord 頻道回話。

建 Bot 後記下：

- 主 Bot token
- 主 Bot application/client ID
- Agent Bot token
- Discord server/guild ID
- Agent 要回覆的 channel ID

建議權限：

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

## 3. 填 `.env`

只先填這些：

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

如果你用 Claude Code 訂閱 / OAuth：

```bash
claude login
```

然後讓 `.env` 裡的 `ANTHROPIC_API_KEY` 保持空白。

## 4. 填 `agents/example/agent.json`

把 `discordBotToken` 和 `discordChannelId` 換成你的 Agent Bot token 與頻道 ID：

```json
{
  "name": "Example",
  "description": "Starter Discord agent profile",
  "model": "sonnet",
  "discordBotToken": "你的AgentBotToken",
  "discordChannelId": "你的DiscordChannelId",
  "settings": {
    "permissionMode": "default",
    "maxTurns": 20
  }
}
```

主 Bot 和 Agent Bot 可以先用不同 Discord application。這樣職責最清楚：

- 主 Bot：slash command、按鈕、系統功能。
- Agent Bot：在指定頻道裡代表 agent 回話。

## 5. 看一下 agent 其他檔案

`agents/example/CLAUDE.md` 是 agent 的基本提示詞。第一次可以先不改。

`agents/example/.claude/settings.local.json` 是 Claude Code 專案設定。第一次可以保持預設：

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

`agents/example/.mcp.json` 是該 agent 的 MCP 設定。沒有 MCP server 時可以保持空物件。

## 6. 啟動

開發模式：

```bash
npm run dev
```

正式一點的本機跑法：

```bash
npm run build
npm start
```

看到這些現象代表大致正常：

- `logs/` 出現 log
- `data/claudecab.db` 出現資料庫
- Agent Bot 在 Discord 上線
- 到指定 channel 發訊息，Agent Bot 有回覆

## 其他模型服務 / Proxy

如果你要接 DeepSeek、第三方 proxy，或任何 Anthropic-compatible 服務，不建議只填全域 `.env`。

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

## Schedule 測試

先驗證 YAML：

```bash
npm run schedule:validate
```

測 Discord thread 建立，不跑 Claude prompt：

```bash
npm run schedule:discord-test -- example/example-daily-check
```

手動觸發 schedule：

```bash
npm run schedule:trigger -- example/example-daily-check
```

## 常見問題

### Agent 沒有回覆

檢查：

- `.env` 有 `DISCORD_ENABLED=true`
- `agents/example/agent.json` 有填 Agent Bot token
- `agents/example/agent.json` 有填正確 channel ID
- Bot 有該 channel 的 View / Send / Read Message History 權限

### 沒有載入 Agent

檢查：

- `.env` 是 `AGENTS_DIR=./agents`
- `agents/example/agent.json` 存在
- `agent.json` 沒有 JSON 格式錯誤

### Claude 認證失敗

確認你只用一種方式：

- API key：填 `ANTHROPIC_API_KEY`
- OAuth：先跑 `claude login`，並讓 `ANTHROPIC_API_KEY` 空白

如果使用 OAuth，不要設定 `ANTHROPIC_BASE_URL`。

如果使用其他模型服務或 proxy，請把 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` 放到 agent 的 `.claude/settings.local.json`，不要混用主機 OAuth。
