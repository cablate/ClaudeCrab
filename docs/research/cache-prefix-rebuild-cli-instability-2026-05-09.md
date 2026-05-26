# Cache Prefix Rebuild — CLI Request Assembly Instability

Date: 2026-05-09
Session: `d0d8e256-eda6-458a-9a18-0e12280002c0` (agents-general, Opus 4.6 [1m])
Scope: Cache read collapse caused by CLI-side prefix structure mutation, not TTL expiry or server eviction.

## Executive Summary

Two cache read collapses occurred in the same session. Both dropped `cache_read` to exactly **11,500 tokens** (the static system prompt prefix size) despite the previous turn reading 114K–423K. One collapse had **zero idle gap** (3 seconds), definitively ruling out TTL expiry and server-side eviction. The root cause is Claude Code CLI internally restructuring the API request prefix between turns.

## Evidence

### Collapse #1 — L216 (zero-gap, tool batch)

| Metric | Value |
|--------|-------|
| Previous turn (L201) | read=114,405 create=223 @ 15:21:34 |
| Collapse turn (L216) | read=11,500 create=106,207 @ 15:21:37 |
| Time gap | **3 seconds** |
| Tier | ephemeral_1h (no tier change) |
| Context | 14 parallel tool_result messages injected between L201 and L216 |

**This collapse proves the issue is client-side.** No server-side mechanism (TTL expiry, capacity eviction, tier downgrade) operates on a 3-second timescale.

### Collapse #2 — L1148 (25-min idle resume)

| Metric | Value |
|--------|-------|
| Previous turn (L1144) | read=423,045 create=14 @ 18:30:53 |
| Collapse turn (L1148) | read=11,500 create=411,874 @ 18:56:36 |
| Time gap | 25.5 minutes |
| Tier | **Degraded from 1h to 5m on L1148**, restored to 1h on L1151 |
| Keepalive | Running at 36-min interval (1h × 0.6). Last ping at 18:30:49 (L1143). No ping due during gap. |

**L1144 had the last keepalive ping at 18:30:53. With 1h TTL and 25-min gap, cache should not have expired.** The tier flicker (1h→5m→1h on consecutive API requests) is an additional anomaly.

### Shared Pattern

Both collapses share these characteristics:

1. `cache_read` drops to exactly **11,500** — the system prompt prefix size. Only the very beginning of the prefix matches.
2. Everything after the system prompt prefix (conversation history) is a complete miss.
3. No `compaction`, `skill_listing`, `deferred_tools_delta`, or `mcp_instructions_delta` events appear between the good turn and the spike.
4. The `promptId` changes every turn throughout the entire session (normal CLI behavior) — promptId change alone does not cause cache misses (verified: keepalive turns also have different promptIds but cache hits fine).

## Analysis

### Ruled Out

| Hypothesis | Evidence Against |
|-----------|-----------------|
| TTL expiry | Collapse #1 happened in 3 seconds. Session has 1h TTL. |
| Server-side capacity eviction | Collapse #1 has no idle gap. |
| task_reminder injection | task_reminder at L1161 is **after** the L1148 spike. L216 has no task_reminder nearby. |
| promptId change | promptId changes every turn; keepalive turns also change promptId but hit cache fine. |
| Conversation compaction | No compaction events found in the JSONL. |

### Most Likely Root Cause

**Claude Code CLI changes the API request prefix structure in certain scenarios, invalidating the entire prompt cache beyond the initial system prompt.**

Three possible mechanisms (not mutually exclusive):

1. **`cache_control` breakpoint relocation** — The CLI places `cache_control: {type: "ephemeral"}` markers in the message array. If the breakpoint position shifts (e.g., after a batch of tool results, or on session resume), the API treats the entire prefix as a new cache entry. Even identical message content with a different breakpoint layout produces a different cache key.

2. **Tool result batch restructuring** — When 14+ parallel tool results are injected in one turn, the CLI may restructure the conversation messages (reorder, merge, or split them) in a way that changes the prefix layout compared to the previous turn.

3. **Dynamic `<system-reminder>` content change** — The CLI injects `<system-reminder>` blocks (skills, deferred tools, task reminders) that can change between turns. If this content is placed before the conversation history in the prefix, any change invalidates all subsequent conversation history cache. The 11,500-token constant hit suggests the mutable system-reminder section falls immediately after the static system prompt.

### Cache Tier Behavior: 1h and 5m Share the Same Cache Pool

**Verified**: `ephemeral_1h` and `ephemeral_5m` are NOT independent buckets. They share the same cache pool and can read each other's entries.

**Evidence — L1027→L1030 (1h→5m cross-tier read):**

| Turn | Tier | create | read | Note |
|------|------|--------|------|------|
| L1027 | 1h | 5,400 | 397,269 | prefix total = 402,669 |
| L1030 | 5m | 348 | **402,669** | Read **100%** of the 1h cache |

The 5m turn at L1030 read the full 402,669 tokens that were cached by previous 1h turns. This proves cross-tier cache reads work.

**Further evidence — sustained 5m run (L1030–L1144):**

After the tier switched to 5m at L1030, it stayed 5m for 24 consecutive turns. Cache reads accumulated normally (402K→423K) with small incremental creates (200–3,000 per turn). The 5m turns read seamlessly from the 1h-origin cache.

**L1148→L1151 re-analysis:**

The L1151 (1h tier) could NOT read from L1148 (5m tier, create=411K). But this is now understood as **prefix structure change** (tool_use + tool_result messages inserted between them), not bucket isolation. The 3% read on L1151 (11,500 tokens) matches the system prompt baseline — the same collapse pattern seen in both collapses.

**Implication for keepalive**: Since tiers share cache, keepalive pings are effective regardless of which tier they happen to land on. A 5m keepalive ping maintains the cache for subsequent 1h queries, and vice versa.

### detectedCacheTTLMs Update Bug (Fixed)

ClaudeCab's `detectedCacheTTLMs` was set once (`=== undefined` guard in SDKStreamProcessor.ts:438) — it did **not** update when the tier changed mid-session. This meant:

- Session detects 1h on first turn → keepalive interval = 36 min
- Tier drops to 5m mid-session → keepalive interval stays 36 min
- 5m cache expires in 5 min → keepalive can't save it

**Fix applied**: Removed the `=== undefined` guard. `detectedCacheTTLMs` now updates every turn, and tier changes are logged as warnings. Keepalive interval adjusts accordingly.

## Impact

| Metric | Collapse #1 | Collapse #2 |
|--------|------------|------------|
| Wasted cache_creation | 106K tokens | 411K + 413K = 824K tokens |
| Cost (1h tier write) | ~$0.50 | ~$3.90 |
| Session-level | 4.8% of session cost | Flagged in anomaly report as $6.33 query |

## Recommendations

### For CacheAnomalyAnalyzer

Add a `prefix_rebuild` cause label for when `cache_read` drops to ~11,500 and the previous turn had significantly higher read. This is distinct from:
- `ttl_expiry` (requires 5+ min gap)
- `task_reminder` / `todo_reminder` (attachment-based)
- `stop_hook_summary` (hook-specific)

### For detectedCacheTTLMs (Done)

~~The `=== undefined` guard means tier changes mid-session are invisible.~~
Fixed: `detectedCacheTTLMs` now updates every turn. Tier changes logged as `sdk.cache_ttl_changed` warnings. Keepalive interval adjusts on tier downgrade.

### For Upstream (Claude Code CLI)

This is a CLI-internal issue — ClaudeCab cannot fix it. File issue:
- Request: stable `cache_control` breakpoint placement across turn types (tool batch, resume, keepalive)
- Request: expose the actual API request messages (or a hash) in the JSONL for cache debugging

### For task_reminder (Separate Issue)

`task_reminder` appeared 29 times in this session (every ~40 lines). While not the cause of these two major collapses, it:
- Wastes tokens on unused task management prompts
- May contribute to minor cache invalidation on normal turns
- Can be disabled with `CLAUDE_CODE_ENABLE_TASKS: '0'` at the cost of losing TaskCreate/TaskUpdate tools

## Related

- [Cache Creation / Stop Hook Incident (2026-05-06)](cache-creation-stop-hook-incident-2026-05-06.md) — Prefix rebuild caused by stop hook branching
- [Cache & Rate Limit Analysis](CACHE_AND_RATELIMIT_ANALYSIS.md) — Broader cost analysis
- Memory: [Cache Anomaly Tracer](../../.claude/projects/F---Program-OwnProject-ClaudeCab/memory/project_cache-anomaly-tracer.md)
