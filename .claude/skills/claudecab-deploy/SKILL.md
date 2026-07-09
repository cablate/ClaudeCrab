---
name: claudecab-deploy
description: Install, deploy, configure, and troubleshoot ClaudeCab. Use when the user wants to set up ClaudeCab on local Windows, Docker, or a cloud platform; configure the Discord bot, Claude Code OAuth, Anthropic API key, or a third-party provider; enable the admin console or schedules; or diagnose startup, authentication, Discord no-reply, or schedule-not-firing issues.
---

# ClaudeCab Deploy

This skill is the operating rulebook for an AI assistant deploying ClaudeCab. ClaudeCab's scope is narrow: Discord ↔ Claude Agent SDK / Claude Code. Do not expand a deployment task into a project refactor.

## Hard rules

- Read `AGENTS.md`, `README.md`, `docs/SETUP.md` before changing any config.
- Do not opportunistically refactor code during deployment unless the user explicitly asks for code changes.
- Never output full secrets in chat, logs, commit messages, or reports.
- Do not paste full `docker compose config` output; some Compose setups expand secrets into the terminal.
- Do not treat ordinary Discord chat as a config entry point.
- Config only flows through `.env`, cloud env/secrets, admin console/local overlay, `agent.json`, `.claude/settings.local.json`, schedule YAML.
- A deployment is only "done" after the checks pass.
- `npm run discord:check` sends a real Discord message — ask the user before running it.
- If you find a secret already in git history, stop, list options, and wait for the user. Do not rewrite history or force push on your own.

## Deployment flow

1. Determine the deployment target:
   - Local dev: `npm run dev`
   - Local production: `npm run build` → `npm start`
   - Windows background service: Task Scheduler points at `scripts/run-hidden.vbs`, managed by the `start.ts` supervisor
   - Docker: `docker compose up --build`
   - Cloud container/platform: platform env/secrets + volume

2. Determine the Claude auth mode:
   - Claude Code subscription / OAuth: run `claude login` on the deploy host; do not set `ANTHROPIC_BASE_URL`.
   - Anthropic API key: set `ANTHROPIC_API_KEY`.
   - DeepSeek / proxy / Anthropic-compatible provider: prefer `agents/<id>/.claude/settings.local.json` with `env.ANTHROPIC_API_KEY` or `env.ANTHROPIC_AUTH_TOKEN`, plus `env.ANTHROPIC_BASE_URL`.

3. Fill required Discord settings:
   - `.env`: `DISCORD_ENABLED`, `DISCORD_MAIN_BOT_TOKEN`, `DISCORD_MAIN_BOT_CLIENT_ID`, `DISCORD_GUILD_ID`, `AGENTS_DIR`
   - `agents/<id>/agent.json`: `discordBotToken`, `discordChannelId`
   - `agents/<id>/.claude/settings.local.json`: `model`, provider env, Claude Code permissions
   - `DISCORD_OWNER_USER_ID`: operator gate and schedule thread notifications

4. Optionally enable the admin console:
   - Off by default.
   - Enable only when you need a small backend to edit config, run checks, or restart.
   - Keep `ADMIN_CONSOLE_HOST=127.0.0.1` unless behind a reverse proxy / tunnel / cloud auth.

5. Verify:
   - `npm run setup:check`
   - `npm run setup:verify`
   - schedules: `npm run schedule:validate`
   - Only after the user consents to a real message: `npm run discord:check -- --agent <id> [--thread]`

6. Start:
   - dev: `npm run dev`
   - direct: `npm run start:direct`
   - supervised: `npm start`
   - Docker: confirm `.env` exists, then `docker compose up --build`

7. When reporting back, list only:
   - Which files you changed
   - Which config values are still missing
   - Which checks you ran and their results
   - Which command you used to start
   - The next step for the Discord smoke test

## Read when needed

- Config fields and restart rules: `references/config-matrix.md`
- Common error troubleshooting: `references/troubleshooting.md`
- `.claude/settings.local.json` schema + Claude Code official docs: `docs/CLAUDE-SETTINGS.md` (read before changing model / permissions / provider env)
- Admin console: `references/admin-console.md`
