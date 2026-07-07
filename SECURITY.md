# Security Policy

ClaudeCab controls Discord bots, Claude Code credentials, provider API keys, local files, schedules, and SQLite state. Treat every deployment as an operator-owned service.

## Supported Versions

Security fixes target the current `main` branch unless a maintainer announces a release branch.

## Reporting A Vulnerability

Open a private security advisory on GitHub, or contact the maintainer through the repository owner profile.

Do not publish:

- Discord bot tokens
- Anthropic/provider API keys
- Claude Code OAuth credentials
- `.env`
- `agents/*` live configuration
- `data/*.db`
- logs containing secrets

## Deployment Defaults

- Keep the admin console disabled unless needed.
- Keep `ADMIN_CONSOLE_HOST=127.0.0.1` unless protected by reverse proxy, tunnel auth, or platform auth.
- Do not expose Discord commands that write configuration to normal users.
- Use `DISCORD_OWNER_USER_ID` for operator-only maintenance commands.
- Run `npm run setup:check` and `npm run setup:verify` before opening a deployment to users.
