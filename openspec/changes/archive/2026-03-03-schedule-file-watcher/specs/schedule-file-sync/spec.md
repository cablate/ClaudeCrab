## ADDED Requirements

### Requirement: Automatic schedule sync on YAML file changes

The system SHALL monitor `agents/*/schedules/*.yaml` for file system changes (creation, modification, deletion) and automatically trigger schedule synchronization for the affected agent within 1 second of the change being detected.

The file watcher SHALL use per-agent debouncing to coalesce rapid successive changes into a single sync operation per agent.

#### Scenario: New YAML file added

- **WHEN** a new `.yaml` file is created in `agents/{agentId}/schedules/`
- **THEN** the system SHALL call `syncSchedulesForAgent(agentId)` within 1 second
- **AND** the new schedule SHALL be registered if `metadata.enabled` is true

#### Scenario: Existing YAML file modified

- **WHEN** an existing `.yaml` file in `agents/{agentId}/schedules/` is modified
- **THEN** the system SHALL call `syncSchedulesForAgent(agentId)` within 1 second
- **AND** the schedule SHALL be re-registered with the updated configuration

#### Scenario: YAML file deleted

- **WHEN** a `.yaml` file is removed from `agents/{agentId}/schedules/`
- **THEN** the system SHALL call `syncSchedulesForAgent(agentId)` within 1 second
- **AND** the corresponding schedule SHALL be unregistered

#### Scenario: Multiple files changed rapidly for same agent

- **WHEN** multiple `.yaml` files in the same agent's schedules directory are changed within 300ms
- **THEN** the system SHALL coalesce them into a single `syncSchedulesForAgent` call

#### Scenario: Files changed for different agents simultaneously

- **WHEN** `.yaml` files for agent A and agent B are changed at the same time
- **THEN** the system SHALL trigger independent sync calls for each agent
- **AND** agent A's sync SHALL NOT be delayed by agent B's debounce timer

### Requirement: File watcher graceful degradation

The file watcher SHALL NOT prevent system startup if it fails to initialize. If the watcher encounters an error during setup, the system SHALL log a warning and continue operating with the existing `message:sent`-based sync mechanism as fallback.

#### Scenario: Watcher initialization failure

- **WHEN** the file watcher fails to start (e.g., OS limit on file watchers reached)
- **THEN** the system SHALL log a warning-level message
- **AND** the system SHALL continue to operate normally
- **AND** schedule sync SHALL still occur via `message:sent` events

### Requirement: File watcher lifecycle management

The file watcher SHALL be started after `ScheduleManager.initialize()` completes and SHALL be closed when `ScheduleManager.dispose()` is called.

#### Scenario: Watcher starts after initialization

- **WHEN** `ScheduleManager.initialize()` completes successfully
- **THEN** the file watcher SHALL begin monitoring

#### Scenario: Watcher stops on dispose

- **WHEN** `ScheduleManager.dispose()` is called
- **THEN** the file watcher SHALL stop monitoring and release all resources
