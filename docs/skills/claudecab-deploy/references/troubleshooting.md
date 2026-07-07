# ClaudeCab 排錯

## Bot 有啟動但 Discord 不回覆

依序確認：

1. `DISCORD_ENABLED=true`
2. 主 Bot token/client/guild 欄位沒有貼錯。
3. Agent `discordBotToken` 與 `discordChannelId` 已設定。
4. Discord Developer Portal 已開 Message Content Intent。
5. Bot 有 read/send message 權限；schedule thread 需要 create/send/read thread 權限。
6. 最新 `logs/claudecab*.log` 有 startup success，沒有 Discord login error。

可跑：

```bash
npm run setup:check
npm run discord:check -- --agent example
```

`discord:check` 會送真實訊息，先取得使用者同意。

## Authentication error

不要先假設 provider 掛了，先分認證模式：

- OAuth：部署機器要跑過 `claude login`；`.env` 不應設定 `ANTHROPIC_BASE_URL`。
- API key：`ANTHROPIC_API_KEY` 要存在。
- Auth token provider：`ANTHROPIC_AUTH_TOKEN` 要存在。
- Provider/proxy：優先在 agent `.claude/settings.local.json` 設定 provider 需要的 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`，以及 `ANTHROPIC_BASE_URL`。
- Docker 不會自動繼承主機 Claude Code OAuth。

可跑：

```bash
npm run setup:verify
```

## Claude Code CLI not found

Claude Code 2.1.119+ 使用平台 binary package。`npm run setup:verify` 會檢查 SDK-bundled CLI package。

常見修復：

```bash
npm install
npm run setup:verify
```

## Schedule 沒觸發

確認：

1. `SCHEDULE_ENABLED` and catch-up settings.
2. YAML strict validation 是否通過。
3. DB schedule execution records 有沒有紀錄。
4. catch-up window 與 stale-running window 是否讓它略過。
5. schedule YAML timezone 是否正確。

可跑：

```bash
npm run schedule:validate
npm run schedule:check -- agents/example/schedules/example-daily-check.yaml --strict
```

## Thread 建立了但 operator 沒被通知

確認：

- `DISCORD_OWNER_USER_ID` 是 numeric user ID，不是 token/client/guild ID。
- Bot 有 thread 權限。
- schedule YAML 的 notify 設定沒有和 owner notify 衝突。

## V2 Resume Empty / No Usable Response

不要自動 fallback 成新的高成本重複 query，除非程式明確允許。

預期處理：

- 保留 SDK session id。
- 關閉壞掉的 process。
- 請使用者重送，或請 operator close session。
- 看 log 裡原始 V2 error。

## Admin Console 連不上

確認：

1. `ADMIN_CONSOLE_ENABLED=true`
2. `ADMIN_CONSOLE_TOKEN` 至少 16 字元。
3. 除非改過 host/port，否則開 `http://127.0.0.1:47824`。
4. Docker 裡要明確 publish/tunnel port，並加保護。
5. startup log 有 `Admin console listening`。
