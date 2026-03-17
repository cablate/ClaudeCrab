## ADDED Requirements

### Requirement: Two-layer thread architecture

The system SHALL maintain two layers of Discord threads for each task: a main thread (Forum post in #task-board) serving as a clean summary board and user interaction interface, and per-task threads in each participating agent's channel serving as the agent's full execution workspace. All agents (including the secretary) SHALL follow the same pattern with zero exceptions.

#### Scenario: Main thread created on task creation

- **WHEN** TaskService.createTask is called
- **THEN** the system SHALL create a Forum post in #task-board, and the resulting thread SHALL serve as the main thread for this task

#### Scenario: Agent per-task thread created on agent call

- **WHEN** AgentCallService.callAgent is invoked with a taskId for an agent that has no existing per-task thread for this task
- **THEN** the system SHALL create a new thread in the agent's Discord channel titled "📋 任務：{task title}", store its ID in the task record's agent_thread_ids field, and use this thread ID as the chatId for the call

#### Scenario: Agent per-task thread reused on subsequent calls

- **WHEN** AgentCallService.callAgent is invoked with a taskId for an agent that already has a per-task thread for this task
- **THEN** the system SHALL reuse the existing thread (same chatId, same session), and the agent SHALL retain conversational context from previous calls

#### Scenario: Agent execution stays in per-task thread

- **WHEN** an agent processes a task-bound call
- **THEN** all assistant messages, tool call outputs, and intermediate responses SHALL appear in the agent's per-task thread (not in the main thread)

### Requirement: Main thread as summary board

The main thread SHALL contain only clean summary content: system messages (status changes, assignments, completion), agent-pushed summaries (via post_to_thread MCP tool), user messages, secretary-pushed responses, and review Embeds. Agent execution details SHALL NOT appear in the main thread.

#### Scenario: System message posted to main thread

- **WHEN** a task's status changes (via updateStatus, assignTask, or completeTask)
- **THEN** the system SHALL post a system message to the main thread: "[系統] 📌 {status transition description}"

#### Scenario: Agent pushes summary to main thread

- **WHEN** an agent calls `post_to_thread` with a taskId and content
- **THEN** the system SHALL post the content to the task's **main thread** (not the agent's per-task thread) with the appropriate format prefix

#### Scenario: Main thread not available

- **WHEN** the task has no main thread discord_thread_id (SQLite-only mode) or the Discord API call fails
- **THEN** the system SHALL continue the operation in SQLite without blocking, and log a warning

### Requirement: User interaction in main thread

The system SHALL route user messages posted in the main thread to the secretary's per-task thread for processing, and the secretary SHALL push responses back to the main thread.

#### Scenario: User message routed to secretary

- **WHEN** a non-bot user posts a message in a task's main thread
- **THEN** the system SHALL identify the corresponding task, construct a UnifiedMessage with task context, and route it to the secretary agent via AgentCallService with the task's taskId bound

#### Scenario: Secretary responds in main thread

- **WHEN** the secretary processes a user message routed from the main thread
- **THEN** the secretary SHALL use post_to_thread to push the response back to the main thread (the secretary's own execution happens in the secretary's per-task thread)

### Requirement: Thread content format

The system SHALL format main thread messages according to the message source:

- System messages SHALL use: `[系統] {emoji} {message}`
- Agent summaries SHALL use: `[{agentId}] {typeEmoji} {content}` (progress: 📝, deliverable: 📦, note: 💬)
- Review request messages SHALL use an Embed with approve/reject buttons
- Cost summary on completion SHALL use: `[系統] 💰 累計花費：${cost} | 耗時：{duration}`

#### Scenario: Agent posts progress summary

- **WHEN** agent "writer" calls `post_to_thread` with type "progress" and content "第 1 篇初稿完成"
- **THEN** the main thread reply SHALL read: `[writer] 📝 第 1 篇初稿完成`

#### Scenario: Task completion summary

- **WHEN** a task transitions to status "done" and has associated execution records
- **THEN** the system SHALL post a completion summary to the main thread containing total cost and duration

### Requirement: Quality gate via Discord interaction

The system SHALL implement a structured review gate triggered by the `request_review` MCP tool. Review Embeds SHALL appear in the main thread.

#### Scenario: Review requested

- **WHEN** an agent calls `request_review` with taskId and summary
- **THEN** the system SHALL:
  1. Update the task status to `in_review`
  2. Post an Embed to the task's **main thread** containing the review summary and deliverable list
  3. Attach approve (✅) and reject (❌) buttons to the Embed
  4. Post a cross-reference Embed to the approvals channel (if configured)
  5. Increment the task's `review_count` field

#### Scenario: Review approved by user

- **WHEN** a user clicks the approve button on a review Embed in the main thread
- **THEN** the system SHALL:
  1. Update the task status to `done`
  2. Post "✅ 審核通過 by {user}" to the main thread
  3. Remove the buttons from the Embed
  4. Trigger task completion (cost summary + archival)

#### Scenario: Review rejected by user

- **WHEN** a user clicks the reject button on a review Embed in the main thread
- **THEN** the system SHALL:
  1. Show a Modal dialog requesting a rejection reason
  2. After submission: post the rejection reason to the main thread, and route the rejection to the secretary's per-task thread for the secretary to arrange revision

#### Scenario: Review count tracking

- **WHEN** a task's `review_count` reaches 3 or more
- **THEN** the system SHALL include a warning in the review Embed: "⚠️ 第 {n} 次審核 — 依品管 SOP，秘書介入處理"

### Requirement: Thread rate limiting

The system SHALL throttle `post_to_thread` calls to prevent Discord API rate limit violations.

#### Scenario: Rapid consecutive posts

- **WHEN** an agent calls `post_to_thread` for the same task within 5 seconds of the previous post
- **THEN** the system SHALL queue the message and deliver it after the 5-second cooldown expires

#### Scenario: Multiple queued posts merged

- **WHEN** 3 or more posts are queued for the same task within a single cooldown window
- **THEN** the system SHALL merge them into a single message separated by newlines

### Requirement: Task archival

The system SHALL archive completed tasks by archiving the main thread and all agent per-task threads.

#### Scenario: Task completed

- **WHEN** a task transitions to status "done"
- **THEN** the system SHALL post the completion summary to the main thread, then archive the main thread and all associated agent per-task threads

#### Scenario: Task cancelled

- **WHEN** a task transitions to status "cancelled"
- **THEN** the system SHALL post a cancellation notice to the main thread and archive all associated threads
