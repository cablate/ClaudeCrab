---
name: claudecab-deploy
description: 協助安裝、部署、設定與排錯 ClaudeCab。當使用者要在本機 Windows、Docker、雲端平台架設 ClaudeCab，設定 Discord bot、Claude Code OAuth、Anthropic API key、第三方 provider、admin console、schedule，或診斷啟動、認證、Discord 無回應、排程未觸發問題時使用。
---

# ClaudeCab Deploy

這個 skill 是給 AI assistant 部署 ClaudeCab 時使用的操作規則。ClaudeCab 的核心定位很窄：Discord ↔ Claude Agent SDK / Claude Code。不要把部署工作擴張成重構專案。

## 硬規則

- 先讀 `AGENTS.md`、`README.md`、`docs/SETUP.md`，再改設定。
- 部署時不要順手重構程式碼，除非使用者明確要求修 code。
- 不要在聊天、log、commit message、報告中輸出完整 secret。
- 不要貼完整 `docker compose config`，有些 Compose 會展開 secret。
- 不要把一般 Discord 聊天當設定入口。
- 設定只走 `.env`、雲端 env/secrets、admin console/local overlay、`agent.json`、`.claude/settings.local.json`、schedule YAML。
- 跑完檢查才能說部署完成。
- `npm run discord:check` 會真的送 Discord 訊息，先問使用者。
- 發現 secret 已進 git history 時停下，列選項等使用者決定；不要自行 rewrite history 或 force push。

## 部署流程

1. 判斷部署目標：
   - 本機開發：`npm run dev`
   - 本機正式：`npm run build` → `npm start`
   - Windows 背景服務：Task Scheduler 指向 `scripts/run-hidden.vbs`，由 `start.ts` supervisor 管理 child process
   - Docker：`docker compose up --build`
   - 雲端 container/platform：平台 env/secrets + volume

2. 判斷 Claude 認證模式：
   - Claude Code 訂閱 / OAuth：部署機器跑 `claude login`，不要設定 `ANTHROPIC_BASE_URL`。
   - Anthropic API key：填 `ANTHROPIC_API_KEY`。
   - DeepSeek / proxy / Anthropic-compatible provider：優先放 `agents/<id>/.claude/settings.local.json` 的 `env.ANTHROPIC_API_KEY` 或 `env.ANTHROPIC_AUTH_TOKEN`，以及 `env.ANTHROPIC_BASE_URL`。

3. 填必要 Discord 設定：
   - `.env`：`DISCORD_ENABLED`、`DISCORD_MAIN_BOT_TOKEN`、`DISCORD_MAIN_BOT_CLIENT_ID`、`DISCORD_GUILD_ID`、`AGENTS_DIR`
   - `agents/<id>/agent.json`：`discordBotToken`、`discordChannelId`
   - `agents/<id>/.claude/settings.local.json`：`model`、provider env、Claude Code permissions
   - `DISCORD_OWNER_USER_ID`：operator gate 與 schedule thread 通知

4. 視需求啟用 admin console：
   - 預設關閉。
   - 需要小後台改設定、跑驗證、按重啟時才開。
   - 除非有 reverse proxy / tunnel / cloud auth 保護，否則保留 `ADMIN_CONSOLE_HOST=127.0.0.1`。

5. 驗證：
   - `npm run setup:check`
   - `npm run setup:verify`
   - schedule：`npm run schedule:validate`
   - 使用者同意會送真訊息後才跑：`npm run discord:check -- --agent <id> [--thread]`

6. 啟動：
   - dev：`npm run dev`
   - direct：`npm run start:direct`
   - supervised：`npm start`
   - Docker：確認 `.env` 存在後 `docker compose up --build`

7. 回報時只列：
   - 改了哪些檔案
   - 還缺哪些設定值
   - 跑了哪些檢查與結果
   - 用哪個指令啟動
   - Discord smoke test 下一步

## 需要時讀取

- 設定欄位與重啟規則：`references/config-matrix.md`
- 常見錯誤排查：`references/troubleshooting.md`
- admin console：`references/admin-console.md`
