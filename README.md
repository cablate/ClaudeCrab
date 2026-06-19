# ClaudeCab

ClaudeCab 是一個 Discord runtime，讓你可以在 Discord 裡透過 Claude Agent SDK / Claude Code 與 agent 對話。

主要用途：

- 已訂閱 Claude Code，希望透過 Discord 使用。
- 想部署 Claude Code SDK harness，接 Anthropic-compatible endpoint 或其他模型服務。
- 想用 Discord channel/thread 承接 agent 對話與排程輸出。

## 目前範圍

ClaudeCab 目前是 Discord-first。核心功能是：

- 從 `AGENTS_DIR` 載入 Discord agents。
- Claude Agent SDK V2 persistent sessions。
- Prompt-cache keepalive 與 idle session cleanup。
- Discord 內處理 permission / question / exit-plan 互動。
- YAML schedules，可輸出到 Discord message/thread。
- SQLite persistence，保存 sessions、conversation、query metrics、schedule thread 對應。
- Discord dashboard、cost report、cache anomaly report。
- 內建 MCP tools：檔案傳送、workspace validation。

目前不做：

- Web UI / public dashboard assets.
- Telegram.
- TTS or sound playback.
- Autonomous social posting or initiative routing.
- Legacy task, budget, or activity services.

## 快速開始

需求：

- Node.js 20+
- Discord bot tokens
- Claude 認證：`ANTHROPIC_API_KEY` 或本機 Claude Code OAuth

安裝：

```bash
npm install
```

建立 `.env`：

```bash
cp .env.example .env
```

最小 `.env`：

```env
DISCORD_ENABLED=true
DISCORD_MAIN_BOT_TOKEN=your-main-bot-token
DISCORD_MAIN_BOT_CLIENT_ID=your-main-bot-client-id
DISCORD_GUILD_ID=your-discord-server-id

AGENTS_DIR=./agents

# 使用 API key；如果改用 claude login，保持空白。
ANTHROPIC_API_KEY=your-anthropic-api-key
```

接著修改 `agents/example/agent.json`：

```json
{
  "name": "Example",
  "model": "sonnet",
  "discordBotToken": "your-agent-bot-token",
  "discordChannelId": "target-channel-id",
  "settings": {
    "permissionMode": "default",
    "maxTurns": 20
  }
}
```

開發模式啟動：

```bash
npm run dev
```

使用 supervisor 啟動：

```bash
npm run build
npm start
```

supervisor 會寫入：

- `claudecab.pid`
- `claudecab.runtime.json`
- logs under `logs/`

第一次安裝與完整設定請看 [docs/SETUP.md](docs/SETUP.md)。

如果要請 AI assistant 幫你設定，請把 [docs/AI_SETUP_ASSISTANT.md](docs/AI_SETUP_ASSISTANT.md) 貼給它。這份文件會要求 AI 只改必要設定、避免亂碰進階選項或 commit secrets。

如果要接 DeepSeek、第三方 proxy 或其他 Anthropic-compatible 服務，請特別看 `SETUP.md` 的「其他模型服務 / Proxy」。這種模式建議把 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` 放在 agent 的 `.claude/settings.local.json`，ClaudeCab 會自動隔離 `CLAUDE_CONFIG_DIR`，避免讀到主機 Claude Code OAuth 憑證。

## Agent 設定檔

Live agents 從 `AGENTS_DIR` 載入。

目錄結構：

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
    projects/
  your-agent/
    ...
```

最小 `agent.json`：

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

Live agent folders 是本機 runtime 設定，預設會被 git ignore。只有 [agents/example](agents/example) 這份乾淨範例會被追蹤。

## 設定文件

一般使用者第一次安裝只需要設定：

- `.env`：主 Bot、server id、Claude 認證。
- `agents/example/agent.json`：Agent Bot token、channel id。
- `agents/example/CLAUDE.md`：agent 行為提示詞，可先不改。
- `agents/example/.claude/settings.local.json`：Claude Code 專案設定，可先不改。

Session、cache keepalive、schedule、dashboard、STT 都有預設值。不要在第一次安裝時全部調整。

請看 [docs/SETUP.md](docs/SETUP.md)。

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

主要模組邊界：

- `src/adapters/discord/`: Discord client lifecycle, slash commands, message conversion, interaction UI, sending.
- `src/core/orchestrator/`: app-level agent loading and platform orchestration.
- `src/conversation/`: session creation, locking, guard checks, and pipeline state transitions.
- `src/core/query/`: SDK query orchestration, stream event handling, response delivery, usage recording.
- `src/core/session/`: app sessions and Claude SDK V2 session lifecycle.
- `src/core/interaction/`: SDK permission/question/exit-plan callback bridges.
- `src/core/keepalive/`: prompt-cache keepalive scheduling, audit, ROI, healing, and cache efficiency tracking.
- `src/schedule/`: YAML schedule loading, cron registration, execution, output formatting, and thread mapping.
- `src/persistence/`: SQLite repositories and migrations.

目前架構圖請看 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 開發

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
```

其他 scripts：

```bash
npm run dev
npm start
npm run lint:fix
npm run format
npm run format:check
```

目前沒有 `npm run quality-gate`，請使用上面的明確指令。

## Schedule 檢查

只驗證 schedule YAML，不執行 Claude 或 Discord delivery：

```bash
npm run schedule:list
npm run schedule:validate
```

手動跑公開範例 schedule prompt，不做 Discord delivery：

```bash
npm run schedule:run -- example/example-daily-check
```

建立真實 Discord thread 並送測試訊息，但不跑 schedule prompt：

```bash
npm run schedule:discord-test -- example/example-daily-check
```

`schedule:discord-test` 會用目標 agent bot token 透過 Discord REST 建 thread，不會啟動第二個 Gateway listener，所以 ClaudeCab 正在跑時也能測。

## 部署

Docker:

```bash
docker compose up -d
```

Cloud VM:

```bash
git clone https://github.com/cablate/ClaudeCrab.git
cd ClaudeCab
cp .env.example .env
npm ci --production
npm run build
npm start
```

如果使用 Claude Code OAuth 而不是 `ANTHROPIC_API_KEY`，請先在部署機器執行 `claude login`，並確認 runtime 讀得到該憑證。

## Repository Notes

這個 repository 會刻意排除 runtime-heavy 或本機專用資料：

- `node_modules/`
- `dist/`
- `data/`
- `logs/`
- `.codegraph/`
- `.claude/` and external live agent folders

主程式碼只保留 Discord + Claude Agent SDK runtime。Local agent skills、私人 prompts、generated databases、logs、planning archives 都不進 git。

## License

MIT
