# ClaudeCab Config Matrix

## Required

| Setting | Location | Notes |
|---|---|---|
| `DISCORD_ENABLED` | `.env`, cloud env, local overlay | Must be `true` for the Discord runtime. |
| `DISCORD_MAIN_BOT_TOKEN` | `.env` / cloud secret | Main bot token; handles slash commands and system interaction. |
| `DISCORD_MAIN_BOT_CLIENT_ID` | `.env` / cloud env | Discord Application ID, not the guild ID. |
| `DISCORD_GUILD_ID` | `.env` / cloud env | Discord server ID. |
| `AGENTS_DIR` | `.env` / cloud env | Agents directory, default `./agents`. |
| `discordBotToken` | `agents/<id>/agent.json` | Agent bot token. May match the main bot for testing; use separate bots for production. |
| `discordChannelId` | `agents/<id>/agent.json` | Discord channel ID the agent listens on. |

## Operator and admin

| Setting | Location | Notes |
|---|---|---|
| `DISCORD_OWNER_USER_ID` | `.env` / local overlay | Operator gate, sensitive maintenance commands, schedule notifications. |
| `ADMIN_CONSOLE_ENABLED` | `.env` / local overlay | Default `false`. |
| `ADMIN_CONSOLE_TOKEN` | `.env` / local overlay | Required when the admin console is enabled; use a long random string. |
| `ADMIN_CONSOLE_HOST` | `.env` / local overlay | Default `127.0.0.1`. Add auth/proxy before binding externally. |
| `ADMIN_CONSOLE_PORT` | `.env` / local overlay | Default `47824`. |
| `CLAUDECAB_LOCAL_CONFIG_PATH` | `.env` | Default `./data/claudecab.local.json`; global overrides from the admin console are written here. |

## Claude / provider auth

| Mode | Where to set | Required values |
|---|---|---|
| Claude Code OAuth | Deploy host | Run `claude login`; leave `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` empty. |
| Anthropic API key | `.env`, cloud secret, agent settings | `ANTHROPIC_API_KEY`; usually no base URL needed. |
| DeepSeek / proxy / provider | Prefer `agents/<id>/.claude/settings.local.json` | `env.ANTHROPIC_API_KEY` or `env.ANTHROPIC_AUTH_TOKEN`, plus `env.ANTHROPIC_BASE_URL`. |

## Restart required after change?

| Change | Recommended action |
|---|---|
| `schedules/*.yaml` | No restart; the schedule watcher reloads. |
| `.claude/settings.local.json` model/provider env | Close existing SDK session or restart before retesting. |
| `agent.json` token/channel | Restart recommended. |
| `.env` / local overlay global runtime settings | Restart required. |
| Admin console host/token | Restart required. |
