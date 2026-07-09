# Runtime MCP Tool Registry

> Source of truth for ClaudeCab in-process MCP tools registered through
> `src/McpToolSetup.ts`.

## Boundary

Runtime MCP tools are deterministic capabilities exposed to agents during a
ClaudeCab query. They are not skills, hooks, checklists, or project
state.

Use a runtime MCP tool when the agent needs to execute code or call a service
with explicit inputs and outputs. Do not use a tool when a normal skill,
checklist, or validator rule is enough.

## Registered Tools

| MCP server | Tool | Source | Registered by | Availability | Purpose |
|---|---|---|---|---|---|
| `file-send` | `mcp__file-send__send_file` | `src/tools/sendFileTool.ts` | `src/McpToolSetup.ts` | Always available | Send generated files back to the user. |

## Governance Rules

- Register every runtime MCP server in `src/McpToolSetup.ts`.
- Add a row here when adding or removing a runtime MCP tool.
- Prefer JSON output for deterministic governance tools.
- Keep tool descriptions concise because they enter the model's tool context.
