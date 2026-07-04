# SDK Touchpoints

日期：2026-07-04  
工作包：WP-C SDK 接觸面登記與客製降級  
目前安裝版本：`@anthropic-ai/claude-agent-sdk@0.2.119`  
狀態：盤查完成；WP-C code 處置完成；本文件是 SDK/CLI 升級前必讀清單。

## 基本規則

- 本專案禁止使用 `@anthropic-ai/sdk`，只允許 `@anthropic-ai/claude-agent-sdk`。
- SDK 升級前先讀本文件，再讀 `docs/sop-sdk-cli-upgrade.md`。
- 不從 type definition 推測 SDK stream/JSONL 形狀；升級時要看 `logs/` 實際事件或跑 canary。
- `scripts/patch-sdk-v2.cjs` 是目前最大客製點。patch 失敗時不准硬改 node_modules，必須更新 patch script 並跑驗證。

## 目前 SDK import 盤點

| 檔案 | 用途 | 風險 |
|---|---|---|
| `src/types/sdk.ts` | SDK type re-export 雛形 | 應作為防腐層候選。 |
| `src/core/session/SDKSessionFactory.ts` | `unstable_v2_createSession` / `unstable_v2_resumeSession` | 高，直接依賴 unstable API。 |
| `src/core/session/SDKSessionTypes.ts` | `SDKSession` / `SDKMessage` / patched option type | 高，記錄 patched SDK contract。 |
| `src/core/query/QuerySdkRunner.ts` | SDK `Options` / MCP server type | 中，應改經由防腐層 re-export。 |
| `src/core/query/types.ts` | SDK `Options` / MCP server type | 中，應改經由防腐層 re-export。 |
| `src/core/subagents/foundationSubagents.ts` | `AgentDefinition` / `PermissionMode` | 中，應改經由防腐層 re-export。 |
| `src/tools/sendFileTool.ts` | `createSdkMcpServer` / `tool` | 中，工具層直接 import SDK。 |
| `src/tools/validatorTool.ts` | `createSdkMcpServer` / `tool` | 中，工具層直接 import SDK。 |
| `src/adapters/discord/discordUtils.ts` | `query` | 待確認是否仍使用；若無 caller，WP-D 死碼清理。 |

## 實際 log evidence

盤查時已在 `logs/` 看到以下真實事件形狀：

- V2 stream system event：`msgType=system`，`msgSubtype=task_started` / `task_notification` / `task_progress`。
- V2 hook event：`event_type=sdk.hook_started`，`hookEvent=UserPromptSubmit` / `Stop`。
- Sub-agent cache event：`event_type=sdk.subagent_turn_cache`，包含 `turnModel`、`cacheCreation`、`cacheRead`。

升級時若這些形狀消失或欄位變名，`SDKStreamEventHandlers`、`SubAgentMessageManager`、usage/cache 診斷會受影響。

## Touchpoint Register

| ID | 接觸面 | 位置 | 引入版本 / 背景 | 存在原因 | 上游 issue | 升級驗證 | 退場條件 |
|---|---|---|---|---|---|---|---|
| SDK-001 | V2 createSession option forwarding patch | `scripts/patch-sdk-v2.cjs`, `package.json` postinstall | 0.2.119；0.2.110 已修 `cwd` / `settingSources`，但 0.2.119 仍漏其他 flags | V2 persistent session 需要 `extraArgs`、`thinking`、`maxTurns`、`maxBudgetUsd`、`includeHookEvents`、`includePartialMessages`、`agentProgressSummaries`、`mcpServers`、`systemPrompt`、`agents`、`skills`、`forwardSubagentText` | 待補 upstream issue URL | `node scripts/patch-sdk-v2.cjs` 必須顯示目標版本且 fully patched；sandbox 跑 SOP patch lab | 上游公開 V2 API 原生轉發全部欄位，patch canary 反向失敗後刪除 postinstall |
| SDK-002 | SDK 版本 range 未 pin | `package.json`, `package-lock.json` | 目前 package.json 是 `^0.2.119` | caret 可能讓 `npm install` 帶入未驗證 SDK，patch anchor 失效或 silent 行為變更 | 不適用 | `npm list @anthropic-ai/claude-agent-sdk --depth=0`；確認 package.json 無 caret | SDK 升級 SOP 改成明確 commit 升版，平時保持 exact version |
| SDK-003 | Unstable V2 create/resume API | `src/core/session/SDKSessionFactory.ts` | V2 persistent session 導入時 | 需要長駐 CLI process、prompt cache、resume JSONL | 待補 upstream issue URL | 真實一來一回、重啟後 resume、schedule thread resume | SDK 提供 stable session API 並移除 unstable namespace |
| SDK-004 | Patched session option contract | `src/core/session/SDKSessionTypes.ts`, `src/core/session/SDKSessionOptions.ts` | 跟 SDK-001 同源 | TypeScript SDK types 不完整，ClaudeCab 需要自定 `ExtendedSessionOptions` | 待補 upstream issue URL | typecheck + canary 驗證 options 實際生效：hook events、MCP、systemPrompt、agents | SDK 公開 types 覆蓋目前所有欄位 |
| SDK-005 | Agent-local auth/env redirection | `src/core/session/SDKSessionOptions.ts` | 多 provider / API-key agent 支援 | 透過 agent `.claude/settings.local.json` 決定 `CLAUDE_CONFIG_DIR`、`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL` | 不適用 | 用 API-key agent 跑一次 query；確認 JSONL 寫入 agent-local `.claude/projects` | 若 SDK 提供正式 per-session config dir / credentials API |
| SDK-006 | CLI path override and SEA layout fallback | `src/core/session/SDKSessionOptions.ts`, `src/utils/cliPath.ts` | Claude Code CLI 2.1.119+ SEA binary layout 變更 | `CLAUDE_CLI_PATH` 可能指到舊 cli.js；需 fallback 到平台包、global package、shim | 不適用 | 設錯 `CLAUDE_CLI_PATH` 後應 resolve 到可執行 `claude.cmd`/`claude.exe` 並記 log | SDK 自行穩定解析 CLI path，或不再需要外部 CLI override |
| SDK-007 | Stream readiness / stale replay handling | `src/core/query/SDKStreamProcessor.ts` | V2 resume stream 會先吐 replay / init event 不穩 | resume 後需等 `system:init`、assistant fallback 或 timeout 才開始送使用者可見內容 | 待補 upstream issue URL | 重啟後 resume；logs 應有 streamReady 或 assistant fallback | SDK stream 標明 replay vs live event |
| SDK-008 | Pre/post result drain | `src/core/query/SDKStreamDrain.ts`, `src/core/session/SDKSessionInternals.ts` | V2 queryIterator 可能在 result 後仍有尾訊息 | 防止下一輪吃到上一輪 residual messages，避免空回應/錯序 | 待補 upstream issue URL | 長工具鏈 query 後下一則訊息不應先出 stale result；logs 無 empty/zombie | SDK stream 在 result 後保證 drain 完成或提供 official drain API |
| SDK-009 | Internal session fields | `src/core/session/SDKSessionInternals.ts` | SDK 未公開 queryIterator / Query interrupt object | `/stop` 與 drain 需要 `(session as any).queryIterator`、`(session as any).query.interrupt()` | 待補 upstream issue URL | `/stop` graceful interrupt；queryIterator drain canary | SDK 公開 `interrupt()` 與 stream drain/flush API |
| SDK-010 | Interrupt cancellation classification | `src/core/query/QuerySdkRunner.ts`, `src/core/session/SDKSessionOperations.ts`, `src/core/session/SDKSessionLifecycle.ts` | V2 interrupt 可能被包成 cancelled / aborted / `ede_diagnostic stop_reason=tool_use` | `/stop` 後保留 sdkSessionId，不誤判成可 retry 的一般錯誤 | 待補 upstream issue URL | `/stop` 中斷 tool_use 中的 query；下一則可 resume | SDK 回傳穩定 cancellation error code |
| SDK-011 | Empty stream / zombie / broken resume guards | `src/core/session/SDKSessionManager.ts`, `src/core/query/QueryExecutor.ts`, `src/core/query/QuerySdkRunner.ts` | V2 process 可能無 output、stream instant done、resume identity error | 防止 duplicate high-cost fallback；schedule handoff fail-closed，一般聊天只在安全條件 fresh retry | 待補 upstream issue URL | 斷掉的 resume 要出明確錯誤；普通聊天 fresh retry 不影響 schedule thread | SDK 提供可判斷的 resume failure code 與 process health API |
| SDK-012 | Hook callback state bridge | `src/core/session/SDKSessionFactory.ts`, `src/core/interaction/*Bridge.ts` | V2 session hooks 建立時閉包固定，但每輪 query callbacks 不同 | hook closures 透過 `managed.currentOptions` 取當輪 callbacks，支援 permission/question/exit-plan/pre-compact UI | 待補 upstream issue URL | UserPromptSubmit、PreToolUse permission、PreCompact event 在 Discord 正常顯示 | SDK hook callback 可 per-send 註冊或更新 |
| SDK-013 | Hook stream event logging | `src/core/query/SDKStreamEventHandlers.ts`, `src/utils/events.ts` | 需要觀測 `hook_started` / `hook_progress` / `hook_response` | SDK callback 是否觸發與 stream 是否 emit 是除錯核心 | 不適用 | logs 中可見 `sdk.hook_started` / `sdk.hook_response` | SDK 提供正式 tracing/diagnostic API |
| SDK-014 | Sub-agent system event parsing | `src/core/query/SDKStreamProcessor.ts`, `src/core/query/SubAgentMessageManager.ts`, `src/core/query/StreamResponseRouter.ts` | logs 實際看到 `system task_started/task_notification/task_progress` | Discord UI 需要把 Task/Agent 子代理 lifecycle 顯示為獨立訊息 | 待補 upstream issue URL | logs 有 `task_*` system subtype；Discord sub-agent message lifecycle 正常 | SDK 公開正式 sub-agent event schema |
| SDK-015 | Programmatic foundation subagents | `src/core/subagents/foundationSubagents.ts`, `src/core/session/SDKSessionOptions.ts` | 0.2.119 patch 轉發 `agents` / `skills` / `forwardSubagentText` | 把 repo foundation subagents 注入 SDK initialize payload | 待補 upstream issue URL | 啟動 query 時 log `sessionOpts.agents` 有 foundation agents；Task tool 可用 | SDK 原生支援穩定 agents/skills config |
| SDK-016 | MCP SDK server in-process bridge | `src/McpToolSetup.ts`, `src/tools/*.ts`, `scripts/patch-sdk-v2.cjs` | 0.2.119 patch 把 `mcpServers` 轉成 F9 `sdkMcpMap` | SDK MCP instance 有 circular refs，不能走 CLI `--mcp-config` JSON | 待補 upstream issue URL | validator/sendFile tool 在 V2 session 可呼叫 | SDK 原生支援 in-process SDK MCP server map |
| SDK-017 | Result usage/modelUsage delta parsing | `src/core/query/SDKStreamEventHandlers.ts`, `src/core/query/StreamHelpers.ts` | V2 result usage 是 cumulative，需要 delta | 計算 per-turn token/cost/cache、主模型/子代理模型拆分 | 不適用 | query metrics row 正確記錄 input/output/cache/cost/modelUsage | SDK 提供 per-turn usage event |
| SDK-018 | Prompt-cache TTL detection | `src/core/query/SDKStreamEventHandlers.ts`, `src/core/keepalive/*` | assistant usage `cache_creation.ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens` | keepalive interval 依實際 TTL 自動調整 | 不適用 | logs 出現 `sdk.cache_ttl_detected`；keepalive interval 調整 | SDK/API 直接提供 cache TTL metadata |
| SDK-019 | JSONL project hash / transcript diagnostics | `src/core/keepalive/SDKTranscriptDiagnostics.ts`, `src/core/session/SDKContextRestore.ts` | Claude Code JSONL 存在 `~/.claude/projects/<projectHash>/<session>.jsonl` | resume guard、keepalive anomaly、session diagnostics 需要讀 transcript | 不適用 | `getJsonlPath()` 指向實際存在 transcript；resume guard 可讀 token count | SDK 提供 transcript lookup / context estimate API |
| SDK-020 | JSONL sanitizer legacy workaround | `src/core/lib/JsonlSanitizer.ts` | 逆向 Claude Code C26 readFileState rebuild | 防止 Read/Write stale diffs 注入 system reminder；目前盤查未找到 caller | 不適用 | `rg sanitizeBeforeResume`；若無 caller，WP-D 可刪或歸檔 | 若確認無 runtime caller，移除；若仍需要，補 canary 和文件 |
| SDK-021 | OAuth usage API outside SDK stream | `src/services/OAuthUsageService.ts` | SDK stream 不提供 5h/7d 訂閱額度百分比 | 透過 Claude Code OAuth credentials 查 quota utilization | 不適用 | 有 OAuth credentials 時 usage command/guard 可取得 percentage | SDK 或 CLI 提供 official quota event |

## WP-C code 處置結果

1. `@anthropic-ai/claude-agent-sdk` 已 pin 到 `0.2.119`，`package.json` 不再使用 caret range。
2. `scripts/patch-sdk-v2.cjs` 已加 exact version guard，只允許 patch `0.2.119`，版本不符會 fail-fast 並提示讀本文件與 SOP。
3. 新增 `src/core/sdk/index.ts` 作為唯一 SDK facade；`src/` 內其他檔案不再直接 import `@anthropic-ai/claude-agent-sdk`。
4. `eslint.config.js` 已加 `no-restricted-imports`，只允許 `src/core/sdk/**/*.ts` 直連 SDK package。
5. `src/types/sdk.ts` 保留為相容 re-export，但來源已改成 `src/core/sdk/index.ts`。

## WP-C 後續 code 處置清單

1. 建立 canary tests 的骨架留給 WP-I：patch anchors、stream task event、interrupt marker、JSONL transcript path。
2. `SDK-020` `JsonlSanitizer` 目前盤查未找到 caller；WP-D 死碼清理時決定刪除或歸檔。
3. 將待補 upstream issue URL 補齊；沒有公開 issue 的 workaround 需在 SOP 中明確標「內部驗證」。

## 本次盤查命令

```bash
npm list @anthropic-ai/claude-agent-sdk --depth=0
rg -n "@anthropic-ai/claude-agent-sdk|claude-agent-sdk" package.json src scripts tests docs/sop-sdk-cli-upgrade.md
rg -n -i "workaround|hack|patch|FIXME|TODO.*sdk|issue #|interrupt|abort|includeHookEvents|includePartialMessages|agentProgressSummaries|forwardSubagentText|StopHook|Subagent|sub-agent|hook event|empty response|empty stream|zombie|resume" src scripts package.json docs/sop-sdk-cli-upgrade.md
rg -n "sdk\\.hook_started|SDK_HOOK|subagent|task_|empty response|empty stream|zombie|interrupt|Authentication error|resume failed|JSONL tail" logs -g "*.log" -g "*.jsonl" -m 20
node scripts/patch-sdk-v2.cjs
```
