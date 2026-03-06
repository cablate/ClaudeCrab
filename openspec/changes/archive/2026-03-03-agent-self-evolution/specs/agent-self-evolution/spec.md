## ADDED Requirements

### Requirement: Daily Reflection Cycle

Each Agent SHALL execute a daily reflection cycle at a scheduled time (default 22:00 local time). The reflection cycle SHALL consist of five sequential phases: (1) review today's recorded learnings from memory/ and Lessons Learned, (2) cross-reference records to identify meta-patterns, (3) compare against user expectations defined in CLAUDE.md to identify uncovered gaps, (4) actively search the web for high-quality materials to fill identified gaps, (5) internalize new knowledge into knowledge/ files. The reflection SHALL NOT duplicate content already recorded during the day's work — it acts as a synthesizer, not a collector.

#### Scenario: Normal daily reflection execution

- **WHEN** the daily-reflection schedule triggers at 22:00
- **THEN** the Agent SHALL read its memory/ and CLAUDE.md Lessons Learned for today's records, identify gaps against CLAUDE.md user expectations, perform web searches to fill gaps, and write new knowledge to knowledge/ with source attribution

#### Scenario: No gaps identified

- **WHEN** the reflection cycle finds no gaps between today's work and user expectations
- **THEN** the Agent SHALL record a brief meta-pattern summary in evolution/weekly/ and skip the web search phase

#### Scenario: Reflection does not duplicate work-time learning

- **WHEN** the Agent already learned and recorded topic X during today's work
- **THEN** the reflection cycle SHALL NOT re-search or re-record topic X, but MAY identify meta-patterns involving X

### Requirement: Three-Layer Permission Model

The system SHALL enforce a three-layer permission model for Agent self-modification of workspace files. Layer 1 (Free): Agents SHALL have unrestricted read-write access to memory/, knowledge/, MEMORY.md, and USER.md. Layer 2 (Append-Only): Agents SHALL only append to the Lessons Learned section of CLAUDE.md and to Skill references/ data files — deletion or modification of existing entries SHALL NOT be permitted. Layer 3 (Approval Required): Agents SHALL NOT directly modify core identity sections of CLAUDE.md, soul.md, behavior.md, schedule definitions, or create new Skills. Layer 3 changes SHALL require a proposal-review-approval workflow.

#### Scenario: Layer 1 free write to knowledge

- **WHEN** an Agent's reflection cycle produces new knowledge
- **THEN** the Agent SHALL write it directly to knowledge/ without requiring any approval

#### Scenario: Layer 2 append-only Lessons Learned

- **WHEN** an Agent discovers a new operational lesson
- **THEN** it SHALL append the lesson to the Lessons Learned section of CLAUDE.md and SHALL NOT modify or remove any existing lesson entries

#### Scenario: Layer 3 SOP change requires proposal

- **WHEN** an Agent identifies a need to change its core behavior rules, persona definition, or schedule
- **THEN** it SHALL write a proposal file to evolution/proposals/ and SHALL NOT directly modify the target files

#### Scenario: Layer 3 proposal format

- **WHEN** an Agent creates a Layer 3 change proposal
- **THEN** the proposal SHALL include: target file path, current content summary, proposed change, rationale, and expected impact

### Requirement: Evolution Directory Structure

Each Agent directory SHALL include an evolution/ subdirectory with the following structure: evolution/weekly/ for weekly reflection summaries and evolution/proposals/ for pending Layer 3 change proposals. Evolution records SHALL be organized by week, not by day. Only insights worth recording SHALL be written — the system SHALL NOT mandate daily output files.

#### Scenario: Evolution directory presence

- **WHEN** AgentLoader scans an Agent directory
- **THEN** the presence of evolution/ SHALL be optional and SHALL NOT cause validation failure if absent

#### Scenario: Weekly summary file naming

- **WHEN** an Agent writes a weekly reflection summary
- **THEN** the file SHALL be named using ISO week format (e.g., 2026-W09.md) in evolution/weekly/

#### Scenario: Proposal lifecycle

- **WHEN** a proposal in evolution/proposals/ is approved or rejected
- **THEN** the proposal file SHALL be updated with the decision outcome and date, and SHALL remain in the directory as an audit trail

### Requirement: User Expectations Section in CLAUDE.md

Each Agent's CLAUDE.md SHALL contain a high-weight User Expectations section positioned near the top of the file (before Lessons Learned). This section SHALL define the user's quality standards and behavioral expectations for the Agent in a measurable, bullet-point format. The Daily Reflection cycle SHALL use this section as the primary reference for gap identification.

#### Scenario: User expectations as reflection benchmark

- **WHEN** the daily reflection cycle reaches the gap identification phase
- **THEN** it SHALL read the User Expectations section from CLAUDE.md and compare each expectation against the day's work output

#### Scenario: Expectations section format

- **WHEN** a User Expectations section is defined
- **THEN** each expectation item SHALL be a concise statement with a measurable or observable criterion (e.g., "Newsletter openings must contain a personal opinion or provocative question")

### Requirement: Web Search During Reflection

The daily reflection cycle SHALL include active web searching as a core capability, not an optional step. When gaps are identified between current performance and user expectations, the Agent SHALL use available web search tools to find relevant high-quality materials. All knowledge internalized from web search SHALL include source attribution (URL and retrieval date).

#### Scenario: Web search for identified gap

- **WHEN** the reflection identifies a gap (e.g., "newsletter openings lack personality")
- **THEN** the Agent SHALL search for relevant techniques, best practices, or examples and write a summary with source URLs to knowledge/

#### Scenario: Source attribution requirement

- **WHEN** knowledge derived from web search is written to knowledge/
- **THEN** the file SHALL include the source URL and the date of retrieval

#### Scenario: Web search unavailability

- **WHEN** web search tools are unavailable during the reflection cycle
- **THEN** the Agent SHALL record the identified gap in evolution/weekly/ as a pending learning item for the next cycle
