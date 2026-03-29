# ClaudeCab 效能優化研究報告

> **基於版本：** CLI v2.1.85 (build 2026-03-26) + Agent SDK v0.2.76
> **日期：** 2026-03-29
> **狀態：** 逆向驗證完成

---

## 摘要

本報告調查了 Claude Code CLI v2.1.85 和 Agent SDK v0.2.76 的效能優化空間，涵蓋 9 個方向。每個方向都經過 source code 逆向驗證，分為三類：**可 PATCH**（修改 cli.js/sdk.mjs 的 postinstall patch）、**可改 ClaudeCab**（修改我們自己的程式碼）、**無法處理**（需要 Anthropic 端改動或架構限制）。

最終結論：有 4 個高價值 PATCH、3 個 ClaudeCab 程式碼改動、2 個無需行動。

---

## 目錄

1. [已確認可 PATCH — 詳細改法與效果](#1-已確認可-patch--詳細改法與效果)
2. [可改 ClaudeCab 程式碼](#2-可改-claudecab-程式碼)
3. [已驗證無法 PATCH / 無需行動](#3-已驗證無法-patch--無需行動)
4. [現有優化 vs 新增優化的完整對照表](#4-現有優化-vs-新增優化的完整對照表)

---

## 1. 已確認可 PATCH — 詳細改法與效果

### PATCH-A：currentDate 快取殺手修復

**問題：** `currentDate` 以 `<system-reminder>` 的形式注入到每個 turn 的第一則訊息中。跨午夜或 compact 後日期改變會讓整個 system-reminder 區塊內容變動，間接影響快取。

**逆向發現：**

`currentDate` 的注入路徑：

```
iQ6()            — 日期產生器，格式 YYYY-MM-DD，每次呼叫取當下時間
    ↓
WA()             — userContext builder，z1() memoized（session 內只算一次）
                   回傳 { claudeMd, currentDate: "Today's date is ${iQ6()}." }
    ↓
bu8(messages, K) — 把 WA() 的輸出包成 <system-reminder> 塞在 messages[0]
```

關鍵：`WA` 用 `z1()` memoize，所以 `iQ6()` 在 session 內只呼叫一次。**但 `WA.cache.clear()` 在每次 compact 後都會被呼叫**（offset 5293411, 6853200, 9905938），導致日期重新計算。

此外有一個 `date_change` 事件產生器 `i4Y()`（offset 9758509），每個 turn 都檢查日期是否變更，變更時注入 "The date has changed" 通知。

**改法：** 在 `WA()` 回傳值中，把 `iQ6()` 替換成 session-scoped 的固定值。

```js
// 目標：offset 5295410 附近
// 原始：
currentDate:`Today's date is ${iQ6()}.`
// 改為：
currentDate:`Today's date is ${uP8()}.`
```

`uP8` 是 `z1(iQ6)` 的 memoized 版本（offset 3712546），在整個 process 生命週期內只計算一次。即使 `WA.cache.clear()` 被呼叫，`uP8` 的快取不會被清除，日期保持穩定。

**grep pattern:** `currentDate:\`Today's date is \${iQ6()}`

**效果：**
- 消除跨午夜時的 system-reminder 變動（~200-500 token 的 message 內容變化）
- 消除 compact 後日期重算造成的不必要差異
- 副作用：跨午夜時 Claude 仍顯示舊日期，但 `date_change` 事件仍會注入正確通知

**影響等級：** 中（只在跨午夜和 compact 後觸發，但觸發時成本是完整 system+messages 重建）

---

### PATCH-B：Auto-mode classifier 消除

**問題：** Auto-mode 啟用時，**每個 turn 都會額外發一次獨立的 API 呼叫**到 Sonnet 4.6 做安全分類。

**逆向發現：**

```js
// offset ~2698, Ny8 函數（auto-mode classifier）
W = {
  model: "claude-sonnet-4-6",     // 硬寫死，不可配置
  max_tokens: 256,                 // fast path
  system: J,                       // permissions block ~2,500 tokens
  temperature: 0,
  querySource: "auto_mode"
};
let K6 = await qk(W);  // 完整的 API request
```

每次 classifier 呼叫消耗約 3,000-8,000 input tokens + 64-256 output tokens。20 輪對話 = 20 次額外的 Sonnet 呼叫。

**改法：** 設定 `permissionMode: "bypassPermissions"` + `allowDangerouslySkipPermissions: true`。

這些選項在 cli.js line 14721 和 14815 有記載：
```
"bypassPermissions": Skip all prompts (requires allowDangerouslySkipPermissions: true)
```

ClaudeCab 是受控環境（所有權限由我們自己管理），classifier 提供的安全檢查沒有額外價值。

**具體改法（sdk.mjs patch 或 session 參數）：** 在 `SDKSessionManager.ts` 建立 session 時，傳入：

```ts
permissionMode: 'bypassPermissions',
allowDangerouslySkipPermissions: true
```

如果 SDK 不直接暴露這些選項，需要在 `patch-sdk-v2.cjs` 中注入。

**效果：**
- 每個 turn 省一次 Sonnet API 呼叫（~3,000-8,000 input tokens + ~100 output tokens）
- 20 輪對話：省 ~60,000-160,000 input tokens + ~2,000 output tokens
- 降低 TTFT（不需等 classifier 回應後才開始主模型呼叫）

**影響等級：** 高（每個 turn 都省一次 API call，延遲 + token 雙重節省）

---

### PATCH-C：Stream watchdog 啟用

**問題：** Stream 卡死時（模型無回應、網路問題），cli.js 預設無限等待。

**逆向發現：**

```js
// offset ~line 7682
let b6 = process.env.CLAUDE_ENABLE_STREAM_WATCHDOG === "1"  // 預設 false
let x6 = parseInt(process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS) || 90000  // 90 秒
let Z6 = x6 / 2  // 45 秒 warning
```

Watchdog 邏輯已經寫好但預設關閉。啟用後：
- 45 秒無 chunk → 記錄 warning
- 90 秒無 chunk → abort stream + fallback 到 non-streaming mode

**改法：** 在 `SDKSessionManager.ts` 建立 session 時的環境變數注入：

```ts
env: {
  CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
  CLAUDE_STREAM_IDLE_TIMEOUT_MS: '60000',  // 60 秒
}
```

**效果：**
- 防止 stream 卡死導致的無限等待（目前使用者需要手動中斷）
- 自動觸發 non-streaming fallback，提高 reliability
- Stall detection telemetry 自動記錄，方便除錯

**影響等級：** 中（不省 token，但大幅提高穩定性）

---

### PATCH-D：Compaction 模型降級

**問題：** Compaction（上下文壓縮）使用與主對話相同的模型。如果主對話用 Opus，compaction 也用 Opus，成本高昂。

**逆向發現：**

```js
// CEq 函數（compact executor）
// cacheSafeParams 繼承自 appState.mainLoopModel
D = await CEq({
  messages: X,
  summaryRequest: J,
  cacheSafeParams: M   // M.model = 主對話模型
});
```

Compaction 只需要摘要能力，Sonnet 或甚至 Haiku 都足以勝任。但模型是從 `cacheSafeParams` 繼承的，沒有獨立的配置點。

**改法：** 在 `patch-cli-cache-opt.cjs` 中新增一個 patch，在 `CEq` 呼叫前攔截 `cacheSafeParams` 中的 model 欄位：

```js
// grep pattern: "cacheSafeParams:M" 在 compact 路徑附近
// 替換 M 中的 model 為較便宜的模型
```

具體需要找到 `CEq` 呼叫點，在其前方注入 model override。這需要進一步逆向 `CEq` 的完整呼叫鏈來確定 patch 位置。

**效果：**
- Opus → Sonnet：compact 成本降為 ~1/5
- Opus → Haiku：compact 成本降為 ~1/30
- 對 compact 品質的影響需要測試（Sonnet 4.6 在摘要任務上表現不差）

**影響等級：** 中高（compact 不常觸發，但每次觸發的 token 量巨大——整個上下文作為輸入）

---

## 2. 可改 ClaudeCab 程式碼

### CODE-A：Session 生命週期管理（Memory bounded）

**問題：** V2 session 一旦建立就永不銷毀（除非手動呼叫 `destroySession`）。cli.js subprocess 的 `params.messages` 陣列無限增長，沒有 pruning。記憶體線性成長，長時間運行後可能達到 412MB+。

**逆向證據：**
- cli.js 沒有 `maxMessages` 限制（搜尋結果為零）
- 唯一的 messages 縮減是 compaction（全量替換為一則摘要訊息）
- `SDKSessionManager.ts` 沒有 session age TTL、idle reaper、或 message count ceiling
- cli.js 的記憶體警告（`XFK` component）是純 UI 展示，不觸發任何修正動作

**改法：** 在 `SDKSessionManager.ts` 新增三個機制：

```ts
// 1. Session 年齡上限（建議 4 小時）
const MAX_SESSION_AGE_MS = 4 * 60 * 60 * 1000;

// 2. Message 輪數上限（建議 150 輪）
const MAX_MESSAGE_COUNT = 150;

// 3. Idle reaper（建議 2 小時無活動就銷毀）
const SESSION_IDLE_TTL_MS = 2 * 60 * 60 * 1000;
```

在 keepalive tick 中檢查：
```ts
if (Date.now() - managed.createdAt > MAX_SESSION_AGE_MS ||
    managed.messageCount > MAX_MESSAGE_COUNT ||
    Date.now() - managed.lastUsedAt > SESSION_IDLE_TTL_MS) {
  await this.destroySession(sessionId);
}
```

下次 query 會自動建立新 session（cache 重建一次），但記憶體被控制住。

**效果：**
- 防止 412MB+ 記憶體膨脹
- 長時間運行的 ClaudeCab 不再需要手動重啟來回收記憶體
- 代價：session 重建時有一次 cache cold start（~$0.38 at 200k context）

---

### CODE-B：Gap detection 超時縮短

**問題：** `SDKSessionManager.ts` 的 persistent session follow-up 模式中，gap detection 最壞情況等待 5 秒才開始處理真實回應。

**逆向證據：**

```ts
// SDKSessionManager.ts:493
if ((elapsed >= 2000 && gapMs >= 1000) || elapsed >= 5000)
```

這段邏輯用來區分 JSONL replay（歷史重播）和真實的模型回應。在 burst replay 結束後，需要等到 gap ≥ 1 秒（且已過 2 秒）或直接等 5 秒才認定 replay 結束。

**改法：** 降低超時值：

```ts
// 原始：
if ((elapsed >= 2000 && gapMs >= 1000) || elapsed >= 5000)
// 建議：
if ((elapsed >= 500 && gapMs >= 300) || elapsed >= 2000)
```

JSONL replay 是 I/O bound 的 burst，gap 遠小於 100ms。真實模型回應的 TTFT 通常 > 500ms。300ms gap threshold 足以區分。

**效果：**
- 最壞情況從等 5 秒降到等 2 秒
- 一般情況從等 2 秒降到等 0.5 秒
- 使用者感受：persistent session 的第一次回應更快

---

### CODE-C：啟動序列平行化

**問題：** `DiscordBootstrap` 的步驟 4-7（Dashboard、Activity Reporter、TaskSync、CostReport）是循序 await，但彼此不相依。

**逆向證據：**

```
DiscordBootstrap 啟動序列：
  1. await discordAdapter.initialize()     ← 必須先完成（WebSocket login）
  2. await registerSlashCommands()          ← 依賴 step 1
  3. new DiscordInteractionHandler()        ← 依賴 step 1
  4. await dashboardService.start()         ← 獨立
  5. new DiscordActivityReporter()          ← 獨立
  6. threadNotifier.startForumListener()    ← 獨立
  7. setInterval(costReport cron)           ← 獨立
```

步驟 4-7 可以用 `Promise.allSettled()` 平行啟動。

此外，`AppBootstrap` 的 WebUI（step 11）和 Schedule（step 10）也可以與 Discord system bot init（step 12）平行。

**效果：**
- 啟動時間減少約 1-3 秒（Dashboard start + Forum listener + WebUI bind 的序列等待）
- 不影響核心訊息處理的就緒時間

---

## 3. 已驗證無法 PATCH / 無需行動

### VERIFIED-A：Streaming jitter — 不在我們的控制層

**逆向結論：** cli.js 的 stream yield 路徑是零緩衝的——每個 SSE chunk 都同步 yield，沒有 debounce 或 batching。兩個 100ms 緩衝（`v78.FyY` 和 `Sh6._EY`）都在後端遙測路徑，不影響 ClaudeCab 的消費者。

更重要的是：**sdk.mjs 傳遞的是「完整 turn」而不是 per-token delta**。cli.js 在 `content_block_stop` 之後才組裝完整的 assistant message 輸出。ClaudeCab 收到的是整輪回應，不是逐 token 串流。

claude-better 的 streaming jitter 優化（91ms→24ms）針對的是 CLI 的即時終端渲染——我們的架構（SDK → bot message）不受這個影響。

**結論：無法 PATCH，且不需要。**

---

### VERIFIED-B：Network keep-alive — 已經最佳化

**逆向結論：** cli.js 使用 undici HTTP client，connection pool 預設啟用 keep-alive。Anthropic SDK 通過 undici 的 dispatcher 路由，連線複用已經是預設行為。

```js
this[ln5] = Z == null ? !0 : Z  // keepAlive defaults to true
```

**結論：無需行動。**

---

### VERIFIED-C：Tool description 精簡 — 已經夠精簡

**逆向結論：** ClaudeCab 的 MCP tool descriptions 全部在 100 字元以下，parameter descriptions 也很簡潔。跟典型的 MCP server（1,000+ 字元 description）相比已經非常精簡。

**結論：無需行動。**

---

### VERIFIED-D：MCP server instance 快取 — 影響太小不值得

**逆向結論：** `buildMcpSetup()` 每次 query 重新建立 in-process MCP server 實例。這些是純記憶體物件（type: "sdk"），不涉及網路連線。建構成本主要是物件分配，對 GC 有微量壓力，但不構成可觀察的延遲。

**結論：可以做但 ROI 太低。**

---

### VERIFIED-E：`speed:"fast"` 參數 — 自動生效

**逆向結論：** 當 agent model 是 `opus-4-6` 且帳號有 fast mode 資格時，cli.js 自動加上 `speed:"fast"` 和 `fast-mode-2026-02-01` beta header。ClaudeCab 不需要做任何事。

條件鏈：`!DISABLE_FAST_MODE` && `!cooldown` && model 包含 `"opus-4-6"` && session `fastMode=true`。

**結論：確認 agent 設定中 model 為 opus-4-6 即可，無需 patch。**

---

## 4. 現有優化 vs 新增優化的完整對照表

### 已實施的優化（10 項）

| # | 優化 | 類型 | 位置 |
|---|------|------|------|
| 1 | context-margin 1000→200 | cli.js PATCH | patch-cli-cache-opt.cjs |
| 2 | SDK 1h cache TTL 強制 | cli.js PATCH | patch-cli-cache-opt.cjs |
| 3 | compaction threshold 100k→150k | cli.js PATCH | patch-cli-cache-opt.cjs |
| 4 | V2 persistent session | ClaudeCab | SDKSessionManager.ts |
| 5 | Cache keepalive ping (4min) | ClaudeCab | SDKSessionManager.ts |
| 6 | Cache efficiency 追蹤 | ClaudeCab | SDKSessionManager.ts |
| 7 | Tool 排序穩定化 | ClaudeCab | McpToolSetup.ts |
| 8 | CLAUDE_CODE_REMOTE=1 | ClaudeCab | SDKQueryManager.ts |
| 9 | JSONL sanitizer (file diff 抑制) | ClaudeCab | JsonlSanitizer.ts |
| 10 | V2 stream replay filter | ClaudeCab | MessageProcessor.ts |

### 新增可實施的優化（7 項）

| # | 優化 | 類型 | 影響等級 | 預估效果 |
|---|------|------|---------|---------|
| A | currentDate 固定化 | cli.js PATCH | 中 | 消除跨日/compact 後的 cache bust |
| B | Auto-mode classifier 消除 | SDK 參數/PATCH | **高** | 每 turn 省一次 Sonnet API call（~5k tokens） |
| C | Stream watchdog 啟用 | 環境變數 | 中 | 防止 stream 卡死，自動 fallback |
| D | Compaction 模型降級 | cli.js PATCH | 中高 | compact 成本降 80-97% |
| E | Session 生命週期管理 | ClaudeCab 程式碼 | 中 | 防止 412MB+ 記憶體膨脹 |
| F | Gap detection 超時縮短 | ClaudeCab 程式碼 | 中低 | persistent session 回應快 3 秒 |
| G | 啟動序列平行化 | ClaudeCab 程式碼 | 低 | 啟動快 1-3 秒 |

### 已驗證無需行動（5 項）

| # | 方向 | 原因 |
|---|------|------|
| a | Streaming jitter | SDK 是 turn-level 而非 token-level，不受影響 |
| b | Network keep-alive | undici 預設已啟用 |
| c | Tool description 精簡 | 已經夠精簡（<100 chars each） |
| d | MCP instance 快取 | In-process 物件，ROI 太低 |
| e | speed:"fast" 參數 | 自動生效，無需干預 |

---

## 附錄：逆向定位參考

| 目標 | grep pattern | cli.js offset |
|------|-------------|---------------|
| 日期產生器 | `function iQ6()` | 3712283 |
| memoized 日期 | `uP8=z1(iQ6)` | 3712546 |
| currentDate 注入 | `currentDate:\`Today's date is` | 5295410 |
| WA cache clear | `WA.cache.clear` | 5293411 |
| date_change 偵測 | `function i4Y(q)` | 9758509 |
| bu8 context 注入 | `function bu8(q,K)` | 11422828 |
| classifier 呼叫 | `querySource:"auto_mode"` | 2698 |
| classifier 模型 | `claude-sonnet-4-6` | 2702 |
| compact executor | `cacheSafeParams:M` | 2278 |
| stream watchdog | `CLAUDE_ENABLE_STREAM_WATCHDOG` | 7682 |
| stream idle timeout | `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | 7682 |
| memory warning threshold | `1610612736` | XFK component |
| 動態邊界標記 | `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` | 6518780 |
