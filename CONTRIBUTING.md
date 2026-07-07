# Contributing

ClaudeCab intentionally keeps core small: Discord adapters, Claude Agent SDK sessions, schedules, persistence, setup validation, and operator tooling.

## Rules

- Do not add `@anthropic-ai/sdk`; this project only uses `@anthropic-ai/claude-agent-sdk`.
- Do not add direct `process.env` reads outside `src/config.ts`.
- Do not hard-delete DB records; use soft-delete flags.
- Do not add personal paths, Discord IDs, tokens, email addresses, provider URLs, or private agent assumptions to source.
- Keep agent-specific workflows in `agents/<id>/` as skills, scripts, schedules, or Claude Code project files.
- Core changes should benefit more than one agent and stay independent of a specific operator's business logic.

## Before A PR

Run:

```bash
npm run typecheck
npm run lint
npm run test:run
npm run setup:check -- --template
```

For setup, SDK, CLI, schedule, or Discord behavior changes, also update the relevant docs:

- `README.md`
- `docs/SETUP.md`
- `docs/ARCHITECTURE.md`
- `docs/SDK_TOUCHPOINTS.md`
- `docs/skills/claudecab-deploy/SKILL.md`
