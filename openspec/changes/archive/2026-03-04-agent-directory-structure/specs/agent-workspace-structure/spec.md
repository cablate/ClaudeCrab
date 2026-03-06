## ADDED Requirements

### Requirement: Standard Agent Directory Structure

Each Agent workspace at agents/{id}/ SHALL include the following standard directories: memory/ for daily work logs, knowledge/ for knowledge staging, output/ for task deliverables, evolution/ for self-improvement records, schedules/ for schedule definitions, and plans/ for planning documents. The .claude/skills/ directory structure SHALL NOT be modified by this specification. Each directory SHALL have a single, well-defined semantic purpose — files SHALL NOT be placed in a directory whose purpose does not match the file's nature.

#### Scenario: New agent workspace initialization

- **WHEN** a new Agent workspace is created from the _example/ template
- **THEN** the workspace SHALL contain all six standard directories (memory/, knowledge/, output/, evolution/, schedules/, plans/)

#### Scenario: Directory semantic enforcement

- **WHEN** an Agent writes a file to its workspace during autonomous operation
- **THEN** the Agent SHALL determine the correct directory based on the file's nature (knowledge, deliverable, evolution record, plan) as defined in the directory classification rules

### Requirement: Knowledge Directory as Staging Area

The knowledge/ directory SHALL serve exclusively as a staging area for learned knowledge materials that have not yet been consolidated into Skills. Knowledge files SHALL contain only information that is directly referenceable by future tasks — techniques, methodologies, case analyses, tool evaluations, and domain research notes. Deliverable documents produced for user-assigned tasks SHALL NOT be stored in knowledge/. Administrative operation records SHALL NOT be stored in knowledge/. Schedule-generated process artifacts SHALL NOT be stored in knowledge/.

#### Scenario: Reflection produces new knowledge

- **WHEN** an Agent's daily reflection cycle produces a new insight or technique
- **THEN** the Agent SHALL write it to knowledge/ following the naming convention {domain}-{topic}-{aspect}.md

#### Scenario: User-assigned analysis report

- **WHEN** an Agent completes an analysis report assigned by the user
- **THEN** the Agent SHALL store the report in output/, NOT in knowledge/

#### Scenario: Administrative records

- **WHEN** Admin produces growth review records or agent change logs
- **THEN** these records SHALL be stored in evolution/reviews/ or as Skill references, NOT in knowledge/

### Requirement: Knowledge Lifecycle Management

Knowledge files in knowledge/ SHALL follow a defined lifecycle: creation during reflection or research, accumulation until 2-3 related knowledge points exist, consolidation into a Skill proposal, and archival marking after consolidation. When knowledge has been consolidated into a Skill's references/, the original file in knowledge/ SHALL be marked with an HTML comment `<!-- consolidated into {skill-name} -->` at the top of the file. Marked files SHALL NOT be deleted — they SHALL remain as original source material for reference. Future knowledge database migration tooling SHALL use these markers to determine processing status.

#### Scenario: Knowledge consolidation marking

- **WHEN** an Agent consolidates knowledge from knowledge/ into a Skill's references/
- **THEN** the original knowledge/ file SHALL be marked with `<!-- consolidated into {skill-name} -->` and SHALL NOT be deleted

#### Scenario: Knowledge accumulation threshold

- **WHEN** an Agent has accumulated 2-3 related knowledge files on the same topic in knowledge/
- **THEN** the Agent SHALL evaluate whether to propose a new Skill that consolidates these knowledge points

#### Scenario: Scanning knowledge directory

- **WHEN** an Agent scans knowledge/ to find relevant materials for a task
- **THEN** files marked with `<!-- consolidated into {skill-name} -->` SHALL be deprioritized in favor of the consolidated Skill references

### Requirement: Output Directory Standardization

Every Agent workspace SHALL include an output/ directory as the standard location for user-assigned task deliverables, process documents, and analysis reports. Files in output/ SHALL be organized by task or project in subdirectories, NOT by file type. The output/ directory SHALL accept any file format (markdown, images, videos, archives, etc.) as long as the content is a deliverable or process artifact from a user-assigned task.

#### Scenario: Task deliverable storage

- **WHEN** an Agent produces a deliverable for a user-assigned task
- **THEN** the deliverable SHALL be stored in output/{task-or-project-name}/

#### Scenario: Multi-format project output

- **WHEN** a task produces both markdown analysis and image assets
- **THEN** all related files SHALL be co-located in the same output/{project-name}/ subdirectory, NOT separated into output/docs/ and output/images/

### Requirement: Evolution Directory Extended Structure

The evolution/ directory SHALL contain three subdirectories: proposals/ for Layer 3 change proposals, weekly/ for weekly reflection summaries, and reviews/ for performance review records. The reviews/ subdirectory SHALL further contain daily/ and weekly/ subdirectories for Admin-generated growth review reports. Performance reviews SHALL be classified as evolution records, NOT as knowledge.

#### Scenario: Growth review storage

- **WHEN** Admin generates a daily or weekly growth review for an Agent
- **THEN** the review SHALL be stored in the target Agent's evolution/reviews/daily/ or evolution/reviews/weekly/

#### Scenario: Evolution directory completeness

- **WHEN** an Agent workspace is created or audited
- **THEN** evolution/ SHALL contain proposals/, weekly/, and reviews/ subdirectories

### Requirement: Plans Directory in Standard Template

Every Agent workspace SHALL include a plans/ directory for storing plan-mode generated planning documents. Plans SHALL be task-scoped documents that describe implementation strategies, and SHALL be distinct from knowledge (learned materials) and output (deliverables).

#### Scenario: Plan mode output storage

- **WHEN** an Agent generates a planning document during plan mode
- **THEN** the document SHALL be stored in plans/

#### Scenario: Plan vs knowledge distinction

- **WHEN** an Agent produces a document that describes how to implement a future task
- **THEN** it SHALL be stored in plans/, NOT in knowledge/ (which is reserved for learned knowledge materials)
