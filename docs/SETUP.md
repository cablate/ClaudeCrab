# ClaudeCab 安裝與驗證

本文是 ClaudeCab 的 canonical 安裝文件。README 只保留專案介紹與快速入口；實際架設、驗證、Docker 路徑以本文為準。

## 0. 你要先決定的三件事

| 決策 | 建議 | 說明 |
|---|---|---|
| 執行方式 | 本機開發先用 `npm run dev` | Windows production 才需要 `npm start` / supervisor。 |
| Claude 認證 | Claude Code 訂閱用 `claude login` | API key 或第三方 provider 才填 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`。 |
| Discord bot | 測試可先共用，正式建議主 Bot / Agent Bot 分開 | 主 Bot 管 slash command，Agent Bot 收發 agent 對話。 |

## 1. 前置需求

- Node.js 20+
- npm
- Git
- 一個 Discord server
- Discord Developer Portal 裡至少一個 bot
- Claude Code CLI 或 Anthropic-compatible provider key

建議先確認：

```bash
node --version
npm --version
```

> ClaudeCab 依賴 `better-sqlite3`（native module）。多數平台有 prebuilt binary，`npm install` 會直接套用；若 Node 版本過新或平台罕見而觸發現場編譯，Windows 需 Python + C++ Build Tools，macOS/Linux 需 `make` + `python3`。遇到編譯失敗時，改用 Node 20 LTS 通常能對到 prebuilt。

Claude Code 訂閱模式要先在部署機器登入：

```bash
claude login
claude --version
```

如果 `claude` 指令不存在，先安裝 Claude Code CLI，並在安裝後重新開 terminal。Claude Code 2.1.119+ 使用平台 native binary，缺平台包時可能出現 CLI 找不到或 SDK spawn 失敗；`npm run setup:verify` 會檢查這件事。

如果要讓 AI assistant 幫你部署，先讓它讀 `.claude/skills/claudecab-deploy/SKILL.md`。這個資料夾是可追蹤的 skill package，裡面包含 config matrix、admin console、Docker/cloud troubleshooting。

## 2. Clone 與安裝

```bash
git clone https://github.com/cablate/ClaudeCrab.git ClaudeCab
cd ClaudeCab
npm install
```

GitHub repository 目前叫 `ClaudeCrab`，本機資料夾建議叫 `ClaudeCab`，避免後續路徑混淆。

`npm install` 會執行 `postinstall`，也就是 `scripts/patch-sdk-v2.cjs`。這會檢查並 patch `@anthropic-ai/claude-agent-sdk@0.2.119`。SDK 升級前請先讀 `docs/SDK_TOUCHPOINTS.md`。

## 3. 建立 `.env`

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

macOS/Linux/Git Bash：

```bash
cp .env.example .env
```

最小必填：

```env
DISCORD_ENABLED=true
DISCORD_MAIN_BOT_TOKEN=your-main-bot-token
DISCORD_MAIN_BOT_CLIENT_ID=your-main-bot-application-id
DISCORD_GUILD_ID=your-discord-server-id

AGENTS_DIR=./agents

ENABLE_PERSISTENCE=true
DB_PATH=./data/claudecab.db
```

顯示時區（dashboard、crash 通知、prompt context 的時間顯示）預設 `UTC`。改成本地時區，例如：

```env
DISPLAY_TIMEZONE=Asia/Taipei
```

各 schedule 的「觸發時區」是在 schedule YAML 自己指定（預設 UTC），與 `DISPLAY_TIMEZONE` 無關。

使用 Claude Code OAuth / 訂閱時，保持：

```env
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=
```

使用 Anthropic API key 或第三方 provider 時，優先放到 agent 層，見第 6 節。

## 4. Discord Bot 設定

Discord Developer Portal：

1. 建立 application 與 bot。
2. Bot 頁面開啟 `Message Content Intent`。
3. OAuth2 URL Generator 勾選 scopes：`bot`、`applications.commands`。
4. 權限至少包含：
   - View Channels
   - Send Messages
   - Create Public Threads
   - Send Messages in Threads
   - Read Message History
   - Attach Files
   - Use Slash Commands

Discord ID 複製方式：

1. Discord 使用者設定開啟 Developer Mode。
2. 右鍵 server 複製 Server ID，填 `DISCORD_GUILD_ID`。
3. 右鍵 channel 複製 Channel ID，填 agent 的 `discordChannelId`。
4. Developer Portal 的 Application ID 填 `DISCORD_MAIN_BOT_CLIENT_ID`。

## 5. 設定 agent

開啟 `agents/example/agent.json`：

```json
{
  "name": "Example",
  "description": "Starter Discord agent profile",
  "discordBotToken": "your-agent-bot-token",
  "discordChannelId": "target-channel-id"
}
```

`discordBotToken` 是 Bot Token，不是 Discord ID。`discordChannelId` 是 numeric channel ID。
`agent.json` 只放 ClaudeCab 顯示與 Discord 連線設定；Claude Code 的模型、provider、權限與 env 放 `.claude/settings.local.json`。

第一次測試可以讓主 Bot 和 Agent Bot 使用同一個 bot token；正式使用建議分開，避免 slash command/system message 和 agent 對話互相干擾。

## 6. Claude / Provider 認證

ClaudeCab 會把 agent 目錄當成 Claude Code 專案工作目錄；Claude Code / agent-sdk 會讀取該目錄下的 `.claude/settings.local.json`。常見認證來源是：

1. agent 的 `.claude/settings.local.json` 裡的 `env.ANTHROPIC_API_KEY` 或 `env.ANTHROPIC_AUTH_TOKEN`
2. `.env` 的 `ANTHROPIC_API_KEY`
3. 主機 Claude Code OAuth，也就是 `claude login`

### Claude Code 訂閱 / OAuth

OAuth 模式的前提（缺一不可，全新部署最常在這裡卡）：

- **需要 Claude Pro / Max 訂閱**。沒有訂閱無法完成 `claude login`；沒訂閱請改用「Anthropic API key」模式，不需要登入。
- **需要在部署機器另外全域安裝 Claude Code CLI**（ClaudeCab 不會幫你裝）：

  ```bash
  npm install -g @anthropic-ai/claude-code
  ```

  ClaudeCab 的 SDK 自帶用來跑 query 的 CLI binary，但 OAuth 登入憑證是由這個獨立的 Claude Code CLI 產生，存在部署機器的 `~/.claude/credentials.json`。

安裝完 Claude Code CLI 後，在部署機器跑（會開瀏覽器完成登入）：

```bash
claude login
```

`.env` 不填 `ANTHROPIC_API_KEY`，也不要設定 `ANTHROPIC_BASE_URL`。

> SSH / Docker / 雲端等無瀏覽器環境跑 `claude login` 的替代方案，見 [.claude/skills/claudecab-deploy/references/troubleshooting.md](../.claude/skills/claudecab-deploy/references/troubleshooting.md) 的 Headless 段。

### Anthropic API key

單一 agent 可先放 `.env`：

```env
ANTHROPIC_API_KEY=your-anthropic-api-key
ANTHROPIC_BASE_URL=
```

### DeepSeek / 第三方 proxy / Anthropic-compatible provider

建議放 agent 層，不要放全域 `.env`。修改 `agents/example/.claude/settings.local.json`：

```json
{
  "model": "sonnet",
  "permissions": {
    "allow": [],
    "deny": []
  },
  "env": {
    "ANTHROPIC_API_KEY": "your-provider-key-or-leave-empty-if-using-auth-token",
    "ANTHROPIC_BASE_URL": "https://your-provider-endpoint"
  }
}
```

部分 provider 使用 `ANTHROPIC_AUTH_TOKEN` 而不是 `ANTHROPIC_API_KEY`；兩者擇一即可，不要同時亂填。

ClaudeCab 會以這份檔案的 `model` 與 provider env 組裝 SDK session；`agent.json` 不再放 model，避免同一個 agent 有兩個互相覆蓋的模型來源。修改 provider 或 model 後，建議關閉既有 SDK session 或重啟後再測一次。

`permissions` 規則、可用 model 名稱、MCP server 設定的完整 schema 以 Claude Code 官方文件為準，設定前先查 [docs/CLAUDE-SETTINGS.md](CLAUDE-SETTINGS.md) 裡的官方文件連結，不要憑記憶猜欄位。

## 7. 靜態驗證

公開模板驗證，不需要真實 secret：

```bash
npm run setup:check -- --template
npm run setup:verify -- --template
```

真實設定驗證：

```bash
npm run setup:check
npm run setup:verify
```

`setup:verify` 會檢查：

- `.env` / agent 設定形狀
- 範例 schedule YAML
- SDK patch 狀態
- Claude Code CLI / npm shim / 平台 binary 狀態
- 暫存 SQLite DB 可初始化
- TypeScript typecheck
- 隔離 TypeScript build（輸出到 `.tmp/build-check`，不覆寫 production `dist/`）

`setup:verify` 不會送 Discord 訊息。

## 7.1 設定變更入口

Discord bot 對一般使用者不提供設定寫入入口。第三方使用者可以對話、停止自己的 query、重置自己的 session、查詢允許公開的狀態；涉及服務生命週期或資源管理的既有指令必須通過 operator gate。

Operator 由 `DISCORD_OWNER_USER_ID` 指定。MVP 不做細分 scope：被指定的 operator 可以使用敏感維護指令，例如 `/restart`、`/close`、`/sync`、`/sessions`、`/cache flush`、以及既有 `/model [agent] [to]`。未通過 gate 的 Discord 使用者不能修改 `.env`、`agent.json`、`.claude/settings.local.json`、schedule YAML 或 runtime 設定，也不能把 Discord bot 當成雲端 secret manager。

正式設定入口以檔案、部署環境、或小型 admin console 為主；Discord operator 指令只保留為維護捷徑，不作為主要設定後台。

設定變更請走：

- `.env` 或雲端平台 secret/env 設定
- `data/claudecab.local.json`（admin console 使用的 local config overlay，重啟後會覆蓋同名 env）
- `agents/<id>/agent.json`
- `agents/<id>/.claude/settings.local.json`
- `agents/<id>/schedules/*.yaml`
- `npm run setup:check` / `npm run setup:verify`

變更後是否需要重啟：

| 設定 | 是否需要重啟 |
|---|---|
| `.env`、Docker/雲端 env、DB path、主 Bot token、guild/client id | 需要 |
| `agent.json` 的 Discord token/channel | 建議重啟；未來若提供 reload，應由 operator 或部署端執行 |
| `.claude/settings.local.json` 的 provider/model/env | 建議重啟或關閉既有 SDK session 後再測 |
| `schedules/*.yaml` | 不需要，系統會 watch 並同步 |

## 7.2 小型 Admin Console

Admin console 是部署者/維運者使用的後台，不是 Discord 使用者功能。預設關閉。

啟用：

```env
ADMIN_CONSOLE_ENABLED=true
ADMIN_CONSOLE_HOST=127.0.0.1
ADMIN_CONSOLE_PORT=47824
ADMIN_CONSOLE_TOKEN=replace-with-a-long-random-token
CLAUDECAB_LOCAL_CONFIG_PATH=./data/claudecab.local.json
```

啟動後開啟：

```text
http://127.0.0.1:47824
```

可做的事：

- 查看 runtime / agent 狀態。
- 編輯 allowlist 內的全域設定，寫入 `data/claudecab.local.json`。
- 編輯 agent 的 `agent.json` 常用欄位。
- 編輯 agent 的 `.claude/settings.local.json` model/provider env。
- 執行 setup check / setup verify。
- 按 restart，行為等同 `/restart`：先 build check，成功後 process exit，交給 supervisor/container 拉起。

安全規則：

- API 需要 `ADMIN_CONSOLE_TOKEN`，GET config 不會回傳 secret 明文。
- 預設只綁 `127.0.0.1`。如果要對外，請放在 reverse proxy / tunnel / cloud auth 後面。
- 不提供任意檔案編輯，只能改 allowlist 欄位。
- Docker/cloud 上平台 env 不一定能由 container 內部改寫；需要可持久化且可重啟套用的設定，使用 `data/claudecab.local.json` 或平台自己的 secret/env 管理。

## 8. Discord 實連驗證

只有 token/channel 已填好、且你接受會真的送出測試訊息時才執行：

```bash
npm run discord:check -- --agent example
```

要連 thread 建立權限一起測：

```bash
npm run discord:check -- --agent example --thread
```

常見錯誤：

| 錯誤 | 通常原因 |
|---|---|
| 401 / Unauthorized | Bot token 錯，或貼成 ID / public key。 |
| 403 / Missing Permissions | Bot 沒進 server，或缺 channel/thread 權限。 |
| 404 / Unknown Channel | channel ID 錯，或 Bot 看不到該 channel。 |

## 9. 啟動

開發（即時跑原始碼）：

```bash
npm run dev
```

正式本機啟動（supervisor 管理、自動重啟）：

```bash
npm start
```

直接跑 runtime（不走 supervisor）：

```bash
npm run start:direct
```

> `npm start` / `start:direct` 都以 tsx 直接執行 `src/index.ts`，**不需要先 `npm run build`**。`npm run build` 產生的 `dist/` 只有 Docker 部署（`node dist/index.js`）會用到。

啟動成功後檢查：

1. console 或 `logs/` 沒有持續重複 error。
2. Agent Bot 在 Discord 顯示上線。
3. 到 agent 的 `discordChannelId` channel 發一則文字訊息，Agent Bot 有回覆。

### Windows 背景啟動

Windows production 可以用 Task Scheduler 指向：

```text
scripts/run-hidden.vbs
```

這個 VBS 會從自己的位置解析 repo root，隱藏啟動 `npm start`，再交給 `start.ts` supervisor 管理 child process。不要用全域 `taskkill /IM node.exe` 停服務；需要停止時請從 Task Scheduler 停 task，或精準指定 `claudecab.runtime.json` 裡的 PID。

## 10. Docker

Docker 是支援路徑，但不取代 Windows production supervisor。第一次部署建議先完成本機 `setup:verify`，再跑 Docker。

必要檔案：

- `.env`
- `agents/`
- `data/`
- `logs/`

`docker-compose.yml` 會把本機 `.env` 掛到 container 的 `/app/.env`，讓 ClaudeCab 在 runtime 讀取。不要改回 `env_file`，否則 `docker compose config` 可能把 token/key 展開到終端輸出，排錯時很容易外洩。

啟動：

```bash
docker compose up --build
```

背景啟動：

```bash
docker compose up --build -d
```

查看 log：

```bash
docker compose logs -f claudecab
```

停止：

```bash
docker compose down
```

Docker 注意事項：

- container 內 OAuth：production image 已全域裝 Claude Code CLI，可 `docker exec -it claudecab claude login` 在 container 內完成 OAuth，憑證寫入 `/home/claudecab/.claude` 並由 `claudecab-auth` volume 持久化。但互動式 login 仍需能把瀏覽器授權回流到 container 的環境（SSH port forward 或本機桌面）；headless 環境建議直接用 API key / auth token / provider key 放 `.env` 或 agent `.claude/settings.local.json`。
- `.env` 是 bind mount，不會被 bake 進 image；請不要把 `docker compose config` 的完整輸出貼到公開地方。
- `agents/`、`data/`、`logs/` 會掛載為 volume，避免重建 container 後遺失 agent 設定與 SQLite DB。
- 若要用第三方 provider，仍建議放 agent `.claude/settings.local.json`，不要把所有 provider key 放全域 `.env`。
- Docker build 會跑 `npm ci` 與 postinstall SDK patch。

不碰 Discord 的 Docker smoke：

```bash
docker build --target production -t claudecab:local .
docker run --rm -d --name claudecab-smoke \
  -e NODE_ENV=production \
  -e DISCORD_ENABLED=false \
  -e SCHEDULE_ENABLED=false \
  -e ENABLE_PERSISTENCE=true \
  -e AGENTS_DIR=/app/agents \
  -e DB_PATH=/app/data/smoke.db \
  -v "$PWD/agents/example:/app/agents/example:ro" \
  claudecab:local
docker ps --filter name=claudecab-smoke
docker exec claudecab-smoke sh -c 'find /app/data /app/logs -maxdepth 1 -type f -print; tail -n 40 /app/logs/*.log'
docker stop claudecab-smoke
```

這個 smoke 只確認 container 可啟動、DB/log 可寫、instance lock healthcheck 可通過；不會驗證 Discord token 或 Claude 認證。真實 Discord 仍用 `npm run discord:check -- --agent example` 驗證。

## 11. 最常見問題

### Bot 上線但不回覆

先確認：

```bash
npm run setup:check
npm run discord:check -- --agent example
```

再確認 Discord Developer Portal 的 Message Content Intent 已開，且 bot 對該 channel 有 View Channels、Send Messages、Read Message History 權限。

### `Claude Code CLI not found`

先跑：

```bash
claude --version
npm run setup:verify
```

如果你用的是 Claude Code 2.1.119+，確認平台 native binary 已安裝，並重新執行 `npm install` 讓 SDK patch 套上。

### `Authentication error`

先區分認證模式：

- OAuth：確認部署機器跑過 `claude login`，且 `.env` 沒設定 `ANTHROPIC_BASE_URL`。
- API key/provider：確認 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 存在，proxy 通常也需要 `ANTHROPIC_BASE_URL`。
- 多 agent/provider：優先把 key/base URL 放 agent `.claude/settings.local.json`。

### Schedule 建 thread 但你沒有收到通知

`.env` 補：

```env
DISCORD_OWNER_USER_ID=your-discord-user-id
```

Bot 仍需要 thread 權限：Create Public Threads、Send Messages in Threads、Read Message History。
