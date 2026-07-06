---
schema_version: behavior-contract/v1
id: claudecab.subagent-delivery
title: SDK task sub-agent Discord delivery contract
status: active
owner_surface: infrastructure
change_context:
  type: bugfix
  reason: SDK Task/sub-agent work can produce output without a normal parent assistant message, leaving Discord silent unless task lifecycle events are routed.
  non_goals:
    - Do not enable V1 fallback.
    - Do not change SDK package or import @anthropic-ai/sdk.
    - Do not expose raw internal task events to normal Discord users.
---

# SDK Task Sub-Agent Discord Delivery Contract

## Behavior Boundary

In scope:

- Parse SDK `system` stream events with task subtypes into `SubAgentEvent`.
- Route `task_started`, `task_progress`, `task_updated`, and `task_notification` to the session `SubAgentMessageManager`.
- When a completed task includes an output file, read it best-effort and include the task result in the Discord sub-agent message.
- Count routed sub-agent events as usable output so V2 empty-output guards do not discard a valid task-only turn.
- Do not emit the generic silent-failure warning when a sub-agent message was delivered.

Out of scope:

- A full task panel or task history UI.
- Reconstructing missed events after the SDK process is closed.
- Changing foundation sub-agent definitions or SDK options.

## Consumers And Entrypoints

| Consumer | Entrypoint |
|---|---|
| Discord user | Edited sub-agent lifecycle message in the active chat/thread |
| SDK stream processor | `processStream()` and `drainPostResultMessages()` |
| Query delivery audit | `deliverFinalResponse()` silent-failure detection |

## Inputs And State

- SDK stream messages are treated as untrusted runtime data; parser reads only string fields it recognizes.
- `output_file` is optional and read best-effort.
- Existing `SubAgentMessageManager` state is reused per SDK session when available.

## Outputs And Side Effects

- Started/progress/completed/failed task events create or edit one Discord message per task/tool-use id.
- Completed events may include truncated task output.
- File-read failures are debug logged and do not fail the parent query.

## Invariants

- Secret values are never added to task messages by ClaudeCab itself.
- A failed output-file read cannot break the parent conversation.
- A delivered sub-agent message counts as user-visible output.

## Acceptance Examples

```gherkin
Given the SDK emits task_started followed by task_notification completed
When the parent assistant response is empty
Then Discord still receives or edits a sub-agent message
And ClaudeCab does not send the generic silent-failure warning
```

```gherkin
Given task_notification includes output_file
When the output file can be read
Then the completed sub-agent message includes the task output
```

## Test Mapping

| Contract item | Evidence |
|---|---|
| Task event parsing | `tests/subAgentDelivery.test.ts` |
| Output file delivery | `tests/subAgentDelivery.test.ts` |
| Silent-failure suppression | `tests/subAgentDelivery.test.ts` |
