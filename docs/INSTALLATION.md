# ClaudeCab 安裝指南

這份文件走「最短能跑起來」路線。完整設定說明請看 [CONFIGURATION.md](CONFIGURATION.md)。

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

如果你用 `claude login`，就讓 `ANTHROPIC_API_KEY` 保持空白。

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

`agents/example/CLAUDE.md` 是 agent 的基本提示詞，可以先不改。

`agents/example/.claude/settings.local.json` 是 Claude Code 專案設定，第一次安裝也先不改。

## 5. 啟動

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

## 6. Schedule 測試

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
