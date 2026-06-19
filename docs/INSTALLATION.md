# Installation Guide

This guide shows the shortest path from a fresh clone to one working Discord agent.

## 1. Install ClaudeCab

Requirements:

- Node.js 20+
- A Discord server where you can add bots
- Claude authentication, either `ANTHROPIC_API_KEY` or `claude login`

```bash
git clone https://github.com/cablate/ClaudeCrab.git
cd ClaudeCab
npm install
cp .env.example .env
```

## 2. Create Discord Applications

ClaudeCab uses two kinds of Discord bots:

- Main bot: slash commands and operational messages.
- Agent bot: the bot identity that replies in an agent channel.

For a minimal install, create one main bot and one agent bot in the Discord Developer Portal.

Enable these bot permissions when inviting them:

- View Channels
- Send Messages
- Create Public Threads
- Send Messages in Threads
- Read Message History
- Attach Files
- Use Slash Commands

Copy these values:

- Main bot token
- Main application/client ID
- Agent bot token
- Guild/server ID
- Agent channel ID

## 3. Configure `.env`

Minimum useful `.env`:

```env
DISCORD_ENABLED=true
DISCORD_MAIN_BOT_TOKEN=your-main-bot-token
DISCORD_MAIN_BOT_CLIENT_ID=your-main-application-id
DISCORD_GUILD_ID=your-server-id

AGENTS_DIR=./agents

# Use one auth mode:
ANTHROPIC_API_KEY=your-anthropic-api-key
# or leave ANTHROPIC_API_KEY empty after running `claude login` on the host.

ENABLE_PERSISTENCE=true
DB_PATH=./data/claudecab.db
```

For proxy-compatible services that expose an Anthropic-compatible endpoint, set:

```env
ANTHROPIC_API_KEY=your-provider-key
ANTHROPIC_BASE_URL=https://your-compatible-endpoint.example.com
```

Do not set `ANTHROPIC_BASE_URL` when using Claude Code OAuth from `claude login`.

## 4. Create One Agent

Start from the tracked example profile:

```text
agents/
  example/
    agent.json
    CLAUDE.md
    .claude/
      settings.local.json
    .mcp.json
    schedules/
```

You can either edit `agents/example` directly for a quick local test, or copy it to your own ignored live profile:

```bash
cp -r agents/example agents/general
```

`agents/example/agent.json`:

```json
{
  "name": "Example",
  "description": "Starter Discord agent profile",
  "model": "sonnet",
  "discordBotToken": "your-agent-bot-token",
  "discordChannelId": "your-agent-channel-id",
  "settings": {
    "permissionMode": "default",
    "maxTurns": 20
  }
}
```

`agents/example/CLAUDE.md`:

```md
# Example Agent

You are a practical Discord assistant. Answer clearly, keep responses concise, and ask for missing context when needed.
```

`agents/example/.claude/settings.local.json`:

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

If you want this agent to use an API key different from the global `.env`, put it in `env`:

```json
{
  "model": "sonnet",
  "env": {
    "ANTHROPIC_API_KEY": "agent-specific-key",
    "ANTHROPIC_BASE_URL": "https://your-compatible-endpoint.example.com"
  }
}
```

## 5. Run

Development:

```bash
npm run dev
```

Production-style local run:

```bash
npm run build
npm start
```

Expected startup signs:

- `logs/` is created.
- `data/claudecab.db` is created when persistence is enabled.
- The agent bot appears online.
- A message in the configured Discord channel receives a response.

## 6. Validate Schedules

Schedules live under each agent folder:

```text
agents/example/schedules/*.yaml
```

Validate all schedule YAML:

```bash
npm run schedule:validate
```

Create a real Discord thread test without running the Claude prompt:

```bash
npm run schedule:discord-test -- example/example-daily-check
```

Run a schedule prompt manually:

```bash
npm run schedule:trigger -- example/example-daily-check
```

## 7. Common Problems

No Discord response:

- Check `DISCORD_ENABLED=true`.
- Check the agent has `discordBotToken` and `discordChannelId`.
- Check the bot has permission to read and send messages in that channel.
- Check logs under `logs/`.

Agent not loaded:

- Check `AGENTS_DIR`.
- Check the agent folder contains `agent.json`.
- Check `agent.json` is valid JSON.

Claude authentication fails:

- Use either `ANTHROPIC_API_KEY` or `claude login`.
- Do not use `ANTHROPIC_BASE_URL` with OAuth.
- For provider proxies, set both `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`.
