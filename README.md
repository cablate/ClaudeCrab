# ClaudeCab

ClaudeCab 是一個 Discord-first runtime，讓使用者可以在 Discord channel/thread 裡透過 Claude Agent SDK / Claude Code 和 agent 對話。

主要用途：

- 用 Discord 消耗 Claude Code 訂閱或 Anthropic API 額度。
- 透過 Claude Code SDK harness 接 Anthropic-compatible endpoint，例如 DeepSeek 或第三方 proxy。
- 把 Discord channel/thread 對話映射成可持續 resume 的 Claude session。

```text
Discord channel/thread -> Agent Bot -> ClaudeCab -> Claude Agent SDK -> Discord reply
```

## 功能範圍

目前保留：

- 從 `AGENTS_DIR` 載入 Discord agents
- Claude Agent SDK V2 persistent sessions
- idle session cleanup 與 prompt-cache keepalive
- Discord permission / question / exit-plan callbacks
- YAML schedules，可輸出 Discord message/thread
- SQLite persistence，包含 sessions、conversation、query metrics、schedule thread mapping
- Discord dashboard、cost report、cache anomaly report
- MCP tools 與 workspace validation

不包含：

- Web UI / public dashboard assets
- Telegram
- TTS 或音效播放
- 自主社群發文或 initiative routing
- 舊 task、budget、activity services

## 快速開始

需求：

- Node.js 20+
- Discord bot token
- Claude 認證：`ANTHROPIC_API_KEY` 或 Claude Code OAuth

安裝：

```bash
npm install
cp .env.example .env
```

最小 `.env`：

```env
DISCORD_ENABLED=true
DISCORD_MAIN_BOT_TOKEN=your-main-bot-token
DISCORD_MAIN_BOT_CLIENT_ID=your-main-bot-application-id
DISCORD_GUILD_ID=your-discord-server-id

AGENTS_DIR=./agents

# 使用 API key 才填；使用 claude login / OAuth 時保持空白
ANTHROPIC_API_KEY=
```

修改 `agents/example/agent.json`：

```json
{
  "name": "Example",
  "description": "Starter Discord agent profile",
  "discordBotToken": "your-agent-bot-token",
  "discordChannelId": "target-channel-id",
  "model": "sonnet",
  "settings": {
    "permissionMode": "default",
    "maxTurns": 20
  }
}
```

檢查並啟動：

```bash
npm run setup:check
npm run dev
```

正式啟動：

```bash
npm run build
npm start
```

完整安裝、Discord bot、Claude OAuth/API key/proxy、AI 輔助設定、schedule 測試都集中在 [docs/SETUP.md](docs/SETUP.md)。

安裝不能只看 build 是否通過；實際完成標準是 Agent Bot 在目標 Discord channel 上線並能回覆訊息。啟動後檢查方式請看 [docs/SETUP.md](docs/SETUP.md) 的最小安裝段落。

## Agent 設定

Live agents 由 `AGENTS_DIR` 載入：

```text
AGENTS_DIR/
  example/
    agent.json
    CLAUDE.md
    .claude/
      settings.local.json
    .mcp.json
    schedules/
      *.yaml
```

預設只追蹤 [agents/example](agents/example)。真實 agent folders 是本機 runtime 設定，預設會被 git ignore。

第一次安裝通常只需要改：

- `.env`：主 Bot、server id、Claude 認證。
- `agents/example/agent.json`：Agent Bot token、channel id。
- `agents/example/.claude/settings.local.json`：只有接 DeepSeek、proxy 或其他 provider 時才需要改。

Session、cache keepalive、schedule、dashboard、STT 都有預設值。第一次安裝不要全部調整。

## 架構

主要 runtime flow：

```text
start.ts supervisor
  -> src/index.ts
  -> AppBootstrap
  -> AgentLoader
  -> PlatformOrchestrator
  -> DiscordAdapter
  -> DiscordMessageHandler
  -> MessageProcessor
  -> ConversationPipeline
  -> QueryExecutor
  -> SDKSessionManager
  -> SDKStreamProcessor
  -> DiscordSender / StreamResponseRouter
```

主要模組：

- `src/adapters/discord/`: Discord client lifecycle、slash commands、message conversion、interaction UI、sending。
- `src/core/orchestrator/`: app-level agent loading 與 platform orchestration。
- `src/conversation/`: session creation、locking、guard checks、pipeline state transitions。
- `src/core/query/`: SDK query orchestration、stream event handling、response delivery、usage recording。
- `src/core/session/`: app sessions 與 Claude SDK V2 session lifecycle。
- `src/core/interaction/`: SDK permission/question/exit-plan callback bridges。
- `src/core/keepalive/`: prompt-cache keepalive scheduling、audit、ROI、healing、cache efficiency tracking。
- `src/schedule/`: YAML schedule loading、cron registration、execution、output formatting、thread mapping。
- `src/persistence/`: SQLite repositories 與 migrations。

完整架構請看 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 驗證

```bash
npm run setup:check
npm run typecheck
npm run test:run
npm run build
```

Schedule 檢查：

```bash
npm run schedule:list
npm run schedule:validate
npm run schedule:run -- example/example-daily-check
npm run schedule:discord-test -- example/example-daily-check
```

## Repository Notes

這個 repository 只應包含 Discord + Claude Agent SDK runtime 需要的程式碼、公開範例與文件。

不應提交：

- `node_modules/`
- `dist/`
- `data/`
- `logs/`
- `.codegraph/`
- `.claude/`
- 真實 live agent folders
- local agent skills
- generated databases
- planning archives

## License

MIT
