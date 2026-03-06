## MODIFIED Requirements

### Requirement: Agent 設定目錄結構

Each Agent SHALL be represented as a self-contained directory under `agents/`, which MUST contain three mandatory items: `agent.json` (ClaudeCab metadata), `CLAUDE.md` (system prompt), and `.claude/settings.local.json` (SDK permissions and model). `agent.json` MUST conform to the `AgentConfig` Zod schema. `settings.local.json` is managed by the SDK and SHALL be loaded via `settingSources: ['project', 'local']`. Each Agent directory MAY contain an `evolution/` subdirectory with `weekly/` and `proposals/` subdirectories for the self-evolution mechanism. The `CLAUDE.md` file SHALL support a User Expectations section positioned as a high-weight section near the top of the file, which the daily reflection cycle uses as its primary gap-identification benchmark.

#### Scenario: Agent 目錄結構驗證

- **WHEN** `AgentLoader` scans the `agents/` directory
- **THEN** it SHALL reject any subdirectory that does not contain a valid `agent.json` passing Zod schema validation

#### Scenario: settings.local.json 所有權

- **WHEN** the SDK approves a tool at runtime
- **THEN** it MAY dynamically write to the `permissions.allow` array in `settings.local.json`, and the application MUST NOT overwrite this file in a way that loses SDK-managed fields

#### Scenario: Agent 繼承

- **WHEN** `agent.json` specifies an `extends` field
- **THEN** `AgentLoader` SHALL merge the parent Agent's configuration, with child values taking precedence

#### Scenario: Evolution directory is optional

- **WHEN** `AgentLoader` scans an Agent directory that does not contain `evolution/`
- **THEN** validation SHALL pass normally — evolution/ is not a mandatory directory

#### Scenario: User Expectations section in CLAUDE.md

- **WHEN** an Agent's CLAUDE.md contains a User Expectations section
- **THEN** AgentLoader SHALL load it as part of the system prompt without special handling — it is treated as regular CLAUDE.md content
