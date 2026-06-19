# AI 輔助安裝指令

這份文件是給「幫你設定 ClaudeCab 的 AI agent」看的。

使用者可以把下面這段任務貼給 AI：

```text
請幫我設定 ClaudeCab，目標是讓 Discord channel 可以和 ClaudeCab agent 對話。

請先閱讀：
- README.md
- docs/SETUP.md
- .env.example
- agents/example/agent.json
- agents/example/.claude/settings.local.json

請照下面原則處理：
- 只修改必要設定檔，不重構程式碼。
- 不要把 token、API key、OAuth credential commit 進 git。
- 如果需要 secret，請列出我要去 Discord / provider 後台取得哪些值，等我提供後再填。
- 一般安裝不要修改 session/cache/schedule/dashboard/STT 進階設定，除非我明確要求。
- 如果我要使用 DeepSeek、第三方 proxy、或 Anthropic-compatible endpoint，請把 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL 放在 agents/<agent>/.claude/settings.local.json 的 env 裡，不要只放全域 .env。
- 如果我要使用 Claude Code OAuth，請讓 ANTHROPIC_API_KEY 保持空白，提醒我先在部署機器跑 claude login，而且不要設定 ANTHROPIC_BASE_URL。

完成後請驗證：
- npm install 已執行或 node_modules 已存在。
- npm run setup:check 通過；如果使用者還沒提供 secret，請先說明哪些 error 是因為缺 token/channel id。
- .env 存在，且 DISCORD_ENABLED、DISCORD_MAIN_BOT_TOKEN、DISCORD_MAIN_BOT_CLIENT_ID、DISCORD_GUILD_ID、AGENTS_DIR 已設定。
- agents/example/agent.json 是合法 JSON，且 discordBotToken / discordChannelId 已替換。
- agents/example/.claude/settings.local.json 是合法 JSON。
- npm run typecheck 通過。
- npm run build 通過。
- npm run schedule:validate 可執行；如果只有 disabled/example warning，請說明它不是阻斷。

最後請告訴我：
- 哪些檔案被修改。
- 哪些 secret 還缺。
- 要用哪個指令啟動。
- 啟動後我應該到哪個 Discord channel 測試。
```

## AI 應該修改哪些檔案

最小安裝只需要改：

- `.env`
- `agents/example/agent.json`
- 可選：`agents/example/CLAUDE.md`
- 只有使用 proxy / 其他模型服務時才改：`agents/example/.claude/settings.local.json`

不要為了第一次安裝修改：

- `src/**`
- `package.json`
- `docs/**`
- `CACHE_KEEPALIVE_*`
- `SESSION_*`
- `DISCORD_CHANNEL_DASHBOARD`
- `DISCORD_CHANNEL_COST_REPORT`
- `STT_*`

## 設定判斷表

| 使用者目標 | 要填哪裡 | 注意事項 |
| --- | --- | --- |
| 用 Anthropic API key | `.env` 的 `ANTHROPIC_API_KEY` | 最簡單 |
| 用 Claude Code 訂閱 / OAuth | 主機跑 `claude login` | `.env` 的 `ANTHROPIC_API_KEY` 保持空白，不要設定 `ANTHROPIC_BASE_URL` |
| 用 DeepSeek / proxy | `agents/example/.claude/settings.local.json` 的 `env` | 填 `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`，ClaudeCab 會自動隔離 `CLAUDE_CONFIG_DIR` |
| 多個 agents 用不同 provider | 各 agent 的 `.claude/settings.local.json` | 不要放全域 `.env` |

## 常見錯誤檢查

先跑：

```bash
npm run setup:check
```

如果只是檢查 repository 內建範本：

```bash
npm run setup:check -- --template
```

### Bot 沒回覆

檢查：

- `.env` 是否有 `DISCORD_ENABLED=true`
- `.env` 是否有主 Bot token/client id/guild id
- `agents/example/agent.json` 是否有 Agent Bot token/channel id
- Agent Bot 是否被邀請進 server
- Agent Bot 是否有該 channel 的 View / Send / Read Message History 權限

### Claude 認證失敗

檢查：

- API key 模式：`ANTHROPIC_API_KEY` 是否存在
- OAuth 模式：是否跑過 `claude login`
- OAuth 模式：是否誤設 `ANTHROPIC_BASE_URL`
- Proxy 模式：key/base URL 是否放在 agent `.claude/settings.local.json` 的 `env`

### Schedule 測試失敗

先跑：

```bash
npm run schedule:validate
```

如果要測 Discord thread 建立：

```bash
npm run schedule:discord-test -- example/example-daily-check
```

這會建立 thread / 發測試訊息，不會真的跑 Claude prompt。
