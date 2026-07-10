# ClaudeCrab Logging Conventions

**For every new or modified log call, follow this document.** Current automated linting is `npm run lint`; there is no separate log-specific lint script in this repository.

The logs are consumed by **two audiences**: humans scrolling `logs/claudecab.log.*`, and AI agents (Claude Code) greping/jq-ing to diagnose issues. Both need the same thing — structured, searchable, correlated events.

---

## The Five Rules

### 1. Every `logger.info/.warn/.error/.fatal` call MUST include `event_type`

```ts
// ❌ bad
logger.info({ userId, agentId }, 'User connected');

// ✅ good
import { EventType } from '../utils/events.js';
logger.info({ event_type: EventType.SESSION_CREATED, userId, agentId }, 'User connected');
```

Prefer `event_type` values from `src/utils/events.ts`. For new durable events, add a constant to `EventType` first, then use it. Some legacy call sites still inline string literals; do not copy that pattern when adding new logs.

`logger.debug` and `logger.trace` are exempt (they're fine-grained diagnostics).

### 2. Never embed structured data in the message string

```ts
// ❌ bad — can't grep for the query id
logger.info(`Query ${queryId} completed in ${ms}ms`);

// ✅ good — queryable
logger.info({ event_type: EventType.AGENT_QUERY_COMPLETE, query_id: queryId, duration_ms: ms }, 'Query completed');
```

### 3. Use `err` (not `error`) for Error objects

The pino serializer at `src/utils/logger.ts` is bound to the `err` key. Using `error` skips it, and the stack trace/cause chain gets lost.

```ts
// ❌ bad — errorSerializer won't run
logger.error({ error: e }, '…');

// ✅ good
logger.error({ err: e }, '…');
```

### 4. Don't create a correlation id manually — `processMessage` does it

Every user-facing interaction enters through `MessageProcessor.processMessage`, which mints a `correlation_id` and installs a `logContext` via `AsyncLocalStorage`. **Every downstream log line on the same async chain automatically carries** `correlation_id`, `message_id`, `platform`, `agent_id`, `user_id`, `chat_id`.

That means you almost never need to pass these fields explicitly.

```ts
// Inside any code reached from processMessage — context is already threaded
logger.info({ event_type: EventType.AGENT_TOOL_CALL, tool: 'Read' }, 'Reading file');
// Output will include correlation_id, message_id, platform, agent_id automatically.
```

If you start a NEW logical operation outside the ingress path (e.g. a cron job), wrap it:

```ts
import { logContext, newCorrelationId } from '../utils/logContext.js';

logContext.run(
  { correlation_id: newCorrelationId(), agent_id: agentId },
  async () => { /* … work … */ }
);
```

### 5. High-frequency logs MUST be sampled or throttled

Polling, heartbeats, tick events, sound playback — anything that could fire >1/sec. Use `src/utils/logSample.ts`:

```ts
import { throttled } from '../utils/logSample.js';

throttled('discord.typing', 5000, () =>
  logger.debug({ event_type: 'adapter.typing' }, 'Typing indicator sent')
);
```

---

## Event Taxonomy

All event names live in `src/utils/events.ts`. Categories (glob-friendly):

| Prefix | Scope | Examples |
|--------|-------|----------|
| `lifecycle.*` | Process-level | `startup_banner`, `heartbeat`, `shutdown_begin` |
| `instance.*` | Singleton-guard | `lock_acquired`, `lock_failed` |
| `adapter.*` | Platform adapter | `started`, `stopped`, `error` |
| `platform.*` | Platform-side abnormalities | `conflict_409`, `reconnect` |
| `message.*` | User-message flow | `processing_start`, `complete`, `race_prevented` |
| `agent.*` | Claude SDK query/tool | `query_start`, `query_complete`, `tool_call` |
| `session.*` | Conversation session | `created`, `restored`, `disposed` |
| `schedule.*` | Cron jobs | `tick`, `fired`, `error` |
| `budget.*` | Cost enforcement | `exceeded`, `paused_agent` |
| `persistence.*` | DB/repo | `migration`, `error` |
| `error.*` | Uncategorized error | `unhandled_rejection` |

**Add new events in `events.ts` first, then use.**

---

## Field Naming

- **snake_case** for structured fields: `user_id`, `message_id`, `chat_id`, `agent_id`.
- Exception: we keep `userId/agentId/chatId/messageId` camelCase at *call sites* because that's how `UnifiedMessage` and SessionManager use them — pino will emit whatever key you pass. **New fields should use snake_case** going forward. The mixin auto-copies camelCase context into snake_case keys on output.
- **Durations** end in `_ms`: `duration_ms`, `wall_clock_ms`.
- **Bytes/memory** end in `_mb` or `_bytes`.
- **Counts** are bare nouns: `token_count`, `session_count`, `message_count`.
- **Tokens / cost** use OpenTelemetry GenAI conventions where applicable: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cost_usd`.

---

## Grep / Jq Recipes (AI-facing)

```bash
# All log lines for one user message
grep "correlation_id=c_abc123" logs/claudecab.log.*

# Count unique live instances in the last N heartbeats (detects duplicate bots)
grep '"event_type":"lifecycle.heartbeat"' logs/claudecab.log.* \
  | jq -r '.instance_id' | sort -u

# All errors in last hour with their causing message
jq -c 'select(.level >= 50 and (now - (.time/1000)) < 3600)' logs/claudecab.log.*

# Per-message token spend (GenAI conventions)
jq -c 'select(."event_type"=="agent.query_complete")
       | { correlation_id, tokens: ."gen_ai.usage.total_tokens", cost: ."gen_ai.usage.cost_usd" }' \
       logs/claudecab.log.*

# Duplicate-processing audit: how many query_complete events per message?
jq -c 'select(."event_type"=="agent.query_complete") | .correlation_id' logs/claudecab.log.* \
  | sort | uniq -c | awk '$1 > 1'
```

---

## Log File Lifecycle

- **Rotation**: `pino-roll` — new file every day or every 10MB, whichever first
- **Retention**: 14 files (approx. 2 weeks at our volume)
- **Location**: `logs/claudecab.log.YYYY-MM-DD.N`
- **Stdout mirror**: still writes to supervisor's `supervisor-out.log` — don't rely on that file for long-term analysis; it's not rotated

Total disk budget: ~140MB. If this blows up you have a spam bug — find the hot log call and sample/throttle it per Rule 5.

---

## Secret Handling

`src/utils/logger.ts` has a `redact` config that strips: `token`, `apiKey`, `password`, `authorization`, and the three bot-token env var names. **This is a safety net, not a license** — still prefer `masked_token: '***'` explicitly at the call site if you're anywhere near auth code.

---

## Linting

```bash
npm run lint
```

`npm run lint` currently runs ESLint against `src`. There is no log-only lint gate, so reviewers should still check new or modified logs against this document.

---

## When to Use Which Level

| Level | Use for |
|-------|---------|
| `fatal` | Process is about to die. Always causes `process.exit(1)`. |
| `error` | Operation failed. A user is affected. Has an `err` field. |
| `warn` | Something unexpected but we recovered. Worth a human glance. |
| `info` | Normal lifecycle events. Each user message produces a handful. |
| `debug` | Intermediate state useful for local repro. Off in prod by default. |
| `trace` | Never enabled in prod. Raw packet-level stuff. |

Set level via `LOG_LEVEL=debug` in `.env`.
