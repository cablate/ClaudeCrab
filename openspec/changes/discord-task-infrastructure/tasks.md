## 1. 資料層擴充

- [x] 1.1 TaskRecordRepository 新增 `review_count` + `agent_thread_ids` 欄位 — ALTER TABLE 新增 review_count INTEGER DEFAULT 0 和 agent_thread_ids TEXT DEFAULT '{}'。新增 `incrementReviewCount`、`resetReviewCount`、`getAgentThreadId(taskId, agentId)`、`setAgentThreadId(taskId, agentId, threadId)` 方法。對應 spec: quality gate via Discord interaction 的 review count tracking + task record agent thread tracking
- [x] 1.2 [P] ExecutionRecordRepository 新增 `task_id` 欄位 — ALTER TABLE execution_records ADD COLUMN task_id TEXT REFERENCES task_records(id)。新增 `listByTaskId(taskId)` 查詢。對應 spec: execution record task attribution
- [x] 1.3 [P] types/interfaces.ts 擴充 ITaskService — 新增 postToThread、requestReview、assignTask（含 autoCall）方法簽名。對應 spec: 全部 task-agent-integration requirements

## 2. AgentCallService — Two-layer thread architecture + 兩層 Thread 架構（核心決策）+ taskId 傳遞機制 + Agent per-task thread 的 session 機制 + 任務驅動的 Agent Call 流程

- [x] 2.1 AgentCallOptions 新增 `taskId?: string` + 實作 Two-layer thread architecture — 當 taskId 存在時：(a) userId 改寫為 `task:{taskId}`（Agent per-task thread 的 session 機制），(b) 透過 DiscordAdapter.createThreadInChannel 查找或建立 agent 的 per-task thread（兩層 Thread 架構），用其 ID 作為 chatId，(c) 從 TaskRecordRepository 讀取任務記錄，prepend 上下文到 enrichedMessage。無 taskId 時行為不變。實作 AgentCallService taskId 傳遞機制 + 任務驅動的 Agent Call 流程。對應 spec: agent per-task thread as session anchor + agent call task binding
- [x] 2.2 [P] DiscordAdapter.createThreadInChannel 方法 — 新增方法：在指定 channel 建立 thread（從一條初始訊息）。AgentCallService 建立 per-task thread 時需要。對應 spec: agent per-task thread created on agent call
- [x] 2.3 Agent call 完成後自動 callback 秘書（品管閘門驅動）— executeInBackground 完成後，若有 taskId 且非 await 模式，自動 call 秘書（task creator agent）帶回覆摘要 + 審核指令。實作 agent call completion callback。對應 spec: agent call completion callback
- [x] 2.4 UnifiedMessage.metadata 傳遞 taskId — metadata 新增 taskId 欄位，MessageProcessor 在記錄 execution_records 時帶入 task_id FK。對應 spec: execution with task context

## 3. TaskService（pure）擴充 + DiscordTaskSync 擴充（task-driven agent call + main thread as summary board）

- [x] 3.1 TaskService.postToThread 方法 — 接收 taskId、content、type（progress/deliverable/note），按主 Thread 內容格式規範格式化，透過 TaskThreadNotifier.postToThread 推到主 thread。包含 thread rate limiting（同一 task 5 秒內合併）。對應 spec: main thread as summary board + thread content format + thread rate limiting
- [x] 3.2 TaskService.requestReview 方法 — 更新狀態為 in_review，incrementReviewCount，透過 TaskThreadNotifier 發送審核請求（DiscordTaskSync 負責 Embed 生成）。review_count >= 3 時加警告。對應 spec: quality gate via Discord interaction + review request notification
- [x] 3.3 TaskService.assignTask 擴充 autoCall — 新增 options.autoCall 參數。為 true 時透過注入的 AgentCallService 發起呼叫，綁定 taskId。失敗時透過 notifier 推失敗通知到主 thread。對應 spec: task-driven agent call (assign with autoCall / auto-call failure)
- [x] 3.4 [P] TaskService.updateStatus 擴充 — 狀態變更時透過 notifier 推系統訊息到主 thread（"📌 Status: X → Y"），並觸發 ActivityEventService.log。完成時附 cost 摘要，觸發 task archival。對應 spec: system message posted to main thread + task lifecycle events + task completion summary + task archival
- [x] 3.5 [P] DiscordTaskSync 擴充 — 實作 TaskThreadNotifier 新方法：postToThread（推 Forum thread reply）、sendReviewEmbed（Embed + Button）、archiveAllThreads（歸檔主 thread + 所有 agent per-task thread）。Task notification routing 通知路由：指派/審核結果推通知到 agent channel。對應 spec: notification routing + task archival

## 4. MCP Tools 設計與擴充

- [x] 4.1 [P] MCP tool `post_to_thread` — 新增到 task-mgmt MCP server。參數：taskId, content, type。呼叫 TaskService.postToThread（透過 notifier 推到主 thread）。task 不存在時回傳錯誤。實作 MCP Tools 設計。對應 spec: MCP tool post_to_thread
- [x] 4.2 [P] MCP tool `request_review` — 新增到 task-mgmt MCP server。參數：taskId, summary, deliverables。呼叫 TaskService.requestReview。task 已在 in_review 時回傳警告。對應 spec: MCP tool request_review
- [x] 4.3 [P] MCP tool `read_task` — 新增到 task-mgmt MCP server。參數：taskId。回傳完整任務上下文（標題、描述、狀態、priority、assignee、creator、review_count、cost、主 thread 最近 10 條訊息）。對應 spec: MCP tool read_task

## 5. Discord InteractionHandler — Quality gate trigger via request_review + 品管閘門 Button 互動

- [x] 5.1 Review Button handler（Quality gate trigger via request_review）— DiscordInteractionHandler 新增 `review:approve:{taskId}` 和 `review:reject:{taskId}` 的品管閘門 Button 互動處理。approve → TaskService.updateStatus(done) + 主 thread 回覆通過。對應 spec: review approved by user
- [x] 5.2 Reject Modal handler — reject Button → 彈出 Modal（TextInput 收集退回理由）→ Modal submit → 主 thread 回覆退回理由 + 路由到秘書 per-task thread。對應 spec: review rejected by user + review rejection modal
- [x] 5.3 [P] Review timeout — 24 小時無互動 → disable buttons（edit Embed 移除 components）+ log timeout event。對應 spec: review interaction timeout

## 6. DiscordAdapter thread 操作增強

- [x] 6.1 [P] DiscordAdapter.replyToThreadEmbed — 新增方法，支援發送 Embed + Button 到 thread（品管閘門 Embed 需要）。對應 spec: review request creates interaction
- [x] 6.2 [P] DiscordAdapter.fetchRecentThreadMessages — 新增方法，讀取 thread 最近 N 條訊息（read_task MCP tool 需要）。對應 spec: read existing task

## 7. 使用者在主 Thread 留言的路由（user message routing from main thread）

- [x] 7.1 DiscordTaskSync 使用者訊息監聽 — 擴充 DiscordTaskSync.startForumListener：監聽使用者在主 Thread 留言的路由，監聽主 thread 的非 bot 訊息，查找對應任務，構造 UnifiedMessage 帶任務 context，透過 AgentCallService.callAgent 路由到秘書的 per-task thread（帶 taskId）。實作 user message routing from main thread + user interaction in main thread。對應 spec: user message detected in main thread + user message in non-task thread

## 8. 服務串接層（task-agent-activity service integration layer）

- [x] 8.1 DiscordBootstrap 串接 — 在 DiscordBootstrap.initializeDiscordServices 中建立擴充後的 DiscordTaskSync，注入 AgentCallService + TaskRecordRepository。TaskService 建構時注入 AgentCallService + ActivityEventService 依賴。對應 spec: task-agent-activity service integration layer + task record agent thread tracking
- [x] 8.2 [P] Escalation 通知 — review_count >= 3 時透過 ActivityEventService.log 發送 warn 級別事件到 #alerts。對應 spec: escalation notification + escalation via ActivityEventService

## 9. 整合驗證

- [x] 9.1 Build 驗證 — `npm run build` 通過，無 TypeScript 錯誤
- [ ] 9.2 端到端手動測試 — 在 Discord 建立任務 → 主 thread 出現 → 指派 agent → agent channel 出現 per-task thread → agent 用 post_to_thread 推摘要到主 thread → 員工完成 → 系統 callback 秘書 → 秘書品管 → request_review → 主 thread 出現審核按鈕 → 使用者在主 thread 留言 → 秘書回覆出現在主 thread → 完成歸檔
