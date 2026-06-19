# ClaudeCab

Discord runtime for talking to Claude Code through the Claude Agent SDK.

ClaudeCab lets Discord users send messages to configured agents, keep Claude SDK sessions alive across turns, run scheduled prompts into Discord threads, and observe cost/cache/session behavior from operational Discord channels.

## Current Scope

ClaudeCab is intentionally Discord-first. The current product surface is:

- Discord agent bots loaded from `AGENTS_DIR`.
- Claude Agent SDK V2 persistent sessions, with optional ephemeral mode.
- Prompt-cache keepalive and session idle cleanup.
- Discord permission, question, and exit-plan interaction prompts.
- YAML schedules that can post into Discord channels and continue in threads.
- SQLite persistence for sessions, conversations, query metrics, rate-limit snapshots, and schedules.
- Operational Discord services for dashboard, cost reports, and cache anomaly reports.
- Built-in MCP tools for file sending and workspace validation.

Not current scope:

- Web UI / public dashboard assets.
- Telegram.
- TTS or sound playback.
- Autonomous social posting or initiative routing.
- Legacy task, budget, or activity services.

## Quick Start

Requirements:

- Node.js 20+
- Discord bot tokens
- Claude authentication through `ANTHROPIC_API_KEY` or local Claude Code OAuth credentials

Install:

```bash
npm install
```

Create local env:

```bash
cp .env.example .env
```

Minimum useful `.env`:

```env
DISCORD_ENABLED=true
DISCORD_MAIN_BOT_TOKEN=your-main-bot-token
DISCORD_MAIN_BOT_CLIENT_ID=your-main-bot-client-id
DISCORD_GUILD_ID=your-discord-server-id

AGENTS_DIR=./agents

# Use either API key or Claude Code OAuth credentials.
ANTHROPIC_API_KEY=
```

Run in development:

```bash
npm run dev
```

Run with the supervisor:

```bash
npm run build
npm start
```

The supervisor writes:

- `claudecab.pid`
- `claudecab.runtime.json`
- logs under `logs/`

For a full first-time setup walkthrough, including Discord bot permissions, `agent.json`, `CLAUDE.md`, `.claude/settings.local.json`, and schedule validation, see [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Agent Profiles

Live agents are external to the repo and loaded from `AGENTS_DIR`.

Expected layout:

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

Minimal `agent.json`:

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

Live agent folders are local runtime configuration and are ignored by git. The sanitized starter profile at [agents/example](agents/example) is the only tracked agent folder.

## Important Configuration

### Sessions

| Variable | Default | Purpose |
| --- | ---: | --- |
| `SESSION_EPHEMERAL` | `false` | If `true`, close the SDK process after each query and resume later from SDK session data. |
| `SESSION_IDLE_CLOSE_MS` | `7200000` | Close live SDK CLI process after 2 hours of real-query idle time. App session and SDK session id are retained for resume. Set `0` to disable. |
| `SESSION_QUERY_HARD_TIMEOUT_MS` | `3600000` | Interrupt a V2 query after 1 hour. Set `0` to disable. |
| `SESSION_QUERY_HARD_TIMEOUT_GRACE_MS` | `30000` | Force-close the live SDK CLI process if a timed-out query does not stop during grace. |
| `SESSION_TIMEOUT_MS` | `3600000` | App session inactivity timeout. |
| `MAX_SESSIONS` | `1000` | Maximum app sessions kept in memory. |

### Cache Keepalive

| Variable | Default | Purpose |
| --- | ---: | --- |
| `CACHE_KEEPALIVE_ENABLED` | `true` | Enable prompt-cache keepalive pings. |
| `CACHE_KEEPALIVE_INTERVAL_MS` | `60000` | Default keepalive interval. |
| `CACHE_KEEPALIVE_SKIP_RECENT_MS` | `15000` | Skip keepalive when user/cache activity is recent. |
| `CACHE_KEEPALIVE_DETECTED_TTL_RATIO` | `0.6` | Recompute interval from detected prompt-cache TTL. |
| `CACHE_KEEPALIVE_MIN_INTERVAL_MS` | `30000` | Lower bound for detected TTL interval. |
| `CACHE_KEEPALIVE_QUERYING_RETRY_MS` | `15000` | Retry delay when keepalive fires while a query is running. |
| `CACHE_KEEPALIVE_POST_QUERY_WARMUP_MS` | `5000` | Warmup delay after a normal user query. |
| `CACHE_EFFICIENCY_WARN_THRESHOLD` | `50` | Warn when rolling cache-read efficiency falls below this percentage. |

### Discord Ops

| Variable | Purpose |
| --- | --- |
| `DISCORD_MAIN_BOT_TOKEN` | Main bot for slash commands and operational services. |
| `DISCORD_MAIN_BOT_CLIENT_ID` | Main Discord application id. |
| `DISCORD_GUILD_ID` | Discord server id. |
| `DISCORD_OWNER_USER_ID` | Optional owner id for privileged notifications. |
| `DISCORD_CHANNEL_DASHBOARD` | Operational dashboard channel. |
| `DISCORD_CHANNEL_COST_REPORT` | Daily cost report channel. |
| `DISCORD_CHANNEL_ALERTS` | Alert channel. |
| `DISCORD_CHANNEL_SYSTEM_LOG` | System log channel. |
| `DISCORD_DASHBOARD_UPDATE_MINUTES` | Dashboard refresh interval. |

### Persistence And Schedules

| Variable | Default | Purpose |
| --- | ---: | --- |
| `ENABLE_PERSISTENCE` | `false` | Enable SQLite repositories. |
| `DB_PATH` | `./data/claudecab.db` | SQLite database path. |
| `DB_RETENTION_MS` | `2592000000` | Persistence retention window. |
| `SCHEDULE_ENABLED` | `true` | Enable YAML schedule loading and cron execution. |

## Architecture

Primary runtime flow:

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

Key module boundaries:

- `src/adapters/discord/`: Discord client lifecycle, slash commands, message conversion, interaction UI, sending.
- `src/core/orchestrator/`: app-level agent loading and platform orchestration.
- `src/conversation/`: session creation, locking, guard checks, and pipeline state transitions.
- `src/core/query/`: SDK query orchestration, stream event handling, response delivery, usage recording.
- `src/core/session/`: app sessions and Claude SDK V2 session lifecycle.
- `src/core/interaction/`: SDK permission/question/exit-plan callback bridges.
- `src/core/keepalive/`: prompt-cache keepalive scheduling, audit, ROI, healing, and cache efficiency tracking.
- `src/schedule/`: YAML schedule loading, cron registration, execution, output formatting, and thread mapping.
- `src/persistence/`: SQLite repositories and migrations.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the current architecture map.

## Development

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
```

Other scripts:

```bash
npm run dev
npm start
npm run lint:fix
npm run format
npm run format:check
```

There is no `npm run quality-gate`; use the explicit commands above.

## Schedule Checks

Validate schedule YAML without running Claude or Discord delivery:

```bash
npm run schedule:list
npm run schedule:validate
```

Run a schedule prompt through Claude SDK without Discord delivery:

```bash
npm run schedule:run -- general/morning-briefing
```

Create a real Discord thread and send a test message without running the schedule prompt:

```bash
npm run schedule:discord-test -- general/morning-briefing
```

`schedule:discord-test` uses the target agent bot token through Discord REST. It does not start a second Gateway listener, so it is suitable while the normal ClaudeCab process is already running.

## Deployment

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

If using Claude Code OAuth instead of `ANTHROPIC_API_KEY`, run `claude login` on the host and make sure the runtime can read the resulting credentials.

## Repository Notes

The repository intentionally excludes runtime-heavy or local-only state:

- `node_modules/`
- `dist/`
- `data/`
- `logs/`
- `.codegraph/`
- `.claude/` and external live agent folders

The main source tree focuses on the Discord + Claude Agent SDK runtime. Local agent skills, private prompts, generated databases, logs, and planning archives are intentionally kept out of git.

## License

MIT
