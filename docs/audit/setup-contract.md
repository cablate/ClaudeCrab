---
schema_version: behavior-contract/v1
id: claudecab.setup.wp-e
title: ClaudeCab setup and Docker support contract
status: active
owner_surface: infrastructure
change_context:
  type: feature
  reason: WP-E upgrades first-run setup, verification, and Docker support so a new operator can install ClaudeCab without relying on private machine context.
  non_goals:
    - Do not change the production startup chain: Task Scheduler + VBS + start.ts.
    - Do not read or expose real .env secrets in docs or test output.
    - Do not make setup:verify send Discord messages automatically.
---

# ClaudeCab Setup And Docker Contract

## Behavior Boundary

In scope:

- New operator can follow `docs/SETUP.md` from clone to local verification.
- `npm run setup:check` validates static configuration shape.
- `npm run setup:verify` validates local prerequisites without contacting Discord, sending messages, or overwriting production `dist/`.
- `npm run discord:check` remains the explicit real Discord connectivity check.
- Docker files describe a supported container path with explicit limits and required volumes/env.
- Discord slash commands are not a configuration write surface for normal users; sensitive maintenance actions must pass the operator gate.

Out of scope:

- Replacing Windows production supervisor.
- Rotating secrets or inspecting a real `.env`.
- Running live Discord checks during automated verify.
- Guaranteeing every Anthropic-compatible proxy works; setup only documents the expected env shape.
- Letting normal Discord users modify `.env`, `agent.json`, `.claude/settings.local.json`, or cloud secrets through bot commands.

## Consumers And Entrypoints

| Consumer | Entrypoint |
|---|---|
| New operator | `docs/SETUP.md` |
| AI agent | `docs/README.md`, `docs/audit/setup-inventory.md`, this contract |
| Static setup doctor | `npm run setup:check` |
| Runtime prerequisite doctor | `npm run setup:verify` |
| Live Discord verification | `npm run discord:check -- --agent <id> [--thread]` |
| Docker operator | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `docs/SETUP.md` |

## Inputs And State

- Node.js version must be 20+.
- `node_modules/` must exist before SDK patch and CLI checks.
- `.env.example` must stay safe to commit and must not include secrets.
- Real `.env` is optional for `--template` verification.
- Discord token/channel verification requires explicit `discord:check`.
- Docker runtime requires mounted `agents/`, `data/`, and `logs/` directories plus env variables.

## Outputs And Side Effects

- `setup:check` prints `ok` / `warn` / `error` rows and exits non-zero on errors.
- `setup:verify` prints step sections and exits non-zero on the first failed prerequisite.
- `setup:verify` may read package metadata, create/delete a temporary DB under the OS temp directory, and create/delete isolated TypeScript build output under `.tmp/build-check`.
- `setup:verify` must not write the production DB or production `dist/` output.
- `setup:verify` must not post Discord messages.
- `discord:check` may send a test Discord message and, when `--thread` is passed, create a thread.
- Docker build may run `npm ci`, which runs the SDK patch postinstall.
- Discord slash commands may show status or session/runtime diagnostics. Existing maintenance commands that write local agent settings must be operator-only, and must not expose cloud secrets.

## Invariants

- `@anthropic-ai/sdk` must not be introduced.
- All SDK calls continue to use `@anthropic-ai/claude-agent-sdk`.
- Production startup remains `start.ts` and is not replaced by Docker in this WP.
- DB verification uses a disposable path, not configured production `DB_PATH`.
- Real credentials stay in `.env` or per-agent `.claude/settings.local.json`, never in tracked docs.
- Per-agent provider env takes precedence in documentation for Anthropic-compatible services to avoid polluting host OAuth credentials.
- Configuration writes primarily happen through repo files, deployment environment variables, CLI/deploy tooling, cloud platform settings, or the admin console. Any retained Discord maintenance shortcut must be operator-only.

## Acceptance Examples

```gherkin
Given a clean checkout with dependencies installed
When the operator runs `npm run setup:verify -- --template`
Then setup check, example schedule check, SDK patch check, Claude CLI check, temp DB check, typecheck, and isolated build are executed
And no Discord message is sent
```

```gherkin
Given an operator has real agent Discord token and channel id
When they run `npm run discord:check -- --agent example --thread`
Then ClaudeCab sends a setup check message and creates a thread only because the operator explicitly requested it
```

```gherkin
Given a Docker operator mounts `./agents`, `./data`, and `./logs`
When they run `docker compose up --build`
Then the container starts the same app runtime entrypoint documented in SETUP
And missing env or agent config fails loudly instead of silently using private machine paths
```

## Test Mapping

| Contract item | Evidence |
|---|---|
| Template setup remains valid | `npm run setup:check -- --template` |
| Full local verify does not require real secrets or touch production `dist/` | `npm run setup:verify -- --template` |
| SDK patch status can be checked without mutation | `node scripts/patch-sdk-v2.cjs --check` |
| Setup doctor logic covered | `tests/setupCheck.test.ts`, setup verify tests added in WP-E |
| Docker path syntax/build intent | `docker compose config` when Docker is available, otherwise static file review plus documented gap |
| Repo gates | `npm run typecheck`, `npm run lint`, `npm run test:run` |

## Intentional Changes

- Docker is upgraded from stale/implicit support to an explicit supported setup path, but Windows supervisor remains the production path until a later deployment decision changes it.
- `setup:verify` is expanded from build-only verification to runtime prerequisite verification.

## Open Questions

- Whether Docker should become the recommended production path is deferred to WP-F/WP-J; WP-E only makes the container path honest and verifiable.
