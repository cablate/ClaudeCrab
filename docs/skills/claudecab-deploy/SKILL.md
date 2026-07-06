---
name: claudecab-deploy
description: Deploy and troubleshoot ClaudeCab for local Windows, Docker, or cloud hosting. Use when setting up ClaudeCab, configuring Discord bots, choosing Claude Code OAuth/API key/provider auth, enabling the admin console, validating schedules, or diagnosing runtime startup/auth/Discord issues.
---

# ClaudeCab Deploy

Use this skill when a user wants an AI assistant to install, configure, deploy, or troubleshoot ClaudeCab.

## Hard Rules

- Read `AGENTS.md`, `README.md`, and `docs/SETUP.md` before editing settings.
- Do not refactor application code during deployment unless the user explicitly asks for code changes.
- Do not print full secrets in chat, logs, commit messages, or generated reports.
- Do not paste full `docker compose config` output; it may include expanded secrets on some Compose setups.
- Do not use normal Discord chat as a settings surface.
- Use the admin console, local config overlay, `.env`, cloud env/secrets, `agent.json`, or `.claude/settings.local.json` for configuration.
- Run checks before telling the user setup is done.
- Real Discord checks send real messages; ask before running `npm run discord:check`.
- If a secret is already committed to git history, stop and ask the user before history rewriting or force push.

## Deployment Flow

1. Identify target:
   - local Windows background service;
   - local dev run;
   - Docker;
   - cloud container/platform.

2. Identify auth mode:
   - Claude Code OAuth: host must run `claude login`; do not set `ANTHROPIC_BASE_URL`.
   - Anthropic API key: set `ANTHROPIC_API_KEY`.
   - Anthropic-compatible provider/proxy: prefer agent `.claude/settings.local.json` env with `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`.

3. Configure required Discord values:
   - `.env`: `DISCORD_ENABLED`, `DISCORD_MAIN_BOT_TOKEN`, `DISCORD_MAIN_BOT_CLIENT_ID`, `DISCORD_GUILD_ID`, `AGENTS_DIR`.
   - `agents/<id>/agent.json`: `discordBotToken`, `discordChannelId`, model, permission settings.
   - `DISCORD_OWNER_USER_ID`: operator user for `/restart`, `/sessions`, `/cache flush`, `/model [agent] [to]`, and schedule notifications.

4. Optional admin console:
   - `ADMIN_CONSOLE_ENABLED=true`
   - `ADMIN_CONSOLE_TOKEN=<long random token>`
   - keep `ADMIN_CONSOLE_HOST=127.0.0.1` unless protected by reverse proxy/tunnel/cloud auth.
   - use `CLAUDECAB_LOCAL_CONFIG_PATH=./data/claudecab.local.json` for durable local overlay.

5. Validate:
   - `npm run setup:check`
   - `npm run setup:verify`
   - only after explicit approval: `npm run discord:check -- --agent <id> [--thread]`

6. Start:
   - dev: `npm run dev`
   - direct: `npm run start:direct`
   - supervised Windows/runtime: `npm start`
   - Docker: confirm `.env` exists, then `docker compose up --build`

7. Report only:
   - files changed;
   - values still missing;
   - checks run and pass/fail;
   - start command;
   - Discord smoke-test next step.

## Reference Files

- `references/config-matrix.md`
- `references/troubleshooting.md`
- `references/admin-console.md`
