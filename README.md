# ClaudeCab

ClaudeCab 是一個 Discord-first runtime，讓使用者可以在 Discord channel/thread 裡透過 Claude Agent SDK / Claude Code 和 agent 對話。

主要用途：

- 用 Discord 消耗 Claude Code 訂閱或 Anthropic API 額度。
- 透過 Claude Code SDK harness 接 Anthropic-compatible endpoint，例如 DeepSeek 或第三方 proxy。
- 把 Discord channel/thread 對話映射成可持續 resume 的 Claude session。

```text
Discord channel/thread
  -> Agent Bot
  -> ClaudeCab
  -> Claude Agent SDK / Claude Code
  -> Discord reply
```

## 功能範圍

目前保留：

- 從 `AGENTS_DIR` 載入 Discord agents
- Claude Agent SDK V2 persistent sessions
- idle session cleanup 與 prompt-cache keepalive
- Discord permission / question / exit-plan callbacks
- YAML schedules，可輸出 Discord message/thread
- SQLite persistence，包含 sessions、conversation、query metrics、schedule thread mapping
- Discord dashboard、cost report、cache anomaly report
- MCP tools 與 workspace validation
- 預設關閉的小型 admin console，可供 operator 設定、驗證、重啟

不包含：

- 公開 Web UI / public dashboard assets
- Telegram
- TTS 或音效播放
- 自主社群發文或 initiative routing
- 舊 task、budget、activity services

## 最小安裝

完整安裝與驗證流程以 [docs/SETUP.md](docs/SETUP.md) 為準，包含 Docker、Claude Code CLI、SDK patch、Discord 實連驗證、以及 DeepSeek / 第三方 provider 設定。

需求：

- Node.js 20+
- 一個 Discord server
- Discord Developer Portal 裡的 bot
- Claude 認證，二選一：
  - Claude Code 訂閱：在部署機器跑 `claude login`
  - API key / proxy：提供 `ANTHROPIC_API_KEY`，必要時提供 `ANTHROPIC_BASE_URL`

最短成功路徑：

1. 建立 Discord bot，開啟 `Message Content Intent`，invite 到 server。
2. 填 `.env` 的主 Bot token、application ID、server ID、`AGENTS_DIR`、Claude 認證。
3. 填 `agents/example/agent.json` 的 Agent Bot token 和目標 channel ID。
4. 先跑 `npm run setup:check`，再跑 `npm run discord:check -- --agent example`。
5. 啟動 ClaudeCab，最後到 Discord channel 發訊息確認 agent 真的會回覆。

安裝：

```bash
git clone https://github.com/cablate/ClaudeCrab.git ClaudeCab
cd ClaudeCab
npm install
cp .env.example .env
```

Windows PowerShell 如果 `cp` 不可用，改用：

```powershell
Copy-Item .env.example .env
```

GitHub repository 目前叫 `ClaudeCrab`，專案名稱是 `ClaudeCab`。上面的 clone 指令刻意指定本機資料夾為 `ClaudeCab`，避免後續 `cd` 路徑混淆。

填 `.env`：

```env
DISCORD_ENABLED=true
DISCORD_MAIN_BOT_TOKEN=your-main-bot-token
DISCORD_MAIN_BOT_CLIENT_ID=your-main-bot-application-id
DISCORD_GUILD_ID=your-discord-server-id

AGENTS_DIR=./agents

# 使用 Anthropic API key 才填；使用 claude login / OAuth 時保持空白
ANTHROPIC_API_KEY=

ENABLE_PERSISTENCE=true
DB_PATH=./data/claudecab.db

# 選填但建議：你的 Discord User ID。schedule 建立 thread 時可通知/加入你。
DISCORD_OWNER_USER_ID=

# 選填：小型 operator 後台，預設關閉
ADMIN_CONSOLE_ENABLED=false
ADMIN_CONSOLE_TOKEN=
CLAUDECAB_LOCAL_CONFIG_PATH=./data/claudecab.local.json
```

填 `agents/example/agent.json`：

```json
{
  "name": "Example",
  "description": "Starter Discord agent profile",
  "model": "sonnet",
  "discordBotToken": "your-agent-bot-token",
  "discordChannelId": "target-channel-id",
  "settings": {
    "permissionMode": "default",
    "maxTurns": 20
  }
}
```

檢查與啟動：

```bash
npm run setup:check
npm run setup:verify
npm run discord:check -- --agent example
npm run dev
```

`setup:check` 和 `discord:check` 會讀 `.env` 的 `AGENTS_DIR`。如果你把 live agents 放在 repo 外，例如 `D:\_CabLate_Agents`，那 `--agent example` 會檢查外部資料夾裡的 `example`，不是 repo 內的 `agents/example`。只想檢查公開範例格式時使用：

```bash
npm run setup:check -- --template
npm run setup:verify -- --template
```

`setup:verify` 是安全總檢查，會跑設定檢查、公開 schedule strict check、typecheck、build；不會送 Discord 訊息。`discord:check` 需要真實 token/channel，公開範例還是 placeholder 時不要執行。

正式啟動：

```bash
npm run build
npm start
```

啟動後用三個現象判斷成功：

1. console 或 `logs/` 沒有持續重複的 error。
2. Agent Bot 在 Discord 顯示上線，且目標 channel 看得到它。
3. 在 `discordChannelId` 對應的 channel 發一則文字訊息，Agent Bot 有回覆。

如果使用 `npm start`，ClaudeCab 也會寫入 supervisor runtime 檔：

- `claudecab.pid`
- `claudecab.runtime.json`
- `logs/`

如果上述任一項沒有出現，不要繼續調進階設定，先看「常見問題」。

## 建議驗證順序

```bash
npm run setup:check
npm run setup:verify
npm run discord:check -- --agent example
npm run typecheck
npm run build
npm run dev
```

最後一定要到 Discord 目標 channel 發一則真實訊息，確認 Agent Bot 會回覆。安裝不能只看 build 是否通過。

`discord:check` 會使用 `agents/example/agent.json` 的 `discordBotToken` 和 `discordChannelId`，透過 Discord REST 直接送一則測試訊息到 channel，不會啟動 Gateway listener，也不會呼叫 Claude。

如果要連 thread 建立權限一起測：

```bash
npm run discord:check -- --agent example --thread
```

這會真的在 Discord 建立測試訊息或 thread，測完後可手動刪除。不要在未確認 token/channel 的情況下讓 AI 自動執行這個指令。

常見錯誤：

- 401 / Unauthorized：Agent Bot token 錯，或貼到的不是 Bot Token。
- 403 / Missing Permissions：Bot 沒被邀進 server，或缺 channel 權限。
- 404 / Unknown Channel：`discordChannelId` 錯，或 Bot 看不到該 channel。

## 主 Bot 與 Agent Bot

ClaudeCab 會用兩層 Discord bot 設定：

| 角色 | 設定位置 | 用途 |
| --- | --- | --- |
| 主 Bot | `.env` 的 `DISCORD_MAIN_BOT_TOKEN` / `DISCORD_MAIN_BOT_CLIENT_ID` | slash command、按鈕、系統訊息、dashboard |
| Agent Bot | `agents/example/agent.json` 的 `discordBotToken` / `discordChannelId` | 在指定頻道代表 agent 接收訊息與回覆 |

第一次安裝可以用同一個 Discord application 的 bot token 做測試，但正式使用建議主 Bot 和 Agent Bot 分開，權限與故障範圍會比較清楚。

需要準備：

- Main Bot token
- Main Bot application/client ID
- Agent Bot token
- Discord server/guild ID
- Agent 要監聽的 channel ID
- 選填：你的 Discord user ID，填到 `DISCORD_OWNER_USER_ID`，讓 schedule thread 可以通知或加入你

Discord ID 複製方式：

1. Discord 使用者設定打開 Developer Mode。
2. 右鍵 server 複製 `Server ID`，填到 `DISCORD_GUILD_ID`。
3. 右鍵 channel 複製 `Channel ID`，填到 `discordChannelId`。
4. Discord Developer Portal 的 Application ID 填到 `DISCORD_MAIN_BOT_CLIENT_ID`。

Discord Developer Portal 裡還要確認：

1. Bot 頁面已建立 bot，並複製的是 `Bot Token`，不是 application public key。
2. Bot 頁面的 `Privileged Gateway Intents` 開啟 `Message Content Intent`。
3. OAuth2 URL Generator 勾選 scopes：`bot`、`applications.commands`。
4. Main Bot 和 Agent Bot 都要 invite 到同一個 server；如果測試時共用同一個 bot，也至少要確認該 bot 已在 server 裡。

ClaudeCab 的 Discord adapter 會使用 `Guilds`、`GuildMessages`、`MessageContent` intents。沒有 Message Content Intent 時，Bot 可能上線但讀不到一般文字訊息。

Bot 權限至少需要：

- View Channels
- Send Messages
- Create Public Threads
- Send Messages in Threads
- Read Message History
- Attach Files
- Use Slash Commands

## Claude 認證模式

ClaudeCab 會依序採用：

1. agent 的 `.claude/settings.local.json` 裡的 `env.ANTHROPIC_API_KEY`
2. `.env` 的 `ANTHROPIC_API_KEY`
3. 主機上的 Claude Code OAuth，也就是 `claude login`

常見選擇：

| 使用方式 | 設定位置 | `ANTHROPIC_BASE_URL` | 備註 |
| --- | --- | --- | --- |
| Claude Code 訂閱 / OAuth | 部署機器跑 `claude login` | 不要設定 | 適合直接使用 Claude Code 訂閱額度 |
| Anthropic API key | `.env` 或 agent settings | 通常不需要 | 單一 agent 可先放 `.env` |
| DeepSeek / proxy / Anthropic-compatible provider | agent `.claude/settings.local.json` 的 `env` | 要設定 | 建議放 agent 層，避免污染全域設定 |

如果使用 DeepSeek、第三方 proxy 或其他 Anthropic-compatible provider，建議改 `agents/example/.claude/settings.local.json`：

```json
{
  "model": "sonnet",
  "permissions": {
    "allow": [],
    "deny": []
  },
  "env": {
    "ANTHROPIC_API_KEY": "your-provider-key",
    "ANTHROPIC_BASE_URL": "https://your-provider-endpoint"
  }
}
```

當 ClaudeCab 偵測到 agent 層的 `ANTHROPIC_API_KEY` 時，會自動把 `CLAUDE_CONFIG_DIR` 指到該 agent 的 `.claude` 目錄，並清掉 `ANTHROPIC_AUTH_TOKEN`。這是為了避免 Claude Code 誤讀主機上的 OAuth 憑證。

## Agent 目錄

預設只追蹤 `agents/example`，真實 agent 設定預設會被 git ignore。

```text
agents/
  example/
    agent.json
    CLAUDE.md
    .claude/
      settings.local.json
    .mcp.json
    schedules/
      *.yaml
```

檔案用途：

| 檔案 | 用途 | 第一次安裝是否要改 |
| --- | --- | --- |
| `.env` | 主 Bot、server id、全域 runtime | 要 |
| `agents/example/agent.json` | Agent Bot token、channel id、model、permission mode | 要 |
| `agents/example/CLAUDE.md` | agent 的基礎指令 | 可先不改 |
| `agents/example/.claude/settings.local.json` | Claude Code 專案設定與 provider env | OAuth/API key 可先不改；proxy 才改 |
| `agents/example/.mcp.json` | agent 的 MCP server 設定 | 可先不改 |
| `data/claudecab.local.json` | admin console 寫入的全域 local override | 可先不改 |

## 給 AI 的安裝指令

可追蹤的部署 skill package 放在 `docs/skills/claudecab-deploy/`。如果你的 AI 工具支援 skills，可以把這個資料夾安裝到該工具的 skill 目錄；不支援時，直接要求 AI 先讀 `docs/skills/claudecab-deploy/SKILL.md`。

如果你要請 AI assistant 幫你設定 ClaudeCab，把下面整段貼給它：

```text
請幫我設定 ClaudeCab，目標是讓 Discord channel 可以和 ClaudeCab agent 對話。

請先閱讀：
- README.md
- docs/SETUP.md
- docs/skills/claudecab-deploy/SKILL.md
- .env.example
- agents/example/agent.json
- agents/example/.claude/settings.local.json

請遵守：
- 只修改必要設定檔，不重構程式碼。
- 優先修改 .env、agents/example/agent.json。
- 如果使用 admin console 修改全域 runtime 設定，應寫入 data/claudecab.local.json，重啟後才會套用。
- 只有在我要使用 DeepSeek、第三方 proxy、或 Anthropic-compatible endpoint 時，才修改 agents/example/.claude/settings.local.json 的 env。
- 不要修改 src/**、package.json、docs/**。
- 不要 commit token、API key、OAuth credential 或任何 secret。
- 不要在回覆中完整印出 secret。
- 不要一開始就調整 session/cache/schedule/dashboard/STT 進階設定。
- 先問清楚 Claude 認證模式：Claude Code OAuth、Anthropic API key、或第三方 proxy/provider。
- 確認主 Bot 和 Agent Bot 是否同一個，不要把 token、client id、guild id、channel id 填錯欄位。
- 確認 Discord Developer Portal 已開 Message Content Intent，且 invite scopes 包含 bot、applications.commands。
- `npm run discord:check` 會真的送 Discord 訊息；只有 token/channel 已由使用者確認時才執行。
- 不要宣稱安裝成功，除非 setup:check、setup:verify 都通過，且你已說明使用者接下來要如何做 Discord 實測。

請依序完成：
1. 如果還沒 clone，使用 `git clone https://github.com/cablate/ClaudeCrab.git ClaudeCab`，然後 `cd ClaudeCab`。
2. npm install
3. 建立或更新 .env
4. 建立或更新 agents/example/agent.json
5. 必要時更新 agents/example/.claude/settings.local.json
6. 執行 npm run setup:check
7. 執行 npm run setup:verify
8. 如果 token/channel 已填好且使用者同意送測試訊息，執行 npm run discord:check -- --agent example

最後請只回報：
- 修改了哪些設定檔
- 哪些值仍需要我自己補上
- 檢查指令是否通過
- 下一步如何啟動
- 下一步如何在 Discord channel 實測
- 如果沒有執行 discord:check，請明確說明原因，例如缺 token/channel 或使用者未同意發送測試訊息
```

AI 最後回報建議使用這個格式：

```text
設定結果：
- 已修改：
  - .env：已填 main bot token/client id/guild id、AGENTS_DIR、Claude 認證模式
  - agents/example/agent.json：已填 agent bot token/channel id
  - agents/example/.claude/settings.local.json：未修改 / 已填 provider env
- 未填或需要你確認：
  - ...

檢查結果：
- npm run setup:check：通過 / 未通過，原因是 ...
- npm run setup:verify：通過 / 未通過，原因是 ...
- npm run discord:check -- --agent example：通過 / 未通過 / 未執行，原因是 ...
- npm run typecheck：通過 / 未通過，原因是 ...
- npm run build：通過 / 未通過，原因是 ...

啟動方式：
- 開發測試：npm run dev
- 正式啟動：
  1. npm run build
  2. npm start

Discord 實測：
1. 確認 Agent Bot 已加入 server、有 channel 權限，且 Message Content Intent 已開。
2. 到 agent.json 的 discordChannelId 對應 channel 發一則測試訊息。
3. 如果沒有回覆，先貼 npm run setup:check 輸出與最新 logs，不要先改進階設定。

安全提醒：
- 我沒有印出完整 token/API key。
- 我沒有修改 src/**、package.json、docs/**。
```

## Schedule 檢查

列出 schedules：

```bash
npm run schedule:list
```

驗證 YAML：

```bash
npm run schedule:validate
```

直接跑一次 schedule prompt：

```bash
npm run schedule:run -- example/example-daily-check
```

測試 Discord thread 建立與送出，不跑 Claude prompt：

```bash
npm run schedule:discord-test -- example/example-daily-check
```

## 進階設定

第一次安裝通常不用調整這些：

| 設定 | 預設行為 | 什麼時候才改 |
| --- | --- | --- |
| `SESSION_IDLE_CLOSE_MS` | idle session 預設一段時間後關閉，之後可 resume | 需要改變 SDK process 存活時間 |
| `SESSION_EPHEMERAL` | 預設保留 live session | 想讓每次對話都重新建立 SDK process |
| `CACHE_KEEPALIVE_*` | 自動維持 prompt cache | 需要優化 cache 成本或命中率 |
| `SESSION_GUARD_*` | 保護長對話與 cache 狀態 | 長對話常爆 token 或 cache 異常 |
| `SCHEDULE_ENABLED` | 控制 schedule loader | 不使用 schedule 才關 |
| `SCHEDULE_CATCHUP_*` | 排程補跑健康檢查 | 預設每 30 分鐘檢查一次；每日固定時間 cron 若超過 grace 仍沒有 DB 執行紀錄，且仍在補跑窗口內，才會補跑 |
| `DISCORD_CHANNEL_*` | dashboard、cost report、alert channel | 需要營運監控頻道 |
| `STT_*` | 語音轉文字 | 要處理語音訊息 |
| `ALLOWED_USERS` | 使用者白名單 | 需要限制可用 Discord 使用者 |

## 架構

主要 runtime flow：

```text
start.ts supervisor
  -> src/index.ts
  -> AppBootstrap
  -> AgentLoader
  -> PlatformOrchestrator
  -> DiscordAdapter
  -> DiscordMessageHandler
  -> MessageProcessor
  -> ConversationPipeline
  -> QueryExecutor
  -> SDKSessionManager
  -> SDKStreamProcessor
  -> DiscordSender / StreamResponseRouter
```

主要模組：

- `src/adapters/discord/`: Discord client lifecycle、slash commands、message conversion、interaction UI、sending。
- `src/core/orchestrator/`: app-level agent loading 與 platform orchestration。
- `src/conversation/`: session creation、locking、guard checks、pipeline state transitions。
- `src/core/query/`: SDK query orchestration、stream event handling、response delivery、usage recording。
- `src/core/session/`: app sessions 與 Claude SDK V2 session lifecycle。
- `src/core/interaction/`: SDK permission/question/exit-plan callback bridges。
- `src/core/keepalive/`: prompt-cache keepalive scheduling、audit、ROI、healing、cache efficiency tracking。
- `src/schedule/`: YAML schedule loading、cron registration、execution、output formatting、thread mapping。
- `src/persistence/`: SQLite repositories 與 migrations。

完整架構請看 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；文件入口請看 [docs/README.md](docs/README.md)。

## 常見問題

### Agent 不回覆

檢查：

- `.env` 有 `DISCORD_ENABLED=true`
- `.env` 的 `AGENTS_DIR=./agents`
- `agents/example/agent.json` 存在且 JSON 合法
- `discordBotToken` 是 Agent Bot token，不是 main bot client ID
- `discordChannelId` 是目標 channel ID
- Agent Bot 已加入 server
- Agent Bot 對該 channel 有 View / Send / Read Message History 權限
- Discord Developer Portal 的 Message Content Intent 已開啟

### Claude 認證失敗

如果使用 OAuth：

- 部署機器先跑 `claude login`
- `.env` 不要填 `ANTHROPIC_API_KEY`
- 不要設定 `ANTHROPIC_BASE_URL`

如果使用 API key / proxy：

- `ANTHROPIC_API_KEY` 必須存在
- proxy 通常也要 `ANTHROPIC_BASE_URL`
- 多 agent 或第三方 provider 建議放 agent `.claude/settings.local.json`，不要放全域 `.env`

### 沒有 log

檢查：

- process 是否真的啟動
- `logs/` 是否被建立
- `LOG_LEVEL=debug` 是否需要暫時打開
- `npm start` 會寫入 supervisor runtime 檔，例如 `claudecab.pid`、`claudecab.runtime.json`

## Repository Notes

這個 repository 只應包含 Discord + Claude Agent SDK runtime 需要的程式碼、公開範例與文件。

不應提交：

- `node_modules/`
- `dist/`
- `data/`
- `logs/`
- `.codegraph/`
- `.claude/`
- 真實 live agent folders
- local agent skills
- generated databases
- planning archives

## License

MIT
