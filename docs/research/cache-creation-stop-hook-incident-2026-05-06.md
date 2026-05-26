# Cache Creation / Stop Hook Incident Analysis

Date: 2026-05-06  
Scope: ClaudeCab persistent SDK sessions, Claude Code v2.1.109 transcript behavior, Opus 4.6 `[1m]` prompt caching, Discord operational alerts.

## Executive Summary

The recent cost spikes were not caused by long user messages or large assistant output. The most important incident had `input_tokens=3`, `output_tokens=222` on the first assistant turn, but `cache_creation_input_tokens=143,067`.

The actual failure mode is a prompt-cache prefix rebuild:

1. A previous turn used Stop hooks with `decision: "block"`.
2. Claude Code wrote hook feedback into the transcript as `system subtype="stop_hook_summary"` and related hook branch nodes.
3. The next request did not continue from the same simple linear prompt prefix. It continued through a Stop-hook summary branch.
4. Anthropic prompt caching is prefix/breakpoint based, not diff based.
5. The server could only reuse the first ~12K tokens of prefix and had to write a new ~49K / ~92K / ~143K cache segment.

This is why a tiny keepalive prompt or a short user message can cause expensive `cache_creation`.

The cost spike is amplified by Opus 4.6 `[1m]`: 1-hour cache writes are expensive relative to cache reads. In the `$1.4996` incident, the cost was dominated by `150,515` cache write tokens, not the `3.0K` output.

## Terms Used In This Document

`input_tokens`
: Fresh, non-cached input for the current request. In these incidents it was tiny (`3`, `15`, etc.). This rules out "large current user input" as the cause.

`cache_read_input_tokens`
: Prompt prefix tokens successfully read from a previous cache entry.

`cache_creation_input_tokens`
: Prompt input tokens written into a new cache entry during this request. This is input-side cost, but not "new user input". It can be old conversation/history/system/tool context being rebuilt into cache.

`output_tokens`
: Assistant output. It is not the driver in these incidents.

`Stop hook block`
: A Stop hook returning `decision: "block"` and a `reason`. Claude Code feeds this reason back so the model continues instead of stopping.

`stop_hook_summary`
: Claude Code transcript system node summarizing Stop hook feedback / blocking state.

## Confirmed Local Incidents

### Incident A: Keepalive on coder session

Alert:

```text
session=7c1ba577-af65-4e47-b9df-9e04e9a14d74
sdkSession=879632b9-e7fa-43a2-b594-780a645bf663
cacheRead=12104
cacheCreation=92719
fresh=3
hitPct=12%
```

JSONL:

```text
C:\Users\User\.claude\projects\F---Program-OwnProject-ClaudeCab-agents-coder\879632b9-e7fa-43a2-b594-780a645bf663.jsonl
```

Relevant nodes:

```text
line 468 system subtype=stop_hook_summary hookErrors=[STOP_HOOK - execution gate ...]
line 469 system subtype=stop_hook_summary hookErrors=[STOP_HOOK - memory checkpoint ...]
line 470 system subtype=stop_hook_summary hookErrors=[] hasOutput=false
line 471 user "Reply with only 'ok'"
line 472 assistant "ok" usage: input=3 read=12104 create=92719 output=4
```

Conclusion:

The keepalive did not expire the entire cache. It reused only a small stable prefix (`12104`) and rebuilt the rest (`92719`) because the next request followed the Stop-hook summary branch.

### Incident B: Keepalive on general session

Alert:

```text
session=21947465-2e85-493f-800f-faf5e768406b
sdkSession=3628bd53-6d29-4089-b2fd-2663f973d3a6
cacheRead=12104
cacheCreation=49424
fresh=3
hitPct=20%
```

JSONL:

```text
C:\Users\User\.claude\projects\F---Program-OwnProject-ClaudeCab-agents-general\3628bd53-6d29-4089-b2fd-2663f973d3a6.jsonl
```

Relevant nodes:

```text
line 107 system subtype=stop_hook_summary hookErrors=[STOP_HOOK - execution gate ...]
line 108 system subtype=stop_hook_summary hookErrors=[STOP_HOOK - memory checkpoint ...]
line 109 system subtype=stop_hook_summary hookErrors=[] hasOutput=false
line 110 user "Reply with only 'ok'"
line 111 assistant "ok" usage: input=3 read=12104 create=49424 output=4
```

Conclusion:

Same pattern as Incident A. It was not TTL-only. The fixed `cacheRead=12104` strongly suggests the cache only hit an early tools/system prefix, then rebuilt the conversation branch.

### Incident C: Normal user query with `$1.4996` cost

User-visible usage summary:

```text
Usage: $1.4996
7 turns
output 3.0K
fresh 15
write 151K
read 967K
5h quota 42% -> 47%
```

DB row:

```text
query_metrics.id=7310
created_at=2026-05-05T18:50:16.596Z
agent=coder
sdkSession=879632b9-e7fa-43a2-b594-780a645bf663
input_tokens=15
output_tokens=3005
cache_read_tokens=967458
cache_creation_tokens=150515
total_cost_usd=1.4996477500000012
num_turns=7
context_total_tokens=162622
context_model=claude-opus-4-6[1m]
```

Quota snapshots:

```text
2026-05-05T18:48:36.385Z five_hour=42%
2026-05-05T18:50:18.770Z five_hour=47%
```

JSONL first assistant turn:

```text
line 688 system subtype=stop_hook_summary
line 689 system subtype=stop_hook_summary
line 690 system subtype=stop_hook_summary
line 691 user "<short user message>"
line 692 attachment type=hook_additional_context hookName=UserPromptSubmit
line 693 assistant usage: input=3 read=12104 create=143067 output=222
```

Per-turn decomposition:

```text
line 693 create=143067 read=12104 output=222
later turns create=1303 + 2721 + 1478 + 988 + 519 + 439 ...
```

Conclusion:

The `$1.4996` query did not become expensive because it produced `3K` output. It became expensive because the first assistant turn rebuilt `143K` of prompt cache before producing a small answer. Later turns only added small normal cache writes.

## Why "Tiny Input" Can Still Create Huge Cache Writes

The key distinction:

```text
input_tokens=3
```

does not mean:

```text
the whole request input was 3 tokens
```

It means:

```text
only 3 tokens were fresh non-cached input.
```

The request still includes the whole prompt prefix: system prompt, tools, MCP tool definitions, conversation history, hook-added context, hidden/system transcript nodes, and current user message.

When the prefix cache hits, those old tokens appear as `cache_read_input_tokens`. When a prefix segment must be rewritten, those old tokens appear as `cache_creation_input_tokens`.

Therefore:

```text
input=3 read=12104 create=143067 output=222
```

means:

```text
new user-side delta was tiny,
the first 12K prompt prefix was read from cache,
the next 143K prompt prefix segment had to be written into cache,
the model then produced 222 output tokens.
```

## Prompt Caching Mechanics Relevant Here

Anthropic prompt caching is prefix/breakpoint based.

Important properties from the official prompt caching documentation:

- Cached prompt content must be reusable as the same prefix.
- The model reads from a cache entry at matching cache breakpoints.
- If the prompt prefix changes before a cache breakpoint, the later content is not reused as a suffix diff.
- Cache writes are more expensive than normal reads; cache reads are cheaper.
- 1-hour cache entries cost more to write than 5-minute entries.

Reference: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

The practical consequence:

```text
old prompt:
  A B C D E

new prompt:
  A B X D E
```

The provider cannot simply reuse `D E` as a suffix. It can only reuse the longest matching prefix / available breakpoint, then rebuild after the divergence:

```text
read:   A B
write:  X D E
```

That is why "a small inserted hidden/system node" can produce a large cache write if it appears before a large conversation-history segment or changes the transcript branch.

## Claude Code Prompt Caching Guidance

The official Claude Code prompt caching blog states that prompt caching is central to Claude Code performance and cost. It also describes a key design practice: do not modify the stable system prompt every turn. Instead, keep the prefix stable and put dynamic information into the next user message or tool result when possible.

Reference: https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything

This matters for ClaudeCab because current Stop hook blocking is effectively the opposite of that ideal:

```text
normal linear prompt history
  -> Stop hook block feedback
  -> hook continuation branch
  -> stop_hook_summary system nodes
  -> next user message
```

That mutates the transcript path before the next user request. It is worse than merely adding a small instruction to the next request, because it can invalidate a large cache segment.

## What The Stop Hook Nodes Contain

A `stop_hook_summary` node has no normal `message.content`. It is a system transcript node with fields like:

```json
{
  "type": "system",
  "subtype": "stop_hook_summary",
  "uuid": "...",
  "parentUuid": "...",
  "cwd": "...",
  "hookErrors": ["STOP_HOOK - execution gate ..."],
  "hasOutput": true
}
```

Typical hook content:

- `STOP_HOOK - execution gate`
- requirements like "Visible reply required"
- checks for execution quality
- `PASS -> reply exactly PASS`
- `FAIL -> reply FAIL: <missing execution item>`
- runtime facts: changed files, touched count, checks, validator, failures, archive duty, exploration, output chars

Second phase:

- `STOP_HOOK - memory checkpoint`
- memory update rules
- `memory=checkpoint_needed_but_not_observed`
- daily/vector/MEMORY/USER note instructions
- `PASS`, `memory updated`, or `No memory update needed: <reason>`

Final empty marker:

```json
{
  "type": "system",
  "subtype": "stop_hook_summary",
  "hookErrors": [],
  "hasOutput": false
}
```

These nodes are not user content, but they affect the transcript path used by the next request.

## Why It Was Not Just "Append A Small Tail"

The severe incidents were not only "old prompt + small new tail".

In the coder example around the expensive normal query:

```text
line 682 attachment hook_blocking_error
line 683 assistant
line 684 user "file updated"
line 685 assistant "memory updated"
line 688 system stop_hook_summary parent=earlier hook branch
line 689 system stop_hook_summary
line 690 system stop_hook_summary
line 691 next user message
line 693 first assistant create=143067 read=12104
```

The next user message continued after `stop_hook_summary`, not after a clean final assistant state. That is a transcript branch drift.

The cache system did not say:

```text
old prefix already cached, only write the small stop hook summary
```

It said:

```text
matching prefix only found up to ~12K,
write the rest of this new prompt path.
```

That is the direct cause of large `cache_creation`.

## Why This Appears Worse In Current Versions

Confirmed:

- Current JSONL shows `version: "2.1.109"`.
- Current JSONL contains `system subtype="stop_hook_summary"` nodes.
- Current expensive requests use `claude-opus-4-6[1m]`.
- Current incidents show the same `cacheRead ~= 12K` plus large `cacheCreation` pattern.

Hypotheses:

- Older Claude Code versions either did not persist Stop hook summary in the same way, did not route the next user message through that summary branch, or did not produce the same hidden/system reminder drift.
- Opus 4.6 `[1m]` makes this more visible because 1-hour cache write cost and quota impact are large.
- Claude Code v2.1.x has similar hidden/system reminder cache-break behavior reported by other users.

The evidence supports "new behavior exposed an existing architecture risk", not "large user input" or "assistant output" as the cause.

## Related GitHub Reports

These are not all the exact same `stop_hook_summary` bug, but they are the same class: hidden/system/dynamic transcript content changes the prompt prefix and causes huge cache creation.

### anthropics/claude-code#48644

URL: https://github.com/anthropics/claude-code/issues/48644

Pattern reported:

- Opus 4.6
- trivial prompt such as `ok` / `1`
- hidden `isMeta` / system reminder nodes
- `cache_creation_input_tokens` jumping to 200K+ tokens

Relevance:

This is very close to our `input=3 read=12104 create=143067` shape. The user prompt is tiny; hidden/system content mutates the prompt cache prefix.

### anthropics/claude-code#49585

URL: https://github.com/anthropics/claude-code/issues/49585

Pattern reported:

- dynamic `<system-reminder>` content
- reminder folded into history
- prompt cache prefix drift
- cache read collapses to tools/system prefix and later message prefix is rebuilt

Relevance:

This explains the exact cache pattern:

```text
cache_read only covers early tools/system prefix
cache_creation rebuilds large conversation prefix
```

### anthropics/claude-code#40524

URL: https://github.com/anthropics/claude-code/issues/40524

Pattern reported:

- `cache_read_input_tokens` around 11K
- `cache_creation_input_tokens` in 160K-300K range

Relevance:

The fixed early cache hit (`~11K` / `~12K`) plus huge cache creation is the same fingerprint we observed.

## Research Question 1: Can We Insert Stop Hook Content Into The User Message Instead?

Question:

> Instead of using Stop hook block after the assistant responds, can ClaudeCab insert the two Stop hook phase prompts into the next user message before sending the query?

Short answer:

Yes, as a cost-control strategy, this is likely much cheaper than Stop hook `decision:"block"` branch drift. But it does not fully preserve Stop hook semantics.

### Why It Could Be Cheaper

Current bad path:

```text
Stop hook block mutates transcript branch
next request reads only ~12K
next request writes 50K-143K cache
```

Proposed pre-injection path:

```text
next request is linear
user message includes governance instructions/checklist
normal cache prefix remains stable
only the new user-turn tail is written
```

Even if the inserted governance content is 1K-3K tokens every query, that is still much smaller than a 50K-143K cache rebuild.

Rough cost intuition on Opus 4.6 `[1m]`:

```text
bad rebuild: 143K 1h cache write ~= dollar-scale cost
pre-injected governance: a few K tokens ~= cents-scale cost
```

### Important Caveat: Suffix Reuse Is Not Guaranteed

If the program sends one plain string like:

```text
好的請開始

{StopHook phase 0}
{StopHook phase 1}
```

the governance block appears after the changing user text. Prompt caching generally cannot reuse an identical suffix after a changing prefix. It is still likely cheaper than branch drift because the governance block is small, but it will not magically be free.

Better variants:

1. Put stable governance text before the variable user text:

   ```text
   <internal-governance>
   compact execution/memory checklist
   </internal-governance>

   <user-message>
   好的請開始
   </user-message>
   ```

2. If the SDK supports structured content blocks, use separate blocks so stable instructions and variable user text are not merged into one opaque string.

3. Keep the injected governance text compact and deterministic. Avoid dynamic runtime facts unless necessary.

### Semantic Difference From Stop Hook

Stop hook block is post-answer enforcement:

```text
assistant tries to stop
hook checks result
hook can force another model turn
```

Pre-injection is pre-answer guidance:

```text
model sees checklist before answering
model is asked to self-check before final response
```

It can reduce failures, but it cannot guarantee the final answer passes a post-hoc validator.

Therefore the recommended architecture is:

```text
main session:
  no Stop hook decision:block
  prepend/append compact governance guidance to user prompt or UserPromptSubmit context

out-of-band audit:
  separate stateless/short session checks final answer
  logs warning / Discord alert / creates follow-up task
  does not mutate main transcript
```

### Recommendation

Do not insert the full current Stop hook phase text verbatim into every user message. It is too verbose and partly post-hoc.

Instead:

1. Extract a compact "preflight governance checklist" from the two phases.
2. Inject it into the next query as deterministic internal context.
3. Disable or feature-flag Stop hook `decision:"block"` in the main session.
4. Move answer validation and memory checkpoint enforcement to an out-of-band audit path.
5. If an audit finds a failure, alert the owner or send a normal follow-up user turn. Do not use Stop hook block.

## Research Question 2: Can We Detect Abnormal Turns And Alert Discord?

Yes. The current code already has enough data.

Relevant code locations:

- `src/core/SDKStreamProcessor.ts`
  - sees each assistant message
  - reads `message.message.usage`
  - updates `managed.lastTurnContextTokens`
  - has per-turn `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`

- `src/core/SDKKeepaliveManager.ts`
  - already has keepalive cache anomaly diagnostics
  - now has transcript inspection and Discord links

- `src/core/SDKSessionTypes.ts`
  - can store latest anomaly state on `ManagedSession`

- `src/services/ActivityEventService.ts`
  - can emit Discord alert events

### Proposed Per-Turn Anomaly Rules

Rule A: cache write spike

```text
cache_creation_input_tokens >= 50_000
```

Rule B: low fresh input plus huge write

```text
input_tokens <= 200
cache_creation_input_tokens >= 25_000
```

This catches "tiny user input caused huge cache creation".

Rule C: read collapse fingerprint

```text
cache_read_input_tokens <= 20_000
cache_creation_input_tokens >= 50_000
lastKnownContextTokens >= 50_000
```

This catches "only tools/system prefix hit; conversation branch rebuilt".

Rule D: create/read ratio

```text
cache_creation / (cache_read + cache_creation + input) >= 0.30
and cache_creation >= 25_000
```

Rule E: known transcript cause

Inspect latest JSONL around the current assistant/user node. If previous parent chain includes:

```text
system subtype=stop_hook_summary
attachment type=hook_blocking_error
attachment type=hook_additional_context with large dynamic text
```

label cause as:

```text
stop_hook_summary
hook_blocking_error
dynamic_prompt_context
unknown_prefix_rebuild
```

### Suggested Event Labels

Structured log event types:

```text
cache.creation_spike
cache.prefix_rebuild_suspected
cache.branch_drift_suspected
cache.stop_hook_summary_rebuild
```

Discord alert title examples:

```text
Cache write spike: 143K creation on first assistant turn
Cache prefix rebuild suspected: read 12K, wrote 143K
Stop hook summary caused cache branch drift
```

### Alert Payload Should Include

Minimum details:

```text
sessionId
sdkSessionId
agentId
chatId
source Discord message link
JSONL path
assistant JSONL line
previous transcript node line/type/subtype
input/cacheRead/cacheCreation/output
context tokens
model
estimated cost
query row id if available
likely cause
```

### Alert Cooldown

Avoid noise by separating two levels:

1. Always structured log every anomaly.
2. Send Discord alert when:

   ```text
   cache_creation >= 50K
   or estimated cost >= $0.50
   or 5h quota delta >= 3 percentage points
   ```

Cooldown should be per `sdkSessionId + likelyCause`, not global.

### Why Per-Turn Detection Matters

The aggregate usage summary can hide the first-turn failure:

```text
aggregate hit rate = 87%
```

But first assistant turn was:

```text
read=12K create=143K
```

The aggregate hit rate looks acceptable only because later turns read the newly written cache. Therefore anomaly detection must inspect per-assistant-turn usage, not only final query aggregate.

## Recommended Next Engineering Changes

### P0: Stop using main-session Stop hook block

Current risk point:

```text
src/core/SDKSessionFactory.ts
Stop hook returns decision:"block"
```

Recommended:

- feature flag this behavior off by default
- keep non-blocking telemetry/logging
- do not return `decision:"block"` in the main persistent session

### P1: Add compact preflight governance injection

Implement a prompt decorator before `SDKSessionManager.execute()` sends the user prompt.

Requirements:

- deterministic text
- compact, not full hook prompt
- no large dynamic runtime facts unless needed
- sourced from existing hook definitions/config, not hardcoded literal duplication
- clear delimiter so it is internal governance context, not user-authored text

Example shape:

```text
<internal-governance>
Before final response: verify user request is handled, required checks are run/reported, failures are not hidden, and memory/update duty is handled when clearly required.
If not complete, continue work before final response.
</internal-governance>

<user-message>
...
</user-message>
```

### P2: Add out-of-band post-answer audit

For the "post-answer" semantics currently provided by Stop hook:

- run a separate short/stateless audit query, or local deterministic validator
- use cheaper model when possible
- never mutate the main session transcript
- alert/follow up on failure

### P3: Add per-turn cache anomaly detection

Add a helper around the assistant-message usage block in `SDKStreamProcessor.ts`:

```text
auditAssistantTurnCacheCreation(sessionId, managed, turnUsage, streamMsgIndex, message)
```

It should:

- compute hit percentage
- compare against thresholds
- inspect transcript parent node if abnormal
- structured-log every abnormal turn
- emit Discord alert on severe spikes
- store `managed.lastCacheCreationAnomaly` for `/sessions`

### P4: Expand `/sessions`

Already improved:

- thread/source links
- JSONL path
- latest keepalive anomaly
- cache tail mutation

Next:

- latest per-turn cache creation anomaly
- first bad assistant line
- cause label
- "last cache branch drift" marker

## What Not To Do

### Do not rely on JSONL surgery for live sessions

Deleting `stop_hook_summary` from JSONL may help only if the SDK later resumes from disk. A live SDK process may already hold the transcript state in memory.

If sanitization is used, it must be resume-time sanitization with parent chain repair, not ad-hoc deletion.

### Do not treat low output as proof of low cost

`output=3K` can still accompany `cache_creation=151K`. Output is not the main signal here.

### Do not trust aggregate hit rate alone

`87% hit` can hide a first-turn branch rebuild because later turns read the cache that the first turn just wrote.

### Do not simply lower keepalive interval

These incidents were not ordinary TTL expiry. Lowering the interval does not fix transcript branch drift.

## Final Diagnosis

The recent expensive cache creation events are best described as:

```text
Stop-hook-induced transcript branch drift causing prompt cache prefix rebuilds.
```

The most reliable mitigation is:

```text
remove main-session Stop hook decision:block
move governance into compact preflight guidance plus out-of-band audit
add per-turn cache creation anomaly logging and Discord alerts
```

The most important detection fingerprint is:

```text
fresh input tiny
cache read fixed around 12K
cache creation tens/hundreds of K
previous transcript parent includes stop_hook_summary or hook_blocking_error
```

When that appears, the issue is not user input size, not assistant output size, and not normal keepalive TTL behavior. It is a prompt prefix/cache breakpoint rebuild caused by hidden/system transcript mutation.

