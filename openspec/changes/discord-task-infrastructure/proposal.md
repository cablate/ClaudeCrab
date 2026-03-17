## Why

TaskService、AgentCallService、ActivityEventService 三個模組已各自存在但**互相不知道對方**。秘書建了任務、分派給員工，但 agent call 不會綁定任務、執行結果不會推到任務的 Discord thread、品管閘門沒有結構化的觸發機制。使用者看到的是一堆分散的頻道訊息，不是「一個任務的完整生命線」。

秘書的 SOP（task-routing、quality-gate、escalation）已定義好工作流程。核心定位：**在現有工作流上面加一層「可見性」，讓黑箱變透明。不改變秘書的指揮方式，不強制員工使用新工具。**

## What Changes

### 核心串接

- **兩層 Thread 架構**：主 Thread（#task-board Forum）是乾淨的摘要看板 + 使用者互動介面。Agent 的完整執行過程在自己 channel 的 per-task thread 裡。所有 agent（含秘書）一視同仁，零特例
- **Agent Call ↔ Task 綁定**：AgentCallService 新增 `taskId` 參數。秘書 call_agent 時多帶一個 taskId。系統自動在 agent 的 channel 建 per-task thread（chatId），用 `task:{taskId}` 當 userId（session 隔離）。花費自動歸因到任務
- **Session 隔離與延續**：同一任務的多次 call 共用 session（同 userId）——agent 記得上次做了什麼。不同任務有獨立 session，互不干擾
- **使用者在主 Thread 互動**：使用者在主 thread 留言 → 路由到秘書的 per-task thread → 秘書處理 → 推結果回主 thread
- **MCP Tools 擴充（可選）**：agent 在執行中**可以選擇性地**使用 `post_to_thread`（推摘要到主 thread）、`request_review`（觸發品管閘門）、`read_task`（讀上下文）。不用也行，主 thread 至少有系統自動訊息

### 兩層品管機制

- **第一層（自動）**：員工完成 → 系統自動 callback 秘書 → 秘書在 per-task thread 品管 → 通過/退回。退回時自動 call 員工修改（同 session），來回直到通過
- **第二層（使用者審核）**：秘書品管通過 → 推到主 thread → `request_review` 出現審核按鈕 → 使用者點按鈕最終確認
- 使用者在主 thread 只看到秘書品管後的最終結果，不被中間修改打擾
- 對接秘書的 `quality-gate.md`：退回最多 2 次，第 3 次秘書介入

### 通知路由

- 任務狀態變更 → 推到 assignee 的 agent channel
- 審核請求 → 推到 `#approvals` 或秘書 channel
- 升級 → 推到 Owner（`#alerts`）
- 所有事件 → ActivityEventService 雙寫（已有，補觸發點）

### 任務驅動的 Agent Call（可選 autoCall）

- 秘書手動 call_agent 帶 taskId 是**主要模式**——秘書仍然是指揮者
- 可選 autoCall：秘書建任務 + 指派 agent 時自動觸發 call，注入任務上下文。**預設關閉**，秘書明確選擇才啟用

## Capabilities

### New Capabilities

- `task-thread-lifecycle`: 任務的 Discord thread 作為完整協作空間的行為規範——thread 內容格式、進度推送觸發點、品管閘門的 Embed + Button 互動、歸檔規則
- `task-agent-integration`: Agent Call 與任務系統的綁定機制——taskId 傳遞、執行結果回寫 thread、任務驅動的自動 agent call、MCP tools（`post_to_thread`、`request_review`、`read_task`）

### Modified Capabilities

- `system-architecture`: 新增 TaskService ↔ AgentCallService ↔ ActivityEventService 的串接層，模組依賴圖變更
- `trigger-mechanisms`: 品管閘門觸發新增 `request_review` 路由——agent 發起 → thread Embed → Button interaction → 回傳結果

## Impact

> 注意：codebase 經過 audit v2 重構。services 層已 platform-agnostic，Discord 邏輯在 adapters/discord/services/。

- 修改 `src/services/AgentCallService.ts` — taskId 綁定、userId/chatId 改寫、per-task thread 建立
- 修改 `src/services/TaskService.ts`（pure）— postToThread/requestReview 業務邏輯，透過 TaskThreadNotifier 推送
- 修改 `src/adapters/discord/services/DiscordTaskSync.ts` — 擴充 TaskThreadNotifier：per-task thread 建立、摘要推送、審核 Embed、使用者訊息路由
- 修改 `src/adapters/discord/services/DiscordActivityReporter.ts` — 任務事件 Discord Embed
- 修改 `src/tools/taskTool.ts` — 新增 post_to_thread、request_review、read_task MCP tools
- 修改 `src/adapters/discord/DiscordInteractionHandler.ts` — 品管閘門 Button/Modal handler
- 修改 `src/services/ActivityEventService.ts`（pure）— 任務生命週期事件觸發點
- 修改 `src/core/MessageProcessor.ts` — metadata.taskId 傳遞到 execution_records
- 修改 `src/adapters/DiscordAdapter.ts` — replyToThreadEmbed、fetchRecentThreadMessages、createThreadInChannel
- 修改 `src/persistence/TaskRecordRepository.ts` — review_count + agent_thread_ids 欄位
- 修改 `src/persistence/ExecutionRecordRepository.ts` — task_id FK
- 修改 `src/adapters/discord/DiscordBootstrap.ts` — 串接新 Discord task services
- 修改 `src/types/interfaces.ts` — 擴充 ITaskService（postToThread、requestReview）
- 不修改 `src/core/SessionManager.ts` — session key 機制不變
