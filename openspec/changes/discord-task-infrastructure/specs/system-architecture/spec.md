## ADDED Requirements

### Requirement: Task-Agent-Activity service integration layer

The system SHALL maintain a coordination layer between TaskService, AgentCallService, and ActivityEventService. TaskService SHALL depend on AgentCallService for task-driven agent calls. AgentCallService SHALL accept a taskId parameter, create or reuse agent per-task threads, and manage session isolation via userId. ActivityEventService SHALL be invoked at each task lifecycle transition to produce both SQLite records and Discord notifications.

#### Scenario: Task assignment triggers agent call

- **WHEN** TaskService.assignTask is called with autoCall enabled
- **THEN** TaskService SHALL invoke AgentCallService.callAgent with the taskId bound, and AgentCallService SHALL create/reuse the agent's per-task thread and inject task context into the prompt

#### Scenario: Agent pushes summary to main thread after completion

- **WHEN** an AgentCallService call bound to a taskId completes successfully
- **THEN** the agent SHALL use post_to_thread to push a summary to the task's main thread (the system does not automatically copy agent responses from the per-task thread to the main thread)

#### Scenario: Task lifecycle events routed through ActivityEventService

- **WHEN** a task transitions status (created, assigned, in_review, done, cancelled)
- **THEN** TaskService SHALL invoke ActivityEventService.log with the appropriate event type to trigger dual-write to SQLite and Discord

### Requirement: Execution record task attribution

The execution_records table SHALL support an optional task_id foreign key referencing task_records.id. When a MessageProcessor execution is triggered by a task-bound agent call, the task_id SHALL be recorded in the execution record for cost attribution.

#### Scenario: Execution with task context

- **WHEN** MessageProcessor processes a message with metadata.taskId set
- **THEN** the resulting execution_records entry SHALL include the task_id value

#### Scenario: Execution without task context

- **WHEN** MessageProcessor processes a message without metadata.taskId
- **THEN** the execution_records entry SHALL have task_id set to NULL

### Requirement: Task record agent thread tracking

The task_records table SHALL support an `agent_thread_ids` column (JSON text) that maps agentId to the Discord thread ID of that agent's per-task thread. This enables the system to look up or create per-task threads for each agent participating in a task.

#### Scenario: Agent thread ID stored on first call

- **WHEN** AgentCallService creates a new per-task thread for an agent
- **THEN** the system SHALL update the task record's agent_thread_ids to include the mapping `{agentId: threadId}`

#### Scenario: Agent thread ID retrieved on subsequent call

- **WHEN** AgentCallService is invoked for an agent that already has a per-task thread for this task
- **THEN** the system SHALL read the thread ID from agent_thread_ids and use it as chatId without creating a new thread
