# WP-A Hardcode Inventory

日期：2026-07-04  
狀態：盤查完成，尚未進入 code 處置  
依據：`docs/PLAN-cleanup-and-governance.md` WP-A

## 執行邊界

- 本次只做 WP-A 盤查與清單文件，不改 source code。
- 遵守序列執行：未同時處理 WP-B 或其他工作包。
- 不碰 production 啟動鏈：未修改 Task Scheduler、VBS、`start.ts` 或目前執行中的 process。
- 未讀出 `.env` 內容；只確認 `.env` 未被 git 追蹤。
- 目前工作樹在 WP-A 前已有既有未提交變更：`src/core/query/QueryExecutor.ts`、`src/core/query/QuerySdkRunner.ts`、`src/core/session/SDKSessionOptions.ts`、`src/utils/cliPath.ts`，以及未追蹤的 `AGENTS.md`、`CLAUDE.md`、`docs/PLAN-cleanup-and-governance.md`。WP-A 不會把這些混入處置判斷。

## 掃描指令與結果摘要

| 檢查 | 結果 |
|---|---|
| 絕對路徑 | 1 筆，`C:\Windows\Media\Ring01.wav` |
| 個人名稱/帳號識別 | 0 筆 |
| Discord/Telegram 17-20 位數字 ID | primary code scope 0 筆；`agents/example` 有 placeholder `000000000000000000` |
| email | 0 筆 |
| 時區假設 | 7 筆 source 命中，另有 tests/example 命中 |
| Windows 專屬命令/路徑 | 2 筆，集中在 `src/utils/localSound.ts` |
| `process.env` fallback | 13 筆，含 `src/config.ts` 與少數非 config 模組 |
| 全量 `process.env` 直讀 | 多處非 config 直讀，需 WP-B 收斂或明確例外 |
| inline `reason` / `description` 字串 | 主要為型別欄位、狀態碼與互動選項文案 |
| tracked secret pattern | 只命中測試假值 `sk-test` |
| `.env` git 歷史 | 無紀錄 |
| `agents/coder`、`agents/general`、`.claude` git 歷史 | 無紀錄 |

## 發現清單

| ID | 位置 | 類別 | 發現 | 建議去向 |
|---|---|---|---|---|
| A-001 | `src/conversation/ConversationPipeline.ts:186` | C | 寫死 Windows 音效檔 `C:\Windows\Media\Ring01.wav`。換 OS 或無音效檔會失效。 | WP-B：改成 config/env 控制；若 local sound 不屬於 core，WP-J 決定移出 core 或預設關閉。 |
| A-002 | `src/utils/localSound.ts:39`, `src/utils/localSound.ts:87` | C | 使用 `powershell.exe` 播放本機音效，屬 Windows-only 行為。 | WP-B/WP-J：包成可關閉的 platform-specific optional feature，或移到外掛層。 |
| A-003 | `src/core/constants.ts:18`, `src/core/constants.ts:42`, `src/adapters/discord/DiscordBootstrap.ts:175`, `src/adapters/discord/services/DiscordDashboard.ts:145`, `src/schedule/CronScheduler.ts:66`, `src/schedule/ScheduleCatchUp.ts:156`, `src/schedule/schemas.ts:21` | C | `Asia/Taipei` 作為顯示與排程預設時區。對開源部署者是環境假設。 | WP-B：新增全域 default timezone config；schedule YAML 可覆蓋；dashboard/Discord 顯示走同一來源。 |
| A-004 | `agents/example/schedules/example-daily-check.yaml:7` | C | example schedule 預設 `Asia/Taipei`。 | WP-E：範本改為明確 placeholder 或引用 setup 文件說明。 |
| A-005 | `agents/example/schedules/example-daily-check.yaml:35` | P | `channelId: "000000000000000000"` 是 placeholder，不是 secret，但會被 ID 掃描命中。 | WP-E：保留 placeholder 但在驗證腳本中辨識；或改成 `<DISCORD_CHANNEL_ID>` 避免誤判。 |
| A-006 | `src/core/constants.ts:8-15`, `src/core/constants.ts:27-38`, `src/core/constants.ts:45-68` | P | core 直接注入中文 memory / startup / cross-agent / skill reminder。這是產品預設與 agent 工作流語意混在 core。 | WP-J：確認 core vs agent 外掛層定位；若不屬於 core，移到 agent template/skill 或 config decoration。 |
| A-007 | `src/config.ts:147-224` | C | `src/config.ts` 是主要 env 入口，但目前只有手寫 parser，尚未 zod schema/fail-fast 缺項清單。 | WP-B：建立單一 config schema，保留合理產品預設，必填 secret 缺失輸出人話錯誤。 |
| A-008 | `src/core/agentPaths.ts:4`, `src/adapters/DiscordAdapter.ts:555`, `src/adapters/DiscordAdapter.ts:568`, `src/schedule/ScheduleOutput.ts:140`, `src/adapters/discord/commands/sessions.ts:70`, `src/core/query/QueryExecutor.ts:236`, `src/core/query/QueryPostProcessing.ts:77`, `src/utils/security.ts:55-64`, `src/utils/audit.ts:62`, `src/core/session/SDKSessionOptions.ts:163`, `src/services/OAuthUsageService.ts:18` | C | 多個非 config 模組直接讀 `process.env`。部分是 runtime context fallback，部分是設定來源分散。 | WP-B：改為從 config/context 注入；少數如 `PATH`/`APPDATA`/`USERPROFILE` 可列為 platform adapter 例外。 |
| A-009 | `src/utils/cliPath.ts:43`, `src/utils/cliPath.ts:47`, `src/utils/cliPath.ts:55`, `src/utils/cliPath.ts:59` | C | CLI path resolver 直接讀 `PATH` 與 `APPDATA`。這是平台環境相依，不是個人值。 | WP-B：標為明確例外或包到 platform/system resolver，避免被誤視為 app config。 |
| A-010 | `scripts/patch-sdk-v2.cjs:31` | C | patch script 直接讀 `CLAUDECAB_SDK_PATCH_DIR` / `SDK_PATCH_DIR`。 | WP-C：SDK touchpoint 登記；WP-B：script-level env 例外或集中到 script config。 |
| A-011 | `scripts/schedule-tool.ts:662`, `scripts/schedule-tool.ts:683` | C | schedule 測試工具直接讀 `DISCORD_OWNER_USER_ID`。 | WP-B：改用共用 config loader，或 CLI option 明確覆蓋。 |
| A-012 | `scripts/setup-verify.ts:40` | C | 直接讀 `process.env.npm_execpath` 判斷 npm 執行環境。 | WP-B：可列為 setup doctor 例外；不屬於部署設定。 |
| A-013 | `start.ts:17-20` | C/D | `claudecab.pid`、`claudecab.runtime.json`、`claudecab.control.json` 寫在 repo root。屬 runtime 產物。 | WP-B/WP-D：遷到 `data/` 或 `temp/`，但涉及 production 啟動鏈，必須留 rollback 路徑。 |
| A-014 | `ecosystem.config.cjs` | D | PM2 設定仍 tracked，但目前 production 已由 `start.ts` supervisor 接管。 | WP-B 確認無引用後，WP-D 依守則移到 `docs/archive/` 或獨立移除 commit。 |
| A-015 | `Dockerfile`, `docker-compose.yml` | C/D | Docker production 路徑使用 `dist/index.js`，與目前 Windows `start.ts` supervisor production path 不一致。 | WP-E 決策點：提案後等使用者拍板，標 experimental 或移除。 |
| A-016 | `README.md:121` | C | 文件範例提到本機外部路徑 `D:\_CabLate_Agents`。雖非 source scope，但對開源安裝有個人環境味道。 | WP-E/README 同步：改成通用 placeholder，例如 `D:\path\to\agents` 或跨平台說明。 |
| A-017 | `tests/setupCheck.test.ts` 多處 | P | `ANTHROPIC_API_KEY=sk-test` 是測試假值。 | 保留；不列為 secret。若未來 secret scanner 擋下，改成 `test-api-key`。 |
| A-018 | `tests/cronScheduler.test.ts`, `tests/scheduleCatchUp.test.ts`, `tests/scheduleOutput.test.ts` | P/C | 測試使用 `Asia/Taipei` 驗證排程邏輯。 | WP-B 後調整為「可配置預設時區」測試；保留一組 explicit timezone 測試。 |
| A-019 | `.claude/`, `.agents/`, `agents/coder`, `agents/general` | D | 本機資料存在於工作樹但未 tracked，且 `.gitignore` 已排除。 | 不納入 WP-A code 處置；維持 ignored。WP-G 再確認開源治理文件是否足夠。 |

## 分類統計

| 類別 | 數量 | 說明 |
|---|---:|---|
| S | 0 | 未發現 tracked secret 或個人 token；`.env` 沒有 git 歷史。 |
| C | 13 | 主要是時區、Windows-only 音效、runtime root 檔、env 直讀、Docker/PM2 殘留。 |
| P | 4 | 產品預設/測試假值/agent prompt 預設。 |
| D | 2 | PM2 舊設定、本機未追蹤資料或 runtime 產物。部分項目與 C 重疊，需 WP-B/WP-D 決定。 |

## 需要使用者確認的處置點

1. **local sound 是否屬於 core？**  
   建議：預設關閉，改成 optional local feature；若開源核心只做 Discord/SDK bridge，後續移出 core。

2. **`Asia/Taipei` 是否仍作為預設？**  
   建議：source default 改為 `UTC` 或從 config 必填/可選；`agents/example` 不寫死台北。

3. **Docker 支援去留**（WP-E 明確標示需使用者拍板）  
   建議：若短期不驗證 Docker，標 experimental 或移到 archive；不要讓半壞 Docker 變成安裝入口。

4. **core prompt context 是否保留 memory/cross-agent/skill reminders？**  
   建議：先不在 WP-A 動，留到 WP-J 用 core 準入標準判斷；高度可能應下放到 agent/template/skill 層。

## 後續驗收方式

WP-A 處置完成後需重跑：

```bash
rg -n --glob '*.ts' --glob '*.cjs' --glob '*.json' --glob '!node_modules/**' --glob '!dist/**' --glob '!logs/**' "[A-Z]:\\\\|[A-Z]:/" src scripts start.ts tests
rg -ni --glob '!node_modules/**' --glob '!dist/**' --glob '!logs/**' "cabcab|cablate|reahtuoo|User\\\\User|Users/User" src scripts start.ts tests
rg -n --glob '*.ts' --glob '!node_modules/**' --glob '!dist/**' --glob '!logs/**' "\b[0-9]{17,20}\b" src scripts
rg -n --glob '!node_modules/**' --glob '!dist/**' --glob '!logs/**' "[a-zA-Z0-9._%+-]+@(gmail|outlook|hotmail)" src scripts tests
rg -ni --glob '!node_modules/**' --glob '!dist/**' --glob '!logs/**' "Asia/Taipei|GMT\+8|UTC\+8" src scripts
rg -ni --glob '!node_modules/**' --glob '!dist/**' --glob '!logs/**' "taskkill|schtasks|\.vbs|powershell|cmd /c|wscript" src scripts start.ts
rg -n --glob '!node_modules/**' --glob '!dist/**' --glob '!logs/**' "process\.env\.[A-Z_]+ *(\?\?|\|\|)" src scripts start.ts
```

目前尚未進入處置，因此 S/C 類命中數尚未歸零。
