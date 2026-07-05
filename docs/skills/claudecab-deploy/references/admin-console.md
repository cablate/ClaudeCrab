# ClaudeCab Admin Console

The admin console is a minimal operator surface. It is not a public dashboard and not a Discord user feature.

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

## What It Can Do

- Read masked global config.
- Write allowlisted global overrides to `data/claudecab.local.json`.
- Read/write allowlisted `agent.json` fields.
- Read/write allowlisted `.claude/settings.local.json` model and provider env fields.
- Run setup check / setup verify.
- Request restart after build check.

## Safety

- API requires `Authorization: Bearer <ADMIN_CONSOLE_TOKEN>`.
- Secret fields are never returned in clear text.
- Unknown fields are rejected.
- Agent path traversal is rejected.
- Default host is localhost.

## Docker / Cloud Notes

Container and cloud env variables usually cannot be permanently edited from inside the running process. For runtime-adjustable global values, the console writes `CLAUDECAB_LOCAL_CONFIG_PATH`.

Mount `./data:/app/data` or equivalent so `claudecab.local.json` survives restarts.

If the platform injects the same env var at every boot, local overlay wins inside ClaudeCab because `src/config.ts` merges the local overlay after environment values.
