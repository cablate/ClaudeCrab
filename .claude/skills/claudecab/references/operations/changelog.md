# ClaudeCab 版本歷史

> 架構決策紀錄 (ADR) 已移至 [decisions/_index.md](../decisions/_index.md)
>
> 歷史版本紀錄（v0.1.0 ~ v1.24.0）請參見 [changelog-archive.md](../_archive/operations/changelog-archive.md)

---

## 版本歷史

### v1.41 - Table Markdown 轉換 + 通用規則注入

**發布日期**：2026-02-23

**Table Markdown 智能轉換**：
- Telegram 不支援 markdown table 語法（`| --- |` 原樣顯示）
- 新增 `convertTablesToTelegramFormat()` — 偵測並轉換所有 markdown table
- 新增 `parseMarkdownTable()` — 解析 table 為結構化資料（headers + rows）
- 所有表格統一轉換為列表格式：`• col1: val1 | col2: val2 | col3: val3`
- 整合於 `convertToTelegramMarkdown()` — 先處理 table 再傳給 `telegramifyMarkdown`，避免 escape 問題

**通用規則注入機制**：
- `AgentLoader.loadSystemPrompt()` 新增 `getGlobalStaticRules()` — 引擎層通用規則統一注入
- 檔案傳送語法 `[send:path]` 從 `constants.ts` 動態注入移至 AgentLoader 靜態注入
- 設計原則：無 runtime 變數的規則 → L0（CLAUDE.md / AgentLoader 靜態）；有變數 → L1（buildPromptContext 動態）

**Agent SDK CLAUDE.md 載入研究**：
- 確認 SDK 需要 `settingSources: ['project']` 才會自動載入 CLAUDE.md
- 發現 ClaudeCab 目前重複載入 CLAUDE.md（SDK 自動 + 手動 append）
- 待評估方案：A) 移除手動讀取讓 SDK 處理；B) 移除 settingSources 中的 'project'

**修改檔案**：
- `src/utils/telegramMarkdown.ts` — table 轉換功能
- `src/core/AgentLoader.ts` — `getGlobalStaticRules()` + `loadSystemPrompt()` 整合
- `src/core/constants.ts` — 移除 `buildPromptContext()` 中的檔案傳送規則

---

### v1.40 - Inline Image 自動發圖

**發布日期**：2026-02-17

**圖片自動發送**：
- Agent 回覆中包含圖片路徑時，自動偵測並以 Telegram photo 發送
- `BaseAdapter.sendPhoto()` 抽象方法 + `TelegramAdapter` 實作（grammy `InputFile` + rateLimiter）
- `MessageProcessor.sendInlineImages()` — regex 偵測 → `existsSync` 驗證 → 發送 → strip 路徑
- 支援格式：Windows 反斜線/正斜線、Unix 絕對路徑、相對路徑、backtick 包裹、markdown `![](path)` 語法
- 整合於 `onIntermediateMessage` 和 `sendFinalResponse` 兩條路徑

---

### v1.39 - RPG 角色管理面板 + 獨白 Per-Agent 設定

**發布日期**：2026-02-17

**角色管理面板（Live page）**：
- Stats modal 改為 Tab 式設計：角色 / 裝備 / 排程 / 記憶 / 設定
- 角色 tab：Bot 控制（啟動/停止）+ 24h 用量 bar
- 裝備 tab：Skills 列表、查看 SKILL.md 內容、刪除 skill
- 排程 tab：排程卡片、暫停/恢復/立即執行/刪除
- 記憶 tab：核心檔案 + 每日日誌列表、點擊查看內容
- 設定 tab：模型/tokens/turns/權限模式/委派/自主行動/獨白，全中文標籤 + 說明文字
- Lazy loading：每個 tab 首次切換才 fetch API

**閒置獨白 Per-Agent 設定**：
- 新增 `settings.idleMutter` 配置：`enabled`（預設 true）、`chance`（預設 0.3）、`maxPerHour`（預設 3）
- `IdleMutterScheduler` 注入 `AgentLoader`，迴圈中讀取 per-agent config 覆寫全域預設
- 設定 tab 可直接開關獨白 + 調整參數

**STT 語音轉文字**：
- 新增 OpenAI Whisper STT provider（`src/core/stt/`）
- TelegramAdapter 支援語音訊息（voice/audio）→ 轉文字處理
- `.env` 新增 `STT_ENABLED`、`STT_API_KEY` 配置

### v1.38 - 新年主題 Title Screen + 編輯模式升級

**發布日期**：2026-02-16

**Galgame 風格 Title Screen**：
- 全屏開場畫面：新年辦公室背景 + 三人合照立繪 + 浮動光粒子 + 🏮搖擺動畫
- 標題「ClaudeCrab 🦀」漸層 shimmer + 多層 text-shadow 確保可讀性
- 右下 Galgame 選單「はじめる / START」，Enter/Space/ESC 可進入
- 進入後淡出並移除 DOM

**編輯模式升級**：
- 🔧 按鈕加文字標籤「🔧 編輯」，hover/active 狀態更明顯
- 進入編輯模式顯示中上方工具列：🖼️ 背景切換 + ✓ 儲存 / ✕ 取消
- 背景切換：預設 / 新年兩套辦公室，選擇存 localStorage
- 儲存/取消機制：拖曳不即時寫入，✓ 才存，✕ 還原所有變更
- Sprite 虛線框加粗 + 呼吸脈衝動畫，拖曳中綠色實線 + 光暈
- 場景邊框高亮，提示文字移至底部膠囊標籤

**其他**：
- Header 標題改為 ClaudeCrab 🦀
- HUD 花費改為歷史總累計
- 全域防誤選反白（圖片、sprite、按鈕等，對話框除外）

**新增圖片**：
- `public/images/office-background-cny.png` — 新年辦公室背景
- `public/images/title-cny.png` — 三人新年合照

**改動檔案**：
- `src/webui/views/live/index.ejs` — Title Screen HTML + 編輯工具列
- `public/css/live.css` — Title Screen 樣式 + 編輯模式重設計 + 防選取
- `public/js/live.js` — Title Screen 邏輯 + 編輯模式 save/cancel + bg switcher

### v1.37 - Sprite 編輯模式

**發布日期**：2026-02-16

**Sprite 自由擺放**：
- 場景右下角 🔧 toggle 進入編輯模式
- Pointer Events 拖曳（滑鼠 + 觸控）、場景邊界限制
- 自訂位置存 `localStorage['claudecab-sprite-custom-positions']`
- 載入優先級：自訂位置 > seat assignment > overflow grid
- 編輯模式下 sprite 顯示虛線框，click 不觸發 portrait

**改動檔案**：
- `src/webui/views/live/index.ejs` — 🔧 按鈕
- `public/css/live.css` — 編輯模式視覺（虛線框、提示文字、拖曳狀態）
- `public/js/live.js` — 拖曳系統、localStorage 讀寫、edit mode toggle

### v1.36 - Live 遊戲化後台整合 + UI 重設計

**發布日期**：2026-02-16

**Game Menu（全新）**：
- 全螢幕 overlay（☰ 按鈕觸發），四個頁籤：用量 / 任務 / 系統 / 成員
- 用量頁：今日花費、查詢數、IN/OUT tokens、7 天柱狀圖、per-agent 表格
- 任務頁：進行中 session 列表、關閉/清理操作
- 系統頁：uptime、memory HP bar、bot 啟停
- 成員頁：agent 列表、model badge、reload 操作
- 新增 API：`GET /api/usage/agents?days=N`（per-agent 聚合用量）
- 未登入時顯示登入提示（檢查 `/api/system/health` 401）

**HUD 資源列擴充**：
- Header 新增 💰花費 / ⚡查詢 / ⏱uptime（每 60s polling）
- 點擊 stat → 打開 Game Menu 對應頁籤

**角色屬性面板**：
- 對話框 nameplate 新增 📊 屬性 toggle
- 切換時 overlay 在對話文字上方（position absolute 在 dialogue-box 內）
- 顯示 24h 花費、查詢數、IN/OUT tokens、model、bot 狀態

**Roster 通知徽章**：
- 有新 personality event 時 roster 卡片顯示紅點脈衝動畫
- 點進 portrait 後紅點消失

**色系統一（玫瑰/梅色系）**：
- Game Menu：深藍 `rgba(12,16,40)` → 深梅 `rgba(35,20,32)`，accent 藍 `#60a5fa` → 玫瑰 `#c88caa`
- Backlog 紀錄面板：全面從藍色改為玫瑰/梅色調
- 對話框 stats panel / toggle：粉色調統一
- Canvas 柱狀圖漸層：藍 → 玫瑰

**Activity Feed 側欄改為 overlay**：
- 從 flex 佈局改為 `position: fixed` 覆蓋模式
- 預設收起，右側邊緣 toggle 按鈕 ◀/▶ 控制
- 開關不影響主畫面尺寸

**改動檔案**：
- `src/webui/api/usage.api.ts` — 新增 `/agents` endpoint
- `src/webui/views/live/index.ejs` — menu overlay + HUD + stats panel + sidebar toggle
- `public/css/live.css` — 全部新增 UI 樣式 + 色系重寫
- `public/js/live.js` — menu / HUD / stats / roster / sidebar 邏輯

### v1.35 - ADR-031 Phase 2: Stop Hook 外部化

**發布日期**：2026-02-16

**Stop Hook 外部化**（ADR-031 Phase 2）：
- 新建 `agents/_shared/hooks/memory-stop-checkpoint.ts` — 讀 stdin `stop_hook_active` flag，決定 allow/block
- 各 agent `settings.local.json` 新增 `Stop` command-type hook 配置
- 從 `MessageProcessor.ts` 移除硬編 Stop programmatic hook
- 從 `constants.ts` 移除 `MEMORY_STOP_CHECKPOINT` 常數和 `buildMemoryStopCheckpoint()` 函式
- UserPromptSubmit 經評估後保留在引擎（runtime 條件式內容無法有意義地靜態外部化）

### v1.34 - Galgame 美學統一 + 即時串流回覆（當前版本）

**發布日期**：2026-02-16

**即時串流回覆**：
- `onIntermediateMessage` 回調中新增 `emitReply()` — 每段中間回覆即時推送到 Web UI
- 結尾 `emitReply()` 改為只送 `result.response`（最後一段），避免重複
- 原先行為：SDK 全部跑完後才一次送 `fullResponse`；現在：每個 assistant turn 即時串流

**對話框淺粉重設計**：
- 對話框背景從深藍黑改為淺粉漸層（rgba 235,200,215）
- 所有文字從白底改為深梅色（#2a1020）提升對比度
- Quick reply 按鈕、輸入框、送出按鈕、nameplate 全部適配粉色調
- 歷史紀錄按鈕從對話框下方移到 nameplate 右側（pill 樣式）

**Roster 區粉調統一**：
- `.party-roster` 漸層從純黑改為暗紫粉（rgba 80,45,65 → rgba 45,25,40）
- `.roster-card` 底色從深黑改為暗紫粉（rgba 60,35,50）
- 狀態文字對比度從 0.5 提升至 0.85

**立繪微演出（CSS）**：
- `task_received` → sprite-jump（跳起）
- `completed` → sprite-celebrate（閃光粒子）
- `error` → sprite-error（震動+紅閃）
- `triggerPhaseAnimation()` 觸發，`animationend` 自動清除

**Markdown 渲染修復**：
- Portrait 回覆改用 `renderSimpleMarkdown()` 渲染（支援 bold/italic/code/list/heading）
- typewriterEffect 新增 `markdown` 選項，動畫結束後切換為 HTML
- 補上遺漏的 italic（`*text*`）支援

**Agent 靜默模式修復**：
- `MEMORY_STOP_CHECKPOINT` 和 `MEMORY_CHECKPOINT_CONTEXT` 加入靜默模式指令
- 修復私聊中記憶檢查結果被輸出為可見文字的問題

---

### v1.33 - Live Page 互動輸入功能

**發布日期**：2026-02-14

**Web UI → Agent 訊息傳送**：
- 新增 `POST /api/messages/send` endpoint（`src/webui/api/messages.api.ts`）
- Web UI 與 Telegram 完全共享 session（同一個 session key：`telegram::agentId::userId`）
- 使用 `ALLOWED_USERS[0]` 作為 owner userId，零新增環境變數
- 走完全相同的 `processMessage()` 流程，回應同時出現在 Web 和 Telegram

**Portrait 面板互動 UI**：
- Quick Reply 按鈕（3 個預設選項）+ 自由輸入 textarea
- Enter 送出 / Shift+Enter 換行 / Loading state
- 樣式融入 Galgame 美學（漸層按鈕、半透明輸入框）

**對話內容改善**：
- `emitReply()` 移除 200 字元截斷，全文傳送
- `MessageProcessor` 移除 reply preview 截斷
- `.dialogue-box` 加入 `max-height: 40vh` + `overflow-y: auto` 支援長文滾動

---

### v1.32 - Live Page Event 重構 + Reply Event

**發布日期**：2026-02-13

**Activity Event 系統重構**：
- 新增 `reply` event type — agent 回覆訊息現在進入 activity system（截斷 200 字）
- `ActivityService.emitReply()` 新方法，`MessageProcessor` 在 `emitWorkflow('completed')` 後自動 emit
- SSE `/stream` 移除初始批次推送（原先推 30 筆全被前端 2s hack 丟棄）
- 前端資料/DOM 分離：`storeEvent()`（記憶層）+ `isFeedVisible()`（顯示層）
- `activityFeed[]` 現在存所有事件，sidebar feed DOM 層 filter 掉 status_change/auto-idle
- `loadRecentFeed` limit 20→50，reverse API 結果確保 `[0]` 是最新事件

**Live Page Backlog 劇情回顧**：
- Backlog modal 按 timestamp 排序（oldest-first），自動 scrollToBottom
- 顯示完整對話脈絡：使用者訊息（📩）→ agent 心聲（💭）→ agent 回覆（💬）
- Backlog overlay 限制在 office-scene 區域（`position: absolute`）
- 文字對比度提升（全部 backlog 文字 opacity 調高）

**Bug 修復**：
- Portrait/sprite bubble filter 統一為 mutter/reaction/reply（修復顯示 stale workflow 資料）
- `loadRecentFeed` 事件順序修正（reverse 後 unshift，確保最新在 `[0]`）

---

### v1.31 - Live Page Data-Driven 重構

**發布日期**：2026-02-12

**Live Page 資產配置後端驅動化（ADR-032）**：
- 刪除前端 `AGENT_ASSETS` hardcode 常量，改從 `/api/activity/agents` API 動態載入
- `agent.json` 新增 `display` 欄位（avatar, color, sprite, portrait, emoji）
- `AgentConfigSchema`（Zod）新增 `DisplaySchema` 型別定義
- `activity.api.ts` 讀取 display config 組裝完整 URL 回傳
- emoji key 對齊 `ActivityMood` 值（neutral/excited/annoyed/tired/focused/bored）
- `pickEmojiKey` 簡化為 mood → phase→mood fallback → neutral
- 圖片遷移至 `public/images/agents/{agentId}/` 標準目錄結構
- 無 display 設定的 agent 自動 fallback（avatar emoji 替代 sprite）

**Bug 修復**：
- `ActivityService.ts`：移除 lastEvent 60 秒過期限制（重新整理後保留最新狀態）
- `ActivityService.ts`：auto-idle event message 改用 `PHASE_DESCRIPTIONS.idle`
- `live.js`：agentCards 即時同步 phase/mood（修復 dialogue panel 狀態不更新）
- `live.js`：過濾 workflow idle 事件不顯示在 feed
- `live.js`：修復 `populateInitialBubbles` 被嵌套在 `init()` 內的問題
- `live.css`：修復 media query 巢狀 `}` 缺失

---

### v1.30 - PathValidator 外部化 + Admin Agent + Serena 標配

**發布日期**：2026-02-12

**PathValidator Hook 外部化（ADR-031）**：
- 新增 `agents/_shared/hooks/path-validator.ts` 外部驗證腳本
- PathValidator 從引擎硬編移至各 agent 的 `settings.local.json` hooks 配置
- 引擎 `MessageProcessor.ts` / `ScheduleExecutor.ts` 不再包含 PathValidator hook
- 移除 `allowAllAgents` flag（agent.ts、PathValidator.ts、admin agent.json）

**Admin Agent（總管）**：
- 新增 `agents/admin/` — Agent 管理員，可跨目錄管理所有 agent
- 不配置 path-validator hook = 天然無限制
- 含 agent-management skill（操作指南 + 建立新 agent 指南）

**Serena MCP 標配化**：
- 所有 agent 新增 `.mcp.json`（Serena server 配置）
- 所有 agent 的 `settings.local.json` 新增 `mcp__serena__*` 權限
- 所有 agent 的 `CLAUDE.md` 新增 Serena 操作規則

**前次 session 變更（一併收錄）**：
- 人格來源修正：SocialEvaluator / InitiativeEvaluator 改讀 soul.md 而非 agent.json description
- ReactionGenerator：擴充 mutter 場景 + 反重複 prompt 約束

---

### v1.29.2 - Agent 記憶搜尋指引

**發布日期**：2026-02-11

**general agent CLAUDE.md**：
- 新增記憶搜尋指引，使用 Serena `search_for_pattern` 搜尋 memory/knowledge/groups
- 評估並放棄 qmd（SQLite FTS5 不支援中文 2 字搜尋）

---

### v1.29.1 - WebUI 對齊 + Skill 優化

**發布日期**：2026-02-11

**WebUI 後台調整**：
- Memory API coreFilesDef 路徑更新：SOUL.md/IDENTITY.md → `.claude/skills/persona/references/` 實際路徑
- Core Files 新增 CLAUDE.md（啟動協議）
- Clone agent 的 reset 註解修正（移除過時的 SOUL.md/IDENTITY.md 引用）
- Skills tab 從 grid 卡片改為伸縮列表（accordion），顯示完整目錄名含 sys-/dom- 前綴

**dom-find-skills 重構**（agentskill-expertise 審視）：
- SKILL.md 精簡化（~120 行 → ~30 行），SOP 細節移到 references/cli-guide.md
- Description 加入主動更新時機
- 核心原則提煉為「不編造，先搜後答」
- 安裝範圍統一為 agent 專屬（移除 `-g`）
- general 和 _example 同步更新

---

### v1.29.0 - Agent 模板現代化

**發布日期**：2026-02-11

**目標**：讓新建 agent 起步即正確，_example 模板升級到 general 的最佳實踐水準

**模板升級**：
- 刪除舊版 skills（`agent-protocols`、`equip`、`find-mcp`、`find-skills`）和 `EQUIPMENT.md`
- 新增 4 個現代化 skills：`sys-agent-protocols`、`persona`、`dom-find-mcp`、`dom-find-skills`
- persona 的 identity.md / soul.md 使用 `{{AGENT_NAME}}`、`{{AGENT_DESCRIPTION}}` 佔位符
- CLAUDE.md 啟動協議引用更新為 `/sys-agent-protocols`
- scheduling.md 移除硬編碼路徑，改為通用說明

**建立流程**：
- `POST /api/agents` 新增 persona identity.md / soul.md 佔位符替換

---

### v1.28.0 - System Prompt Preset Append

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
