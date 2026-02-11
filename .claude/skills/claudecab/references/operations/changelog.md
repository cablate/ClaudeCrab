# ClaudeCab 版本歷史

> 架構決策紀錄 (ADR) 已移至 [decisions/_index.md](../decisions/_index.md)

---

## 版本歷史

### v1.28.0 - System Prompt Preset Append（當前版本）

**發布日期**：2026-02-11

**修正**：SDK systemPrompt 從字串覆蓋改為 preset append 模式
- `SDKQueryManager`：傳給 SDK 的 systemPrompt 改為 `{ type: 'preset', preset: 'claude_code', append: agentSystemPrompt }`
- `ConfigTransformer`：`SDKOptions.systemPrompt` 型別擴展支援 preset 格式，`toSDKOptions()` 輸出同步更新
- **影響**：agent 執行時保留 Claude Code 的內建 system prompt（工具使用規範、安全規則等），自訂 system prompt 附加在後面而非覆蓋
- **背景**：先前使用字串模式會導致 Claude Code 的內建 prompt 被完全替換，agent 缺少工具使用規範

---

### v1.27.0 - Activity System v2.0 架構重構 + Live Page 虛擬辦公室

**發布日期**：2026-02-10

**目標**：Activity System 架構重構（God class 拆分）、SQLite 持久化、前端篩選 UI、穩定性修復、Live Page 虛擬辦公室視覺升級。

**Phase 1: ReactionGenerator 抽取**
- 新增 `src/core/ReactionGenerator.ts`：統一 Haiku AI 呼叫邏輯（`generateReaction()`、`generateMutter()`）
- 共享方法：`callHaiku()`、`parseResponse()`、`inferMood()`
- 從 `ActivityService` 和 `IdleMutterScheduler` 移除重複的 AI 呼叫邏輯

**Phase 2: 模組瘦身 + 接線**
- `ActivityService`：移除 AI 邏輯，降為 thin facade（事件建立 + 推送 + 狀態管理）
- `IdleMutterScheduler`：從 177 行瘦到 ~90 行，只負責排程邏輯
- `AppBootstrap`：新增 `buildPersonalityReader()` 消除重複的 personality 讀取邏輯

**Phase 3: ActivityRepository + Migration v7→v8**
- 新增 `src/persistence/ActivityRepository.ts`：activity_events 表的 CRUD
- `DatabaseManager` migration v7→v8：新增 `activity_events` 表 + 索引

**Phase 4: API 篩選 + 前端 UI**
- `/api/activity/events` 支援 `agentId`、`type`、`since`、`limit` 查詢參數
- `getRecent()` 有 repository 時優先從 DB 查詢（重啟後歷史資料可見）
- 前端篩選按鈕：All / Workflow / Personality / per-agent（client-side filter）
- SSE 初始批次不更新 agent card（防止舊資料覆蓋乾淨初始狀態）

**穩定性修復**
- `SocialEvaluator`：新增 30 秒 timeout（`Promise.race`），防止 API hang 卡住整個系統
- `SocialEvaluator`：JSON parse 改用 `match(/\{[\s\S]*?\}/)` 提取，容忍 Haiku 在 JSON 前後加文字
- `ActivityService.getAgentState()`：60 秒 auto-expire stale phase + mood，防止 agent card 卡在過時狀態
- `ActivityService.emitWorkflow()`：completed/error 後 5 秒自動推 idle 事件
- `live.js` typewriter effect：用 WeakMap 追蹤 timer，新動畫取消舊動畫防止字元交錯
- `recordMessage` 重複寫入：已知的 `INSERT OR IGNORE` 行為，不影響功能

**Live Page 虛擬辦公室視覺升級**
- 兩欄佈局：左側員工卡片（hero）+ 右側活動動態（sidebar 340px）
- 員工檔案風格卡片：大頭像（2.75rem emoji + radial gradient glow）、角色描述、model badge、idle 時長
- Mood emoji 映射（😐😆😤😩🧐😪）+ 2.25rem 大尺寸顯示
- 卡片色彩個性：頂部 accent bar + `::after` radial-gradient 背景 tint（5% opacity）
- 內心獨白氣泡（speech bubble with triangle pointer）+ typewriter 效果
- Compact header：inline mini-stats（💬 訊息 / ✅ 完成 / 🧠 獨白）+ 辦公室時鐘（週X HH:MM）
- 全中文介面：狀態標籤、時間格式（剛剛/N 分鐘前）、idle 時長
- Feed 增強：workflow 事件 tool badge、personality 事件 type icon（💬/💭）、personality 允許換行
- DB 統計 API：`/api/activity/stats` 回傳 messagesHandled、tasksCompleted、personality
- Stats 30 秒自動 poll + 事件驅動 debounce 更新
- 頁面初始化從 DB 撈最近 20 則歷史事件填入 feed
- 初始 bubble 基於時段顯示預設語（早安/下午了啊）
- Idle badge 每 60 秒自動更新
- 工作中持續顯示當前任務（task_received → working → tool_use 期間保持）
- Flash 效果改用 CSS transition（不與 breathing animation 衝突）
- Responsive：mobile 端自動堆疊（sidebar 變 100% 寬度）

**Personality 系統調優**
- `ReactionGenerator` prompt 從回應摘要改為內心獨白風格（15 字以內口語化碎碎念）
- 新增 `PHASE_MOOD_HINTS`：per-phase 情緒引導（避免 88% focused 問題）
- 情緒多樣性：completed→excited/bored、error→annoyed/tired、idle→bored/tired

**IdleMutterScheduler 啟用**
- 成本優化設定：5 分鐘檢查間隔、30% 觸發機率、3 次/小時/agent 上限
- `hasActiveViewers` gate：僅 SSE 有連線時才檢查（無人看時零成本）
- `mutterHistory` Map 追蹤每 agent 每小時 mutter 次數
- 預估成本 ~$0.10/天（2 agents）

**穩定性修復**
- SSEBroadcaster：30 秒心跳（`:heartbeat\n\n`）+ `dispose()` 方法
- 前端 SSE：指數退避重連（1s → 2s → 4s → ... → 30s max）
- `ActivityRepository.getStats()`：SQL COUNT 聚合（messagesHandled、tasksCompleted）
- `ActivityService.getStats()`：查詢前先 flush write queue

**新增檔案**
- `src/core/ReactionGenerator.ts`
- `src/core/IdleMutterScheduler.ts`（前次已建立，本次重寫）
- `src/persistence/ActivityRepository.ts`
- `src/webui/api/activity.api.ts`（前次已建立，本次修改）
- `src/webui/services/SSEBroadcaster.ts`（前次已建立，本次修改）
- `public/js/live.js`（前次已建立，本次重寫為 v4.0）
- `public/css/live.css`（前次已建立，本次重寫為 v4.0）
- `src/webui/views/live/index.ejs`（前次已建立，本次重寫）
- `start-dev.bat`：`chcp 65001` + `npm run dev`（修正 Windows 終端中文亂碼）

### v1.26.0 - 並行委派 + 結果收斂 + 協作失控防護

**發布日期**：2026-02-07

**目標**：ADR-030 Tier 1 — 群組中多 bot 並行委派 + 協調者自動綜合結果；Tier 1.1~1.3 — 協作失控防護。

**並行委派（ADR-030 Tier 1）**
- `DelegationHandler.processDelegation()`：2+ targets 時改用 `Promise.allSettled()` 並行執行，單一 target 維持串行路徑
- 新增 `executeParallelDelegation()`：並行執行所有委派，收集結果後注入 synthesis prompt 給協調者
- 新增 `buildSynthesisPrompt()`：建立綜合提示，包含各 bot 回覆或失敗標記
- `executeDelegation()` 回傳 `{ agentId, response?, success }` 以支援結果收集
- `isSynthesis` 安全旗標：仿照 `isInitiative` 模式，防止綜合回覆觸發二次委派
- `BotRepliedPayload`、`processMessage` options、`emitBotRepliedEvent` 皆傳遞 `isSynthesis`
- 邊界：部分失敗仍綜合、全部失敗跳過綜合、synthesis 回覆不觸發新委派

**協作失控防護（ADR-030 Tier 1.1~1.3）**
- **Tier 1.1**：被委派 bot（`delegationDepth > 0`）的回覆不再觸發 @mention 委派掃描，防止禮貌性 @mention 造成 cascade
- **Tier 1.2**：`GroupBroadcaster` 追蹤 `delegationActive` 狀態，委派進行中抑制 Initiative 評估，避免旁觀 bot 插嘴
- **Tier 1.3**：`ContextInjector.formatHistory()` 加入群組行為規範 prompt，指示 bot 不在群組回報內部操作（記憶寫入、工具狀態等）

### v1.25.0 - 用量頁面 + 排程韌性強化

**發布日期**：2026-02-06

**目標**：新增 Usage 用量統計頁面、修復排程 ID 不一致 bug、為排程執行加入 retry + circuit breaker。

**Usage 用量頁面**
- 新增 `/usage` 頁面：期間篩選（24h/7d/30d/全部）、4 張統計卡片（總花費/總查詢數/輸入 Tokens/輸出 Tokens）
- 每日花費趨勢圖（Canvas bar chart）、Agent 用量摘要表、近期查詢列表（分頁載入）
- API：`GET /api/usage/daily`、`GET /api/usage/recent`
- 全繁體中文介面

**Schedule ID 修復**
- `ScheduleLoader.loadForAgent()` / `loadById()`：以檔名為 canonical ID，自動修正 YAML 內 `spec.id` 不一致問題
- 修復 Dashboard「Schedule not found」bug（YAML 檔名 vs 內部 id 不符）
- Create schedule API 支援 once/interval trigger type（原本硬編碼只支援 cron）

**排程 Retry + Circuit Breaker**
- `isTransientError()` 新增 3 個 pattern：`'529'`、`'overloaded'`、`'tool_use ids must be unique'`
- `ScheduleExecutor.execute()`：用 `retryAsync()` 包住 `executeQuery()`，3 次重試、5s→15s→45s backoff、每次 retry 新 session ID
- `CronScheduler`：新增 `consecutiveFailures` 追蹤，連續失敗 3 次自動暫停 + 呼叫 `onAutoPause` callback
- `ScheduleNotifier.notifyAutoPaused()`：發送自動暫停 Telegram 通知，含恢復指令
- `AppBootstrap`：串接 auto-pause callback（pauseSchedule + notifyAutoPaused）

**修改檔案**：
- `src/utils/retry.ts` — isTransientError 擴充
- `src/schedule/ScheduleExecutor.ts` — retryAsync 包裝 executeQuery
- `src/schedule/CronScheduler.ts` — consecutiveFailures + onAutoPause callback
- `src/schedule/ScheduleNotifier.ts` — notifyAutoPaused()
- `src/schedule/ScheduleManager.ts` — （被 callback 呼叫 pauseSchedule）
- `src/schedule/ScheduleLoader.ts` — 檔名為 canonical ID
- `src/AppBootstrap.ts` — 傳入 onAutoPause callback
- `src/webui/routes/usage.ts` — 用量頁面 route（新增）
- `src/webui/api/usage.api.ts` — 用量 API endpoints（新增）
- `src/webui/views/usage/index.ejs` — 用量頁面模板（新增）
- `src/webui/views/partials/sidebar.ejs` — 用量 nav link
- `src/webui/routes/index.ts` — 註冊 usage routes
- `src/webui/api/agents.api.ts` — create schedule 支援 once/interval
- `src/persistence/types.ts` — QueryMetricRawRow rename
- `tests/integration/performance.test.ts` — 修復 flaky lock release 閾值

---

### v1.24.0 - Dashboard 設定管理 + Schedule 修復

**發布日期**：2026-02-06

**目標**：Dashboard Agent Edit 升級為完整設定管理介面 + 排程系統三個 bug 修復。

**Dashboard 設定管理（ADR-027）**
- Agent Edit Form 改為 4 Tab 分區（基本 / 模型參數 / 工具 / 群組協作）
- 新增 ~15 個欄位：maxTokens、maxThinkingTokens、permissionMode、maxTurns、delegation、initiative 等
- **Config 所有權分離**：permissions + model 寫入 `settings.local.json`（SDK 管理），其餘寫 `agent.json`
- 工具權限改為 tag/chip UI（動態讀取 settings.local.json 現有權限）
- 移除 allowedTools/disallowedTools（agent.json 不應介入 SDK 層級工具控制）

**Schedule 修復**
1. **對話建立排程不執行**：Agent 寫 YAML 後 CronScheduler 沒有 register → 新增 `syncSchedulesForAgent()` + `message:sent` 事件自動觸發
2. **排程執行缺少 context**：`settingSources: ['local']` → `['project']`，確保 skills 被載入
3. **排程通知 Markdown**：`ScheduleNotifier` 改用 `sendWithMarkdownFallback()`（MarkdownV2 → Markdown fallback），與一般對話共用同一工具函式
4. **Schema 容錯**：`type: "at"` 自動映射為 `"once"`，`datetime` 自動映射為 `at`（防止 agent 產出不合規 YAML）
5. **Agent 排程文件修正**：scheduling.md 新增 Trigger 類型對照表、`once` 範例、欄位名稱警告
6. **排程執行 Hooks**：ScheduleExecutor 加入 UserPromptSubmit（時間注入）+ PreToolUse（PathValidator 路徑隔離），與一般對話一致的安全性和 context 注入
7. **Once/Interval trigger 支援**（ADR-028）：CronScheduler 不再 reject non-cron schedules，改為自動轉換 cron 表達式（`once` → `分 時 日 月 *`、`interval` → `*/N * * * *`）。`once` 執行後自動 unregister
8. **TelegramCommands Markdown fallback**：含動態內容的指令回應（/start、/help 私聊、/schedule list/info/history）改用 `replyWithMarkdown()` fallback（Markdown → plain text），純靜態回應維持原樣

**WebUI UX 改善**
9. **Create 後引導**：建立新 Agent 後直接跳轉到 Edit 頁面（原本跳到 Detail 頁），減少使用者「建完還要找哪裡設定」的摩擦
10. **Model 設定同步**：`AgentLoader.syncModelFromSettings()` 確保 `settings.local.json`（SDK source of truth）的 model 設定覆蓋 agent.json 的值
11. **Schedule UI 支援 once/interval**：Create Schedule Modal 新增 Trigger Type 選擇器（Cron/Once/Interval），with 對應的條件式欄位和 YAML 預覽
12. **Memory 編輯器升級**：Modal 加寬至 `max-w-5xl`、textarea 高度 `h-[60vh]`、新增全螢幕切換按鈕
13. **System Prompt 快速編輯**：Detail 頁 System Prompt tab 加入 Edit 按鈕，一鍵打開 CLAUDE.md 編輯器
14. **Schedule 顯示 trigger type**：Dashboard 列表和 Telegram 指令（/schedule list、/schedule info）根據 trigger type 顯示對應標籤（Cron/Once/Interval），不再一律顯示空的 cron 欄位

**排程 vs 對話的 Hook 差異**：

| Hook | 對話 | 排程 | 理由 |
|------|------|------|------|
| UserPromptSubmit（時間注入） | ✅ | ✅ | 排程需要知道今天日期 |
| PreToolUse（PathValidator） | ✅ | ✅ | 安全性一致 |
| Stop（記憶 checkpoint） | ✅ | ❌ | 排程 prompt 應自帶指令 |
| canUseTool（權限審批） | ✅ | ❌ | 排程無人值守 |

**修改檔案**：
- `src/webui/types.ts` — 擴展 UpdateAgentRequest
- `src/webui/api/agents.api.ts` — PUT handler 完整寫入
- `src/webui/routes/agents.ts` — edit route 傳遞完整 config
- `src/webui/views/agents/edit.ejs` — Tab UI + 所有新欄位
- `src/schedule/ScheduleExecutor.ts` — 加入 UserPromptSubmit + PreToolUse hooks
- `src/schedule/ScheduleNotifier.ts` — 使用 sendWithMarkdownFallback
- `src/schedule/ScheduleManager.ts` — 新增 syncSchedulesForAgent()
- `src/schedule/schemas.ts` — trigger type/datetime alias 容錯
- `src/types/events.ts` — MessageSentPayload 加 agentId
- `src/adapters/BaseAdapter.ts` — emitMessageSent 加 agentId
- `src/AppBootstrap.ts` — message:sent → schedule sync
- `agents/general/.claude/skills/agent-protocols/references/scheduling.md` — 完整 trigger 類型文件
- `src/schedule/CronScheduler.ts` — once/interval→cron 轉換 + once 自動 unregister
- `src/adapters/commands/TelegramCommands.ts` — replyWithMarkdown fallback
- `src/webui/views/agents/create.ejs` — 建立後 redirect 到 edit 頁
- `src/core/AgentLoader.ts` — syncModelFromSettings()
- `src/webui/views/agents/detail.ejs` — Schedule create UI once/interval、Memory 編輯器升級、System Prompt Edit 按鈕

---

### v1.23.2 - GroupBroadcaster SRP 拆分

**發布日期**：2026-02-05

**目標**：解決 GroupBroadcaster 826 行 god-object 問題，拆分為 3 個模組各司其職。

**架構變更**
```
GroupBroadcaster (Facade, 516 行)
  ├─ Core: membership, dedup, routing, recording, event handling
  ├─ InitiativeHandler (224 行) — ADR-023 initiative 全部邏輯
  └─ DelegationHandler (202 行) — ADR-021/022 delegation 全部邏輯
```

**設計決策**
- `GroupBroadcasterOptions` 外部 API 完全不動，PlatformOrchestrator / AppBootstrap 零修改
- InitiativeHandler 有狀態（cooldowns + counters），dispose 時清理
- DelegationHandler 無狀態，不需 dispose
- 現有 30 個 GroupBroadcaster 測試保留作為整合測試（EventBus → Facade → Handler）
- 新增 24 個 handler 獨立單元測試（10 delegation + 14 initiative）

**修改檔案**：
- `src/core/InitiativeHandler.ts` — **新建**，evaluateInitiatives + executeInitiative + cooldown/counter
- `src/core/DelegationHandler.ts` — **新建**，processDelegation + detectDelegationTargets + executeDelegation
- `src/core/GroupBroadcaster.ts` — 移除 5 個 methods + 7 個 fields，委託給 handlers
- `tests/unit/InitiativeHandler.test.ts` — **新建**，14 個測試
- `tests/unit/DelegationHandler.test.ts` — **新建**，10 個測試

---

### v1.23.0 - ADR-023: Bot 主動互動模式 v1

**發布日期**：2026-02-05

**目標**：讓 Bot 能在沒有被 @mention 的情況下，主動回應群組中與其專業相關的訊息。

**核心功能**
- **Initiative Pipeline**：Gate → Throttle → Evaluate (Haiku) → Execute
- **LLM 評估器**：用 Haiku（~$0.001/次）做語意判斷，取代關鍵字規則
- **Strategy Pattern**：`InitiativeEvaluator` 介面可抽換實作（LLM / AlwaysRespond / 未來 Embedding）
- **Initiative Mode**：`agent.json` 設定 `settings.initiative.{enabled, mode, cooldown, maxPerHour}`
- **v1 限制**：僅支援 `work` mode；initiative 回覆不觸發委派鏈

**設計決策**
- 棄用關鍵字預篩（維護成本高、語意理解零）→ 直接用 Haiku 評估
- Throttle 在 Evaluate 之前（先擋再花錢）
- cooldown 用 `Map<string, number>` 而非 DedupTracker（需 per-agent 可配置 TTL）

**實測修正**（v1.23.1）
- 修正 `@anthropic-ai/sdk` 誤用 → 改用 `claude-agent-sdk` 的 `query()` 呼叫 Haiku
- 修正 Haiku 回傳 markdown code block 包裹 JSON 的解析問題
- Model 從 `claude-haiku-4-20250514` 改為 `claude-haiku-4-5-20251001`
- Initiative pipeline 關鍵節點 log 從 debug 拉到 info（評估進入、判定不回、全被過濾）
- 新增 `InitiativeEvaluationUsage` 型別，evaluation 費用寫入 `query_metrics` 表（歸到被評估的 bot）
- `GroupBroadcaster` 注入 `queryMetricsRepository`，注入鏈：AppBootstrap → PlatformOrchestrator → GroupBroadcaster

**修改檔案**：
- `src/types/agent.ts` — 新增 `InitiativeSettingsSchema`
- `src/types/events.ts` — `BotRepliedPayload.isInitiative`
- `src/core/InitiativeEvaluator.ts` — **新建**，Strategy 介面 + LLMInitiativeEvaluator + usage 回傳
- `src/core/GroupBroadcaster.ts` — Initiative Pipeline + usage 記錄 + info-level log
- `src/core/PlatformOrchestrator.ts` — 注入 initiative callbacks + evaluator + queryMetricsRepository
- `src/core/MessageProcessor.ts` — isInitiative 傳遞鏈
- `src/AppBootstrap.ts` — queryMetricsRepository 注入到 PlatformOrchestrator
- `tests/unit/InitiativeEvaluator.test.ts` — **新建**，mock claude-agent-sdk query()
- `tests/unit/GroupBroadcaster.test.ts` — 新增 10 個 initiative 測試

---

### v1.22.0 - ADR-022: 委派機制增強 + 基礎設施重構

**發布日期**：2026-02-05

**目標**：多重委派支援 + 委派可配置（inbound/outbound）+ 群組協作基礎設施穩定化。

**核心功能**
- **多重委派**：`detectDelegationTargets()` 回傳 `string[]`，一次回覆可同時觸發多個被 @mention 的 Bot
- **委派可配置**：`agent.json` 的 `settings.delegation` 新增 `inbound`/`outbound` 設定
  - `inbound: false` → 此 Bot 不接受其他 Bot 的委派（不被觸發）
  - `outbound: false` → 此 Bot 的回覆不會觸發委派偵測（不派工給別人）
  - 預設都是 `true`（向後相容）
- **Depth 共用**：同一次回覆觸發的所有 target 共享相同 delegation depth，防止指數爆炸

**命名決策**
- 初版 `acceptDelegation`/`canDelegate` 語意相近易混淆，改為方向性命名 `inbound`/`outbound`

**基礎設施重構**

經過 code review 識別 14 個改善項目，本版本完成以下重構：

| Phase | 項目 | 說明 |
|-------|------|------|
| 1 | GroupBroadcaster 單元測試 | 19 個測試案例涵蓋 membership, dedup, routing, delegation, recording |
| 2.1 | `groupSession.ts` | `group::` 前綴工具函數（`buildGroupUserId`, `isGroupUserId`） |
| 2.2 | `DedupTracker.ts` | 統一 dedup 機制，支援 TTL 與自動清理 |
| 3.1 | `dispose()` 修復 | 清理 `processedMessages` 防止記憶體洩漏 |
| 3.2 | metadata 型別安全 | `as string` 改為 `typeof === 'string'` runtime guard |
| 3.3 | mentionedBot 註解 | 說明 ADR-019/021/022 設計決策 |
| 4.1 | 拆分 `handleBotReplied` | 分離 recording 與 delegation 邏輯 |
| 5.1 | `scheduleManager!` 移除 | `ScheduleCommandDeps` 型別縮窄，消除 non-null assertion |
| 5.2 | GroupBroadcaster 可注入 | `PlatformOrchestratorOptions` 支援注入 GroupBroadcaster |

> 完整決策紀錄：[ADR-026](../decisions/adr/adr-026-group-infra-stabilization.md)
> 保留項目：`waitForBotMessageId` busy-wait（可接受）、`executeQueryWithSDK` 過長（風險高）

**修改檔案**：
- `src/types/agent.ts` — 新增 `DelegationSettingsSchema`
- `src/core/GroupBroadcaster.ts` — 多重委派 + DedupTracker + handleBotReplied 拆分 + dispose 修復
- `src/core/PlatformOrchestrator.ts` — getDelegationSettings callback + GroupBroadcaster 可注入
- `src/core/MessageProcessor.ts` — 使用 groupSession 工具函數
- `src/adapters/TelegramAdapter.ts` — mentionedBot 設計註解
- `src/adapters/commands/TelegramCommands.ts` — DedupTracker + groupSession + ScheduleCommandDeps
- `src/utils/groupSession.ts` — 新增 `group::` 工具函數
- `src/utils/DedupTracker.ts` — 新增統一 dedup 機制
- `tests/unit/GroupBroadcaster.test.ts` — 新增 19 個測試案例

---

### v1.21.0 - ADR-024: 群組命令支援

**發布日期**：2026-02-04

**目標**：群組中命令的路由、dedup、新命令（`/members`、`/status`）、`@all` 支援。

**核心功能**
- **命令路由**：`routeGroupCommand()` 解析 `/cmd@botname` 格式，決定 `targeted`/`bare`/`other_bot`
- **跨 Bot Dedup**：`isGroupCommandProcessed()` 用 `chatId:date:userId:command` 作 key（Telegram 對每個 bot 分配不同 `message_id`），儲存於 `globalThis` 確保跨實例共享
- **命令分類**：
  - 唯讀（`/help`、`/status`、`/members`）→ 裸打由一個 Bot dedup 回覆
  - 破壞性（`/reset`、`/stop`）→ 裸打提示指定 `@botname` 或 `@all`
- **`@all` 支援**：所有 Bot 靜默執行，第一個 Bot 發送統一回覆
- **新命令 `/members`**：顯示群組 Bot 成員列表（名稱、@username、描述、運行狀態）
- **新命令 `/status`**：私聊顯示單一 Bot 狀態；群組顯示所有 Bot 狀態
- **群組版 `/help`**：群組中顯示群組專屬指令說明

**踩坑記錄**
- Telegram Markdown 中 `@username` 的底線 `_` 被當作斜體 → 改用 HTML parse mode + `escapeHtml()`
- Telegram 對每個 bot 分配獨立 `message_id` → 不能用 `chatId:messageId` dedup，改用 `chatId:date:userId:command`

**修改檔案**：
- `src/adapters/commands/TelegramCommands.ts` — 群組命令路由 + dedup + 新命令
- `src/adapters/commands/index.ts` — 新增 export
- `src/adapters/TelegramAdapter.ts` — `setupCommandHandlers` 群組路由邏輯
- `src/core/PlatformOrchestrator.ts` — 提供 `getGroupBotMembers` + `getBotStatus` callback
- `tests/unit/TelegramCommands.test.ts` — mock context 補上 `chat` 屬性

---

### v1.20.0 - ADR-021: 群組自動委派

**發布日期**：2026-02-04

**目標**：Bot 回覆中 @mention 另一 Bot 時，自動觸發被提及的 Bot 處理（Auto-Delegation）。

**核心功能**
- `GroupBroadcaster.handleBotReplied()` 偵測回覆中的 @mention
- `detectDelegationTarget()` 解析 @username 並匹配群組成員 Bot
- `executeDelegation()` 建立合成 UnifiedMessage 觸發目標 Bot 的 processMessage
- `BotRepliedPayload` 新增 `delegationDepth` 和 `delegationChain` 欄位

**安全機制**
- `MAX_DELEGATION_DEPTH = 3`：最多 3 層委派
- Cycle detection：delegationChain 追蹤已委派的 agentId
- 不自我委派：過濾發送者自身的 username
- 單一委派：每次回覆只觸發第一個匹配的 Bot

**修改檔案**：
- `src/types/events.ts` — BotRepliedPayload 擴展
- `src/core/GroupBroadcaster.ts` — 委派偵測 + 執行邏輯
- `src/core/MessageProcessor.ts` — processMessage options + emitBotRepliedEvent 傳遞 delegation

---

### v1.19.0 - ADR-020 Phase 2: Token 追蹤 + Dashboard 增強（當前版本）

**發布日期**：2026-02-04

**目標**：實作 ADR-020 Phase 2（Token 用量追蹤與數據可視化）+ 群組記憶隔離修正。

**1. Token 用量追蹤**
- `SDKQueryManager` 新增 `QueryUsage` 介面，從 SDK `modelUsage` 聚合 input/output/cache tokens 和成本
- `QueryResult` 擴展 `usage` 和 `totalCostUsd` 欄位
- DB Schema v6→v7，新增 `query_metrics` 表（agent_id, tokens, cost, duration 等）
- 新增 `QueryMetricsRepository`：`record()` / `getAgentStats()` / `getAllAgentStatsSince()` / `getDailyStats()`
- `MessageProcessor` 新增 `recordQueryMetrics()` 私有方法，每次 SDK query 成功後記錄

**2. Dashboard 增強**
- 新增「Today's Cost」統計卡片（綠/黃/紅色根據金額）
- Agent 列表增強：顯示 24h queries 數、成本（$X.XXX）、IN/OUT token（Xk）、平均回應時間
- `queryMetricsRepository` 完整佈線：AppBootstrap → WebUIServer → Dashboard route

**3. 成員清單加入 @username**
- `GroupMemberInfo` 新增 `username` 欄位
- `AppBootstrap` 的 `getGroupMembersInfo` callback 從 `TelegramAdapter.getBotInfo()` 取 username
- `formatMemberList()` 顯示格式：`- Kevin (@kevin_bot) — 秘書（你自己）`
- Bot 可建議「@coder_bot 來處理」，用戶直接知道要打什麼

**4. 群組記憶隔離修正**
- `buildMemoryStopCheckpoint()` 群組版明確指示：群組事件寫 `groups/{chatId}/`，不寫 `memory/*.md`
- `buildPromptContext()` 群組模式改顯示 `【群組日誌路徑】` 取代個人 `【日誌路徑】`
- 修正 Bot 在群組對話時同時寫個人日誌 + 群組日誌的冗余問題

**新增檔案**：
- `src/persistence/QueryMetricsRepository.ts`

**修改檔案**：
- `src/core/SDKQueryManager.ts` — QueryUsage + QueryResult 擴展 + usage 捕捉
- `src/persistence/DatabaseManager.ts` — Schema v6→v7 migration + query_metrics 表
- `src/persistence/types.ts` — QueryMetricRow、AgentUsageStats、DailyUsageStats、IQueryMetricsRepository
- `src/persistence/index.ts` — 新增 exports
- `src/core/MessageProcessor.ts` — recordQueryMetrics() + queryMetricsRepository 選項
- `src/AppBootstrap.ts` — 佈線 QueryMetricsRepository + username lookup
- `src/core/ContextInjector.ts` — GroupMemberInfo.username + formatMemberList 顯示
- `src/core/constants.ts` — 群組記憶隔離（Stop checkpoint + promptContext）
- `src/webui/types.ts` — queryMetricsRepository 依賴
- `src/webui/WebUIServer.ts` — 傳遞 queryMetricsRepository
- `src/webui/routes/dashboard.ts` — 查詢 24h agent usage stats
- `src/webui/views/dashboard/index.ejs` — Today's Cost + Agent usage UI
- `tests/unit/DatabaseManager.test.ts` — schema version 更新為 '7'

---

### v1.18.0 - 虛擬辦公室群組協作 Phase 1

**發布日期**：2026-02-04

**目標**：實作 ADR-020 Phase 1，讓多 Bot 群組協作（虛擬辦公室模式）實際可用。

**1. 群組成員持久化**
- DB Schema v5 → v6，新增 `group_members` 表（platform + chat_id + agent_id，UNIQUE 約束）
- 新增 `GroupMemberRepository`：registerMember / getMembers / getAllMembers / removeMember
- `GroupBroadcaster` 加入 DB 寫入 + `restoreMemberships()` 重啟時自動還原成員關係
- `AppBootstrap` / `PlatformOrchestrator` 完成佈線

**2. 群組成員注入**
- `ContextInjector` 新增 `formatMemberList()` — 注入 `[群組成員]` 清單到 prompt
- 包含每個成員的名字、描述、以及「你自己」標記
- 即使沒有新的群組訊息，成員清單仍會注入（Bot 始終知道群組裡有誰）
- `AppBootstrap` 建構 `getGroupMembersInfo` callback（整合 GroupMemberRepository + AgentLoader）

**3. 群組記憶路徑**
- `buildPromptContext` 在群組對話時輸出 `【群組記憶】groups/{chatId}/MEMORY.md | groups/{chatId}/YYYY-MM-DD.md`
- `buildMemoryStopCheckpoint` 在群組對話時將 `groups/{chatId}/` 加入 Stop hook 的檢查清單
- 三份 `memory-system.md` 新增群組記憶區段

**4. 群組記憶寫入提示**
- `formatHistory` 有注入訊息時，SYSTEM framing 加入「請寫入群組記憶」提示
- 群組記憶目錄結構扁平化：`groups/{chatId}/YYYY-MM-DD.md`（無多餘 memory/ 子目錄）

**新增檔案**：
- `src/persistence/GroupMemberRepository.ts`
- `agents/_example/groups/.gitkeep`

**修改檔案**：
- `src/persistence/DatabaseManager.ts` — Schema v5→v6 migration
- `src/persistence/types.ts` — GroupMemberRow、IGroupMemberRepository
- `src/persistence/index.ts` — 新增 exports
- `src/core/GroupBroadcaster.ts` — 成員持久化 + restoreMemberships()
- `src/core/PlatformOrchestrator.ts` — 佈線 groupMemberRepository
- `src/AppBootstrap.ts` — 佈線 + getGroupMembersInfo callback
- `src/core/ContextInjector.ts` — 成員清單注入 + 記憶寫入提示
- `src/core/constants.ts` — buildPromptContext 群組記憶路徑 + buildMemoryStopCheckpoint
- `src/core/MessageProcessor.ts` — 傳遞 groupChatId + 使用 buildMemoryStopCheckpoint
- `agents/*/memory-system.md` — 新增群組記憶區段
- `tests/unit/DatabaseManager.test.ts` — schema version 更新

---

### v1.17.0 - Codebase 優化重構

**發布日期**：2026-02-03

**目標**：提升模組邊界清晰度、消除重複程式碼、改善開發者可維護性與可擴充性。

**Tier 1: Quick Wins**

1. **EVENT_NAMES 修復**
   - 補齊缺失的 `group:message` 和 `bot:replied` 事件名稱

2. **日誌等級修正**
   - `ContextInjector`：4 處 info → debug（cursor 查詢為例行操作）
   - `GroupMessageRepository`：2 處 info → debug（insert 操作為例行操作）

3. **barrel exports 補齊**
   - `src/core/index.ts` 補上 ContextInjector、QuestionBridge、GroupBroadcaster、SDKQueryManager、PathValidator

4. **sendWithMarkdownFallback 共用函式**
   - `src/utils/telegramMarkdown.ts` 新增函式，消除 MessageProcessor 中 2 處重複的 MarkdownV2 → Markdown fallback 邏輯

5. **sender label 共用函式**
   - 新增 `src/utils/format.ts`，提供 `formatUserLabel()` 和 `formatBotLabel()`
   - 消除 GroupBroadcaster（2 處）和 MessageProcessor（1 處）的重複

**Tier 2: Structural Refactors**

6. **AppBootstrap 重構**
   - 新增 `src/config.ts` — 集中化 env var 解析（AppConfig 介面）
   - 新增 `src/AppBootstrap.ts` — 應用生命週期管理（start + shutdown）
   - `src/index.ts` 從 288 行精簡到 20 行

7. **StatusMessageManager 抽取**
   - 新增 `src/core/StatusMessageManager.ts`（212 行）
   - 封裝 tool event tracking、debounced 更新、status message 生命週期
   - 提供 `isStatusCapable()` 型別守衛

8. **InteractionHandler 抽取**
   - 新增 `src/core/InteractionHandler.ts`（327 行）
   - 封裝 PermissionBridge + QuestionBridge 設置和 canUseTool callback 建構
   - AskUserQuestion 處理和一般權限審批流程

9. **Post-query methods 拆分**
   - MessageProcessor 的 post-query 區段拆分為 5 個 private methods
   - `saveSDKSessionId()` / `updateInjectionCursor()` / `persistConversation()` / `sendFinalResponse()` / `emitBotRepliedEvent()`

**重構成果**：
- MessageProcessor: 1,397 行 → 1,065 行 (-24%)
- index.ts: 288 行 → 20 行 (-93%)
- 新增 5 個專責模組，總計 1,033 行

**新增檔案**：
- `src/config.ts`
- `src/AppBootstrap.ts`
- `src/core/StatusMessageManager.ts`
- `src/core/InteractionHandler.ts`
- `src/utils/format.ts`

**修改檔案**：
- `src/index.ts` — 精簡為委派 AppBootstrap
- `src/core/MessageProcessor.ts` — 職責分離重構
- `src/core/GroupBroadcaster.ts` — 使用共用 format 函式
- `src/core/ContextInjector.ts` — 日誌等級修正
- `src/core/index.ts` — 補齊 barrel exports
- `src/persistence/GroupMessageRepository.ts` — 日誌等級修正
- `src/types/events.ts` — EVENT_NAMES 補齊
- `src/utils/telegramMarkdown.ts` — 新增 sendWithMarkdownFallback

---

### v1.16.0 - WebUI 管理系統增強

**發布日期**：2026-02-02

**Phase 1: 核心功能補完**

1. **Agent 管理增強**
   - Agent 刪除（軟刪除移至 `.trash/`，支援硬刪除）
   - Agent 複製（含記憶保留選項）
   - Bot 啟停控制（個別 Agent 的 Bot 啟動/停止）

2. **排程建立 UI**
   - Create Schedule Modal（表單化建立）
   - YAML 即時預覽
   - Cron 表達式說明

3. **PlatformOrchestrator 新增方法**
   - `getBotStatusForAgent()` - 取得 Bot 狀態
   - `startBotForAgent()` - 啟動單一 Bot
   - `stopBotForAgent()` - 停止單一 Bot

**Phase 2: 監控與 Dashboard 改進**

4. **MonitoringService 服務**
   - 系統指標（uptime、memory、sessions）
   - Bot 狀態追蹤
   - 事件記錄（EventBus 整合）

5. **System 監控頁面**
   - `/system` - 系統總覽
   - `/system/metrics` - 詳細指標
   - `/system/events` - 事件日誌
   - `/system/audit` - 審計日誌（預覽）

6. **Dashboard 改進**
   - 三欄布局
   - Bot 狀態卡片（即時顯示）
   - Recent Events 區塊

7. **Sidebar 導航更新**
   - 新增 System 區塊（Overview、Metrics、Events、Audit）

**新增檔案**：
- `src/webui/services/MonitoringService.ts`
- `src/webui/api/system.api.ts`
- `src/webui/routes/system.ts`
- `src/webui/views/system/index.ejs`
- `src/webui/views/system/metrics.ejs`
- `src/webui/views/system/events.ejs`
- `src/webui/views/system/audit.ejs`

**修改檔案**：
- `src/core/PlatformOrchestrator.ts` - Bot 單獨啟停方法
- `src/webui/api/agents.api.ts` - 刪除、複製、Bot 控制、排程建立 API
- `src/webui/WebUIServer.ts` - MonitoringService 整合
- `src/webui/types.ts` - MonitoringService 依賴
- `src/webui/routes/index.ts` - System 路由
- `src/webui/routes/dashboard.ts` - 傳遞監控數據
- `src/webui/views/dashboard/index.ejs` - Bot 狀態 + Events
- `src/webui/views/agents/list.ejs` - 刪除、複製、Bot 控制 UI
- `src/webui/views/agents/detail.ejs` - Schedule 建立 Modal
- `src/webui/views/partials/sidebar.ejs` - System 導航

---

### v1.15.0 - 多 Bot 群組協作 Phase 2

**發布日期**：2026-02-02

**變更**：

1. **GroupBroadcaster 模組**
   - 新增 `src/core/GroupBroadcaster.ts`
   - 監聽 `group:message` 事件，分發給所有同群組 Bot
   - 維護 chatId → agentIds 映射（Bot 收到訊息時自動註冊）

2. **多 Bot 協作機制**
   - 所有 Bot 都執行 query（維護各自 session 歷史）
   - 只有被 @mention 或 reply to 的 Bot 發送回覆
   - 其他 Bot 以 `observeOnly` 模式運行（query 但不回覆）

3. **Bot 訊息過濾**
   - TelegramAdapter 過濾 `from.is_bot === true` 的訊息
   - 防止 Bot 之間互相觸發無限迴圈

4. **observeOnly 模式**
   - MessageProcessor 新增 `observeOnly` 參數
   - 觀察模式跳過：typing indicator、中間訊息、最終回應、status message

5. **事件系統擴展**
   - 新增 `group:message` 事件類型（`GroupMessagePayload`）
   - TelegramAdapter 群組訊息改為發出事件，由 GroupBroadcaster 處理

**新增檔案**：
- `src/core/GroupBroadcaster.ts`

**修改檔案**：
- `src/types/events.ts` - 新增 GroupMessagePayload
- `src/adapters/TelegramAdapter.ts` - Bot 過濾、getBotInfo()、發出事件
- `src/core/MessageProcessor.ts` - observeOnly 模式
- `src/core/PlatformOrchestrator.ts` - 整合 GroupBroadcaster

---

### v1.14.0 - Telegram 群組對話支援 Phase 1

**發布日期**：2026-02-02

**變更**：

1. **群組觸發機制**
   - 新增 `botInfo` 屬性保存 bot 的 username 和 id
   - 群組中只回應 @mention 或 reply to bot 的訊息
   - 非相關訊息自動忽略

2. **群組共享 Session**
   - 群組模式 Session Key: `platform::agentId::group::chatId`
   - 所有群組成員共享同一對話歷史
   - 私聊模式維持 `platform::agentId::userId`

3. **群組回應策略**
   - 群組中發送訊息時附帶 `reply_to_message_id`
   - 讓回覆關聯原訊息，方便追蹤對話脈絡

4. **Commands 支援**
   - `handleStop`, `getCurrentSession` 支援群組 effectiveUserId
   - `/reset`, `/stop` 在群組中正確操作共享 session

**修改檔案**：
- `src/adapters/TelegramAdapter.ts`
- `src/adapters/commands/TelegramCommands.ts`
- `src/core/MessageProcessor.ts`

---

### v1.13.0 - PathValidator 路徑權限強制執行

**發布日期**：2026-02-02

**變更**：

1. **PathValidator 路徑驗證模組**
   - 新增 `src/core/PathValidator.ts`
   - 強制執行 Agent 工作區隔離
   - 透過 PreToolUse hook 攔截所有檔案操作工具（Read, Write, Edit, Glob, Grep, Bash）

2. **路徑權限規則（程式層面強制）**
   - 自己的工作區：讀寫皆可
   - `_shared/knowledge/`：所有 bot 可讀
   - `_shared/knowledge/{自己}/`：可寫入
   - `_shared/knowledge/{其他}/`：禁止寫入
   - 其他路徑：禁止存取

3. **Bash 命令路徑檢測**
   - 從命令字串中提取路徑（引號內路徑、絕對路徑、相對路徑）
   - 轉換為實際絕對路徑後驗證
   - 阻止 `ls ../nitterbot/` 等越界操作

4. **MessageProcessor 整合**
   - 在 `additionalOptions.hooks` 加入 PreToolUse hook
   - 自動注入路徑驗證，Agent 無需維護 hooks.ts

**新增檔案**：
- `src/core/PathValidator.ts`
- `tests/unit/PathValidator.test.ts`（30 個測試案例）

**修改檔案**：
- `src/core/MessageProcessor.ts`

---

### v1.12.0 - 共享知識區架構

**發布日期**：2026-02-01

**變更**：

1. **共享知識區 `_shared/knowledge/`**
   - 建立跨 Agent 知識共享機制
   - 目錄結構：`agents/_shared/knowledge/{agentId}/`
   - 權限規則：所有 bot 可讀，只能寫入自己的命名空間

2. **私有知識區 `knowledge/`**
   - 將 `tools/` 和 `cases/` 整合到 `knowledge/` 目錄
   - 分類：`tools/`（工具評估）、`cases/`（案例研究）、`research/`（研究筆記）
   - 作為草稿區，完成後可發布到共享區

3. **EQUIPMENT.md**
   - 新增已安裝工具清單檔案
   - 記錄 MCP servers、Skills、Plugins

4. **Agent 協議更新**
   - `memory-system.md` 新增 Knowledge 檔案系統規範
   - `safety.md` 新增路徑權限規則（禁止存取其他 bot 工作區）
   - `startup-protocol.md` Step 3 加入讀取 EQUIPMENT.md

**新增檔案**：
- `agents/_shared/knowledge/` 目錄結構
- `agents/*/EQUIPMENT.md`
- `agents/*/knowledge/` 目錄結構
- `.claude/skills/claudecab/references/system/shared-knowledge.md`
- `.claude/skills/claudecab/references/decisions/adr/adr-015-shared-knowledge.md`

**修改檔案**：
- `agents/*/agent-protocols/references/memory-system.md`
- `agents/*/agent-protocols/references/safety.md`
- `agents/*/agent-protocols/references/startup-protocol.md`
- `.claude/skills/claudecab/references/system/overview.md`
- `.claude/skills/claudecab/references/decisions/_index.md`
- `.claude/skills/claudecab/SKILL.md`

---

### v1.11.0 - Agent Skill 系統

**發布日期**：2026-01-30

**變更**：

1. **協議 Skill 化（agent-protocols）**
   - 將 Startup Protocol、Memory System、Safety、Scheduling、Guidelines、Output Style 抽離為獨立 skill
   - 位置：`agents/general/.claude/skills/agent-protocols/`
   - 所有協議文件移至 `references/` 子目錄
   - SKILL.md 作為協議索引，觸發時機：每次 session 開始時

2. **人格 Skill 化（persona）**
   - 將 SOUL.md、IDENTITY.md 抽離為可攜帶的 skill
   - 位置：`agents/general/.claude/skills/persona/`
   - 人格與環境狀態（USER.md、MEMORY.md）分離
   - 部署到新環境只需複製 persona skill

3. **CLAUDE.md 簡化**
   - 從完整協議文檔改為指向 skills 的引導文件
   - 新增 `<STRICTLY_IMPORTANT>` 標籤強調啟動協議必須執行
   - 新增「重新校準」機制：長對話時重新調用 skills 恢復注意力
   - 保留 Lessons Learned 區段供 agent 自行維護

4. **啟動協議提醒注入**
   - `src/core/constants.ts` 新增 `STARTUP_PROTOCOL_REMINDER` 常數
   - `buildPromptContext()` 接受 `isNewSession` 參數
   - 新 session 時透過 UserPromptSubmit hook 注入啟動提醒
   - `MessageProcessor` 使用 `internalSession.sdkSessionId === undefined` 判斷是否為新 session

5. **記憶檔案讀取強化**
   - `startup-protocol.md` 更新為更明確的步驟
   - Step 2 加入 Glob 工具搜尋 `memory/*.md` 確認日誌檔案
   - 明確指示讀取今天和昨天的日期檔案

6. **日期時間處理改用 date-fns**
   - `src/core/constants.ts` 使用 `date-fns` 和 `date-fns-tz` 處理日期
   - 使用 `toZonedTime` 確保 Asia/Taipei 時區
   - 使用 `subDays` 計算昨天日期
   - 日誌路徑格式：`memory/YYYY-MM-DD.md`

7. **SDK settingSources 改為 'project'**
   - `src/core/SDKQueryManager.ts` 預設 `settingSources` 從 `['local']` 改為 `['project']`
   - 目的：讓 SDK 能載入 `.claude/skills/` 目錄的 skills
   - 仍透過 `systemPrompt` 參數明確傳入 CLAUDE.md 內容（避免 SDK 搜尋父目錄）

**修改檔案**：
- `agents/general/CLAUDE.md` — 簡化為 skill 引導
- `agents/general/.claude/skills/agent-protocols/` — 新增協議 skill
- `agents/general/.claude/skills/persona/` — 新增人格 skill
- `src/core/constants.ts` — 新增 STARTUP_PROTOCOL_REMINDER、isNewSession 支援
- `src/core/MessageProcessor.ts` — isNewSession 檢測、傳遞給 hook

**Skill 結構**：

```
agents/general/.claude/skills/
├── agent-protocols/
│   ├── SKILL.md                    # 協議索引
│   └── references/
│       ├── startup-protocol.md     # 啟動流程
│       ├── memory-system.md        # 記憶寫入規則
│       ├── safety.md               # 安全規則
│       ├── scheduling.md           # 排程建立指引
│       ├── guidelines.md           # 回覆準則
│       └── output-style.md         # 輸出格式
└── persona/
    ├── SKILL.md                    # 人格定義入口
    └── references/
        ├── soul.md                 # 核心價值觀、說話風格
        └── identity.md             # 名字、角色、定位
```

---

### v1.10.1 - 排程系統修復與優化

**發布日期**：2026-01-30

**變更**：

1. **chatId 自動注入**
   - `buildPromptContext(chatId?)` 接受 chatId 參數
   - 輸出 `【當前對話】platform: telegram, chatId: xxx`
   - Agent 建立排程時可從 context 取得 chatId，不需手動填入

2. **WebUI 編輯保留 MCP 權限**
   - 修復 `edit.ejs`：編輯 agent 時保留非基本工具權限（MCP 工具等）
   - 之前問題：每次編輯會覆蓋 SDK "Always Allow" 加入的權限

3. **ScheduleNotifier 修復**
   - 從用 `platform` 改為用 `agentId` 作為 adapter key
   - 修復多 agent 時通知送到錯誤頻道的問題
   - `index.ts` 啟動時正確註冊 adapters 到 notifier

4. **排程通知只傳最後一條訊息**
   - `ScheduleExecutor` 加入 `onIntermediateMessage` callback
   - 通知只包含最後一條 assistant message，不含中間過程

5. **Database Schema v4**
   - 移除 `schedule_executions` 的 FK 約束（YAML 是 source of truth）

**修改檔案**：
- `src/core/constants.ts` — buildPromptContext 接受 chatId
- `src/core/MessageProcessor.ts` — 傳遞 chatId 給 hook
- `src/schedule/ScheduleExecutor.ts` — onIntermediateMessage 只保留最後一條
- `src/schedule/ScheduleNotifier.ts` — 用 agentId 作為 adapter key
- `src/index.ts` — 註冊 adapters 到 notifier
- `src/webui/views/agents/edit.ejs` — 保留非基本工具權限
- `src/persistence/DatabaseManager.ts` — Schema v4 migration
- `agents/_example/CLAUDE.md` — 排程指引更新
- `agents/general/CLAUDE.md` — 排程指引更新
- `agents/nitterbot/CLAUDE.md` — 排程指引更新

---

### v1.10.0 - Agent-Driven Scheduling System

**發布日期**：2026-01-29

**變更**：

1. **排程系統核心架構**
   - 三層架構：對話層 → 規格層 → 執行層
   - Agent 可偵測排程意圖，引導使用者建立 YAML 規格
   - 排程任務使用獨立 session 執行（Agent 有 Startup Protocol 提供 context）

2. **YAML 規格系統**
   - 排程檔案位置：`agents/{agentId}/schedules/{taskId}.yaml`
   - 支援 cron、interval、once 三種觸發類型
   - 完整的 Zod schema 驗證

3. **執行與通知**
   - `CronScheduler` 使用 node-cron 管理排程觸發
   - `ScheduleExecutor` 執行任務，記錄結果
   - `ScheduleNotifier` 發送 Telegram 通知（完成/失敗）

4. **資料庫擴展**
   - 新增 `scheduled_tasks` 表（任務定義）
   - 新增 `schedule_executions` 表（執行記錄）
   - Schema 版本升級至 v3

5. **Telegram 指令**
   - `/schedule list` - 列出所有排程
   - `/schedule info <id>` - 查看詳情
   - `/schedule pause/resume <id>` - 暫停/恢復
   - `/schedule run <id>` - 立即執行
   - `/schedule delete <id>` - 刪除
   - `/schedule history [id]` - 執行歷史

6. **Agent 指引擴展**
   - `agents/_example/CLAUDE.md` 新增 Scheduling System 區段
   - 定義觸發詞、建立流程、YAML 範例

**新增檔案**：
- `src/schedule/schemas.ts` — Zod schema 定義
- `src/schedule/types.ts` — TypeScript 類型
- `src/schedule/ScheduleLoader.ts` — YAML 載入器
- `src/schedule/CronScheduler.ts` — Cron 排程器
- `src/schedule/ScheduleExecutor.ts` — 任務執行器
- `src/schedule/ScheduleNotifier.ts` — 通知發送器
- `src/schedule/ScheduleManager.ts` — 統一管理介面
- `src/schedule/index.ts` — 模組匯出
- `src/persistence/ScheduleRepository.ts` — 排程資料庫操作

**修改檔案**：
- `src/persistence/DatabaseManager.ts` — 新增 v3 schema + migration
- `src/adapters/commands/TelegramCommands.ts` — 新增 /schedule 指令
- `src/core/PlatformOrchestrator.ts` — 傳遞 scheduleManager
- `src/index.ts` — 初始化排程系統
- `agents/_example/CLAUDE.md` — 新增排程指引

**新增依賴**：
- `node-cron` — Cron 表達式排程
- `yaml` — YAML 解析

---

### v1.9.2 - SDK 權限回調擴展 + /stop 指令

**發布日期**：2026-01-29

**變更**：

1. **Allow Always 權限選項（Phase 1）**
   - Telegram 權限提示新增三個按鈕：Allow / Always / Deny
   - 點擊 "Always" 會設定 `alwaysAllow: true` 並回傳 `updatedPermissions`
   - SDK 自動將權限寫入 `settings.local.json`，後續不再詢問
   - 更新 `PermissionDecision` 介面加入 `alwaysAllow?: boolean`
   - 更新 `PermissionResolver` 類型支援 `'allow' | 'always' | 'deny'`

2. **AskUserQuestion 處理（Phase 2）**
   - 新增 `QuestionBridge` 處理問題-答案的 async 協調
   - 新增 `QuestionPromptOptions`、`QuestionPromptResult`、`QuestionResolver` 類型
   - TelegramAdapter 實作 `sendQuestionPrompt`、`updateQuestionPrompt`、`setQuestionResolver`
   - callback_query handler 處理 `q_opt_*` 事件
   - canUseTool 閉包檢測 `AskUserQuestion` 工具並透過 Telegram 按鈕呈現選項
   - 目前只支援單選（multiSelect 未來再支援）

3. **/stop 指令**
   - 新增 `/stop` Telegram 指令，可強制中斷正在執行的 Claude 查詢
   - MessageProcessor 新增 `cancelQuery()`、`cancelQueryForUser()`、`hasActiveQueryForUser()` 方法
   - 更新 `/help` 和 `/start` 訊息加入 `/stop` 說明

4. **即時狀態訊息（Status Message）**
   - 處理查詢時發送「🔄 處理中...」狀態訊息
   - 捕捉 SDK tool 事件（tool_use, tool_result, tool_progress, tool_use_summary）
   - Debounce 更新（1 秒最小間隔）避免 Telegram API 速率限制
   - 顯示最近 5 個工具事件，提供即時執行反饋
   - 完成時更新為「✅ 完成（使用了 N 個工具）」
   - 狀態訊息不存入資料庫

**新增檔案**：
- `src/core/QuestionBridge.ts` — 問題-答案橋接器

**修改檔案**：
- `src/adapters/types.ts` — 新增 Question 相關類型 + ToolEvent、StatusMessage 類型
- `src/adapters/BaseAdapter.ts` — 新增 question 相關預設方法
- `src/adapters/TelegramAdapter.ts` — 實作 question UI + Always 按鈕 + callback handler + sendStatusMessage / updateStatusMessage
- `src/core/MessageProcessor.ts` — canUseTool 處理 AskUserQuestion + cancelQuery 方法 + 狀態訊息整合
- `src/core/SDKQueryManager.ts` — ExecuteQueryOptions 新增 onToolEvent callback + 捕捉 tool 事件
- `src/core/PermissionBridge.ts` — PermissionDecision 加入 alwaysAllow
- `src/adapters/commands/TelegramCommands.ts` — 新增 /stop 指令

---

### v1.9.1 - SDK 類型系統擴展

**發布日期**：2026-01-29

**變更**：

1. **SDK 類型轉接層**
   - 新增 `src/types/sdk.ts` — 從 `@anthropic-ai/claude-agent-sdk` 導入並 re-export 所有類型
   - 權限系統：`PermissionMode`, `PermissionBehavior`, `PermissionResult`, `CanUseTool` 等
   - Hook 系統：`HookEvent`, `HookCallback`, 13 種 Hook 輸入/輸出類型
   - 會話系統：`ExitReason`, `ConfigScope`, `SettingSource`
   - 訊息類型：`SDKMessage`, `SDKAssistantMessage` 等
   - 自定義 `AskUserQuestion` 類型（SDK 未暴露）

2. **PermissionMode 擴展**
   - 從 3 種擴展為 6 種：`default`, `acceptEdits`, `bypassPermissions`, `plan`, `delegate`, `dontAsk`
   - 更新 `PermissionModeSchema`（Zod）
   - 更新 `PERMISSION_MODE_MAP` 和 `SDKOptions` 介面

3. **Hook 事件擴展**
   - `HOOK_EVENT_NAMES` 加入 `setup` 事件（共 13 種）

**修改檔案**：
- `src/types/sdk.ts`（新增）— SDK 類型轉接層
- `src/types/agent.ts` — 擴展 PermissionModeSchema
- `src/types/hooks.ts` — 加入 setup 事件
- `src/types/index.ts` — 導出 sdk.ts
- `src/core/ConfigTransformer.ts` — 更新 PERMISSION_MODE_MAP 和 SDKOptions

**測試**：297 tests, 20 files 全部通過

---

### v1.9.0 - Agent 專門化支援（MCP + Skills）

**發布日期**：2026-01-29

**變更**：

1. **MCP Server 自動載入**
   - 配置檔從 `mcp.json` 改為 `.mcp.json`（符合 SDK 的 project scope 標準）
   - SDK 會自動從 `agents/{id}/.mcp.json` 讀取 MCP 配置
   - 不需要手動傳遞 `mcpServers` 選項

2. **Skills 支援**
   - Skills 目錄結構：`agents/{id}/.claude/skills/{skill-name}/SKILL.md`
   - SDK 會自動從 `.claude/skills/` 掃描並載入 skills
   - 需要在 `settings.local.json` 的 `allow` 清單加入 `"Skill"`

3. **General Agent 更新**
   - 新增 `"Skill"` 到允許的工具清單
   - 建立測試用 `.mcp.json`（echo server）
   - 新增 `capability-discovery` skill（引導用戶發現 MCP/Skills 資源）

4. **WebUI Skills 管理**
   - Agent Detail 頁面新增 Skills Tab
   - 上傳 skill zip 檔案安裝到 `.claude/skills/`
   - 檢視/編輯 SKILL.md 內容
   - 刪除 skills（含確認對話框）
   - 發現資源連結（SkillsMP、SkillHub、Anthropic Skills）

**修改檔案**：
- `src/core/AgentLoader.ts` — `MCP_CONFIG_FILE` 改為 `.mcp.json`
- `agents/general/.claude/settings.local.json` — 加入 `"Skill"`
- `agents/general/.mcp.json`（新增）— 測試 MCP 配置
- `agents/general/.claude/skills/capability-discovery/SKILL.md`（新增）— 能力發現引導 skill
- `src/webui/api/agents.api.ts` — Skills API endpoints
- `src/webui/types.ts` — SkillInfo 型別
- `src/webui/views/agents/detail.ejs` — Skills Tab UI

**配置範例**：

`.mcp.json`（放在 agent 根目錄）：
```json
{
  "mcpServers": {
    "echo": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-echo"]
    }
  }
}
```

SKILL.md（放在 `.claude/skills/{name}/SKILL.md`）：
```markdown
---
name: my-skill
description: My custom skill
---

Instructions for the skill...
```

---

### v1.8.1 - 時間注入修復

**發布日期**：2026-01-29

**變更**：

1. **UserPromptSubmit Hook 時間注入**
   - 新增 `buildPromptContext()` 函數，動態生成含當前時間的 context
   - 格式：`【當前時間】2026/01/29 00:24 週四`
   - 時區：Asia/Taipei
   - 修復 AI 時間認知錯誤（如「已經 12:21 卻說快 12 點」）

**修改檔案**：
- `src/core/constants.ts` — 新增 `buildPromptContext()` 函數
- `src/core/MessageProcessor.ts` — 使用動態 context 取代靜態常數

---

### v1.8.0 - Agent 頁面 UI 改善 + Memory System UI

**發布日期**：2026-01-28

**變更**：

1. **Agent Create/Edit 功能**
   - 新增 `POST /api/agents` - 從 `_example` 模板建立新 agent
   - 新增 `PUT /api/agents/:id` - 編輯現有 agent 設定
   - 新增 `GET /agents/create` 和 `GET /agents/:id/edit` 頁面
   - Agent ID、Name、Description、Model、Telegram Token、Permissions 完整編輯

2. **Agent Detail 頁面資訊補充**
   - 新增 Telegram Token 顯示（遮罩版 + Copy 按鈕）
   - 新增 Allowed Tools (Permissions) 顯示（綠色 pill badges）
   - Model 優先順序：`settings.local.json` > `agent.json` > `'sonnet'`

3. **Agent List 頁面**
   - 新增 Version 欄位顯示

4. **Memory System UI（Tab 整合）**
   - Detail 頁面改為 Tab 結構：System Prompt / Memory System / Sessions
   - Core Files 顯示：SOUL.md、USER.md、IDENTITY.md、MEMORY.md
   - Daily Logs 顯示：memory/*.md 日誌列表
   - Modal 編輯器：支援檢視和編輯記憶檔案
   - 新增 Memory API：
     - `GET /api/agents/:id/memory` - 列出記憶檔案
     - `GET /api/agents/:id/memory/file?path=...` - 讀取檔案
     - `PUT /api/agents/:id/memory/file` - 更新檔案

5. **Session 過期顯示修復**
   - Sessions 列表現在會顯示所有 sessions（包括超過 `SESSION_TIMEOUT_MS` 的過期 sessions）
   - 過期 sessions 從 DB 讀取，標記 `isExpired: true`
   - Session detail 頁面可以查看過期 sessions 的詳情和對話歷史
   - messageCount 從 conversations 表計算，不再顯示 0

**修改檔案**：
- `agents/_example/`（新增）— Agent 模板目錄
- `src/core/AgentLoader.ts` — scanAgents() 跳過 `_example`
- `src/webui/api/agents.api.ts` — POST/PUT agents + Memory API
- `src/webui/routes/agents.ts` — create/edit 路由 + sessions 從 DB 讀取
- `src/webui/views/agents/*.ejs` — UI 頁面（create, edit, detail, list）
- `src/webui/routes/sessions.ts` — 從 DB 讀取過期 sessions + messageCount
- `src/webui/api/sessions.api.ts` — 從 DB 讀取過期 sessions + messageCount
- `src/webui/types.ts` — CreateAgent/UpdateAgent/Memory 型別
- `src/persistence/types.ts` — IConversationRepository.getMessageCount

---

### v1.7.1 - General Agent 權限修正 + Memory Checkpoint Hook

**發布日期**：2026-01-28

**變更**：

1. **General Agent 權限修正**（`agents/general/.claude/settings.local.json`）
   - `allow` 加回 `Write` 和 `Edit`
   - 原因：記憶管理是 general agent 核心功能，每次寫入都要按按鈕體驗太差
   - 最終權限：`["Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"]`，只有 `Bash` 需要審批

2. **Memory Checkpoint Hook**
   - 新增 `src/core/constants.ts`：定義 `MEMORY_CHECKPOINT_CONTEXT` 常數
   - 修改 `src/core/MessageProcessor.ts`：透過 SDK `hooks.UserPromptSubmit` 注入記憶檢查提醒
   - 每次使用者送訊息時，agent 會收到提醒：「回覆前，先檢查上一輪對話是否有值得記錄的內容」
   - 目的：提高記憶寫入的可靠性，確保 agent 不會忘記保存重要內容

**修改檔案**：
- `agents/general/.claude/settings.local.json` — 權限修正
- `src/core/constants.ts`（新增）— MEMORY_CHECKPOINT_CONTEXT 常數
- `src/core/MessageProcessor.ts` — UserPromptSubmit hook 注入

---

### v1.7.0 - 互動式 Telegram 權限審批系統

**發布日期**：2026-01-28

**背景**：Agent SDK 執行工具時需要人類審批權限（canUseTool callback），但原先只能在 CLI 中操作。ClaudeCab 需要將此流程橋接到 Telegram，讓使用者透過 InlineKeyboard 按鈕即時審批。

**變更**：
- **PermissionBridge**（新增 `src/core/PermissionBridge.ts`）：Promise-based 非同步橋接，管理 requestId → deferred Promise，支援 120 秒 timeout 自動 deny、AbortSignal、cancelAll
- **PermissionBridge 單元測試**（新增 `tests/unit/PermissionBridge.test.ts`）：13 項單元測試覆蓋核心邏輯
- **Adapter 型別擴充**（`src/adapters/types.ts`）：新增 `PermissionPromptOptions`、`PermissionPromptResult`、`PermissionResolver` 型別
- **BaseAdapter 預設方法**（`src/adapters/BaseAdapter.ts`）：新增 3 個預設方法 — `sendPermissionPrompt`、`updatePermissionPrompt`、`setPermissionResolver`
- **TelegramAdapter 權限 UI**（`src/adapters/TelegramAdapter.ts`）：Override 3 個方法 + InlineKeyboard（Allow / Deny）+ `callback_query` handler；message handler 改為 fire-and-forget 避免 grammy polling deadlock；`doStart` 加入 `allowed_updates: ['message', 'callback_query']`
- **MessageProcessor 權限組裝**（`src/core/MessageProcessor.ts`）：建立 PermissionBridge、組裝 `canUseTool` 閉包、透過 `additionalOptions` 傳入 SDK；allow 回應包含 `updatedInput`（SDK Zod schema 要求）
- **Agent 權限收緊**（`agents/general/.claude/settings.local.json`）：`allow` 從 `["*"]` 改為 `["Read", "Glob", "Grep", "WebFetch", "WebSearch"]`（v1.7.1 加回 Write/Edit）

**修改檔案**：
- `src/core/PermissionBridge.ts`（新增）
- `tests/unit/PermissionBridge.test.ts`（新增）
- `src/adapters/types.ts` — 新增權限相關型別
- `src/adapters/BaseAdapter.ts` — 新增 3 個預設方法
- `src/adapters/TelegramAdapter.ts` — 權限 UI + fire-and-forget + allowed_updates
- `src/core/MessageProcessor.ts` — PermissionBridge 組裝 + canUseTool 閉包
- `agents/general/.claude/settings.local.json` — 權限收緊

---

### v1.6.0 - 中間訊息即時串流

**發布日期**：2026-01-28

**背景**：SDK 多輪 agent 處理期間會產生多個 assistant 訊息（「讓我查看檔案」 → 工具執行 →「找到了」→ 最終回答），但原本所有訊息收集後一次性發送，使用者在處理期間完全沒有反饋。

**變更**：
- **Callback-based Streaming**：`ExecuteQueryOptions` 新增 `onIntermediateMessage` optional callback，SDK for-await 迴圈中每收到 assistant 訊息即呼叫 callback 即時送出
- **MessageProcessor 串流注入**：`executeQueryWithSDK()` 注入 callback 閉包，透過 adapter 即時發送中間訊息到 Telegram
- **DB 分段持久化**：中間訊息獨立存入 DB，WebUI 對話記錄與 Telegram 看到的一致
- **QueryResult 擴充**：新增 `intermediateMessageCount` 欄位追蹤已串流的訊息數量
- **向後相容**：不提供 callback 時行為完全不變，既有 284 tests 零修改全部通過

**設計原則維持**：
- SDKQueryManager 保持解耦 — callback 是 optional 函式，不知道消費者身份
- 零 Adapter 改動 — TelegramAdapter 既有的 RateLimiter 自動處理多次呼叫

**修改檔案**：
- `src/core/SDKQueryManager.ts` — `ExecuteQueryOptions` + `QueryResult` 介面擴充、for-await 迴圈 callback 邏輯、移除未使用 import
- `src/core/MessageProcessor.ts` — `executeQueryWithSDK()` callback 注入、DB 分段持久化

**測試**：284 tests, 19 files 全部通過

---

### v1.5.2 - Moltbot Gap Analysis 實作

**發布日期**：2026-01-28

**背景**：根據 Moltbot 官方文件（docs.molt.bot）逐項對照，補齊 agents/general/ 缺少的機制。

**變更**：
- **教訓路由修正**：寫入規則從 SOUL.md 改為 CLAUDE.md 自身的 Lessons Learned 區段（符合官方 AGENTS.md 模板）
- **BOOTSTRAP.md**：新增首次啟動儀式，agent 第一次對話時自動執行 onboarding（認識使用者、定義自己），完成後刪除檔案
- **對話保護規則**：CLAUDE.md 新增 Auto-flush 行為規則，agent 在長對話中主動保存記憶
- **Lessons Learned 區段**：CLAUDE.md 尾部新增空區段，供 agent 自行寫入從經驗學到的操作規則

**決定不做**：
- **HEARTBEAT.md**：需要 Gateway 排程器配套才能實現定期巡邏，純 CLAUDE.md 指令無法達成
- **TOOLS.md**：general agent 不需要環境特定備註

**修改檔案**：
- `agents/general/CLAUDE.md` — 教訓路由 + Startup Protocol + 對話保護 + Lessons Learned
- `agents/general/BOOTSTRAP.md` — 新增
- `docs/moltbot-gap-analysis.md` — 新增（差距分析文件）

**設計原則維持**：零引擎改動，所有變更都在 agent 層

---

### v1.5.1 - Dynamic SystemPrompt

**發布日期**：2026-01-28

**問題**：AgentLoader 在啟動時讀取 CLAUDE.md 並快取為 `LoadedAgent.systemPrompt` 靜態字串。Agent 若在對話中透過 Write 工具自主更新 CLAUDE.md（記憶協議允許），後續 query 仍使用舊的快取值。

**修復**：
- **AgentLoader.readSystemPrompt(agentId)** — 新增方法，每次從磁碟重新讀取 CLAUDE.md（保持原有優先序：config.systemPrompt > systemPromptFile > CLAUDE.md）
- **MessageProcessorOptions.getSystemPrompt** — 新增可選的函式注入點，每次 query 前呼叫以取得最新 systemPrompt
- **MessageProcessor.executeQueryWithSDK()** — 使用注入的 `getSystemPrompt(agent.id)` 取代快取的 `agent.systemPrompt`
- **index.ts** — 連接 `agentLoader.readSystemPrompt()` 到 MessageProcessor

**設計原則維持**：
- SDKQueryManager 零改動 — 仍然只接收 systemPrompt 字串
- 依賴注入 — MessageProcessor 透過函式接收，不直接依賴 AgentLoader
- 向下相容 — `getSystemPrompt` 為 optional，未提供時 fallback 到 `agent.systemPrompt` 快取值

**修改檔案**：
- `src/core/AgentLoader.ts` — 新增 `readSystemPrompt()` 方法
- `src/core/MessageProcessor.ts` — 新增 `getSystemPrompt` 注入、每次 query 前讀取最新
- `src/index.ts` — 連接 agentLoader 到 messageProcessor

**測試**：284 tests, 19 files 全部通過

---

### v1.5.0 - Agent 記憶系統

**發布日期**：2026-01-28

**重大變更**：
- **Moltbot 風格記憶系統**：`agents/general/` 整合自主記憶能力，採用 Moltbot 純檔案記憶架構
- **零程式碼改動**：不動 `src/` 任何一行，記憶邏輯完全由 Agent 透過 CLAUDE.md 指令自行管理
- **SDKQueryManager 完全解耦**：記憶系統不污染 SDK 整合層，SDKQueryManager 可獨立抽離做其他開發

**設計原則**：
- Agent 自主管理 — CLAUDE.md 定義記憶協議，Agent 用 Read/Write 工具自行讀寫 workspace 檔案
- 不建立「組裝層」— 不在 MessageProcessor 或任何中間層把記憶內容注入 systemPrompt
- SDKQueryManager 只接收 systemPrompt 字串 + cwd 路徑，完全不知道記憶系統的存在

**新增檔案**（`agents/general/`）：
- `CLAUDE.md`（改寫）— 從 9 行簡單提示改為完整記憶協議（Startup Protocol + Memory System + Safety）
- `SOUL.md` — 人格定義（Core Truths、Boundaries、Vibe、Continuity、Voice Guide）
- `USER.md` — 使用者檔案模板
- `IDENTITY.md` — AI 身份模板
- `MEMORY.md` — 長期記憶空結構
- `memory/.gitkeep` — 每日日誌目錄

**Agent 啟動協議**（CLAUDE.md 定義）：
1. 讀 SOUL.md — 知道自己是誰
2. 讀 USER.md — 知道對面是誰
3. 讀 IDENTITY.md — 知道自己的名字和風格
4. 讀 MEMORY.md — 知道過去的重要事實
5. 讀 memory/今天.md — 知道今天發生了什麼
6. 讀 memory/昨天.md — 知道昨天的 context

**記憶寫入規則**：
| 內容 | 寫到哪裡 |
|------|----------|
| 決定、偏好、持久事實 | MEMORY.md |
| 日常筆記、進行中 context | memory/YYYY-MM-DD.md |
| 學到的教訓、犯的錯 | SOUL.md |
| 人格上的自我發現 | SOUL.md（修改必須通知使用者）|

**參考設計**：[Moltbot 純檔案記憶架構](../../docs/moltbot-blueprint.md)（Phase 0）

---

### v1.4.1 - 對話連續性修復

**發布日期**：2026-01-27

**問題**：伺服器重啟後對話永遠從零開始，日誌顯示 `resume: "(new session)"`

**根因**：Session 過期→DB 刪除→ON DELETE CASCADE 刪除對話歷史→新 session 無 sdkSessionId→SDK 開啟全新對話

**修復**：
- **保留 DB 行**：`cleanupExpired()` 只從記憶體移除，DB 行保留供對話延續
- **restoreSessions()** 僅清理超過 `dbRetentionMs`（預設 30 天）的古老 session，過期 session 不載入記憶體但保留在 DB
- **createSession() 繼承 sdkSessionId**：建立新 session 前查 DB 取回先前 `session_id` + `sdk_session_id`，重用舊 session ID（保持 conversations FK 關聯）
- **Resume 失敗自動重試**：`executeQueryWithSDK()` 帶 resume 呼叫 SDK 失敗時，清除 sdkSessionId 並不帶 resume 重試一次（優雅降級）
- **Server crash 恢復**：`restoreSessions()` 自動重置卡住的 `processing` 狀態為 `idle`

**新增設定**：
- `SessionStoreConfig.dbRetentionMs` — DB 保留期（預設 30 天），超過此期限的 session 在啟動時清除
- `DB_RETENTION_MS` 環境變數

**修改檔案**：
- `src/core/SessionManager.ts` — cleanupExpired、restoreSessions、createSession
- `src/core/MessageProcessor.ts` — executeQueryWithSDK resume 重試邏輯
- `src/types/session.ts` — dbRetentionMs 配置
- `src/persistence/types.ts` — IConversationRepository 補 getLastMessages
- `src/index.ts` — DB_RETENTION_MS 環境變數
- `tests/unit/SessionManager.test.ts` — 新增 4 個對話連續性測試

**測試**：284 tests, 19 files 全部通過

---

### v1.4.0 - 設計債清理與架構對齊

**發布日期**：2026-01-27

**重大變更**：
- **移除 Legacy 模式**：SDK 為唯一模式，移除 `USE_CLAUDE_AGENT_SDK` 環境變數、Legacy 執行路徑、直接使用 @anthropic-ai/sdk 的程式碼
- **移除 CLI**：刪除 `src/cli.ts` 與 `npm run cli` script
- **SDK 訊息持久化**：SDK query 完成後自動將 user/assistant 訊息存入 ConversationRepository，供 WebUI 查看對話歷史
- **agent.json 配置生效**：`maxTurns` 等設定值從 agent 配置讀取（原先硬寫為 10）
- **清理安全框架**：移除未使用的 `ConfirmationManager`、`SensitiveCommandConfig`、`PendingConfirmation`、`DEFAULT_SENSITIVE_COMMANDS`
- **清理 ConversationRepository**：移除 Legacy 專用方法（`trimConversation`、`bulkInsert`、`cleanupOrphaned`）

**移除檔案**：
- `src/cli.ts`

**修改檔案**：
- `src/core/MessageProcessor.ts` — 移除 Legacy 分支、讀取 agent maxTurns、新增 SDK 訊息持久化
- `src/index.ts` — 移除 Legacy 初始化、連接 conversationRepository 到 MessageProcessor
- `src/persistence/ConversationRepository.ts` — 移除 Legacy 方法
- `src/persistence/types.ts` — 移除 `trimConversation` 介面方法
- `src/utils/security.ts` — 移除 ConfirmationManager 相關程式碼
- `src/utils/index.ts` — 移除 ConfirmationManager exports
- `package.json` — 移除 cli script

**測試**：280 tests, 19 files 全部通過

---

### v1.3.0 - 多機器人架構

**發布日期**：2026-01-27

**重大變更**：
- **每個 Agent 獨立 Bot**：從「單一 Bot + `/switch` 切換」改為「一個 Agent 一個 Bot」
- 新增 `PlatformOrchestrator` — 統一管理所有平台 Adapter 的生命週期
- 新增 `AdapterRegistry` — `platform::agentId` 複合鍵管理 Adapter 實例
- Session Key 從 `platform::userId` 改為 `platform::agentId::userId`
- DB Schema v2 — UNIQUE 約束加入 `agent_id`，含自動 migration
- 移除 `/switch`、`/list` Telegram 指令
- 移除 `switchAgent()` 方法
- 移除 `TELEGRAM_BOT_TOKEN` 環境變數

**新增欄位**：
- `agent.json` 新增 `telegramBotToken` 欄位

**新增檔案**：
- `src/core/PlatformOrchestrator.ts`
- `src/core/AdapterRegistry.ts`

**修改檔案**：
- `src/types/agent.ts` — AgentConfigSchema 新增 telegramBotToken
- `src/types/session.ts` — getSessionKey 改為三段式
- `src/persistence/DatabaseManager.ts` — Schema v2 migration
- `src/persistence/SessionRepository.ts` — 查詢加入 agentId
- `src/core/SessionManager.ts` — 所有方法加入 agentId 參數
- `src/core/MessageProcessor.ts` — 接收外部傳入 agentId
- `src/core/AgentLoader.ts` — 新增 getAgentsWithPlatformTokens()
- `src/adapters/TelegramAdapter.ts` — 建構綁定 agentId
- `src/adapters/commands/TelegramCommands.ts` — 移除 switch/list
- `src/index.ts` — 使用 PlatformOrchestrator 啟動
- `src/webui/types.ts` — 注入 PlatformOrchestrator
- `src/webui/routes/agents.ts` — 顯示 Bot 狀態
- `src/webui/api/agents.api.ts` — Bot 重載使用 Orchestrator
- `src/webui/views/agents/list.ejs` — Bot Status 欄位
- `src/webui/views/agents/detail.ejs` — Bot Status 區塊

**WebUI 增強**：
- Agents 列表頁顯示各 Bot 運行狀態（綠色/黃色 badge）
- Agent 詳情頁顯示 Bot 狀態資訊
- Agent 重載透過 Orchestrator 同時重啟 config 與 Adapter

**測試**：312 tests, 19 files 全部通過（v1.4.0 後降為 280 tests）

---

### v1.2.0 - WebUI 管理介面

**發布日期**：2026-01-27

**重大變更**：
- 新增 `src/webui/` 模組 - Express + EJS 管理介面
- 支援密碼認證（JWT + httpOnly Cookie）
- Dashboard 系統狀態監控
- Agents 管理（列表、詳情、重載）
- Sessions 管理（列表、篩選、關閉、清理）
- Conversations 查看與匯出

**新增依賴**：
- express ^5.0.1
- ejs ^3.1.10
- cookie-parser ^1.4.7
- jsonwebtoken ^9.0.2
- tailwindcss ^3.4.17（開發依賴）

**新增環境變數**：
- `WEBUI_ENABLED` - 啟用 WebUI（預設 false）
- `WEBUI_PORT` - WebUI 埠號（預設 3001）
- `WEBUI_PASSWORD` - 登入密碼（必填）
- `WEBUI_JWT_SECRET` - JWT 密鑰
- `WEBUI_SESSION_EXPIRE` - Session 過期時間

**新增檔案**：
- `src/webui/WebUIServer.ts` - Express Server
- `src/webui/middleware/auth.ts` - JWT 認證
- `src/webui/routes/` - 頁面路由
- `src/webui/api/` - API 端點
- `src/webui/views/` - EJS 模板（元件化設計）
- `public/` - 靜態資源

**架構特點**：
- 元件化 EJS 模板（components/, partials/）
- 使用 `partials/start.ejs` + `partials/end.ejs` 包裹模式（EJS 不支援原生 layout）
- 依賴注入（透過 middleware 注入到 request）
- 服務層分離（StatsService）
- 啟動時預載所有 Agents（`loadAllAgents()`）

**已知修復**：
- 修正 EJS 模板結構（從錯誤的 JavaScript 模板字串語法改為正確的 EJS include）
- 修正 Agents 列表不完整問題（改用 `loadAllAgents()` 預載）

---

### v1.1.0 - SQLite 持久化

**發布日期**：2026-01-26

**重大變更**：
- 新增 `src/persistence/` 模組
- 支援 Session 持久化到 SQLite
- 重啟後可恢復 Session（SDK 模式透過 resume）
- WAL 模式提升並發效能

**新增環境變數**：
- `ENABLE_PERSISTENCE` - 啟用持久化（預設 false）
- `DB_PATH` - 資料庫路徑

**新增檔案**：
- `src/persistence/DatabaseManager.ts`
- `src/persistence/SessionRepository.ts`
- `src/persistence/ConversationRepository.ts`
- `src/persistence/types.ts`

---

### v1.0.0 - 生產環境就緒

**重大變更**：
- 完整的 Telegram Bot 功能
- 323 個測試，覆蓋率達標
- CLI 測試工具（v1.4.0 移除）
- Docker 部署支援

**已實作功能**：
- AgentLoader + ConfigTransformer
- SessionManager（含並發控制、冪等性檢查）
- TelegramAdapter（含速率限制、長訊息分割）
- 指令系統（/start, /help, /reset）（v1.3.0 移除 /list, /switch）
- 安全機制（用戶白名單、審計日誌、輸入驗證）

---

### v0.6.0 - 安全強化

**新增功能**：
- 用戶白名單（ALLOWED_USERS 環境變數）
- 審計日誌模組（src/utils/audit.ts）
- 訊息長度限制
- 基本 Prompt Injection 偵測
- 敏感指令確認機制（v1.4.0 移除 ConfirmationManager）

---

### v0.5.0 - Telegram 平台整合

**新增功能**：
- TelegramAdapter（使用 grammy）
- 訊息分割（4096 字元上限）
- 打字指示器
- 速率限制（35ms 最小間隔）
- 指令處理

---

### v0.4.0 - SessionManager

**新增功能**：
- 多用戶 Session 管理
- `platform::userId` 作為 session key（v1.3.0 改為 `platform::agentId::userId`）
- 並發控制（async-mutex）
- 冪等性檢查
- 自動清理過期 Session

---

### v0.3.0 - AgentLoader

**新增功能**：
- 目錄掃描載入 Agent
- Zod Schema 驗證
- Agent 繼承（extends）
- hooks.ts 動態載入

---

### v0.2.0 - 型別定義

**新增功能**：
- 完整 TypeScript 型別系統
- Zod Schema 驗證
- 自訂錯誤類別

---

### v0.1.0 - 專案初始化

**建立項目**：
- TypeScript + ESM 配置
- ESLint + Prettier
- Vitest 測試框架
- pino 日誌系統
