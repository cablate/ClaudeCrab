# ClaudeCab Troubleshooting

## Bot Starts But Discord Does Not Respond

Check in order:

1. `DISCORD_ENABLED=true`
2. Main bot token/client/guild values are in the right fields.
3. Agent `discordBotToken` and `discordChannelId` are set.
4. Discord Developer Portal has Message Content Intent enabled.
5. Bot has channel permissions to read/send messages and create/manage threads if schedules use threads.
6. Latest `logs/claudecab*.log` contains startup success and no Discord login error.

Run:

```bash
npm run setup:check
npm run discord:check -- --agent example
```

Only run `discord:check` after the user accepts that a real message may be sent.

## Authentication Error

Do not assume provider outage first.

- OAuth mode: host must have `claude login`; `.env` should not set `ANTHROPIC_BASE_URL`.
- API key mode: `ANTHROPIC_API_KEY` must exist.
- Provider/proxy mode: prefer agent `.claude/settings.local.json` with both `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`.
- Docker does not automatically inherit host Claude Code OAuth credentials.

Run:

```bash
npm run setup:verify
```

## Claude CLI Not Found

Claude Code 2.1.119+ uses platform binary packages. `npm run setup:verify` checks the SDK-bundled CLI package.

Fix:

```bash
npm install
npm run setup:verify
```

## Schedule Did Not Trigger

Check:

1. `SCHEDULE_ENABLED` and catch-up settings.
2. YAML strict validation.
3. DB schedule execution records.
4. Catch-up window and stale-running window.
5. Timezone in the schedule YAML.

Run:

```bash
npm run schedule:validate
npm run schedule:check -- agents/example/schedules/example-daily-check.yaml --strict
```

## Thread Created But Operator Not Notified

Check:

- `DISCORD_OWNER_USER_ID` is numeric user ID, not token/client/guild ID.
- Bot can add members to thread.
- Schedule YAML notify fields do not conflict with owner notify.

## V2 Resume Empty / No Usable Response

Do not automatically fallback to a fresh high-cost duplicate query unless the code explicitly allows it.

Expected handling:

- Preserve SDK session id.
- Close broken process.
- Ask the user to resend or operator to close session.
- Check logs for the original V2 error.

## Admin Console Cannot Connect

Check:

1. `ADMIN_CONSOLE_ENABLED=true`
2. `ADMIN_CONSOLE_TOKEN` length is at least 16.
3. Open `http://127.0.0.1:47824` unless host/port changed.
4. If inside Docker, publish or tunnel the port deliberately and protect it.
5. Review startup logs for `Admin console listening`.
