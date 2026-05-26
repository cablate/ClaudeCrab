# Runtime MCP Tool Registry

> Source of truth for ClaudeCab in-process MCP tools registered through
> `src/McpToolSetup.ts`.

## Boundary

Runtime MCP tools are deterministic capabilities exposed to agents during a
ClaudeCab query. They are not skills, hooks, validators, checklists, or project
state.

Use a runtime MCP tool when the agent needs to execute code or call a service
with explicit inputs and outputs. Do not use a tool when a normal skill,
checklist, or validator rule is enough.

## Registered Tools

| MCP server | Tool | Source | Registered by | Availability | Purpose |
|---|---|---|---|---|---|
| `file-send` | `mcp__file-send__send_file` | `src/tools/sendFileTool.ts` | `src/McpToolSetup.ts` | Always available | Send generated files back to the user. |
| `validator` | `mcp__validator__run_agent_workspace_validation` | `src/tools/validatorTool.ts` | `src/McpToolSetup.ts` | Always available | Run the reference-trio workspace validator and return JSON schema v1. |
| `tts` | `mcp__tts__speak` | `src/tools/ttsTool.ts` | `src/McpToolSetup.ts` | When TTS service exists | Generate or play TTS audio. |
| `task-mgmt` | `mcp__task-mgmt__*` | `src/tools/taskTool.ts` | `src/McpToolSetup.ts` | When TaskService exists | Create, list, update, and review tasks. |

## Governance Rules

- Register every runtime MCP server in `src/McpToolSetup.ts`.
- Add a row here when adding or removing a runtime MCP tool.
- If the tool is part of workspace governance, add validator coverage in
  `scripts/validate-agent-workspace.mjs`.
- Prefer JSON output for deterministic governance tools.
- Keep tool descriptions concise because they enter the model's tool context.

## Validator Tool Contract

`mcp__validator__run_agent_workspace_validation` is the first governance MCP
tool in this workspace.

It wraps:

```bash
node scripts/validate-agent-workspace.mjs --json --warn-only
```

The output must follow schema v1:

```json
{
  "schemaVersion": 1,
  "validator": "agent-workspace",
  "scope": "reference-trio",
  "ok": true,
  "counts": {
    "errors": 0,
    "warnings": 0
  },
  "issues": []
}
```
