# Cache & Rate Limit 消耗分析

> 研究日期：2026-04-30
> 資料範圍：2026-04-28 ~ 2026-04-29
> 帳號類型：Claude Max（cache TTL = 1 hour）

## 核心公式

```
cache_read   = context_window × num_turns          （乘法關係）
cache_write  = 本次 query 新產生的內容（tool results + assistant response）
             + (TTL 過期 ? 整個 context 重新寫入 : 0)
rate_limit % = 帳號級 5hr 窗口所有 token 消耗 / 額度上限
```

## 各指標增長邏輯

### cache_read（佔 rate limit 消耗 95%+）

| 因子 | 說明 |
|------|------|
| context_window | persistent session 對話歷史 + system prompt + tool definitions，只增不減 |
| num_turns | 每一 turn 都完整讀一次 context；tool use 越多 turns 越多 |

驗證資料：session `6f40b7aa`（JSONL restored context = 98K），cache_rd/turn = 93-168K，吻合。

**cache_read 機制沒有改變。** 增幅來自 persistent session 讓 context 無限累積。

### cache_write

| 場景 | cache_write 來源 |
|------|-----------------|
| cache warm + 少量 tool use | 3-15K（新 user msg + assistant response） |
| cache warm + 大量 tool use | **每 turn 的 tool result 都是新內容**。44 turns × ~73K/turn ≈ 3.2M |
| cache cold（TTL 過期） | 整個 context 重新寫入。2.3M context → 3.2M cache_write |

**重要修正：** 初期分析誤判 gap < 60min 的 cache_write spike 為 TTL 過期。
實際上帳號 TTL = 1 hour，gap 8-49 min 的 spike 是 **tool use volume**，不是 cache rebuild。

### input_tokens

正常 10-50（只有新 user message 的 delta）。異常高 = cache prefix 完全 miss。

### output_tokens

= Σ(每 turn 的 assistant 回覆 + tool call 指令)。受任務複雜度驅動，與 context 大小無關。

### rate limit %（5hr window）

帳號級指標，包含所有 Claude 消耗來源：

| 來源 | 追蹤到 ClaudeCab DB？ |
|------|---------------------|
| ClaudeCab（Discord bot） | ✓ query_metrics |
| Claude Code CLI | ✗ 幽靈增幅 |
| claude.ai 網頁 | ✗ 幽靈增幅 |

驗證：04-29 有多筆 0 token 消耗但 +2~11pp 的幽靈增幅，確認外部使用。

### cost（三級定價，Opus 4）

| 類型 | 單價 /Mtok | 佔比 |
|------|-----------|------|
| input | $15.00 | 極小 |
| output | $75.00 | ~5% |
| cache_write | $18.75 | 視 TTL/tool use |
| cache_read | $1.875 | ~90%（量最大） |

## Keepalive 狀態

- `CACHE_KEEPALIVE_INTERVAL_MS` = 3,000,000（50 min）via .env
- Detected TTL = 1 hour → adjusted interval = 48 min
- 04-28：138 筆 keepalive ping DB 記錄
- **04-29：0 筆 keepalive ping DB 記錄**

### 根因：adjustKeepaliveInterval 的 metrics 黑洞（已修 4ac27a2）

**Keepalive 有在跑，但 adjusted timer 的 callback 不記錄。**

| | startKeepalive（原始 timer） | adjustKeepaliveInterval（調整後） |
|--|---------------------------|----------------------------------|
| send ping | ✓ | ✓ |
| extract usage | ✓ | ✗ ← bug |
| record to DB | ✓ | ✗ ← bug |
| calculate ROI | ✓ | ✗ ← bug |
| audit cache hit | ✓ | ✗ ← bug |
| log level | debug（ping）+ info（ROI） | debug only ← bug |

流程：session 建立 → startKeepalive（50min timer，**有記錄**）→ 第一個 query 偵測 TTL=1hr
→ adjustKeepaliveInterval **清掉原始 timer，換上無記錄的 48min timer** → 後續 ping 全進黑洞。

**修法**（4ac27a2）：抽出 `executeKeepalivePing()` 共用 helper，兩個 timer 都呼叫同一份邏輯。
所有 keepalive ping log 從 debug 改為 info。

因為 TTL = 1 hour，大多數 gap < 60 min 的 query **本來就不需要 keepalive 保護**。

## 真正的成本驅動鏈

```
persistent session（不結束）
  → context 只增不減
    → cache_read/turn 越來越大（= context size）
      → × turns = 總 cache_read（rate limit 主消耗）
    → tool use 密集 query
      → turns 多 → cache_read 乘法放大
      → 每 turn 新 tool result → cache_write 累積
    → 離開 > 1 hour → TTL 真正過期
      → 回來時 cache_write = 整個 context 重寫

同時 Claude Code CLI / claude.ai 的消耗
  → 疊加在同一個 5hr rate limit window
  → 出現幽靈增幅（ClaudeCab 看不到）
```

## 實證數據

### session 6f40b7aa（general, 14hr 長 session）

| 指標 | 初始 (12:46) | 最終 (02:47) | 增幅 |
|------|-------------|-------------|------|
| context/turn | 22K | 168K | 7.6x |
| 單筆 cache_read | 567K | 2,771K | 4.9x |

### session 457695f2（coder, 怪物 session）

| 指標 | 初始 (04:11) | 最終 (18:08) | 增幅 |
|------|-------------|-------------|------|
| context/turn | 29K | 2,344K | **81x** |
| 單筆 cache_read | 914K | 28,126K | **31x** |
| 單筆 cache_write（max） | 137K | 3,192K | **23x** |

### 每週趨勢

| 週 | avg context/turn | avg cache_wr/turn | avg cost/query |
|----|-----------------|-------------------|----------------|
| W05-W08 | 32-72K | 8-12K | $0.20-0.65 |
| W09-W12 | 62-1,072K | 9-45K | $0.83-2.22 |
| W13-W17 | 195-1,037K | 6-15K | $1.24-2.81 |

context/turn 的長期增長反映 persistent session 引入後的結構性變化。
cache_wr/turn 穩定（6-15K），spike 來自 tool use volume 而非機制改變。

## 背景：方案降級影響

100U 方案的 rate limit 池子比高階方案小。同樣的 token 消耗量，在新方案下佔比更高。
cache TTL 為 1 hour（Claude Max），keepalive 有效但之前因 metrics 黑洞不可見（已修 4ac27a2）。

## 2026-05-04：Hook / Subagent 新機制消耗補記

> 調查目的：確認 Context Economy、hook visibility、Stop hook、scout subagent、actual model observability 等新機制是否造成額度異常。
> 資料範圍：2026-05-04 runtime code 與 `logs/claudecab.2026-05-04*.log`。

### 結論

新機制確實增加 input / output，但成本來源要分清楚。

不是所有「看得到的 hook / subagent 狀態」都會進模型。真正會進模型的是 `additionalContext`、Stop hook 的 block reason、subagent prompt、subagent 自己的工具結果與回覆，以及 `agentProgressSummaries` 這類 AI 生成摘要。

目前最可疑的固定成本不是 Haiku scout 本身，而是 Stop hook 每輪至少多跑 Phase 0 / Phase 1 兩個模型 turns。當主 session 是 Opus 且 context / cache 很大時，即使 Stop prompt 很短，額外 turns 仍會乘上龐大的 cached context。

### 會增加模型 input / output 的機制

| 機制 | 是否進模型 | 成本判斷 |
|------|------------|----------|
| `UserPromptSubmit` checklist | 會。非短訊息每次注入約 642 chars，粗估 160 tokens | 小，但每輪固定增加 |
| Stop Phase 0 | 會。約 483 chars + runtime summary，並強制多一個模型 turn | 大，因為多跑主模型 turn |
| Stop Phase 1 | 會。約 835 chars + state context，並強制再多一個模型 turn | 大，因為每輪至少變 3 turns |
| PreToolUse context economy warning | 會。觸發時透過 `additionalContext` 注入 | 中。Read / Grep / Glob / WebSearch / WebFetch 目前第一次就會觸發，偏敏感 |
| PostToolUse Bash error prompt | 會，但只在命令錯誤時 | 小到中 |
| Scout subagent prompt | 會。`scout.md` 約 1510 chars，粗估 378 tokens | 小到中，只在 scout 啟動時 |
| Scout 工具結果與 brief | 會，計入 Haiku subagent | 視讀檔 / 搜尋量而定 |
| `agentProgressSummaries` | 會。長時間 subagent 約每 30 秒 fork 產生進度摘要 | 通常小，但不是零 |

### 不應算成模型 input 的機制

| 機制 | 判斷 |
|------|------|
| Hook 狀態訊息，例如 `🪝 Hook - PreToolUse` | 主要是 adapter / UI 可視化，不是自動塞回模型 |
| SubAgentMessageManager 的可編輯狀態訊息 | 主要是 Discord 狀態訊息，不是模型 context |
| actual model 顯示 | telemetry / UI，不是 prompt |
| usage subtitle，例如 `models ... out ... $...` | telemetry / UI，不是 prompt |
| `includeHookEvents` stream event | 增加 stream 可觀測訊息，通常不是模型推理 input |

### Haiku scout 是否反而更燒

如果 scout 真的取代主 Opus 的 broad exploration，通常會省。

如果 scout 只是額外多做一份初版，而主 session 後面又繼續用 Opus 大量 Read / Grep / WebFetch，同一份探索成本就會疊加。這時候即使 scout 是 Haiku，總額度仍可能更高。

2026-05-04 的 mixed-model query 實證：

| 時間 | 總成本 | Opus 成本 | Haiku 成本 | 判斷 |
|------|--------|-----------|------------|------|
| 14:29 | $0.3080 | $0.2794 | $0.0286 | Haiku 佔小頭 |
| 14:34 | $0.6817 | $0.6368 | $0.0450 | Haiku 佔小頭 |
| 14:58 | $1.8036 | $1.5988 | $0.2048 | Haiku 增加但不是主因 |
| 17:38 | $0.4288 | $0.2558 | $0.1730 | Haiku 因 WebSearch / output 較高 |
| 23:12 | $2.0700 | $1.9555 | $0.1144 | Opus 仍是主因 |

合計這 5 筆：

- 總成本：`$5.2921`
- Haiku 成本：`$0.5658`
- Haiku 佔比：`10.7%`
- Haiku output：`18,396`
- Haiku cache read：`404,679`
- Haiku cache creation：`296,126`

這代表 Haiku scout 不是零成本，但不是 2026-05-04 主要異常來源。主要風險在於它若沒有替代主模型探索，就會成為額外成本。

### 23:12 query 的代表案例

23:12 那輪有 4 次 scout delegation：

- 總成本：`$2.06998`
- Opus：`$1.95555`
- Haiku：`$0.11444`
- Haiku 佔約 `5.5%`
- turns：`15`
- Haiku output：`2702`
- Haiku cache creation：`74661`

判斷：這輪不是「Haiku 很貴」，而是「subagent 讓總工作量增加，而主 Opus 仍然是主要成本」。

### 13:16 真正異常案例

2026-05-04 13:16 有一筆明顯異常：

- 成本：`$17.53`
- turns：`1`
- output：`103,155`
- cache read：`2,710,791`
- cache creation：`1,997,709`
- 沒有看到 Haiku / scout model 記錄

判斷：這不像 Haiku scout 問題，較像 output 爆炸或巨大 cache creation。它應該被獨立追查，不要和 subagent 成本混為一談。

### 目前最可能的成本放大鏈

```
每輪 UserPromptSubmit 注入
  + Stop Phase 0 / Phase 1 強制多跑 2 turns
  + persistent session context 很大
  + 主模型是 Opus
  = 固定 overhead 被巨大 context 放大

大量探索任務
  + scout Haiku 先讀一輪
  + main Opus 又讀一輪 top sources 以外的材料
  + subagent progress summaries / tool output
  = subagent 成本疊加，而不是替代
```

### 治理判斷

應保留：

- actual model / modelUsage 顯示，因為它不燒模型，且能確認實際跑的模型。
- subagent fail-closed policy，避免 generic / missing model override 繼承昂貴主模型。
- scout evidence packet contract，避免 scout 直接變 final answer。

應重新評估：

- Stop Phase 1 是否每輪都要跑。它是目前最大固定 overhead 之一。
- Stop Phase 0 / Phase 1 是否可條件化，例如只有有檔案改動、命令失敗、validatorNeeded、archiveAccess、durable-state signal 時才 block。
- Context Economy warning 門檻是否太低。現在 Read / Grep / Glob / WebSearch / WebFetch 第一次就注入，可能過度敏感。
- `agentProgressSummaries` 是否需要預設開啟；長時間 subagent 下它不是零成本。

### 下一步建議

1. 在 query log 中拆出 hook-induced turns，讓 Stop Phase 0 / 1 成本可直接量化。
2. 將 Stop Phase 1 改成 conditional hygiene，沒有 durable-state signal 時不 block。
3. 將 Context Economy 的 first-tool warning 改為更保守門檻，或只顯示 UI，不馬上 `additionalContext`。
4. 對 scout 設 hard budget：工具次數、output chars、maxTurns、是否允許 progress summaries。
5. 獨立追查 2026-05-04 13:16 的 `$17.53` query，重點看 output 爆炸與 cache creation 來源。

## 控制策略

| 槓桿 | 手段 | 效果 | 複雜度 | 狀態 |
|------|------|------|--------|------|
| **縮小 context** | handoff + reset | 2.3M → 50K = -98% | 中 | 待實作 |
| **減少 turns** | coder maxTurns 上限 + prompt 引導 | 102t → 10t = -90% | 低 | 待討論 |
| Session cleanup | auto idle soft-delete | 消除殭屍 session | 低 | `/sessions` Feature B |
| Rate limit 感知 | 5hr% 高時延後非關鍵 query | 減緩但不減少總量 | 中 | 待討論 |
| External tracking | OAuth % - ClaudeCab 貢獻 = 外部 | 純觀測 | 低 | 待討論 |

**最高投報比：context 控制 + turn 控制（兩者是乘法關係）。**

### 策略 1：Handoff + Reset（取代 SDK compaction）

不依賴 SDK compaction API，用自有的 handoff 機制：context 到閾值時壓縮成 handoff prompt → reset session → 用 handoff prompt 開新 context。

**待確認：**
- 閾值：200K context/turn 是合理觸發點？（100-200K 時 cost ~$1/query，300K+ 爆炸）
- handoff 內容：session 層級摘要 vs 完整 conversation summary
- 觸發方式：自動 / 半自動（通知確認）/ 混合（coder 自動、general 通知）
- 使用者體驗：reset 後同 thread 繼續，是否告知使用者記憶斷層

### 策略 2：Turn 控制

- coder agent maxTurns 上限（防止 44/102 turns 的失控 query）
- system prompt 引導先規劃再行動，減少盲目 tool use 試探

### 策略 3：Rate Limit 門控

query 前讀 OAuth 5hr%：
- < 50%：正常
- 50-70%：排程任務延後，只跑使用者互動
- \> 70%：警告使用者，排程全暫停
