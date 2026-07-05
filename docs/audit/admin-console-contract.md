---
schema_version: behavior-contract/v1
id: claudecab.admin-console
title: ClaudeCab minimal admin console contract
status: active
owner_surface: infrastructure
change_context:
  type: feature
  reason: Provide a small operator-only setup and maintenance surface without exposing configuration controls to normal Discord users.
  non_goals:
    - Do not replace the production startup chain: Task Scheduler + VBS + start.ts.
    - Do not add Discord bot commands for normal-user configuration.
    - Do not implement fine-grained RBAC, multi-tenant admin, or a large dashboard.
    - Do not introduce @anthropic-ai/sdk.
---

# ClaudeCab Admin Console Contract

## Behavior Boundary

In scope:

- Disabled-by-default local HTTP admin console.
- Token-protected API for setup status, allowlisted config reads/writes, validation, and restart.
- Secret masking for all config reads.
- Agent config editing for `agent.json` and `.claude/settings.local.json`.
- Global local config overlay editing for allowlisted setup/runtime keys.
- Restart action equivalent to the existing `/restart` maintenance path: build check, then process exit so the supervisor/container can restart.

Out of scope:

- Arbitrary file browsing or editing.
- Cloud secret manager integration.
- Fine-grained permission scopes.
- Replacing Discord conversation behavior.
- Live Discord verification without explicit operator action.

## Consumers And Entrypoints

| Consumer | Entrypoint |
|---|---|
| Operator browser | `GET /` |
| Operator API client | `GET /api/config`, `PUT /api/config/global`, `PUT /api/agents/:agentId` |
| Validation | `POST /api/validate` |
| Restart | `POST /api/restart` |
| Runtime config | `ADMIN_CONSOLE_*` env parsed only by `src/config.ts` |

## Inputs And State

- `ADMIN_CONSOLE_ENABLED=true` enables the server.
- `ADMIN_CONSOLE_TOKEN` is required when enabled.
- `ADMIN_CONSOLE_HOST` defaults to `127.0.0.1`.
- `ADMIN_CONSOLE_PORT` defaults to `47824`.
- `CLAUDECAB_LOCAL_CONFIG_PATH` is the writable global config target; default is `./data/claudecab.local.json`.
- `AGENTS_DIR` controls the writable agent config root.

## Outputs And Side Effects

- `GET /` returns the small embedded admin UI.
- `GET /api/config` returns masked global and agent config snapshots.
- `PUT /api/config/global` updates only allowlisted local config overlay keys.
- `PUT /api/agents/:agentId` updates only allowlisted `agent.json` and `.claude/settings.local.json` fields.
- `POST /api/validate` runs setup check or setup verify and returns command output.
- `POST /api/restart` runs the build check and exits process `0` after responding.

## UI States

- First paint shows token input and connection status.
- Loading state disables action buttons.
- Ready state shows overview, global config, agents, validation, and restart.
- Error state shows the API error text without exposing secrets.

## Invariants

- API routes except health/static UI require the admin token.
- Secrets are never returned in clear text by GET endpoints.
- Request bodies may set or clear secrets, but logs and responses must not echo their clear text.
- Writes stay inside `.env` or the selected agent directory.
- Unknown fields are rejected.
- Admin console can be disabled without affecting Discord bot runtime.

## Acceptance Examples

```gherkin
Given ADMIN_CONSOLE_ENABLED is false
When ClaudeCab starts
Then no admin HTTP server is opened
```

```gherkin
Given ADMIN_CONSOLE_ENABLED is true and ADMIN_CONSOLE_TOKEN is set
When an operator requests GET /api/config with Bearer token
Then the response lists config fields
And token/key fields are masked
```

```gherkin
Given a normal Discord user sends a message
When they use the bot
Then admin console settings are not reachable through normal chat
```

```gherkin
Given an operator changes an agent model through PUT /api/agents/example
When the request passes validation
Then agent.json or settings.local.json is updated
And the agent config is reloaded
And the response states whether restart or session close is recommended
```

## Test Mapping

| Contract item | Evidence |
|---|---|
| Config parsing | `tests/config.test.ts` |
| Secret masking and allowlist writes | `tests/adminConfigService.test.ts` |
| Runtime gates | `npm run typecheck`, `npm run lint`, `npm run test:run` |

## Intentional Changes

- Adds a new disabled-by-default HTTP surface for operators.
- Keeps Discord commands as maintenance shortcuts, not primary setup UX.
