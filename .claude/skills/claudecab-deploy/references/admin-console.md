# ClaudeCab Admin Console

The admin console is a minimal operator backend. It is not a public dashboard and not a Discord user feature.

## Enable

```env
ADMIN_CONSOLE_ENABLED=true
ADMIN_CONSOLE_HOST=127.0.0.1
ADMIN_CONSOLE_PORT=47824
ADMIN_CONSOLE_TOKEN=replace-with-long-random-token
CLAUDECAB_LOCAL_CONFIG_PATH=./data/claudecab.local.json
```

Open:

```text
http://127.0.0.1:47824
```

## What you can do

- Read masked global settings.
- Write allowlisted global overrides to `data/claudecab.local.json`.
- Read/write allowlisted `agent.json` fields.
- Read/write allowlisted `.claude/settings.local.json` model/provider env.
- Run setup check / setup verify.
- Request restart after a build check passes.

## Security rules

- API requires `Authorization: Bearer <ADMIN_CONSOLE_TOKEN>`.
- Secret fields are never returned in plaintext.
- Unknown fields are rejected.
- Agent path traversal is rejected.
- Binds to localhost by default.

## Docker / cloud notes

Container and cloud env usually cannot be permanently rewritten from inside the running process. For runtime-adjustable global values, the admin console writes to `CLAUDECAB_LOCAL_CONFIG_PATH`.

Mount `./data:/app/data` (or equivalent volume) so `claudecab.local.json` survives restarts.

If the platform injects the same env name on every start, ClaudeCab still treats the local overlay as authoritative, because `src/config.ts` merges the local overlay after env.
