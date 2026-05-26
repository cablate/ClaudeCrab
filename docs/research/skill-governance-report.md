# Skill Governance Report

Date: 2026-04-30

This report captures the B8 lesson from the ClaudeCab workspace architecture
cleanup. It is meant as future CC deep engineering handbook material.

---

## Finding

After `output/`, `uploads/`, `plans/`, and `knowledge/` were normalized, the
remaining ambiguity was the capability layer: `.claude/skills/`.

Skill folders are easy to misclassify because they look like small code
projects, method documents, product playbooks, and prompt libraries at the same
time. Without lifecycle rules, they create three quiet failure modes:

1. Duplicate skills with the same name drift across agents.
2. Vendor/imported skills keep hidden repo boundaries.
3. Generated caches get tracked as if they were source.

---

## Inventory Snapshot

| Scope | Count | Shape |
|-------|-------|-------|
| General skills | 34 skills / 237 files after B8.4 | Content, lecture, marketing, memory, and presentation workflows; promoted shared skills are now stubs. |
| Coder skills | 18 skills / 85 files after B8.4 | Coding workflow, browser automation, Remotion, planning, and payment integration; promoted shared skills are now stubs. |
| Shared runtime skills | 19 skill trees / 52 files after B8.4 | Canonical runtime location for promoted shared skills. |
| Shared governance skills | 1 manual/helper skill plus governance docs | `content-analyzer` remains a manual shared helper, not Claude Code auto-discovered. |

The important signal is not size. It is the absence of lifecycle boundaries.

---

## Cases

### Duplicate names are silent forks

General and coder both have skills such as `handoff`, `memory-ops`, `persona`,
`scheduling`, `taste-skill`, and `thorough`. Some may be intentionally
role-specific. Some may be accidental copies.

The governance rule is not "dedupe everything." The rule is:

> If two agents share the same behavior, promote the skill to shared. If the
> behavior differs, document the fork.

Silent forks are dangerous because future agents see the same skill name and
assume the same behavior.

B8.3 found five exact duplicates, two minor-diff shared candidates, one
intentional role fork, one independently evolved skill, and one stale coder copy:

| Type | Skills | Lesson |
|------|--------|--------|
| Exact duplicate | `knowledge-vector-memory`, `memory-ops`, `scheduling`, `sys-growth`, `taste-skill` | Copying a skill to multiple agents creates future drift even when it is harmless today. |
| Minor diff | `dom-agent-browser`, `handoff` | Small frontmatter/reference differences should be merged before promotion. |
| Intentional fork | `persona` | Role-specific context is a legitimate reason to keep two copies. |
| Independent evolution | `agentskill-expertise` | Both copies may contain unique improvements; merge requires a dedicated pass. |
| Version drift | `thorough` | Old behavior can contradict current operating philosophy, not merely miss features. |

The implementation lesson was sharper than the classification:
`agents/_shared/.claude/skills/` is not automatically discovered by each agent.
Moving a skill to shared and deleting local discovery files would make the
workspace cleaner but can make the runtime less capable. Physical migration
needs a discovery/stub design first.

B8.4 Phase 1 used `taste-skill` as the PoC. The full skill now lives at
`agents/_shared/.claude/skills/taste-skill/SKILL.md`; general and coder keep
small local stubs with the same frontmatter. The stub solves discovery, while
the shared canonical file solves drift.

After a fresh-session check confirmed the stub pattern works, B8.4 Phase 2a
expanded the same pattern to `scheduling` and `memory-ops`. This was still kept
small on purpose: `knowledge-vector-memory` and `sys-growth` showed real
reference/version differences, so they need review before physical migration.

Cab then set the governing rule: if duplicate shared candidates overlap or
represent different versions, use the `general` copy as canonical unless an
intentional role fork is documented. B8.4 Phase 2b applied that rule to
`knowledge-vector-memory`, `sys-growth`, `handoff`, `thorough`,
`dom-agent-browser`, and `agentskill-expertise`. `persona` remains the explicit
role fork.

The post-migration fresh-session check passed for `handoff`, `sys-growth`, and
`agentskill-expertise`: Claude Code discovered the local stubs and loaded the
latest canonical shared content. This confirms the stub pattern is not just a
file-shape convention; it works in the runtime path that matters.

### Vendor skills need provenance

`coder/.claude/skills/portaly-payment-skill/` contains a nested `.git` directory
with an external GitHub remote. That may be intentional, but the policy is not
explicit.

The correct question is not "delete it?" The correct question is:

> Is this a submodule, an external repo, or a clean exported skill copy?

Each answer implies a different update path.

B8.2 inspection resolved the steady-state recommendation for this case:

- Source: `https://github.com/real-engine-tw/portaly-payment-skill.git`
- Imported commit: `d184b795e40fa1b46e29436496932439e3e6589f`
- Nested repo status: clean, tracking `origin/main`
- Parent repo status: tracks the skill files directly, not as a submodule

The best steady state is a clean exported vendor skill: parent repo tracks the
skill files, shared governance records the source and commit, and nested `.git`
metadata is removed after owner approval. Keeping both direct parent tracking
and a nested repo makes the update boundary ambiguous.

### Caches do not become source because they are inside a skill

`general/.claude/skills/pptx/` had tracked Python `.pyc` cache files. The source
scripts were valuable; compiled caches were not. B8.1 removed the tracked cache
files and verified the root `.gitignore` already covers `__pycache__/` and
`*.pyc`.

This is the same pattern seen in `output/` with `node_modules/`, but at a smaller
scale. The layer changed; the hygiene rule did not.

---

## General Principle

Skills are behavior, not state.

Projects own files and next steps. Knowledge owns reusable references. Skills
own activation rules and repeatable operating procedure. When a skill starts
owning project state, it becomes a hidden project. When it starts owning caches,
it becomes a hidden runtime folder. When a vendor skill keeps a nested repo
without policy, it becomes a hidden dependency boundary.

The fix is a lifecycle table, not a large migration.

---

## Handbook Takeaway

The final workspace architecture needs a capability layer, but the capability
layer needs governance:

1. `SKILL.md` defines when and how the agent should behave.
2. Skill references and scripts are stable support material.
3. Project state links back to `projects/<name>/README.md`.
4. Shared runtime behavior goes to `_shared/.claude/skills/`, with local stubs
   until the platform supports shared discovery.
5. Imported behavior needs provenance and update policy.
6. Generated caches are never source of truth.
7. A declared canonical owner is more valuable than repeated micro-merges; for
   ClaudeCab shared skill drift, `general` is the default canonical owner.
