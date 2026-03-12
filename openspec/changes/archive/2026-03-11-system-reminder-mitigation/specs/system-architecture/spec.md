## MODIFIED Requirements

### Requirement: SDKQueryManager 隔離

`SDKQueryManager` SHALL be the only module that calls the SDK `query()` function. It SHALL accept only a `systemPrompt` string and a `cwd` path as primary inputs. It MUST NOT contain any business logic such as memory injection, user profile assembly, or conversation history formatting. The system prompt SHALL be passed using the SDK preset append mode (`{ type: 'preset', preset: 'claude_code', append: systemPrompt }`) to preserve Claude Code's built-in prompts and safety rules. `SDKQueryManager` MUST be designed to be portable and usable outside ClaudeCab without modification. Before calling `query()` with a `resume` option, `SDKQueryManager` SHALL invoke the JSONL sanitizer (`sanitizeBeforeResume`) to prevent C26 readFileState diff injection from historical conversation data.

#### Scenario: Preset append 模式

- **WHEN** `SDKQueryManager` calls `query()`
- **THEN** the `systemPrompt` option MUST use `{ type: 'preset', preset: 'claude_code', append: ... }` format and MUST NOT use a plain string override

#### Scenario: 查詢層不含業務邏輯

- **WHEN** `SDKQueryManager` executes a query
- **THEN** it SHALL NOT read memory files, inject user profiles, or perform any Agent-specific data assembly

#### Scenario: 對話恢復

- **WHEN** a session has a saved `sdkSessionId`
- **THEN** `SDKQueryManager` SHALL pass it to the SDK via the `resume` option, and if it fails, SHALL retry once after clearing the saved ID, without the `resume` option

#### Scenario: 中間訊息串流

- **WHEN** the SDK produces assistant messages during a multi-turn query
- **THEN** the `onIntermediateMessage` callback SHALL be invoked immediately for each message, enabling real-time delivery to the user

#### Scenario: JSONL sanitization before resume

- **WHEN** `SDKQueryManager.executeQuery()` is called with a `resume` option
- **THEN** it SHALL call `sanitizeBeforeResume(cwd, resume)` before invoking `query()`, and if sanitization fails, it SHALL proceed with the query without blocking

---

### Requirement: AgentLoader 動態系統提示

`AgentLoader` SHALL support two system prompt access modes: startup-time cache and per-query disk read. `readSystemPrompt(agentId)` SHALL re-read `CLAUDE.md` from disk on every call, allowing Agents to modify their own system prompt at runtime. `loadSystemPrompt()` SHALL return only the engine-level global static rules (e.g., `[send:path]` file-send syntax and agent-call tool descriptions). `loadSystemPrompt()` SHALL NOT read or append CLAUDE.md content — the SDK's WL8 memory loader handles CLAUDE.md loading automatically via `settingSources: ['project']`.

#### Scenario: 執行時 CLAUDE.md 重新載入

- **WHEN** `MessageProcessor` calls `getSystemPrompt(agentId)` before each SDK query
- **THEN** `AgentLoader.readSystemPrompt()` SHALL read the file from disk and return the current content, not a cached value

#### Scenario: 全域規則注入

- **WHEN** `AgentLoader` assembles the final system prompt
- **THEN** it SHALL return only the output of `getGlobalStaticRules()`, which contains custom tool descriptions (file-send syntax, agent-call), without CLAUDE.md content

#### Scenario: No manual CLAUDE.md injection

- **WHEN** `loadSystemPrompt()` is called during agent initialization
- **THEN** it SHALL NOT read CLAUDE.md from disk — the SDK's built-in WL8 memory loader loads it automatically via `settingSources: ['project']`

#### Scenario: No TTS forced invocation in global rules

- **WHEN** `getGlobalStaticRules()` constructs the global static rules string
- **THEN** it SHALL NOT include TTS tool descriptions or forced TTS usage instructions
