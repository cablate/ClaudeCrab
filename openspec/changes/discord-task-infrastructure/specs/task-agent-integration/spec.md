## ADDED Requirements

### Requirement: Agent per-task thread as session anchor

When an agent call is bound to a taskId, the system SHALL create or reuse a per-task thread in the agent's Discord channel as the chatId, and use `task:{taskId}` as the userId. This ensures session isolation per task and session continuity across multiple calls for the same task.

#### Scenario: Task-bound call creates per-task thread

- **WHEN** AgentCallService.callAgent is invoked with options.taskId for an agent with no existing per-task thread for this task
- **THEN** the system SHALL create a thread in the agent's Discord channel, set `chatId` to the new thread ID, set `userId` to `task:{taskId}`, and store the thread ID in the task record's `agent_thread_ids` field

#### Scenario: Task-bound call reuses existing per-task thread

- **WHEN** AgentCallService.callAgent is invoked with options.taskId for an agent that already has a per-task thread for this task
- **THEN** the system SHALL set `chatId` to the existing thread ID and `userId` to `task:{taskId}`, producing the same session key as the previous call

#### Scenario: Same task multiple calls share session

- **WHEN** AgentCallService.callAgent is invoked twice for the same taskId targeting the same agent
- **THEN** both calls SHALL produce the same session key (`platform::agentId::task:{taskId}`), allowing the agent to retain conversation context from the first call

#### Scenario: Different tasks have isolated sessions

- **WHEN** an agent is called for task A and separately for task B
- **THEN** the session keys SHALL differ (`task:{taskIdA}` vs `task:{taskIdB}`), ensuring conversation contexts are isolated, and each task SHALL have its own per-task thread in the agent's channel

#### Scenario: Agent without Discord channel

- **WHEN** AgentCallService.callAgent is invoked with a taskId but the target agent has no configured discordChannelId
- **THEN** the system SHALL fall back to using the options.chatId provided by the caller and log a warning

### Requirement: Agent call task binding

The AgentCallService SHALL support binding an agent call to a task via a `taskId` field in AgentCallOptions. When taskId is provided, the system SHALL inject task context into the agent's prompt.

#### Scenario: Agent call with taskId

- **WHEN** AgentCallService.callAgent is invoked with options.taskId set to a valid task ID
- **THEN** the system SHALL:
  1. Read the task record from TaskRecordRepository
  2. Prepend a task context block to the enrichedMessage containing: task title, description, current status, assignee, and review count

#### Scenario: Agent call with invalid taskId

- **WHEN** AgentCallService.callAgent is invoked with a taskId that does not exist in the database
- **THEN** the system SHALL log a warning and proceed with the call without task context injection (graceful degradation)

#### Scenario: Execution record task attribution

- **WHEN** an agent call is bound to a taskId and MessageProcessor records an execution
- **THEN** the execution_records entry SHALL include the task_id foreign key, enabling cost attribution per task

### Requirement: Agent call completion callback

When a fire-and-forget agent call bound to a taskId completes, the system SHALL automatically callback the task's creator agent (typically the secretary) with the completed agent's response summary for quality review. This enables the two-layer quality gate: secretary reviews first, then user reviews.

#### Scenario: Successful completion triggers callback

- **WHEN** a fire-and-forget AgentCallService call with taskId completes successfully
- **THEN** the system SHALL invoke AgentCallService.callAgent targeting the task's creator agent (from task_records.created_by_agent_id, defaulting to 'general'), with the same taskId, and a message containing the completed agent's response summary and instruction to perform quality review

#### Scenario: Callback not triggered for await mode

- **WHEN** an AgentCallService call with taskId and awaitResult=true completes
- **THEN** the system SHALL NOT trigger a callback (the caller already received the response directly)

#### Scenario: Callback not triggered without taskId

- **WHEN** a fire-and-forget AgentCallService call without taskId completes
- **THEN** the system SHALL NOT trigger a callback (backward compatible)

#### Scenario: Secretary approves after callback

- **WHEN** the secretary receives a callback and determines the work passes quality review
- **THEN** the secretary SHALL use post_to_thread to push the approved result to the main thread and use request_review to present a final review Embed to the user

#### Scenario: Secretary rejects after callback

- **WHEN** the secretary receives a callback and determines the work needs revision
- **THEN** the secretary SHALL call the original agent again with the same taskId (continuing the same session) with revision instructions, and the cycle repeats until the secretary approves

### Requirement: Task-driven agent call

The TaskService SHALL support automatic agent call initiation when a task is assigned with the autoCall flag.

#### Scenario: Assign with autoCall

- **WHEN** TaskService.assignTask is called with agentId and options.autoCall set to true
- **THEN** the system SHALL:
  1. Update the task's assignee in SQLite
  2. Update the task status to `in_progress`
  3. Invoke AgentCallService.callAgent from the task creator (or 'general') to the assignee agent, with the taskId bound and the task's full context as the message
  4. Post an assignment notification to the task's main thread

#### Scenario: Assign without autoCall

- **WHEN** TaskService.assignTask is called without the autoCall flag (or autoCall is false)
- **THEN** the system SHALL only update the assignee and post an assignment notification to the main thread, without initiating an agent call

#### Scenario: Auto-call failure

- **WHEN** autoCall is true but AgentCallService.callAgent fails (agent not found, depth limit, etc.)
- **THEN** the system SHALL log the error, post a failure notice to the task's main thread, and keep the task in `in_progress` status

### Requirement: MCP tool post_to_thread

The task-mgmt MCP server SHALL provide a `post_to_thread` tool that allows agents to post summary messages to the task's main thread (not the agent's per-task thread).

#### Scenario: Post progress

- **WHEN** an agent calls `post_to_thread` with taskId, content "初稿完成", and type "progress"
- **THEN** the system SHALL post `[{agentId}] 📝 初稿完成` to the task's **main thread**

#### Scenario: Post deliverable

- **WHEN** an agent calls `post_to_thread` with type "deliverable"
- **THEN** the system SHALL post the content with 📦 prefix to the task's **main thread**

#### Scenario: Task not found

- **WHEN** an agent calls `post_to_thread` with a taskId that does not exist
- **THEN** the tool SHALL return an error message: "任務不存在：{taskId}"

### Requirement: MCP tool request_review

The task-mgmt MCP server SHALL provide a `request_review` tool that triggers the quality gate for a task. The review Embed SHALL appear in the main thread.

#### Scenario: Successful review request

- **WHEN** an agent calls `request_review` with taskId and summary
- **THEN** the system SHALL trigger the quality gate flow defined in the task-thread-lifecycle spec (posting Embed to main thread) and return a confirmation message

#### Scenario: Task already in review

- **WHEN** an agent calls `request_review` for a task that is already in `in_review` status
- **THEN** the tool SHALL return a warning: "任務已在審核中"

### Requirement: MCP tool read_task

The task-mgmt MCP server SHALL provide a `read_task` tool that returns the full context of a task.

#### Scenario: Read existing task

- **WHEN** an agent calls `read_task` with a valid taskId
- **THEN** the tool SHALL return: task title, description, status, priority, assignee, creator, review count, cost, and the last 10 messages from the main thread (if Discord thread exists)

#### Scenario: Read non-existent task

- **WHEN** an agent calls `read_task` with an invalid taskId
- **THEN** the tool SHALL return an error message: "任務不存在：{taskId}"

### Requirement: Notification routing

The system SHALL route task-related notifications to the appropriate Discord channels based on event type.

#### Scenario: Task assigned notification

- **WHEN** a task is assigned to an agent
- **THEN** the system SHALL post a notification to the main thread: "[系統] 📌 指派給 {agentId}"

#### Scenario: Review request notification

- **WHEN** a review is requested for a task
- **THEN** the system SHALL post the review Embed to the main thread and a cross-reference Embed to the approvals channel (if configured)

#### Scenario: Review result notification

- **WHEN** a review decision is made (approved or rejected)
- **THEN** the system SHALL post the result to the main thread and send a notification to the assignee agent's per-task thread with the result and any rejection reason

#### Scenario: Task completion notification

- **WHEN** a task is completed
- **THEN** the system SHALL log a task.completed event via ActivityEventService

#### Scenario: Escalation notification

- **WHEN** review_count reaches 3 or higher and a new review is requested
- **THEN** the system SHALL send an alert-level notification via ActivityEventService to #alerts with @Owner mention
