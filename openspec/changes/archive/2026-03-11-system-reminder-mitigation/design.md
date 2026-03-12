## Context

Claude Code Agent SDK 內部的 `readFileState`（LRU Cache）追蹤已讀/已寫的檔案，每輪 user message 時執行 stale check（`jqY`），若偵測到檔案變更就注入 diff 到 `<system-reminder>`。

Agent SDK 的致命問題：`readFileState` 是 `submitMessage()` 的區域變數，每次都從 JSONL 用 `C26` 函數全量重建（max=10），所有 entry 設為 `offset: undefined` → 全部被追蹤，`timestamp` 用過去時間 → 幾乎一定觸發注入。

同時，ClaudeCab 的 `AgentLoader.loadSystemPrompt()` 手動讀取 CLAUDE.md 並作為 `systemPrompt.append` 傳給 SDK，而 SDK 的 `settingSources: ['project']` 已透過 WL8 自動載入同一份 CLAUDE.md，導致內容重複。

完整逆向分析見 `system-reminder-調查報告.md` 和 `system-reminder-工程筆記.md`。

## Goals / Non-Goals

**Goals:**

- 阻止 C26 從 JSONL 重建 readFileState entry，消除歷史對話帶來的 diff 注入
- 消除 CLAUDE.md 在 system prompt 中的重複注入
- 移除 TTS 強制觸發指令，降低 system prompt 固定成本
- 提供效能觀測數據（file size、duration、patch count）供後續優化

**Non-Goals:**

- 不嘗試阻止 runtime Edit/Write 產生的 readFileState entry（SDK 內部，無法控制）
- 不修改 SDK 原始碼或 monkey-patch 內部函數
- 不處理 WL8 memory loader 本身的路徑 key 不一致 bug

## Decisions

### JSONL 預處理策略：破壞 C26 收集條件

選擇在 `query()` 呼叫前修改 JSONL 檔案，讓 C26 的收集條件不成立：
- Read: 加 `offset=1`（C26 要求 `offset === undefined`）
- Write: 移除 `content`（C26 要求 `file_path && content`）
- Edit: 不需處理（C26 本身不處理 Edit）

**替代方案**：修改 timestamp 為未來時間 → 不徹底，過期後又觸發。

### 備份策略：單一 .pre-sanitize 覆寫

每次修改前 `copyFileSync` 為 `.pre-sanitize`，同一 session 覆寫同一份備份。不用 `.bak` 累積模式避免磁碟膨脹。

### 注入時機：SDKQueryManager.executeQuery() 內

在 `query()` 呼叫前、`options.resume` 有值時同步執行。選擇同步而非 async 因為 JSONL 檔案通常 <2MB，同步 I/O 在 20ms 內完成。

### 移除手動 CLAUDE.md 讀取

`loadSystemPrompt()` 改為只回傳 `getGlobalStaticRules()`（Custom Tools 描述）。SDK 的 `settingSources: ['project']` 已自動載入 CLAUDE.md，不需手動讀取。

移除 `readSystemPromptFile()` 和 `DEFAULT_SYSTEM_PROMPT_FILE` 常量（dead code）。

## Risks / Trade-offs

- **[風險] JSONL 損壞** → 緩解：修改前備份 `.pre-sanitize`，sanitize 失敗時靜默跳過不阻擋對話
- **[風險] Write tool 首次寫未讀過的檔案報 errorCode: 2** → 緩解：Claude 會自動先 Read 再 Write，實務上不影響
- **[限制] runtime Edit/Write 仍觸發注入** → 接受：這是 SDK 內部行為，等官方 `--no-system-reminders` 開關
- **[限制] 同步 I/O 阻塞** → 接受：目前 JSONL <2MB、耗時 <25ms，未來若檔案過大再改 async + streaming
