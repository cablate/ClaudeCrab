# ClaudeCab 程式碼品質與效能優化報告

> 日期：2026-05-30
> 範圍：src/ 全部 ~107 個 TypeScript 檔案，~23K 行
> 方法：9-agent parallel workflow 跨 4 個面向掃描 + 合成

---

## 一、現狀摘要

- **107 個 TypeScript 檔案，約 23K 行**
- tsconfig 嚴格度良好（`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`）
- **欠缺 ESLint TypeScript 規則守門** — 所有 `eslint-disable @typescript-eslint/no-explicit-any` 註解是死的，無對應 rule 檢查
- 核心分層架構（persistence → core → adapters）單向箭頭大致成立，少數違規
- 整體健康度：**中上** — 架構框架正確但內部實作品質參差

---

## 二、架構問題

### P0 — 大檔案拆分

| 檔案 | 行數 | 問題 | 建議 |
|------|------|------|------|
| `src/adapters/discord/DiscordSlashCommands.ts` | 1208 | 14 個 slash command handler 混雜一檔，handleCtx 單一函式 235 行 | 每個 command 抽成獨立檔案至 `commands/` 目錄 |
| `src/adapters/DiscordAdapter.ts` | 1138 | constructor 佔 813 行，混雜 client init / event binding / security / voice / thread 處理 | 拆出 ClientManager、EventHandler、MessageRouter、FileTransfer、VoiceHandler |
| `src/core/query/QueryExecutor.ts` | 902 | 查詢執行邏輯與 15 個 display formatting 函式混雜 | 抽出 UsageSummaryFormatter、QueryUsageReporter |
| `src/core/query/SDKStreamProcessor.ts` | 834 | `processStream` 單一函式 ~660 行 | 抽出 StreamClassifier、SubAgentTracker、UsageTracker |
| `src/core/session/SessionManager.ts` | 811 | `startOrGetSession` ~150 行含 DB 查詢/agent loading/config transform/event emit | 抽出 SessionPersistence、SessionLifecycle |
| `src/core/keepalive/SDKKeepaliveManager.ts` | 706 | keepalive 排程與異常診斷格式化混雜 | 抽出 SDKKeepaliveScheduler、SDKKeepaliveDiagnostics |
| `src/core/orchestrator/AgentLoader.ts` | 675 | `loadAgent` ~200 行含 config/hooks/MCP/cache 混雜 | 抽出 AgentConfigLoader、AgentHookLoader、AgentMcpLoader |
| `src/core/session/SDKSessionManager.ts` | 660 | 6 個查詢/報告方法佔 184 行，與 session 生命週期管理混雜 | 抽出 SDKSessionQueries |

**不需拆分**：BaseAdapter.ts (501 行，職責清楚)、InteractionHandler.ts (507 行，static registry 設計使然)、migrations.ts (496 行，SQL 字串宣告式)、SDKQueryManager.ts (679 行，職責單一內聚)。

### P1 — 跨層依賴異常

1. **persistence → schedule（反向依賴）** — `ScheduleRepository.ts:9` import `../schedule/types`。雖只 import type，但 persistence 不應依賴 schedule 層。建議：schedule/types 型別移至 persistence 或 types 層。
2. **schedule → adapters（垂直耦合）** — `ScheduleNotifier.ts:10` import `../adapters/BaseAdapter`。排程通知應透過抽象介面。
3. **conversation → adapters（偏軟）** — `ConversationPipeline.ts:2` import `../adapters/BaseAdapter`。可接受但建議改依賴 core/types 抽象。

### P2 — 死 barrel export 全滅

所有 7 個 `index.ts` barrel 檔案無人透過 barrel path 引用。全部 import 走完整子模組路徑（如 `types/agent.js` 而非 `types`）。

**死檔案**：
- `types/activity.ts` — `ActivityEvent` 等型別，0 處 import。Characters Come Alive 系統遺留物。
- `types/interfaces.ts` — 空殼檔案，無任何 export。
- `core/tts/` — 空目錄，TTS 尚未實作。

---

## 三、Code Quality 問題

### P0 — 錯誤處理

| 排名 | 位置 | 問題 | 嚴重度 |
|------|------|------|--------|
| 1 | `HookMessageManager.ts:65` | `.catch(() => {})` 重置整個 hook 佇列，後續 enqueue 全部看不到錯誤 | **high** |
| 2 | `AppBootstrap.ts:248` | OAuth 回呼註冊失敗完全靜默，OAuth 用量永久停擺 | **high** |
| 3 | `ConversationPipeline.ts:195-197` | re-throw 前沒 log，遺失 platform/agentId/userId 上下文。多 agent 同時出錯無法追溯 | **medium** |
| 4 | `DiscordAdapter.ts:172` | 按鈕清理失敗無紀錄，使用者看到殘留按鈕 | **medium** |
| 5 | `SDKSessionManager.ts:252` | keepalive 調整失敗靜默 | **medium** |
| 6 | `SDKSessionFactory.ts:203,350` | bare catch 不記錄 binary 解析失敗 / hook send 失敗 | **medium** |
| 7 | `OAuthUsageService.ts:78` | persist 失敗不記錄，重啟後 rate limit 資訊遺失 | **medium** |
| 8 | `CacheAnomalyAnalyzer.ts:96-97,409-410` | `readFileSync` 無 try/catch，直接呼叫會炸掉程序 | **medium** |

其他約 35 處「log and swallow」在非關鍵路徑可接受。約 30 處 `bare catch {}` 屬防禦性設計正確用法。

### P0 — 型別安全

**核心問題**：SDKStreamProcessor.ts 有 13 個 `eslint-disable @typescript-eslint/no-explicit-any`，佔專案 ~70% 的型別安全漏洞。根本原因是 `claude-agent-sdk` 未公開 stream message 的 discriminated union type。

其他問題：
- 6 處 `as unknown as` 雙重轉型（DiscordSlashCommands、PlatformOrchestrator、SDKSessionFactory）
- 3 處非 null 斷言（`!`）無註解說明
- 3 處 `as string[]` 直接偽造型別（SDKStreamProcessor:556、AgentLoader:475、persistence/types:347）
- 3 處 `catch (e: any)`（scripts/ 目錄）
- **全域無 ESLint config** — 所有 `eslint-disable` 註解是死的，無對應 rule 在檢查

### P1 — DB 模式

**最嚴重**：
1. `QueryMetricsRepository.getRecentQueries` 用 `SELECT *` 回傳 20 個欄位，卻在 `/sessions` 被 `getRecentQueries(2000)` 呼叫。拉 2000 筆全欄位只為了建立 `sdkSessionId → latest query` 映射。
2. `/ctx` handler 拉 100 筆用 for...of 過濾 platform/chatId/createdAt，屬 application-layer filtering 反模式。
3. `/cache efficiency` 拉 2000 筆後在 JS 端過濾 createdAt，無 date 參數傳入 SQL。

**次要問題**：
1. Migration 變數命名與鏈條版本完全脫節（`MIGRATION_V6_TO_V7` 在 v4→v5 步驟執行），無對照文件，插入新 migration 極易放錯位置。
2. Repository 間 row mapping 策略不一致（SessionRepository 直接 `as` cast，ScheduleRepository 用 `rowToTask` helper，QueryMetricsRepository 部分 mapping 部分 cast）。

---

## 四、效能與記憶體問題

### P1 — Timer Leak

1. **`DiscordBootstrap.ts:214` cacheAnomalyReportTimer 無 cleanup** — `AppBootstrap` 未儲存此 timer reference，shutdown 時無法 `clearInterval`。graceful shutdown 後該 timer 繼續跑 5 分鐘，可能嘗試送 Discord 訊息到已關閉的 adapter。
2. **`SDKSessionManager.ts:401` clearInterval 錯用於 setTimeout handle** — `keepaliveTimer` 實際是 `setTimeout` 回傳值，但用 `clearInterval` 清除。Node.js 目前共用 handle 物件讓此行為恰好 work，但依賴實作細節，非合約保證。

### P2 — 記憶體風險

1. **SDKSessionManager.managedSessions 無上限、無定期 cleanup**。每個 `ManagedSession` hold 住 SDK CLI 子行程（~150MB RAM），一旦 session 被建立但後續 query 一直失敗未觸發 destroy，就永久留在 Map 中。建議：加入 `maxSessions`（預設 20）+ 閒置 eviction timeout，對 schedule resume session 加 flag 保護。
2. **`ManagedSession.currentOptions` 保留 systemPrompt、mcpServers、callback closures 直到下次 query 才覆寫**。建議在 `processStream` finally 區塊 `managed.currentOptions = undefined`。

### P2 — EventBus 全死

- **零個 `.on()` 呼叫**。所有 `emit`/`emitSync` 送入虛空。
- 3 個 EventMap key（`session:switched`、`connection:healthChanged`、`activity`）連 emit site 都沒有。
- `emitSync` 名實不符（發射 async 不等待），且加的多餘 `.catch()` 因 `emit()` 內部已用 `Promise.allSettled` 吞掉所有 rejection 而永不觸發。

建議：刪除 EventBus class，用直接呼叫取代現有 `emitSync` sites。EventMap type 保留供參考。

---

## 五、優化建議執行計畫

### P0 — 立即執行（1-2 天）

| # | 問題 | 做法 | 工時 | 風險 |
|---|------|------|------|------|
| 1 | `HookMessageManager.ts:65` `.catch(() => {})` 吞掉佇列錯誤 | 改為 `logger.error` 或 re-throw 讓上層處理 | small | 低 |
| 2 | `AppBootstrap.ts:248` OAuth 回呼註冊失敗 | 加 `logger.error` 記錄錯誤 | small | 低 |
| 3 | `AppBootstrap.ts` 未持有 `cacheAnomalyReportTimer` | 新增欄位，shutdown 做 clearInterval | small | 低 |
| 4 | `SDKStreamProcessor.ts` 13 個 `any` | 定義 `StreamMessage` union type 逐一替換 | medium | 中 — 需確認 SDK stream shape |
| 5 | `SDKSessionManager.ts:401` `clearInterval` 錯用 | 改為 `clearTimeout` | small | 低 |

### P1 — 短期（1-2 週）

| # | 問題 | 做法 | 工時 | 風險 |
|---|------|------|------|------|
| 6 | QueryMetricsRepository SELECT * + 2000 筆 | 新增 SQL 聚合方法取代 JS 過濾 | medium | 低 |
| 7 | /ctx for...of 過濾 | 新增 `getRecentChannelQueries` 下放 SQL | medium | 低 |
| 8 | /cache efficiency JS 過濾 | `getRecentQueries` 加 `since` 參數 | small | 低 |
| 9 | managedSessions 無上限 | 加入 maxSessions + eviction | medium | 中 |
| 10 | DiscordSlashCommands.ts 1208 行 | 拆 `commands/` 目錄 | large | 低 |
| 11 | DiscordAdapter.ts 1138 行 | 拆 5 個模組 | medium | 中 |
| 12 | Migration 變數命名脫節 | 重新命名 + 對照表 | small | 低 |
| 13 | 移除死 barrel export | 保留有用 barrel 其餘移除 | medium | 低 |
| 14 | 移除死檔案 | types/activity.ts、types/interfaces.ts、core/tts/ | small | 低 |
| 15 | ConversationPipeline catch 補 log | 加 logger.error | small | 低 |

### P2 — 中期（2-4 週）

| # | 問題 | 做法 | 工時 | 風險 |
|---|------|------|------|------|
| 16 | EventBus 全死 | 刪除 EventBus class，emitSync 改直接呼叫 | medium | 低 |
| 17 | currentOptions memory retention | finally 區塊 clear | small | 中 |
| 18 | 建立 ESLint flat config | 啟用 @typescript-eslint 逐步清理 | medium | 低 |
| 19 | SDKSessionFactory bare catch 補 log | 加 logger.warn | small | 低 |
| 20 | CacheAnomalyAnalyzer readFileSync 加 try/catch | 失敗回傳空陣列 | small | 低 |
| 21 | Repository row mapping 統一 | 導入 rowToXxx helper pattern | medium | 低 |
| 22 | `as unknown as` 雙重轉型清理 | 逐處評估 | medium | 中 |
| 23 | QueryExecutor.ts 902 行 | 抽出 UsageSummaryFormatter | medium | 低 |
| 24 | SDKStreamProcessor.ts 834 行 | 抽出 StreamClassifier / SubAgentTracker | medium | 中 |
| 25 | AgentLoader.ts 675 行 | 抽出 Agent*Loader 子模組 | medium | 低 |

---

## 六、不做的事（技術債管理決策）

**永久 defer**：

1. **SELECT * 全面清掃** — SessionRepository / ConversationRepository / ScheduleRepository 的 SELECT * 由於資料表小（欄位 6-12，資料量 < 數百筆），改明確欄位清單效益近乎零。
2. **SessionManager.processedMessageIds LRU 改批量刪除** — 現行逐筆刪除在 99.9% 場景正常，不投入時間。
3. **persistence → schedule 反向依賴修正** — 僅 import type，無 runtime 影響。
4. **OAuthUsageService persist 失敗** — 功能設計上 persist 失敗不影響主流程。

**短期不做（有價值但非當前優先）**：

5. `emitSync` 改名 — 等 EventBus 刪除決定後再說。
6. 非 null 斷言加註解 — 僅 3 處，對執行無害。
7. `catch (e: any)` in scripts/ — 非 production 程式。
8. SDKKeepaliveManager closure 改 WeakRef — 效益有限。
9. SDKKeepaliveManager abandon session 自動停止 — 已可被 #9 間接解決。
10. `EventType.ADAPTER_SEND_ERROR` 拆分 — logging taxonomy 品味問題。
