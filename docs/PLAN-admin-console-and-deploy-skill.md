---
status: active
owner_surface: infrastructure
last_updated: 2026-07-05
---

# Admin Console And Deploy Skill Plan

## 0. Product Decision

ClaudeCab 要能安全交給第三方 Discord 使用者使用。Discord 對話面不是架設後台；一般使用者只能使用對話、自助 session/reset/stop 等低風險功能。

既有 Discord 指令不移除。涉及服務生命週期、資源管理、或設定寫入的指令，一律加 operator gate。MVP 的 operator 來源是 `DISCORD_OWNER_USER_ID`，不做細分 scope。

主要架設與設定入口要移到一個很小的 admin console。它是部署者/維運者使用的 setup surface，不是聊天使用者功能。

## 1. Current State

### Bot plane

- 一般 Discord 訊息會進 agent 對話流程。
- `/reset`、`/stop` 操作使用者自己的 session/query。
- `/status`、`/cost`、`/cache status`、`/cache efficiency` 是讀取型診斷。
- `/close`、`/sync`、`/restart`、`/sessions`、`/cache flush` 是維護型操作。
- `/model [agent] [to]` 是既有模型切換入口；保留，但切換必須 operator-only。

### Config plane

- `.env`、雲端 env、`data/claudecab.local.json`：全域 runtime、主 Bot、DB、schedule、session、cache。
- `agents/<id>/agent.json`：agent 名稱、Discord token/channel、預設模型、permission mode。
- `agents/<id>/.claude/settings.local.json`：Claude Code/agent-sdk 實際 provider/model/env。
- `agents/<id>/schedules/*.yaml`：schedule workflow，已支援 watch reload。

### Setup support

- `docs/SETUP.md` 是人工安裝主文件。
- `npm run setup:check` 做靜態設定檢查。
- `npm run setup:verify` 做本機前置驗證。
- `npm run discord:check -- --agent <id> [--thread]` 做真實 Discord 實連測試。
- Docker path 已可建置與 smoke test，但 production Windows chain 仍由 Task Scheduler + VBS + `start.ts` 管。

## 2. Target Shape

### 2.1 Operator gate

一個共用 operator helper，所有敏感 Discord 入口都呼叫同一個判斷：

- Source of truth：`config.discord.ownerUserId` / `DISCORD_OWNER_USER_ID`。
- 無 owner 設定時：所有敏感操作拒絕。
- 拒絕訊息：ephemeral，明確說需要 operator。
- 不依賴 Discord guild Administrator 作為唯一安全線。

敏感入口清單：

- `/restart`
- `/close`
- `/sync`
- `/sessions`
- `/sessions` 產生的 `sess:*` buttons
- `/cache flush`
- `/model [agent] [to]`
- 未來 reload/start/stop agent 或 admin console trigger

### 2.2 Minimal admin console

後台只做架設與維運，不做聊天功能。

建議模組：

- `src/admin/AdminServer.ts`：小型 HTTP server，預設只綁 `127.0.0.1`。
- `src/admin/AdminServer.ts` 內建 bearer token 驗證；token 走 config，不硬寫。
- `src/admin/AdminConfigService.ts`：讀寫 allowlist 內的設定檔。
- `src/admin/AdminCommandRunner.ts`：呼叫既有 setup check/verify。
- `src/admin/AdminRestartService.ts`：和 `/restart` 一樣先 build/check，再 `process.exit(0)` 交給 supervisor/container 重啟。
- `src/admin/AdminHtml.ts`：embedded 極小 HTML/CSS/JS，不引入大型前端框架，也不需要額外 build/copy assets。

預設安全策略：

- 預設關閉：`ADMIN_CONSOLE_ENABLED=false`。
- 預設 bind localhost：`ADMIN_CONSOLE_HOST=127.0.0.1`。
- 對外部署必須由 reverse proxy / cloud auth / tunnel 保護。
- GET response 一律 mask secrets。
- POST 只接受 allowlist 欄位。
- 不支援任意檔案瀏覽。
- 不做多角色、多 scope、多租戶。

### 2.3 Admin console screens

維持很小，建議四頁以內：

1. Overview
   - runtime status
   - active agents
   - setup check summary
   - restart button

2. Global config
   - Discord main bot ids/token 狀態，token 只顯示是否存在
   - DB path
   - schedule/session/cache 常用開關
   - admin console bind/auth 狀態

3. Agents
   - `agent.json` 常用欄位
   - `.claude/settings.local.json` provider/model/env 常用欄位
   - token/key 欄位 masked
   - agent-level validation

4. Diagnostics
   - setup:check
   - setup:verify quick subset
   - Discord check 指令產生器，不自動送出
   - troubleshooting checklist

## 3. Dynamic Config Rules

設定變更不要全部硬重啟，但要清楚分類。

| 類型 | 動態套用 | 建議行為 |
|---|---:|---|
| `schedules/*.yaml` | 是 | 已 watch reload |
| `/model [agent] [to]` | 部分 | 寫入 agent `.claude/settings.local.json` 後 reload agent config；既有 SDK session 可能要 close 後才完整生效 |
| `agent.json` display/name/model | 部分 | reload agent config；已啟動 Bot token/channel 變更建議重啟 |
| Agent Discord token/channel | 否 | 建議重啟或後續做 explicit agent restart |
| `.env` / cloud env / local config overlay | 否 | 重啟 |
| DB path / main bot token / guild/client id | 否 | 重啟 |
| session/cache 策略 | 部分 | 新 session 可套用；既有 SDK process 不保證立即更新 |

UI 要顯示「此變更是否需要 restart / close sessions / reload agent」，不要讓使用者猜。

## 4. Deploy Skill

目標：讓使用者可以把整包 ClaudeCab 丟給 AI，AI 能按規則完成本機或雲端部署，不亂改程式碼、不印 secret、不把 Discord 當設定後台。

建議位置：

```text
.agents/skills/claudecab-deploy/
  SKILL.md
  references/
    local-windows.md
    docker.md
    cloud.md
    config-matrix.md
    admin-console.md
    troubleshooting.md
    verification.md
```

Skill 必須要求 AI：

- 先讀 `README.md`、`docs/SETUP.md`、`AGENTS.md`。
- 只修改必要設定檔，不重構 core。
- 先判斷 Claude 認證模式：Claude Code OAuth、Anthropic API key、第三方 provider/proxy。
- 不在回覆中印出 token/key。
- 先跑 `npm run setup:check`，再跑 `npm run setup:verify`。
- 真實 Discord 測試只能在使用者明確同意後跑 `npm run discord:check`。
- 若要改 settings，優先使用 admin console 或檔案，不能讓一般 Discord 使用者改。
- 發現 secret 已進 git 歷史時停下來，列選項等使用者拍板。

Troubleshooting 必含：

- CLI not found / platform package missing。
- Authentication error：區分 OAuth、API key、provider proxy。
- Discord bot 無回應：token、intent、channel id、Bot 權限、logs。
- schedule 沒觸發：DB execution、catch-up window、timezone、yaml strict check。
- thread 有建立但 owner 沒通知：owner id、thread member add、mention delivery。
- V2 resume empty/no usable response：保留 session id、不要自動 fallback 造成高成本 duplicate query。
- Docker/container：volume、env、OAuth 不會自動繼承主機登入狀態。

## 5. Implementation Packages

### ADM-A: Operator gate hardening

- 新增共用 operator helper。
- 敏感 Discord 指令統一使用 helper。
- 恢復既有 `/model [agent] [to]` 入口，但切換行為 operator-only。
- 更新 tests 與 SETUP。

驗證：

- `npm run typecheck`
- `npm run lint`
- `npm run test:run`

### ADM-B: Admin console contract

- 新增 `docs/audit/admin-console-contract.md`。
- 定義 config allowlist、secret masking、restart contract、dynamic reload rules。
- 已完成。

### ADM-C: Minimal admin server skeleton

- 新增 disabled-by-default admin server。
- 加 config parsing。
- 提供 health/status GET。
- 已完成，包含 embedded UI 與 token-protected API。

### ADM-D: Config editing allowlist

- 支援安全讀寫 runtime local config overlay 的 allowlist。
- 支援 `agent.json` 常用欄位。
- 支援 `.claude/settings.local.json` provider/model/env。
- 所有 secret masked。
- 已完成。

### ADM-E: Validation and restart

- 後台可觸發 setup check / selected verify。
- restart button 使用與 `/restart` 相同策略：先 build/check，再 `process.exit(0)`。
- 保留 rollback：admin console 可關閉，production start chain 不改。
- 已完成。

### ADM-F: Deploy skill

- 建立 `docs/skills/claudecab-deploy/`。
- 加 local/docker/cloud/troubleshooting references。
- 用現有 setup scripts 作為唯一驗證命令來源。
- 已完成第一版。

## 6. Non-goals

- 不做大型 dashboard。
- 不做 Discord 內設定 wizard。
- 不做多租戶或細分 RBAC scope。
- 不替換 Task Scheduler + VBS + `start.ts`。
- 不把 secrets commit 進 repo。
- 不新增 `@anthropic-ai/sdk`。

## 7. Open Decisions

- Admin console 採用 `data/claudecab.local.json` 作為可寫 config overlay，避免 Docker/cloud 無法持久改容器內 `.env`。
- Docker/cloud 上 restart button 採取與 `/restart` 一致語意：build check 後 process exit，交給 supervisor/container/platform 拉起。
- 是否把 `/cost`、`/cache status`、`/cache efficiency` 也改成 operator-only，避免第三方看到成本/資源診斷。
