# Session Operations and Review Fix Plan

## Goal

Improve ClaudeCab's session reliability, user experience, and cost control without requiring operators to read raw logs or ask an AI to reconstruct incidents from logs.

This plan has two tracks:

- Fix the review findings from the recent schedule-thread/session changes.
- Add operator-facing management surfaces for session health, resume risk, cost risk, and schedule-thread continuity.

## Stage 1: Fix Review Findings

### 1. Preserve schedule-thread identity after successful handoff

Problem:

- `QueryExecutor` clears `continuation_source` after the first successful schedule-thread handoff.
- `SessionRepository.findByScheduleThread()` only recognizes rows where `continuation_source = 'schedule'`.
- After restart, `ScheduleThreadMap` is gone and the DB resolver no longer recognizes the Discord thread as `schedule:thread:{threadId}`.

Required change:

- Do not use one column for both "this is a schedule thread" and "first handoff is pending".
- Keep a persisted schedule-thread marker after activation.

Recommended implementation:

- Replace `continuation_source` semantics with two persisted fields, or add one additional field:
  - `continuation_source = 'schedule' | NULL` means this row belongs to a schedule-created thread.
  - `continuation_state = 'pending' | 'active' | NULL` means whether first handoff is still pending.
- On schedule completion:
  - Save `continuation_source = 'schedule'`.
  - Save `continuation_state = 'pending'`.
- On successful first handoff:
  - Keep `continuation_source = 'schedule'`.
  - Set `continuation_state = 'active'`.
- `findByScheduleThread(threadId)` must resolve both pending and active schedule-thread rows.
- Discord routing must continue to derive `userId = schedule:thread:{threadId}` after restart.

Acceptance tests:

- Schedule thread row is findable after `continuation_state` changes to `active`.
- Simulated restart after first handoff still routes the Discord thread to `schedule:thread:{threadId}`.
- Second reply after restart resumes the same stored `sdk_session_id`.

### 2. Stop schedule resume fallback before fresh query runs

Problem:

- `SDKSessionManager` detects empty resume output, destroys the session, creates a fresh session, sends the user's prompt, and only then returns `resumeLost`.
- `QueryExecutor` suppresses the returned response for schedule continuation, but the fresh query already ran.
- This violates the chosen policy: schedule handoff failure must stop explicitly, not open a new conversation.

Required change:

- Add a runtime option that disables automatic fresh-session fallback when resume is mandatory.

Recommended implementation:

- Add `requireResume?: boolean` or `allowResumeFallback?: boolean` to `ExecuteQueryOptions`.
- When `internalSession.continuationSource === 'schedule'` and first handoff is pending, pass `requireResume: true` or `allowResumeFallback: false`.
- In `SDKSessionManager`, when empty resume output occurs and fallback is disabled:
  - Destroy the broken session.
  - Throw a typed error such as `ResumeRequiredError` or return a `QueryResult` state that contains no fresh query side effect.
  - Do not call `_createSession()` with `resume: undefined`.
  - Do not send the prompt to a fresh session.
- In `QueryExecutor`, catch this typed failure and send the explicit schedule-context failure message.

Acceptance tests:

- Schedule pending resume empty result does not create a fresh V2 session.
- Schedule pending resume empty result does not send the user's prompt to a fresh session.
- Normal chat still falls back to fresh conversation with the existing warning.

### 3. Restore anti-spam behavior for token guard

Problem:

- `SessionGuard` now prompts on every over-threshold message.
- This can block every turn in long sessions after the user already chose Continue.

Required change:

- Reintroduce suppression so the token guard does not fire every message.

Recommended implementation:

- Restore the prior growth threshold behavior:
  - Fire if the guard was never shown.
  - Fire again only if current token count is at least 1.5x the last shown token count.
- Keep the new timeout behavior.
- Keep resume guard behavior that checks JSONL before rebuild cost.

Acceptance tests:

- First over-threshold message prompts.
- Next message at similar token count does not prompt again.
- Message at 1.5x or more prompts again.
- Timeout still returns `timeout` and aborts message processing.

### 4. Align migration schema with fresh schema

Problem:

- Fresh DB creates `idx_sessions_continuation`.
- v14-to-v15 migration only adds the column.

Required change:

- Add the same index creation to the migration.

Acceptance tests:

- Migrated v14 DB contains `continuation_source`.
- Migrated v14 DB contains `idx_sessions_continuation`.

### 5. Keep `created_at` immutable on upsert

Problem:

- `SessionRepository.save()` updates `created_at` on conflict.
- Existing test currently locks in that mutable behavior.
- `created_at` should represent original session creation time.

Required change:

- Remove `created_at = excluded.created_at` from the upsert update clause.
- Replace the test with one that asserts `created_at` is preserved.
- Use `last_active_at` for update-time changes.

Acceptance tests:

- Upsert preserves original `created_at`.
- Upsert updates `last_active_at`.
- Schedule pre-created session keeps its original creation time after activation.

## Stage 2: Add Operator-Facing Session Management

### 1. Add `/sessions` operational command

Purpose:

- Let operators inspect active and persisted sessions without reading logs.

Recommended fields:

- Agent
- Platform
- User/session identity
- Discord channel/thread id when derivable
- SDK session id short hash
- State: idle, processing, error, soft-deleted
- Continuation source/state: normal, schedule pending, schedule active
- Last active time
- Estimated context tokens
- Cache TTL risk
- Last resume outcome
- Approximate cost for current session

Recommended actions:

- Reset session
- Clear SDK session id
- Force close V2 managed session
- Show JSONL path and existence status
- Re-check resume availability

### 2. Add `/thread-status` for Discord threads

Purpose:

- Make it obvious whether the current Discord thread is a normal thread, task thread, or schedule thread.

Output should include:

- Detected route type
- Effective `userId`
- ClaudeCab `session_id`
- Stored `sdk_session_id`
- Whether JSONL exists
- Whether first schedule handoff is pending or active
- Last successful resume time, if tracked
- What will happen on the next message

### 3. Add `/resume-check` diagnostic command

Purpose:

- Let an operator check whether a session can resume before the user pays rebuild cost.

Behavior:

- Resolve the current effective session.
- Locate SDK JSONL by `agent.path` and `sdk_session_id`.
- Report:
  - JSONL exists or missing
  - last assistant usage/context tokens if available
  - estimated cache TTL risk
  - whether resume is expected to be safe
- Do not send a Claude prompt.

### 4. Add session health dashboard data API

Purpose:

- Support future WebUI or Discord summary views without parsing logs.

Recommended endpoint/service shape:

- `SessionHealthService.getOverview(agentId?)`
- `SessionHealthService.getSessionDetail(sessionId)`
- `SessionHealthService.getThreadDetail(threadId)`

Data should be derived from:

- `sessions`
- query metrics
- `SDKSessionManager` in-memory state
- JSONL existence/context restore
- schedule-thread persisted metadata

### 5. Add proactive operational alerts

Purpose:

- Notify before users experience silent failure or runaway cost.

Alert candidates:

- Schedule thread handoff failed.
- Schedule thread handoff is pending for unusually long time.
- Resume JSONL missing for a persisted session.
- Cache efficiency drops below threshold.
- Session cost exceeds configurable threshold.
- Keepalive repeatedly fails.
- Zombie session recovered.
- Session guard timeout rate is high.

Alerts should include:

- Agent id
- Effective user/session id
- Thread id when available
- SDK session id short hash
- Suggested operator action

## Stage 3: Cost and UX Controls

### 1. Add per-session cost budget view

Purpose:

- Show cost accumulation by session, not only by agent or trigger type.

Recommended behavior:

- Aggregate query metrics by `session_id` where possible.
- For schedule threads, show schedule execution cost separately from follow-up chat cost.
- Surface high-cost sessions in `/sessions` and dashboard overview.

### 2. Add resume-risk policy

Purpose:

- Avoid surprising users with expensive rebuilds.

Policy:

- If JSONL context is large and cache is cold, guard should show cost/context warning before sending the prompt.
- If the session is schedule-pending and resume is unavailable, fail explicitly.
- If normal chat resume is unavailable, keep current behavior: warn and start fresh.

### 3. Add session event history

Purpose:

- Let operators answer "what happened to this session?" without reading logs.

Events to persist or summarize:

- Session created/restored/reset/soft-deleted
- SDK session id changed
- Resume failed
- Resume fallback used
- Schedule handoff pending/active/failed
- Guard shown/continued/switched/timed out
- Keepalive failed/recovered

## Stage 4: Test Coverage

Add tests for:

- Schedule thread first handoff success.
- Schedule thread second reply after process restart.
- Schedule resume failure does not create fresh session.
- Normal chat resume failure still creates fresh session with warning.
- Token guard suppression and timeout behavior.
- v14-to-v15 migration includes column and index.
- `created_at` is immutable across upsert.
- `/thread-status` and `/resume-check` resolve expected session identities.

## Suggested Implementation Order

1. Fix Stage 1 review findings.
2. Add tests for the two P1 findings before changing behavior.
3. Add `/thread-status` and `/resume-check` first because they directly reduce debugging pain.
4. Add `/sessions` overview.
5. Add `SessionHealthService` for WebUI/API reuse.
6. Add proactive alerts and per-session cost summaries.

## Non-Goals

- Do not replace Claude SDK resume with custom context reconstruction.
- Do not make schedule execution itself persistent.
- Do not require operators to inspect raw JSONL manually.
- Do not change normal chat fallback policy unless explicitly requested.

## Claude Code Execution Prompt

Use this prompt with Claude Code from the repository root:

```text
Read docs/SESSION_OPERATIONS_AND_REVIEW_FIX_PLAN.md and implement Stage 1 completely.

Constraints:
- Preserve the product rule: schedule execution is ephemeral, but schedule-thread follow-up is persistent from the first user reply onward.
- Fix all five review findings in Stage 1.
- Add or update tests for every Stage 1 acceptance test.
- Do not implement Stages 2-4 yet except where a small helper is required for Stage 1 tests.
- Run npm run typecheck and the relevant vitest tests before finishing.
- Summarize changed files, behavior changes, and test results.
```
