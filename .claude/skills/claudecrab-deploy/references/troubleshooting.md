# ClaudeCrab Troubleshooting

## Bot starts but Discord does not reply

Confirm in order:

1. `DISCORD_ENABLED=true`
2. Main bot token/client/guild fields are pasted correctly.
3. Agent `discordBotToken` and `discordChannelId` are set.
4. Message Content Intent is enabled in the Discord Developer Portal.
5. The bot has read/send message permissions; schedule threads additionally need create/send/read thread permissions.
6. The latest `logs/claudecab*.log` shows startup success with no Discord login error.

Run:

```bash
npm run setup:check
npm run discord:check -- --agent example
```

`discord:check` sends a real message — get the user's consent first.

## Authentication error

Do not assume the provider is down. First identify the auth mode:

- OAuth: the deploy host must have run `claude auth login`; `.env` must not set `ANTHROPIC_BASE_URL`.
- API key: `ANTHROPIC_API_KEY` must be present.
- Auth-token provider: `ANTHROPIC_AUTH_TOKEN` must be present.
- Provider/proxy: prefer setting the provider's `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, plus `ANTHROPIC_BASE_URL`, in the agent's `.claude/settings.local.json`.
- Docker does not automatically inherit host Claude Code OAuth.

### Headless / Docker / Cloud cannot run `claude auth login`

`claude auth login` is interactive OAuth (it opens a browser). On an SSH headless server, a Docker container, or a cloud platform (Fly / Railway / Render, etc.) it usually cannot complete. In these environments **prefer skipping OAuth and use an API key instead**:

- Easiest: use an Anthropic API key or an Anthropic-compatible provider key in `agents/<id>/.claude/settings.local.json` `env`; do not depend on host OAuth (setup details in `docs/CLAUDE-SETTINGS.md`).
- If you must use a Claude Code subscription: complete `claude auth login` on a **machine with a browser** first, then move the credentials to the target machine following the Claude Code official docs (https://code.claude.com/docs/en/settings). Exact steps and supported scope follow the official docs. **Never commit OAuth credentials to git.**
- Docker: the container cannot inherit host OAuth; always use the API-key approach above.

Run:

```bash
npm run setup:verify
```

## Claude Code CLI not found

Claude Code 2.1.119+ uses a platform binary package. `npm run setup:verify` checks for the SDK-bundled CLI package.

Common fix:

```bash
npm install
npm run setup:verify
```

## Schedule does not fire

Confirm:

1. `SCHEDULE_ENABLED` and catch-up settings.
2. YAML strict validation passes.
3. DB schedule execution records exist.
4. The catch-up window and stale-running window are not causing it to be skipped.
5. The schedule YAML timezone is correct.

Run:

```bash
npm run schedule:validate
npm run schedule:check -- agents/example/schedules/example-daily-check.yaml --strict
```

## Thread created but operator not notified

Confirm:

- `DISCORD_OWNER_USER_ID` is a numeric user ID, not a token/client/guild ID.
- The bot has thread permissions.
- The schedule YAML notify setting does not conflict with owner notify.

## Session resume empty / no usable response

Do not automatically fall back to a new, costly repeat query unless the code explicitly allows it.

Expected handling:

- Preserve the SDK session id.
- Close the broken process.
- Ask the user to resend, or have the operator close the session.
- Inspect the original session error in the log.

## Admin Console unreachable

Confirm:

1. `ADMIN_CONSOLE_ENABLED=true`
2. `ADMIN_CONSOLE_TOKEN` is at least 16 characters.
3. Unless host/port were changed, open `http://127.0.0.1:47824`.
4. Under Docker, explicitly publish/tunnel the port and add protection.
5. The startup log shows `Admin console listening`.
