# WP-B Config Inventory

日期：2026-07-04  
狀態：盤查與 WP-B code 處置完成  
依據：`docs/PLAN-cleanup-and-governance.md` WP-B

## 執行邊界

- 本文件只盤點配置分層與衝突，尚未修改 runtime code。
- 不碰 production 啟動鏈：`Task Scheduler + VBS + start.ts` 不在本階段修改。
- 不新增 `@anthropic-ai/sdk`；本專案仍只允許 `@anthropic-ai/claude-agent-sdk`。
- 不讀 `.env` 實際內容；只盤點 `.env.example` 與程式碼讀取規則。

## 現有配置載體

| 載體 | tracked | 目前用途 | 問題 |
|---|---:|---|---|
| `.env` | 否 | 本機 secret 與部署設定 | 正確不進版控；目前 runtime 直接從 `process.env` 分散讀取。 |
| `.env.example` | 是 | 最小安裝範本 | 已有基本註解，但與 runtime config schema 未共用；doctor 規則可能漂移。 |
| `src/config.ts` | 是 | 主要 `AppConfig` 建構入口 | 手寫 parser，無 zod schema；缺少 fail-fast 必填清單；部分設定仍被其他模組直讀 env。 |
| `src/constants.ts` / module constants | 是 | crash marker、prompt text、產品預設 | 產品預設、agent 工作流語意與環境假設未完全分層。 |
| `start.ts` | 是 | Windows production supervisor | PID/runtime/control 檔寫 root；涉及啟動鏈，需 rollback 路徑。 |
| `claudecab.pid` | 否 | supervisor runtime PID | 已被 `.gitignore` 排除，但仍污染 root 工作目錄。 |
| `claudecab.runtime.json` | 否 | supervisor runtime state | 已被 `.gitignore` 排除，但仍污染 root 工作目錄。 |
| `claudecab.control.json` | 否 | supervisor control command | 未 tracked；若存在也應視為 runtime 產物。 |
| `ecosystem.config.cjs` | 是 | PM2 舊設定 | 目前 production 走 `start.ts`，需確認無引用後 WP-D archive/remove。 |
| `Dockerfile` / `docker-compose.yml` | 是 | Docker 安裝/部署路徑 | 與現行 Windows supervisor production path 不一致；WP-E 決策點。 |
| `agents/example/*` | 是 | 開源 agent template | schedule example 寫死 `Asia/Taipei` 與 placeholder channel ID。 |
| local `.claude/`, `.agents/`, `agents/coder`, `agents/general` | 否 | 本機操作資料 | 已被 ignore，非開源配置來源。 |

## `process.env` 直讀盤點

### 應保留為唯一 env 入口

| 位置 | 變數 | 建議 |
|---|---|---|
| `src/config.ts` | 大多數 app env | 保留，但改為 zod schema + typed helpers + fail-fast。 |

### 應改為 AppConfig/context 注入

| 位置 | 變數 | 建議改法 |
|---|---|---|
| `src/core/agentPaths.ts:4` | `AGENTS_DIR` | 改由 `AppConfig.agentsDir` 或呼叫端注入；不要在 helper 重新讀 env。 |
| `src/adapters/DiscordAdapter.ts:555`, `src/adapters/DiscordAdapter.ts:568` | `DISCORD_OWNER_USER_ID` | `DiscordAdapterConfig` 增加 `ownerUserId` 或透過 service context 注入。 |
| `src/adapters/discord/DiscordInteractionHandler.ts:152` | `DISCORD_OWNER_USER_ID` | interaction handler 建構時注入 owner id。 |
| `src/adapters/discord/commands/sessions.ts:21` | `DISCORD_OWNER_USER_ID` | slash command context 注入 owner id。 |
| `src/schedule/ScheduleOutput.ts:140` | `DISCORD_OWNER_USER_ID` | schedule output params/context 注入 owner id。 |
| `scripts/schedule-tool.ts:662`, `scripts/schedule-tool.ts:683` | `DISCORD_OWNER_USER_ID` | 使用 `loadAppConfig().discord.ownerUserId` 或 CLI option。 |
| `src/adapters/discord/commands/sessions.ts:70` | `DISCORD_GUILD_ID` | 優先使用 runtimeContext / interaction.guildId；最後 fallback 應由 config/context 提供。 |
| `src/core/query/QueryExecutor.ts:236` | `DISCORD_GUILD_ID` | `QueryExecutorDeps` 或 request runtimeContext 注入 guild id。 |
| `src/core/query/QueryPostProcessing.ts:77` | `DISCORD_GUILD_ID` | 由 `runtimeContext` 或 deps 注入；不要讀 env。 |
| `src/utils/security.ts:55-64` | `ALLOWED_USERS`, `MAX_MESSAGE_LENGTH`, `PROMPT_INJECTION_DETECTION` | 已有 `appSecurityConfig` 路徑；移除 env fallback，讓 AppBootstrap 必須傳入 config。 |
| `src/utils/audit.ts:62` | `AUDIT_LOGGING` | 移除 module-load fallback；由 `auditLogger.configure()` 單一入口控制。 |
| `src/conversation/ConversationPipeline.ts:142` | `loadAppConfig()` | 不應在 message pipeline 內重載全域 config；改由 `ConversationPipeline` deps 注入需要的值。 |
| `src/utils/logger.ts:5-6` | `LOG_LEVEL`, `NODE_ENV` | 可保留為 bootstrap 前例外，或改為 logger factory；需明確列例外。 |
| `src/AppBootstrap.ts:59-60` | `NODE_ENV`, `LOG_LEVEL` | 只用於 startup banner；可從 config/log module 注入或列為 observability 例外。 |

### 平台/系統 resolver 例外候選

| 位置 | 變數/狀態 | 建議 |
|---|---|---|
| `src/utils/cliPath.ts` | `PATH`, `APPDATA`, `process.platform`, `process.arch` | 這是系統 resolver，不是 app config；保留但在文件中列為例外。 |
| `src/services/OAuthUsageService.ts:18` | `USERPROFILE`, `HOME` | Claude Code OAuth 憑證位置，應改為可覆蓋 config，預設仍可從 host home 推導。 |
| `src/core/session/SDKSessionOptions.ts:163` | `CLAUDE_CLI_PATH` | SDK/CLI runtime override；可保留在 config schema 或 SDK adapter config。 |
| `scripts/setup-verify.ts:40` | `npm_execpath` | npm runner 偵測，script-local 例外。 |
| `scripts/patch-sdk-v2.cjs:31` | `CLAUDECAB_SDK_PATCH_DIR`, `SDK_PATCH_DIR` | SDK patch lab override；WP-C 登記為 SDK touchpoint。 |
| `start.ts:88` | spread `process.env` + `NODE_ENV=production` | production supervisor 行為；本 WP 不碰，WP-F/部署 SOP 再處理。 |

## 重複與衝突

| 主題 | 現況 | 風險 | 建議 |
|---|---|---|---|
| Discord owner id | `src/config.ts` 有 `discord.ownerUserId`，但多處仍直讀 env。 | schedule thread mention / thread member add / slash command 權限可能讀到不同來源。 | 統一從 AppConfig 傳入 Discord services、adapter、schedule output。 |
| Guild id | `src/config.ts` 有 `discord.guildId`，但 QueryExecutor/PostProcessing/commands 有 env fallback。 | query metrics / Discord links / runtimeContext 可能不一致。 | AppBootstrap 建 runtime context provider，QueryExecutor 不讀 env。 |
| Security config | `loadSecurityConfig(this.config.security)` 已存在，但 `utils/security.ts` 仍 fallback env。 | 測試或呼叫端忘記傳 config 時會暗中讀 env。 | 移除 fallback；必要時讓呼叫端明確傳 default config。 |
| Audit config | AppBootstrap 會 `auditLogger.configure()`，但 `AuditLogger` constructor 又讀 env。 | module load 時機影響行為。 | constructor 用安全產品預設；bootstrap 是唯一設定入口。 |
| Agents dir | `AppConfig.agentsDir` 與 `src/core/agentPaths.ts` env helper 並存。 | setup/runtime 對 agents dir 的理解可能分裂。 | helper 改為純 path utility 或由呼叫端傳入。 |
| Timezone | schedule schema default、cron fallback、dashboard display 都寫 `Asia/Taipei`。 | 開源部署者預設時區被台北綁住。 | 新增 `app.timezone` 或 `DEFAULT_TIMEZONE` config；schedule 明確覆蓋優先。 |
| Runtime files | `.gitignore` 排除 root pid/runtime，但 `start.ts` 仍寫 root。 | 正常運行後 root 仍髒；新手困惑。 | 改到 `data/runtime/` 或 `temp/runtime/`，但必須保留 rollback。 |
| Docker/PM2 | tracked，但與 production supervisor 不一致。 | 新手可能照 Docker 啟動壞路徑。 | WP-E/WP-D 處理；Docker 需使用者拍板。 |

## 建議 WP-B code 切法

為降低風險，建議 WP-B 不一次做完所有 config 願景，而是切成以下小步：

1. **Config schema 基礎化**
   - 在 `src/config.ts` 導入 zod schema。
   - 保留現有 env 名稱與預設值，避免行為改變。
   - 新增 `loadAppConfig(env?: NodeJS.ProcessEnv, cwd?: string)` 參數，方便測試與 setup doctor 共用。
   - 增加 `validateAppConfigForRuntime(config)` 或等價 fail-fast，輸出缺項與修復提示。

2. **移除已經有 AppConfig 的 env 重複讀取**
   - `utils/security.ts`、`utils/audit.ts`。
   - Discord owner id / guild id 先從 AppBootstrap 注入到已存在的 Discord services/context。
   - QueryExecutor 的 guild id 改由 request/runtimeContext 傳入。

3. **Timezone config**
   - 新增 `timezone` 至 AppConfig，預設建議 `UTC` 或 `Asia/Taipei` 由使用者拍板。
   - 若要避免行為變更，第一步可先維持 `Asia/Taipei` default，但文件標示 WP-E 要改 example。

4. **Runtime root 產物**
   - 本包先只把路徑常量抽成可 rollback 的 helper，不直接改 production 預設路徑。
   - 真正遷移到 `data/runtime/` 可放 WP-D/F，避免破壞目前啟動鏈。

5. **測試**
   - 新增 `tests/config.test.ts`，涵蓋：預設值、必填 Discord runtime 缺項訊息、env override、security/audit fallback 移除。
   - 更新既有 setup tests 只在必要時調整。

## 需要確認的 WP-B 決策

1. **全域 timezone 預設**
   - 選項 A：維持 `Asia/Taipei` 作為相容預設，先集中化，WP-E 再讓 example 指引使用者改。
   - 選項 B：改為 `UTC` 作為開源預設，這是行為變更，schedule/dashboard 顯示會變。
   - 建議：WP-B 先選 A，降低風險；WP-E 文件再教部署者設定。

2. **runtime PID/state 檔實際遷移時機**
   - 選項 A：WP-B 只盤點與抽象化，不改 `start.ts` 實際路徑。
   - 選項 B：WP-B 直接改到 `data/runtime/`，同時保留 root fallback。
   - 建議：選 A，因 `start.ts` 是 production 啟動鏈，依守則留到 WP-D/F 帶 rollback 處理。

3. **Docker/PM2**
   - 本決策規劃書放在 WP-E/WP-D；WP-B 不拍板、不處理。

## WP-B code 處置結果

- `src/config.ts` 改為 zod schema 驗證，保留既有 env 名稱與預設值；`loadAppConfig(env, cwd)` 可被測試與 doctor script 共用。
- 新增 `validateAppConfigForRuntime()` / `formatRuntimeConfigIssues()`，`src/index.ts` 啟動時會對 Discord 必填項 fail-fast，輸出缺少的 env 名稱。
- `utils/security.ts` 與 `utils/audit.ts` 不再自行讀 env；security/audit 只接受 AppConfig/產品預設。
- Discord owner/guild 設定改由 AppConfig 注入到 `DiscordAdapter`、`DiscordInteractionHandler`、slash commands、schedule thread output、`scripts/schedule-tool.ts`。
- `QueryExecutor` / `QueryPostProcessing` 不再讀 `DISCORD_GUILD_ID`；guild id 由 `MessageProcessor`/runtime context 注入。
- `ConversationPipeline` 不再每則訊息呼叫 `loadAppConfig()`；session guard config 由 `MessageProcessor` 注入。
- `src/core/agentPaths.ts` 不再讀 `AGENTS_DIR`；由 `AppBootstrap` 呼叫 `configureAgentPaths(config.agentsDir)`，hook runtime config / prompt root / foundation subagents 改成 lazy resolve，避免 import-time 固定錯路徑。
- 新增 `tests/config.test.ts`，並更新 `tests/foundationPaths.test.ts`、`tests/scheduleOutput.test.ts` 覆蓋 config-driven path 與 schedule owner mention。

## WP-B 剩餘 env 例外

以下直讀目前保留，原因是平台 resolver、script-local runner、SDK/CLI touchpoint 或 production supervisor，後續工作包再分別處理：

| 位置 | 原因 | 後續 |
|---|---|---|
| `src/config.ts` | 唯一正式 env 入口 | 保留。 |
| `start.ts` | production supervisor 會繼承 env；本包不碰啟動鏈 | WP-F 部署 SOP。 |
| `src/utils/logger.ts`、`src/AppBootstrap.ts` 的 `NODE_ENV` / `LOG_LEVEL` | bootstrap 前 observability | 可在 WP-H/F 評估 logger factory。 |
| `src/utils/cliPath.ts` | 系統 CLI resolver，需讀 `PATH` / `APPDATA` | WP-C SDK/CLI touchpoints 登記。 |
| `src/core/session/SDKSessionOptions.ts` | `CLAUDE_CLI_PATH` 是 SDK/CLI override | WP-C 登記。 |
| `src/services/OAuthUsageService.ts` | Claude OAuth credentials host home resolver | WP-E 文件化可覆蓋方式。 |
| `scripts/setup-verify.ts` | npm runner 偵測 | script-local 例外。 |
| `scripts/patch-sdk-v2.cjs` | SDK patch lab override | WP-C 登記。 |
| `scripts/discord-check.ts` | function default 可注入 env，測試已可覆寫 | 保留。 |
| `src/adapters/discord/commands/cache.ts` `HOSTNAME` | cache status footer observability | 可後續改成 logger/runtime metadata。 |

## WP-B 驗收結果

```bash
npm run typecheck
npm run test:run
```

均已通過；`npm run lint` 會在 commit 前與完整 gates 一起執行。

## WP-B 驗收預期

WP-B code 處置完成後應達成：

```bash
rg -n "process\.env\." src scripts start.ts
```

剩餘命中只允許：

- `src/config.ts`
- 明確列為 platform/system resolver 例外的檔案，例如 CLI path resolver
- script-local runner 例外，例如 `setup-verify.ts`
- production supervisor `start.ts`，直到 WP-F 部署 SOP 處理

並需通過：

```bash
npm run typecheck
npm run lint
npm run test:run
```
