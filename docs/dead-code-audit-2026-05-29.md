# Dead Code / Chicken-Rib Audit — 2026-05-29

掃描方式:在 Opus 主迴圈直接 grep + 讀檔驗證(非 workflow / 非小模型)。每筆「dead」結論都附 grep 證據(呼叫次數、唯一引用位置)。confidence 只在「grep 證明零 live consumer」時標 high。

範圍:`src/**`、`agents/_foundation/hooks/runtime-config.json`。

---

## A. 已移除(本 session 已 commit)

| Commit | 內容 |
|---|---|
| `c1f9851` | src/core 重組進子目錄 + 真刪 Activity/EventBus-era 模組、tts、task tool、group repos、ContextInjector 等 |
| `311b9c1` | 空殼 service(TTSService/TaskService/BudgetService)、ActivityService interface + 9 noop call、dead config keys、~13 unused exports |
| `47ca0d1` | ActivityEventService 整條線、ExecutionRecordRepository + execution_records 表、message:sent listener、OperationalEvent type、keepaliveMissLastAlertAt 死 thread |

---

## B. 本輪新發現 — ✅ 已移除(2026-05-29 第二批 commit)

> B1–B6 全數刪除完畢、`npm run typecheck` 綠。C1（PathValidator）一併移除。
> **注意兩點**:
> 1. lifecycle / instance / persistence / error 四個 category **整類清空**（grep 證實 0 emit）。日後若要接 startup/shutdown/crash/unhandled-rejection 記錄，需在 `events.ts` 重新宣告。
> 2. `SDK_HOOK_CB_USER_PROMPT_SUBMIT` / `SDK_HOOK_CB_STOP` 是從未接線的觀測 stub（見 memory `sdk-callback-hook-invisibility`），一併刪除；若日後補 UserPromptSubmit/Stop callback 的 `logger.info` 記錄，需重新宣告這兩個常數。
> 3. ARCHITECTURE.md 的 PathValidator / ContextInjector / ActivityService 殘留條目，與 governance 變更一起在下一個 commit 後做一次性 doc-sync。

（以下為移除前的原始證據，保留供查。）

## B. 本輪新發現 — 原始清單（high confidence）

### B1. `src/utils/sdkResult.ts` — 整檔死
- **證據**:`classifySdkResult` + `SdkResultUsage` + `SdkResultOutcome` 三個 export,全 codebase **零外部引用**;唯一提及是 `src/utils/events.ts:107` 的一句**註解**(`// classifySdkResult ...`),不是呼叫。
- **kind**:orphan-file(整檔)
- **blast radius**:刪 `src/utils/sdkResult.ts` + 清掉 events.ts:107 那句過時註解。
- **confidence**:high

### B2. `buildV1IntermediateMessageCallback` — StreamResponseRouter.ts:138
- **證據**:0 個呼叫者(只剩定義)。V1 chat 路徑已收斂掉,只剩 V2(使用者)+ V1(排程),而排程不走這個 intermediate-message callback。
- **kind**:unreachable / dead V1-chat remnant
- **blast radius**:刪該 function(~50 行)。順帶檢查同檔 `buildV1*` 系列有無其他 V1-chat-only 殘留。
- **confidence**:high

### B3. `extractSubAgentEvent` — SDKStreamProcessor.ts:143
- **證據**:`export function extractSubAgentEvent(_msg: any): null { ... }` 本體就是回傳 null 的 stub,且 0 呼叫者。sub-agent 訊息處理早已改走 `extractSystemTaskText`(見 memory `v2-sdk-stream-replay`)。
- **kind**:dead stub
- **blast radius**:刪該 function。
- **confidence**:high

### B4. `findJsonlBySessionId` — CacheAnomalyAnalyzer.ts:338
- **證據**:0 呼叫者。同檔的 `scanRecentJsonlFiles → analyzeJsonl → parseJsonl → extractContentText` 鏈是**活的**(被 DiscordCacheAnomalyReport 每日 cron 用),但 `findJsonlBySessionId` 是獨立 leaf,沒人用。
- **kind**:unused export
- **blast radius**:刪該 function。
- **confidence**:high

### B5. `resetEventBus` (EventBus.ts:197) + `resetAdapterRegistry` (AdapterRegistry.ts:182)
- **證據**:唯一引用是 `src/core/index.ts` 的 barrel re-export;**專案沒有任何 tests 目錄 / `*.test.ts`**,這兩個 test-only 重置助手沒有任何 test 在用。
- **kind**:test-only helper without tests
- **blast radius**:刪兩個 function + 從 core/index.ts barrel 移除 re-export。低風險。
- **confidence**:high(但若計畫近期補測試,可保留)

### B6. 67 個未使用的 `EventType` 常數(共 175 個中)
- **證據**:逐一 grep `EventType.<KEY>`,67 個 key 是「定義了但從沒 emit」。含已移除功能的殘留(`LIFECYCLE_HEARTBEAT*` ← HeartbeatService 已刪、`GOVERNANCE_RETIRED_PATH_ACCESS`/`GOVERNANCE_SESSION_SUMMARY` 等)+ 大量從沒接上的 aspirational id(`ADAPTER_SEND_BEGIN`、`PLATFORM_CONNECTED`、`SCHEDULE_TICK`、`SESSION_LOCK_*`、`ORCHESTRATOR_*`…)。
- **kind**:orphan event ids
- **blast radius**:`src/utils/events.ts` 的 EventType map 砍 67 個 entry(純字串常數,無下游)。建議刪前再跑一次本清單重驗(避免剛好有動態組字串引用,目前看是靜態 `EventType.X` 用法)。
- **confidence**:high(string 常數,風險極低)
- 完整 67 個清單見本次 audit grep 輸出(LIFECYCLE_*, INSTANCE_LOCK_*, ADAPTER_*, PLATFORM_*, MESSAGE_*, AGENT_*, SDK_HOOK_CB_USER_PROMPT_SUBMIT/STOP, SESSION_LOCK_*/DEDUP_MARKED, ORCHESTRATOR_*, SCHEDULE_TICK/EXECUTION_*/NOTIFIER_*, GOVERNANCE_SESSION_SUMMARY/RETIRED_PATH_ACCESS/REPEATED_FAILURE/STOP_HYGIENE_*, ADAPTER_DISCORD_*_LISTENER_STARTED, PERSISTENCE_*, CACHE_HEARTBEAT_SNAPSHOT/SESSION_EVICTED/SESSION_RESTORED/KEEPALIVE_ERROR, ERROR_UNHANDLED_REJECTION/UNCAUGHT_EXCEPTION)。

---

## C. 先前發現、尚未動作(carry-forward)

### C1. `src/core/lib/PathValidator.ts` — 整檔死
- 完整的 workspace 隔離器(讀寫限自己 workspace / 讀 foundation / 寫自己 namespace),**但從沒被 `new`**。唯一引用是 core/index.ts barrel re-export(`CronScheduler.ts:49` 的 `.validate()` 是 cron 套件,不是它)。
- 與 `hardBlocks` 關係:概念上是 hardBlocks 的「完整版」,但因為太嚴(會擋 `_foundation`/`_example` additionalDirectories)被擱置。**目前唯一活的 path 寫入防線是 hardBlocks**。
- **建議**:當死碼刪掉(整檔 + barrel export)。除非要復活它取代 hardBlocks(需先放寬規則,較大工程)。

### C2. `ContextUsageTelemetry` + `query_metrics.contextUsageJson` 欄位
- `collectContextUsageSnapshot` 算出超細的 context token 拆帳 → 只 `logger.info()` + 序列化進 `query_metrics.contextUsageJson` 欄位,**該欄位沒有任何 SELECT 讀回**。`/ctx` 顯示的是即時簡化版,不是這份。
- **選項**:(a) 整個拆掉(telemetry-no-consumer);或 (b) 把明細接到 `/ctx` 之類有出口的地方讓它變有用。**待 user 決定**。

### C3. `query_metrics` 其他 write-only 欄位
- `context_total_tokens`、`context_percentage`、`turn_type`(恆 'query')、per-row `sdk_session_id` 等欄位寫進去但沒人聚合/SELECT。低風險(留著無害),schema 可瘦身,但要 DB migration。**待評估**。

---

## D. 設計決策待拍板(非死碼,勿當死碼刪)

### D1. hardBlocks / governance telemetry / contextEconomy 三系統糾纏
`SDKSessionFactory` 的 PreToolUse/PostToolUse hook 裡三者共用 `managed.governance` state:
- **hardBlocks**:真 enforcement,擋寫入 `_shared/` 退役路徑 + 擋 `output/` 變成 repo/build tree(`.git`/`package.json`/`npm install`)。`createPreToolDeny` 真的 deny。**唯一活的 path 寫入防線。**
- **governance telemetry**:純軟性觀察 — 路徑分類、validator/broad-search/archive/指令失敗追蹤 → 推 Discord「X observed」+ 回合末 summary 卡片。不 enforce。
- **contextEconomy**:**也含真 enforcement** — 擋超大無界 Read(`SDKSessionFactory.ts:465`)、擋 main-context web 工具逼 delegate scout(`:486`)+ 探索預算提醒。

**待 user 回答的範圍問題**:砍 governance 時,contextEconomy 的真護欄要不要保留?(user 上次的回覆是反問「hardBlocks 是不是只剩零星功能、別處有沒有類似」→ 已查證:類似的是 dead 的 PathValidator,hardBlocks 是唯一活防線。**決定尚未下**。)

---

## E. 查過、確認是「活的」— 勿誤刪

- **STT**(`src/core/stt/*`、`createSTTProvider`、`GroqSTTProvider`):完整 wire(AppBootstrap → DiscordAdapter → DiscordMessageHandler.transcribe)。預設 `STT_ENABLED=false` 的 opt-in,不是死碼。
- **CacheAnomalyAnalyzer 掃描鏈**(`scanRecentJsonlFiles`/`analyzeJsonl`/`parseJsonl`/`extractContentText`):被 DiscordCacheAnomalyReport 每日 cron 用。活。(只有 `findJsonlBySessionId` 是死 leaf → B4)
- **SDKQueryManager / V1 path**:V1 manager 本身被 ScheduleExecutor(排程路徑)用,活。死的只有 V1 *chat* 的 `buildV1IntermediateMessageCallback`(→ B2)。
- **UsageAnomalyDiagnostics / SDKTranscriptDiagnostics / updateCacheEfficiency**:有 live consumer(QueryExecutor embed / keepalive),活。
- **ConfigTransformer**(11 refs)、**restoreContextFromJsonl**(6)、**playSound**(5):活。

---

## 建議執行順序(都是低風險機械刪除,可一個 commit)

1. B1 `sdkResult.ts` 整檔 + events.ts 註解
2. B2 `buildV1IntermediateMessageCallback`
3. B3 `extractSubAgentEvent`
4. B4 `findJsonlBySessionId`
5. B5 `resetEventBus` + `resetAdapterRegistry` + barrel
6. B6 67 個 EventType 常數
7. C1 `PathValidator` 整檔 + barrel(若確定不復活)

每步後 `npm run typecheck`,全綠再 commit。C2/C3/D1 需 user 決定後再動。
