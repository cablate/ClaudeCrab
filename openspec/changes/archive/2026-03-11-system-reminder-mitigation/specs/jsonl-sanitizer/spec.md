## Purpose

Defines the JSONL sanitization mechanism that prevents Claude Code Agent SDK's C26 function from rebuilding `readFileState` entries from conversation history, eliminating unwanted file-diff injection into `<system-reminder>` on every turn.

## Requirements

## ADDED Requirements

### Requirement: JSONL sanitization before resume

The system SHALL sanitize the JSONL conversation file before every SDK resume operation. Sanitization SHALL modify tool_use blocks to break C26's collection conditions:
- Read tool_use blocks without an `offset` field SHALL have `offset: 1` added.
- Write tool_use blocks with a `content` field SHALL have `content` removed.
- Edit tool_use blocks SHALL NOT be modified (C26 does not process them).

The sanitizer SHALL only write the file back if at least one modification was made.

#### Scenario: Read tool_use patching

- **WHEN** a JSONL file contains a Read tool_use block with `offset` equal to `undefined` or absent
- **THEN** the sanitizer SHALL set `input.offset` to `1` so that C26's condition (`offset === undefined`) fails

#### Scenario: Write tool_use patching

- **WHEN** a JSONL file contains a Write tool_use block with a `content` field in `input`
- **THEN** the sanitizer SHALL delete `input.content` so that C26's condition (`file_path && content`) fails

#### Scenario: Edit tool_use blocks are untouched

- **WHEN** a JSONL file contains an Edit tool_use block
- **THEN** the sanitizer SHALL NOT modify it

#### Scenario: No-op on clean file

- **WHEN** the JSONL file contains no patchable Read or Write tool_use blocks
- **THEN** the sanitizer SHALL NOT rewrite the file

---

### Requirement: Backup before modification

The sanitizer SHALL create a backup copy of the JSONL file before writing modifications. The backup SHALL be stored at `{jsonlPath}.pre-sanitize`. The backup SHALL overwrite any previous `.pre-sanitize` file for the same session (single backup per session, not cumulative).

#### Scenario: Backup creation on first sanitization

- **WHEN** the sanitizer modifies a JSONL file for the first time in a session
- **THEN** it SHALL copy the original file to `{jsonlPath}.pre-sanitize` before writing changes

#### Scenario: Backup overwrite on subsequent sanitization

- **WHEN** the sanitizer modifies the same JSONL file again in a later resume
- **THEN** the existing `.pre-sanitize` file SHALL be overwritten with the current pre-modification content

---

### Requirement: Performance observability

The sanitizer SHALL record and return performance metrics for every sanitization attempt: `readsPatched`, `writesPatched`, `totalLines`, `fileSizeBytes`, and `durationMs`. When patches are applied, the sanitizer SHALL log these metrics at `info` level. When the file is already clean and has content, the sanitizer SHALL log metrics at `info` level.

#### Scenario: Metrics logging on patch

- **WHEN** the sanitizer patches one or more tool_use blocks
- **THEN** it SHALL log at `info` level with `readsPatched`, `writesPatched`, `totalLines`, `fileSizeKB`, and `durationMs`

#### Scenario: Metrics logging on clean file

- **WHEN** the sanitizer processes a file with content but finds nothing to patch
- **THEN** it SHALL log at `info` level with `totalLines`, `fileSizeKB`, and `durationMs`

---

### Requirement: Non-blocking error handling

The sanitizer SHALL never block or fail the resume operation. If any error occurs during sanitization (file read, parse, write), the sanitizer SHALL catch the error, log a warning, and return `false` to indicate sanitization was skipped.

#### Scenario: File read failure

- **WHEN** the JSONL file cannot be read (permissions, corruption)
- **THEN** the sanitizer SHALL log a warning and return without blocking the resume

#### Scenario: Malformed JSONL line

- **WHEN** a line in the JSONL file cannot be parsed as JSON
- **THEN** the sanitizer SHALL keep the line as-is and continue processing remaining lines

---

### Requirement: Project hash computation

The sanitizer SHALL compute the Claude Code project-hash directory name using the same algorithm as the SDK (reverse-engineered from `ID()` + `bmK()`). Non-alphanumeric characters SHALL be replaced with `-`. If the result exceeds 200 characters, it SHALL be truncated to 200 characters with a bmK hash suffix (charCode loop to base36).

#### Scenario: Standard path hashing

- **WHEN** given a working directory path
- **THEN** the sanitizer SHALL produce a hash matching `cwd.replace(/[^a-zA-Z0-9]/g, '-')` truncated to 200 chars with hash suffix if needed

#### Scenario: JSONL file path resolution

- **WHEN** given a `cwd` and `sessionId`
- **THEN** the sanitizer SHALL resolve the JSONL path as `~/.claude/projects/{projectHash(cwd)}/{sessionId}.jsonl`
