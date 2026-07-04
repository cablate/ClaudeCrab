# ClaudeCab Scripts

| script | npm command | 用途 |
|---|---|---|
| `setup-check.ts` | `npm run setup:check` | 檢查開源 agent template / `agent.json` / Discord 基本設定是否合理。 |
| `setup-verify.ts` | `npm run setup:verify` | 檢查 Node/npm、SDK patch、Claude Code CLI binary 等 runtime prerequisite。 |
| `discord-check.ts` | `npm run discord:check -- <agentPath>` | 獨立驗證單一 agent 的 Discord bot token 與 channel 存取。 |
| `schedule-tool.ts` | `npm run schedule:*` | 排程 list/validate/check/run/trigger/discord-test，用於本機與 Discord thread delivery 驗證。 |
| `patch-sdk-v2.cjs` | `npm run postinstall` | postinstall SDK patch；升級前先讀 `docs/SDK_TOUCHPOINTS.md` 與 `docs/sop-sdk-cli-upgrade.md`。 |

不在這份索引裡的臨時腳本不應放進 `scripts/`；請放到本機暫存或在完成後歸檔。
