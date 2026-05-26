# Pipeline Unification — A 方案（全部走 V2）遷移計畫

**建檔**：2026-04-25
**狀態**：PLAN ONLY — 尚未實作
**決策根據**：User 選擇 A 方案 @ 2026-04-25 session
**相關背景**：`docs/conversation-pipeline-fragmentation.md`
**符合 SOP**：`docs/sop-sdk-cli-upgrade.md`（此為姊妹文件，immutable 日期版本命名）

---

## 背景

當前專案有**四個獨立 SDK 呼叫器**（schedule 是 V1 的外殼，不算獨立）：

| # | Pipeline | 入口 | SDK 呼叫方式 |
|---|---------|------|-------------|
| 1 | V2 persistent session | `src/core/SDKSessionManager.ts` | `unstable_v2_createSession` + patched sdk.mjs |
| 2 | V1 stateless query | `src/core/SDKQueryManager.ts` | 直接 `query()` |
| 3 | Schedule executor | `src/schedule/ScheduleExecutor.ts` | 走 (2) |
| 4a | Initiative evaluator | `src/core/InitiativeEvaluator.ts` | 直接 `import { query }` |
| 4b | Social evaluator | `src/core/SocialEvaluator.ts` | 直接 `import { query }` |
| 5 | Reaction generator | `src/core/ReactionGenerator.ts` | 直接 `import { query }` |

每次加新 SDK option（`includeHookEvents`、`CLAUDE_CLI_PATH`、`agentProgressSummaries`）就漏接 N 次。最近一次 2026-04-25 排程半夜爆 `Native CLI binary not found` 就是 V1 沒接 `CLAUDE_CLI_PATH`。

**選擇 A 方案的意義**：所有 conversation 統一走 V2 `unstable_v2_createSession`。V1（SDKQueryManager）長期保留作 emergency fallback，但 primary path 全部切 V2。

---

## 為何 A 而非 B / C / D

| 選項 | 為何不選 |
|------|---------|
| B（抽 ConversationService facade） | User 的架構直覺是「就算是排程也都是對話功能，應該由一個 core module 管理」。Facade 還是有兩份實作藏在後面，沒解決根本的「新 option 要改幾個地方」問題。只是把問題藏起來。 |
| C（V1 變 V2 薄殼） | 與 A 幾乎等價，但 V1 還在 codebase，心智負擔沒減。 |
| D（強制 util 共用） | 這是今天做的事（`src/utils/cliPath.ts`）。會繼續發生漏接 — 治標不治本。 |

**A 的代價（必須承受）**：
- V2 每次 create 都 spawn 新 CLI process → cold start 2-3s / 次
- Evaluator（Haiku，短 prompt）原本走 V1 幾百毫秒就回，切 V2 會明顯變慢
- 一天 N 次 evaluator / reaction → spawn 量大

**緩解方向**（不在本次 scope，但列入 future work）：
- **Session pool**：V2 session 以 agent 為 key 緩存一段時間（5-10 分鐘 TTL），短時間內重複 evaluator / reaction 可以 resume
- **Lazy close**：evaluator / reaction 用完不立刻 close，留 idle timer，有下個 request 就 reuse
- 目前 scope：先**正確切過去**，效能優化 Phase 6 再談

---

## 不變量（貫穿所有階段）

| # | 不變量 | 違反後果 |
|---|--------|---------|
| 1 | **V1 保留不刪** | rollback 需要 V1 作安全網；Phase 6 之後才討論刪不刪 |
| 2 | **每階段一條 pipeline**：同一個 commit 不切兩條 | rollback 粒度 = 一條 pipeline |
| 3 | **Feature flag 控制切換**：`PIPELINE_V2_<kind>` env var（`schedule` / `evaluator` / `reaction`），預設 `false`（走舊路） | 單條爆了能 env 切回 V1 不需 revert commit |
| 4 | **Production restart 永遠 user 動作**：agent 不自動重啟 bot | Safety Valve 第 2 類 |
| 5 | **每階段 smoke test 先過再切**：每條 pipeline 對應一個 `docs/upgrades/tests/test-pipeline-v2-<kind>.mts` | 未經驗證的切換 = 押寶 production |
| 6 | **Cost metrics 觀測 ≥ 24 小時才下一階段**：切一條觀察，token 消耗 / latency / error rate 有基線 | 連鎖爆炸檢測需要時間窗 |
| 7 | **Patch 規範繼承**：若需要新 patched sdk.mjs 改動，依舊走 `scripts/patch-sdk-v2.cjs` + anchor + Origin/Last-modified 註解 | 破壞 SOP |

---

## 影響面盤點

### Code 層面

| 檔案 | 改動性質 |
|------|---------|
| `src/core/InitiativeEvaluator.ts` | Phase 3 — 改 V2 single-turn |
| `src/core/SocialEvaluator.ts` | Phase 3 — 改 V2 single-turn |
| `src/core/ReactionGenerator.ts` | Phase 4 — 改 V2 single-turn |
| `src/schedule/ScheduleExecutor.ts` | Phase 5 — 改呼 V2 session（one-shot + thread persist 兩種模式） |
| `src/core/SDKQueryManager.ts` | 保留，加註解「emergency fallback only」；Phase 6 才討論刪 |
| `src/core/SDKSessionManager.ts` | Phase 2 — 補 single-turn helper（see 下節） |
| `src/utils/cliPath.ts` | 已存在，所有新 caller 都透過這裡 |
| `src/utils/events.ts` | 新增 `PIPELINE_V2_FALLBACK: 'pipeline.v2_fallback'` 等 event |

### 新增 helper（Phase 2 準備）

在 `SDKSessionManager` 加一個 `runSingleTurn()` 方法：

```ts
/**
 * One-shot V2 session — create → send → await result → close.
 * For stateless callers (evaluator, reaction, non-thread schedule).
 * Does NOT cache the session; does NOT reuse; does NOT emit activity events
 * (those are user-facing; evaluator runs silently).
 */
async runSingleTurn(
  agent: LoadedAgent,
  prompt: string,
  options: { model?: string; maxTurns?: number; tools?: string[]; abortController?: AbortController },
): Promise<{ responseText: string; usage: QueryUsage; sdkSessionId?: string }>
```

這個 helper 內部：
- 呼 `unstable_v2_createSession`（走同一份 patched sdk.mjs，吃 `CLAUDE_CLI_PATH`、`settingSources`、`mcpServers` 等）
- `session.send(prompt)` 後讀 `session.stream()` 拿 result
- 用 `classifySdkResult()`（Phase 2 時建的 util，#2 patch 已在 `src/utils/sdkResult.ts`）處理 non-success subtype
- `finally { await session.close() }` 確保資源釋放
- **不動**現有 `sendMessage()`（它是 persistent session 專用）

### 外部依賴 / config

- `.env` 新增 feature flag：`PIPELINE_V2_EVALUATOR=false` / `PIPELINE_V2_REACTION=false` / `PIPELINE_V2_SCHEDULE=false`
- 預設全部 `false`，保持現狀，等階段性打開
- Production 切換流程：flag 改 → 重啟 bot（user 手動）→ 觀察 24h → 下階段

---

## 分階段遷移計畫

### Phase 0 — Baseline metrics（零改動，24 小時）

**目標**：在切任何東西前，留下「當前系統」的效能 / 成本基線，切完後才有對照組。

**動作**：
1. 確認 `QueryMetricsRepository` 對每條 pipeline 都在記錄（evaluator / reaction / schedule）。若沒接就先補 metrics 記錄，但**不動 SDK 呼叫路徑**。
2. 做一份 baseline dashboard（grep log + jq）：
   - Evaluator：per-call input/output tokens, latency, success rate
   - Reaction：同上
   - Schedule：thread mode 跟 message mode 分開統計
3. 存 baseline snapshot 到 `docs/upgrades/2026-04-25-pipeline-unify-baseline.md`（immutable）

**驗證**：24 小時內至少收到各 pipeline 的樣本 n ≥ 20。

**Rollback 策略**：N/A（零改動）

---

### Phase 1 — Feature flag infrastructure（僅改動 config 讀取）

**目標**：加 env var 讀取機制，但**所有 flag 都是 `false`**，行為等同當前。

**動作**：
1. `src/config/featureFlags.ts` 新增：
   ```ts
   export const pipelineV2 = {
     evaluator: process.env.PIPELINE_V2_EVALUATOR === 'true',
     reaction: process.env.PIPELINE_V2_REACTION === 'true',
     schedule: process.env.PIPELINE_V2_SCHEDULE === 'true',
   };
   ```
2. `.env.example` 加三個新 flag（都 `false`）
3. 在 `LLMInitiativeEvaluator` / `LLMSocialEvaluator` / `ReactionGenerator` / `ScheduleExecutor` 的 constructor 接受 flag 注入（dependency injection，不直接讀 env）
4. 暫時沒有 V2 分支 — 只是把 flag 接線準備好

**驗證**：
- `npm run typecheck` 過
- bot 啟動 log 出現 `{ event_type: 'lifecycle.startup_complete', pipelineV2: { evaluator: false, reaction: false, schedule: false } }`

**Rollback 策略**：revert 該 commit（flag infra 單獨一 commit）

**不變量檢查**：
- [ ] flag 預設全 `false`
- [ ] 現有測試全過（baseline 74 pre-existing failures 不變）
- [ ] `npm run lint:logs:strict` 不報新 warning

---

### Phase 2 — Build `runSingleTurn()` helper（V2 單次對話原語）

**目標**：在 `SDKSessionManager` 加 `runSingleTurn()`，**目前沒有任何 caller 呼它**。只做實作 + 獨立 smoke test。

**動作**：
1. 實作 `runSingleTurn()`（見上節 signature）
2. 新增 `docs/upgrades/tests/test-pipeline-v2-single-turn.mts`：
   - 載入真實 agent（抓一個 evaluator 用的 Haiku agent）
   - 呼 `runSingleTurn(agent, '回答：pong')`
   - assert `responseText` 非空且 < 200 字、`usage.inputTokens > 0`
   - 跑 3 次，驗 session 確實被 close（process handle 數不爆）
3. 這個 helper **不呼叫 `onHookEvent`** — evaluator / reaction 不需要 hook 可視化，避免 Discord 雜訊

**驗證**：
- smoke test pass
- `node docs/upgrades/tests/test-pipeline-v2-single-turn.mts` 執行 10 次仍乾淨退出
- `ps` / handle count 切前切後一致

**Rollback 策略**：revert commit — 沒有 caller 依賴此 helper

**不變量檢查**：
- [ ] 新 helper 內部用 `resolveCliPath()`（即 `CLAUDE_CLI_PATH`）
- [ ] 新 helper 用 `classifySdkResult()` 處理 non-success
- [ ] session 在 `finally` 確保 close
- [ ] 不污染現有 `sendMessage()` / `SDKSessionManager` 公開 API

---

### Phase 3 — 切 Evaluator（風險最低：短 prompt、退讓 semantics）

**目標**：`LLMInitiativeEvaluator` / `LLMSocialEvaluator` 加 V2 分支。

**為何先切 Evaluator**：
- 失敗 semantics 已經是「退讓 → respond: false」（#2 patch 已做好）。V2 path 爆 = agent 暫時更沉默，不會 user-facing outage
- 頻率高但單次成本低（Haiku short prompt）
- 沒有 thread / persistSession 複雜度

**動作**：
1. Evaluator constructor 接受 `{ sessionManager?: SDKSessionManager, useV2: boolean }`
2. 在 `shouldRespond` / `shouldRespondSocially` 頂端分支：
   ```ts
   if (this.useV2 && this.sessionManager) {
     try {
       const { responseText, usage } = await this.sessionManager.runSingleTurn(agent, prompt, { model: this.model, maxTurns: 1 });
       // ...same parse logic
     } catch (err) {
       logger.warn({ event_type: EventType.PIPELINE_V2_FALLBACK, pipeline: 'evaluator', err });
       // fall through to V1 path
     }
   }
   // V1 path (unchanged)
   const q = this.queryFn({ prompt, options: {...} });
   ```
3. **關鍵**：V2 分支 throw → **fallback V1**，不讓 user-facing pipeline 連鎖爆
4. 加 smoke test `docs/upgrades/tests/test-pipeline-v2-evaluator.mts`

**Production 切換**：
1. Deploy Phase 3 code，flag 仍 `false`，bot 重啟 → 驗無 regression
2. 改 `.env`：`PIPELINE_V2_EVALUATOR=true`，bot 重啟
3. 觀察 24h：
   - `event_type: pipeline.v2_fallback` 數量 → 目標 < 1%
   - evaluator latency p50 / p95 跟 Phase 0 baseline 對比
   - token 總量 / 單次成本對比
   - 若 fallback rate > 5% → 立刻 `PIPELINE_V2_EVALUATOR=false` 回 V1，查根因

**Rollback 策略**：
- 一級：env flag `false`，重啟 bot（秒級）
- 二級：revert commit（分鐘級）
- 三級：package.json 鎖舊 SDK 版本 → 全線舊狀態

**Done-when**：
- 24h fallback rate < 1%
- latency p95 <= baseline * 1.5（evaluator spawn cost 可接受）
- cost 每次 <= baseline * 1.3（session create overhead）
- 無新 error log pattern

---

### Phase 4 — 切 Reaction Generator（同 Phase 3 pattern）

**動作**：與 Phase 3 完全同構。Reaction 的 parseResponse 在 JSON fail 時會 crash（本次也順手補 try-catch，但不擴大 scope）。

**Production 切換**：Phase 3 觀察期滿、metric 綠燈後再 deploy。

**Done-when**：同 Phase 3 指標。

---

### Phase 5 — 切 Schedule Executor（最複雜：thread mode / persistSession / retry / abortController）

**為何放最後**：
- Thread mode 本質就是 persistent session，V2 語意匹配但要搭 `threadMap.sdkSessionId` 追蹤
- Message mode 是 single-turn，但有 `onIntermediateMessage` callback / abortController / 5 次 retry
- `spec.execution.timeout` 跟 V2 session 的 timeout 要對齊

**動作**：
1. 在 `SDKSessionManager` 上加 `runPersistentTurn()` 變體，或 reuse 現有 `sendMessage()`（thread mode 可以直接把 schedule 視為普通 session）
2. `ScheduleExecutor` 分兩條 V2 路徑：
   - thread mode → V2 persistent session（session 存活、可 follow-up）
   - message mode → V2 runSingleTurn
3. retry 邏輯保留；timeout 對應 V2 的 abort 機制
4. `threadMap.sdkSessionId` 改從 V2 session 的 ID 拿
5. **大 smoke test**：`docs/upgrades/tests/test-pipeline-v2-schedule.mts` 模擬 thread mode + follow-up + retry

**Production 切換**：
- `PIPELINE_V2_SCHEDULE=true` 之前，**本地跑一次完整 schedule**（可以改 spec 設 5 分鐘後觸發）
- 確認 Discord thread 實際建出來、結果貼到 thread、follow-up 能回 session

**Done-when**：
- 跑過至少一輪 thread mode + 一輪 message mode 真實排程
- thread follow-up 能接上 V2 session（user 在 thread 內回訊息 → 走 V2 persistent，可回應）
- retry + abortController 行為沒退化

---

### Phase 6 — 清理 / 觀察（非本次 scope，用 flag 留一段時間）

不急著刪 V1。至少再留 **2 週**：
- 觀察有沒有罕見 edge case 打到 V1 fallback
- 有 2 週零 fallback 才開 issue 討論「要不要刪 V1 + `SDKQueryManager`」

---

## Known Risks / 未爆彈

| Risk | 影響 | 緩解 |
|------|------|------|
| V2 session cold start 讓 evaluator 變慢 | 群聊 initiative 反應變遲鈍 | Phase 3 觀察期驗證；若 p95 > baseline * 1.5 → 觸發 Session pool（future work） |
| V2 session 沒 close() 洩漏 | 記憶體 / process handle 累積 | `runSingleTurn` finally close；Phase 2 smoke test 驗 process handle 數 |
| `PIPELINE_V2_*` env 被誤寫 | 切到沒準備好的 V2 | flag 名 prefix 統一；bot 啟動 log 印實際讀到的值（operator 看 log 驗證） |
| V2 session 需要特定 MCP config，stateless 場景用不到 | 負擔變大 | `runSingleTurn` 只注入 `tools: []` 對應的 MCP subset；evaluator 本來就 `tools: []` |
| Schedule thread follow-up 的 session ID 格式改變 | 既有 thread mapping 失效 | Phase 5 做 migration：既有 thread 保留 V1 session ID，新建立的走 V2 |
| V2 用了 `patched sdk.mjs` 的 private fields，未來 SDK 大改可能連動 | 升 SDK 時 patch script 要連動 | SOP 已規範；Phase 2 helper 只用 public API，不碰 private |
| rate_limit_event 行為差異 | V1 V2 對 rate limit 的 surface 方式可能不同 | Phase 3 smoke test 裡刻意跑到 rate limit 驗證 |

---

## Feature Flag 設計細節

### 讀取

```ts
// src/config/featureFlags.ts
function bool(envVar: string): boolean {
  const v = process.env[envVar];
  return v === 'true' || v === '1';
}

export const pipelineV2 = {
  evaluator: bool('PIPELINE_V2_EVALUATOR'),
  reaction: bool('PIPELINE_V2_REACTION'),
  schedule: bool('PIPELINE_V2_SCHEDULE'),
} as const;
```

### 切換矩陣

| flag 組合 | 行為 |
|----------|------|
| 全 `false` | 等同今天（V1 / 直接 query） |
| `EVALUATOR=true`，其他 `false` | 只 evaluator 走 V2 |
| 逐步打開 | Phase 3 → 4 → 5 順序 |
| 全 `true` | 最終目標狀態 |

### Startup log

```ts
logger.info(
  { event_type: EventType.LIFECYCLE_STARTUP_COMPLETE, pipelineV2 },
  'Startup complete',
);
```

Operator 開啟 log 立刻看到 flag 實際狀態，避免「以為改了實際沒生效」。

---

## Done-when（整個 migration 完工條件）

- [ ] Phase 0 baseline 文件存在且 metrics 有 24h 樣本
- [ ] Phase 1-5 每階段對應 commit 各自獨立
- [ ] Phase 3-5 每階段在 production 至少觀察 24h，fallback rate < 1%
- [ ] 4 條 pipeline（evaluator ×2 / reaction / schedule）全部走 V2
- [ ] 新 SDK option（CLAUDE_CLI_PATH、hooks、agentProgressSummaries、future `getContextUsage`）只需改 `SDKSessionManager` 一處即能全線生效
- [ ] `docs/conversation-pipeline-fragmentation.md` 升級成「historical — resolved by this migration」
- [ ] 有機制防止新 stateless caller 繞過 V2（lint rule 或 architectural note）

---

## 相關文件

- `docs/conversation-pipeline-fragmentation.md` — 問題描述與 4 選項比較
- `docs/sop-sdk-cli-upgrade.md` — SDK/CLI 升級 SOP（本 plan 的姊妹文件）
- `docs/upgrades/2026-04-24-sdk-0.2.76-to-0.2.119-patch-plan.md` — SDK 升級範例（immutable plan 格式範本）

## 完工後的更新責任

完工時更新：
- `docs/conversation-pipeline-fragmentation.md` → 加 `**狀態：已整合（see 2026-04-25 plan）**` header
- 本 plan 在 Phase 6 完成後加 `**狀態：完成 YYYY-MM-DD**` header，凍結
- 若 Phase 6 決議刪 V1，新開 `docs/upgrades/<date>-remove-v1-pipeline-plan.md` 不改本文件
