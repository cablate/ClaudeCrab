## ADDED Requirements

### Requirement: Quality gate trigger via request_review

The system SHALL support a quality gate trigger initiated by agents via the `request_review` MCP tool. This trigger SHALL post review Embeds to the task's main thread and route through the Discord InteractionHandler for approval/rejection via Button interactions, separate from the existing delegation chain and initiative/social evaluation mechanisms.

#### Scenario: Review request creates interaction

- **WHEN** an agent invokes `request_review` with a taskId
- **THEN** the system SHALL:
  1. Post an Embed with approve/reject buttons to the task's **main thread**
  2. Register a pending interaction in DiscordInteractionHandler with a unique requestId
  3. Route the button click response back to TaskService for status update

#### Scenario: Review interaction timeout

- **WHEN** a review Embed's buttons receive no interaction within 24 hours
- **THEN** the system SHALL disable the buttons (edit Embed to remove components) and log a timeout event via ActivityEventService

#### Scenario: Review rejection modal

- **WHEN** a user clicks the reject button on a review Embed
- **THEN** the DiscordInteractionHandler SHALL present a Modal with a text input for the rejection reason
- **AND** upon submission, the reason SHALL be posted to the main thread and sent as a notification to the assignee agent's per-task thread

### Requirement: User message routing from main thread

The system SHALL listen for non-bot messages in task main threads and route them to the secretary agent for processing. This routing SHALL be separate from and SHALL NOT enter the group message routing pipeline (initiative/social evaluation).

#### Scenario: User message detected in main thread

- **WHEN** a non-bot user posts a message in a task's main thread
- **THEN** the system SHALL:
  1. Look up the task record by discord_thread_id
  2. Construct a UnifiedMessage with the task context injected
  3. Route it to the secretary agent via AgentCallService.callAgent with the taskId bound

#### Scenario: User message in non-task thread

- **WHEN** a non-bot user posts a message in a Forum thread that is not tracked as a task's main thread
- **THEN** the system SHALL ignore the message (no routing)

### Requirement: Task notification routing

The system SHALL route task-related notifications to specific Discord channels based on event type, independent of the group message routing pipeline. Task notifications SHALL NOT enter the initiative/social evaluation pipeline.

#### Scenario: Assignment notification to main thread

- **WHEN** a task is assigned to an agent
- **THEN** the system SHALL post a system notification to the task's main thread

#### Scenario: Review result notification to agent per-task thread

- **WHEN** a review decision is made (approved or rejected)
- **THEN** the system SHALL post a notification to the assignee agent's per-task thread so the agent receives the feedback in its session context

#### Scenario: Escalation via ActivityEventService

- **WHEN** a task's review_count reaches 3 or higher and a new request_review is triggered
- **THEN** the system SHALL invoke ActivityEventService.log with level "warn" to trigger an alert-level notification to #alerts
