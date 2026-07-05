# ClaudeCab Config Matrix

## Required

| Setting | Location | Notes |
|---|---|---|
| `DISCORD_ENABLED` | `.env`, cloud env, or local overlay | Must be `true` for Discord runtime. |
| `DISCORD_MAIN_BOT_TOKEN` | `.env` / cloud secret | Main bot for slash commands and system interactions. |
| `DISCORD_MAIN_BOT_CLIENT_ID` | `.env` / cloud env | Discord application ID, not guild ID. |
| `DISCORD_GUILD_ID` | `.env` / cloud env | Discord server ID. |
| `AGENTS_DIR` | `.env` / cloud env | Folder containing agent directories. |
| `discordBotToken` | `agents/<id>/agent.json` | Agent bot token. Can equal main token only for simple testing, not recommended for production. |
| `discordChannelId` | `agents/<id>/agent.json` | Channel this agent listens to. |

## Operator And Admin

| Setting | Location | Notes |
|---|---|---|
| `DISCORD_OWNER_USER_ID` | `.env` / local overlay | Operator gate for sensitive Discord commands and schedule notifications. |
| `ADMIN_CONSOLE_ENABLED` | `.env` / local overlay | Default false. |
| `ADMIN_CONSOLE_TOKEN` | `.env` / local overlay | Required when admin console is enabled. Use a long random token. |
| `ADMIN_CONSOLE_HOST` | `.env` / local overlay | Default `127.0.0.1`. Use public bind only behind auth/proxy. |
| `ADMIN_CONSOLE_PORT` | `.env` / local overlay | Default `47824`. |
| `CLAUDECAB_LOCAL_CONFIG_PATH` | `.env` | Defaults to `./data/claudecab.local.json`; admin console writes global overrides here. |

## Claude / Provider Auth

| Mode | Where to set | Required values |
|---|---|---|
| Claude Code OAuth | Host machine | Run `claude login`; leave `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` blank. |
| Anthropic API key | `.env`, cloud secret, or agent settings | `ANTHROPIC_API_KEY`; usually no base URL. |
| DeepSeek/proxy/provider | Prefer `agents/<id>/.claude/settings.local.json` | `env.ANTHROPIC_API_KEY` and `env.ANTHROPIC_BASE_URL`. |

## Restart Expectations

| Change | Expected action |
|---|---|
| `schedules/*.yaml` | No restart; schedule watcher reloads. |
| `.claude/settings.local.json` model/provider env | Close existing SDK session or restart if unsure. |
| `agent.json` token/channel | Restart recommended. |
| `.env` / local overlay global runtime settings | Restart required. |
| Admin console bind/token | Restart required. |
