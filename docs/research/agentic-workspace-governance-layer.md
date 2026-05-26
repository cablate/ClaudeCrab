# Agentic Workspace Governance Layer

> Date: 2026-05-11
> Status: discussion anchor, not accepted specification
> Scope: large AI-agent workspace folder governance, script validation, agent repair tasks, and visualization data

## Purpose

This document anchors the current understanding of a workspace governance method
for a large AI-agent workspace.

The goal is not to make a prettier folder tree. The goal is to make the
workspace observable, verifiable, and maintainable by combining:

- standardized folder structures;
- folder-level README files;
- machine-readable folder configs;
- folder registries;
- deterministic health-check scripts;
- AI-agent semantic repair tasks;
- generated visualization data for dashboards and mind maps.

The working name is **Agentic Workspace Governance Layer**.

## Core Problem

When one AI agent works across a large workspace that contains many projects,
research notes, generated outputs, scripts, uploads, and knowledge stores, the
agent can no longer rely on ad hoc exploration.

Without governance, common failures appear:

- files are placed in the wrong folder;
- temporary output becomes long-term knowledge by accident;
- project README files stop reflecting current state;
- active, paused, done, and archived work become hard to distinguish;
- repeated AI-generated artifacts accumulate without triage;
- the user cannot see what work is currently in motion;
- frontend visualization requires crawling the whole workspace every time.

The proposed response is to add a thin governance layer above the filesystem:

```text
filesystem facts
-> script validation
-> health issues
-> agent repair tasks
-> generated visualization data
-> dashboard / mind map
```

## Design Principle

The key division of labor:

```text
Scripts own facts and rules.
AI agents own semantic judgment.
```

The key ownership boundary:

```text
Agent-local governance owns truth.
Root-level governance only aggregates.
Shared schemas and templates live in _foundation.
```

Scripts should handle deterministic work:

- scan folders and files;
- read modification times;
- check required files and folders;
- validate naming rules;
- validate registry entries;
- detect missing or unregistered files;
- detect stale README files;
- detect expired or untriaged output;
- generate issue codes;
- generate JSON for dashboards and mind maps.

AI agents should handle interpretive work:

- summarize a project's purpose;
- classify an unknown file;
- decide whether an output should be promoted to a project;
- update README status and next actions after reviewing changes;
- decide whether a registry entry is stale or a file should be restored;
- propose a move when a file belongs elsewhere.

This keeps the agent from guessing basic facts and keeps scripts from pretending
to understand meaning.

## Governance Scope

Governance should be **per-agent** by default.

Each agent workspace owns its own governance config, generated health data,
repair queue, and visualization map. The root workspace may aggregate these
outputs for a global dashboard, but it should not become the source of truth for
agent-local state.

Recommended structure:

```text
agents/<agent>/
+-- workspace.governance.yaml
+-- projects/
+-- output/
+-- knowledge/
+-- uploads/
+-- .generated/
    +-- workspace-governance/
        +-- scan.json
        +-- health.json
        +-- agent-tasks.json
        +-- workspace-map.json
        +-- mindmap.json
```

Optional root rollup:

```text
.generated/
+-- workspace-governance/
    +-- all-agents-health.json
    +-- all-agent-tasks.json
    +-- workspace-map.json
```

This keeps responsibility clear:

- `agents/general/` owns general-agent projects, output, uploads, and repair
  tasks;
- `agents/coder/` owns coder-agent projects, output, uploads, and repair tasks;
- `agents/_foundation/` owns shared policy, schemas, templates, and reference
  governance material.

`agents/_foundation/` is a special workspace unit, not a normal working agent.
It may emit health and map data, but it does not need the same repair queue
shape as `general` or `coder` until a concrete need appears.

## Existing Related Mechanisms

ClaudeCab already has several mechanisms that overlap with this proposal. The
general pilot should extend them instead of creating a parallel system.

### Existing Workspace Validator

`scripts/validate-agent-workspace.mjs` already validates the reference trio
workspace.

Current coverage includes:

- allowed top-level items for `agents/general/` and `agents/coder/`;
- required layer README files;
- required project README frontmatter;
- allowed project status values: `active`, `paused`, `done`, `archived`;
- required project README sections: `Purpose`, `Current Status`, `Next Step`,
  `Key Paths`, `Maintenance Rules`;
- archive placement rules;
- path mention existence checks;
- output repo/dependency/build marker detection;
- startup context review metadata such as `last_reviewed` and `review_after`;
- gitignore boundary checks;
- foundation skill, hook, subagent, knowledge, and checklist contracts.

There is also an MCP validator tool in `src/tools/validatorTool.ts`, exposing
`run_agent_workspace_validation` so runtime agents can call the validator
instead of guessing.

Implication:

```text
The governance pilot should not start with a new validator from zero. It should
either extend validate-agent-workspace.mjs or create a general-focused companion
script that reuses the same issue/reporting style.
```

### Existing Project README Contract

`agents/_foundation/templates/project-README-template.md` already defines the
project card model:

- frontmatter: `name`, `owner`, `status`, `aliases`, `external_paths`,
  `last_updated`;
- sections: `Purpose`, `Current Status`, `Next Step`, `Key Paths`,
  `Decisions`, `Open Questions`, `Archive Links`, `Maintenance Rules`;
- rule: update `last_updated`, `Current Status`, and `Next Step` whenever the
  project changes.

Implication:

```text
Time, commitment, dependency, and decision anchors should extend project README
cards instead of replacing them.
```

### Agent Project README vs Git Repo README

The governance layer must distinguish an agent project README from a git repo
README. They share the filename `README.md`, but they have different jobs.

```text
Agent project README = project card for secretary/agent planning.
Git repo README = technical documentation for a code/content repository.
```

Agent project README:

- usually lives at `agents/general/projects/<project>/README.md`;
- answers what is going on, why it matters, current status, next step, time
  anchors, key paths, and open questions;
- should stay short and scannable;
- is the primary input for governance scan, attention feed, planning brief, and
  reminder generation.

Git repo README:

- lives at an actual repo root, such as an external app folder or
  `content-repo/README.md`;
- answers what the repo is, how to install, run, test, build, deploy, and
  navigate technical architecture;
- should not own secretary state such as reminders, Cab follow-ups, or active
  planning status.

If a project card points to a real repo, keep the boundary explicit:

```text
agents/general/projects/<project>/
+-- README.md        # agent project card
+-- content-repo/    # optional actual repo boundary
    +-- README.md    # repo documentation
    +-- package.json
    +-- src/
```

Or use an external repo path:

```text
agents/general/projects/<project>/
+-- README.md        # agent project card with Key Paths pointing outward

F:/_Program/OwnProject/<actual-repo>/
+-- README.md        # repo documentation
+-- package.json
+-- src/
```

Rule:

```text
Governance reads agent project README files as planning source of truth. It may
link to repo README files, but should not treat repo README files as project
cards unless they explicitly opt into that role.
```

### Folder Role Files

Any folder that becomes a repeatable agent working unit can expose role files.
The set should stay small; not every folder needs every role file.

Recommended roles:

```text
README.md       = folder card: purpose, status, next step, key paths.
RULES.md        = operating contract: rules, boundaries, workflow, checks.
index.md        = current inventory, comparison table, or status index.
TEMPLATE.md     = template for creating repeated same-type files.
registry.yaml   = machine-readable inventory, only when needed.
folder.config.yaml = machine-readable validation config, only when needed.
```

`RULES.md` should combine what might otherwise become `OPERATING-GUIDE.md`.
This keeps the folder lighter.

Use `RULES.md` for:

- hard boundaries and prohibited placements;
- naming rules;
- required update rules;
- agent workflow steps;
- validator commands;
- how to add, move, archive, or promote items;
- relationship to indexes and templates.

Do not make `RULES.md` a long tutorial or history log. If it grows too large,
split stable examples or deep rationale into a project note, but keep the
working contract in `RULES.md`.

Adoption levels:

```text
Minimum: README.md
Structured folder: README.md + RULES.md
Indexed collection: README.md + RULES.md + index.md
Template-driven collection: README.md + RULES.md + index.md + templates
Script-governed collection: add registry.yaml / folder.config.yaml when needed
```

For `competitor-course-analysis`, the target role split is:

```text
competitor-course-analysis/
+-- README.md              # project card for secretary planning
+-- RULES.md               # analysis rules and operating workflow
+-- index.md               # competitor inventory and comparison notes
+-- TEMPLATE.md            # paid-course analysis template
+-- YT-SCAN-TEMPLATE.md    # YouTube scan template
+-- validator.sh           # local validation script
+-- entries/               # individual analysis files
```

### Existing Session-End Project Hygiene

`agents/_foundation/checklists/session-end-project-update.md` already requires
project cards, indexes, output classifications, and upload ownership to stay
synchronized after sessions.

It requires updates when a session:

- creates, moves, edits, archives, or advances a project;
- changes a project README;
- reclassifies output material;
- uses uploaded files;
- produces a handoff that changes the next project action.

Implication:

```text
The new governance layer can make this checklist observable by detecting stale
project README files, missing next actions, output triage candidates, and upload
drain candidates.
```

### Existing Output And Upload Safety

Existing checklists already define the semantic boundary:

- `agents/_foundation/checklists/output-safety-checklist.md`;
- `agents/_foundation/checklists/uploads-drain-checklist.md`;
- `agents/general/output/README.md`;
- `agents/general/uploads/README.md`.

The validator already errors when repo/dependency/build markers appear under
`output/`.

Implication:

```text
Output triage should reuse the existing safety model. The new layer should add
age, ownership, promotion, and attention feeds rather than redefine output.
```

### Existing Schedule And Memory-Ops Flow

`agents/general/schedules/` already defines recurring jobs:

- `memory-cleanup.yaml`;
- `morning-briefing.yaml`;
- `weekly-reflection.yaml`.

`agents/_foundation/skills/memory-ops/SKILL.md` already defines cleanup,
briefing, and weekly review behavior. It also defines `memory/pending-todos.md`
as a structured working file with categories:

- `Next Actions`;
- `Waiting For`;
- `Projects`;
- `Someday / Reference`;
- `Archive`.

Important existing concepts:

- `Waiting For` items need a trigger date;
- triggered waiting items can become follow-up actions;
- morning briefing should mostly read cleanup output and pending todos;
- weekly review prunes stale todos and lowers noisy items;
- noisy or low-quality pending todos make the briefing useless.

Implication:

```text
The new governance layer should not create a second todo/calendar system. It
should generate project/workspace facts that memory-ops can consume.
```

### Existing Manual Project Inventory

`agents/general/plans/may-june-2026-project-inventory.md` is already close to a
manual planning brief. It lists deadlines, user-controlled items, active
projects, side projects, and suggested focus.

Implication:

```text
planning-brief.json should automate the factual substrate of this kind of
inventory, while the agent still applies judgment when proposing priorities.
```

## Integration Decision

The general pilot is not a replacement for `memory-ops`, `schedules/`, or
`validate-agent-workspace.mjs`.

The intended layering is:

```text
validate-agent-workspace.mjs
-> structural correctness and existing policy violations

general workspace governance scan
-> project/workspace facts, time anchors, attention items, planning substrate

memory-ops cleanup / briefing / weekly
-> memory consolidation, pending-todos maintenance, user-facing briefings
```

The new layer should feed the secretary with workspace facts:

- active project cards;
- stale README cards;
- missing or vague next steps;
- output triage candidates;
- upload drain candidates;
- time anchors;
- approaching deadlines;
- overdue review/follow-up anchors;
- blocked projects and dependencies.

It should not become:

- a separate hand-maintained calendar;
- a second `pending-todos.md`;
- a replacement schedule system;
- a parallel project README format.

## Skill Package

The operational method is packaged as a shared foundation skill:

```text
agents/_foundation/skills/workspace-governance/SKILL.md
```

Agent-local discovery stubs should point to that canonical source from:

```text
agents/general/.claude/skills/workspace-governance/SKILL.md
agents/coder/.claude/skills/workspace-governance/SKILL.md
```

The skill is responsible for helping agents:

- interpret external governance scan outputs;
- design internal unit governance;
- choose README/RULES/index/TEMPLATE/folder.config/registry roles;
- preserve the script-versus-agent boundary;
- avoid duplicate todo/calendar systems;
- translate validation states into planning, attention, and repair actions.

This keeps the method available at runtime without loading the full research
document into every session.

## Two-Level Validation

Validation should have two layers.

```text
Workspace validator = outside governance layer.
Unit validator = folder-local governance layer.
```

Core rule:

```text
Workspace validator checks that each unit has a valid contract.
Unit validator checks whether the unit fulfills its own contract.
```

### Workspace Validator

The workspace validator handles cross-workspace rules that every governed unit
should follow.

Existing example:

```text
scripts/validate-agent-workspace.mjs
```

It should check things like:

- agent top-level folders match the workspace policy;
- project README files exist;
- project README frontmatter is valid;
- status values are from the shared enum;
- required project card sections exist;
- project cards distinguish active, paused, done, and archived;
- output does not contain repo, dependency, or build markers;
- required layer README files exist;
- path mentions are valid;
- gitignore boundaries are correct;
- unit validators, if declared, are documented and safe to run.

It should not hard-code unit-specific domain rules.

It should not need to understand:

- whether a competitor analysis entry contains all A-H sections;
- whether a YouTube scan table has the right columns;
- whether a course entry includes pricing, platform, and source URL;
- whether a project-specific `index.md` fully matches local domain semantics.

### Unit Validator

A unit validator handles the folder's own rules.

Example:

```text
agents/general/projects/competitor-course-analysis/validator.sh
```

For `competitor-course-analysis`, the unit validator can check:

- `entries/` filenames follow the local naming rule;
- every entry follows `TEMPLATE.md` or `YT-SCAN-TEMPLATE.md`;
- required entry sections are present;
- required fields such as platform, price, source, and analysis date exist;
- `index.md` lists all completed entries;
- `index.md` counts match the actual entries;
- local files are in allowed folders.

These rules belong inside the unit because they are domain-specific.

### Execution Boundary

First version rule:

```text
The workspace validator should not automatically execute every unit validator.
```

Reasons:

- unit validators may be slow;
- unit validators may require network access;
- unit validators may have side effects;
- unit validators may be shell scripts with unclear safety;
- unit validators may require a runtime that is unavailable in the current
  agent environment, such as Bash on a Windows-only shell;
- a broken unit validator should not break all workspace governance.

The first workspace-level behavior should be:

- detect whether a unit validator exists;
- check that `README.md` or `RULES.md` documents how to run it;
- optionally report that a local validator is available;
- only run it when it is explicitly declared read-only and safe.
- treat `unit_validation.mode: none` as an explicit statement that a lightweight
  unit does not need a local validator.

Future declaration example:

```yaml
unit_validation:
  command: bash validator.sh
  runtime: bash
  mode: read-only
  safe_to_run: true
  timeout_ms: 30000
```

Only validators with an explicit safe declaration should be included in an
automatic workspace health run.

Lightweight strategy or reference units may explicitly opt out:

```yaml
unit_validation:
  command: null
  runtime: null
  mode: none
  safe_to_run: false
  auto_run: false
  reason: This unit relies on project-card, required-file, and freshness checks only.
```

The scan should treat this as "validator not required", not as unverified.

Runtime compatibility is part of the safe declaration. For example, a
`validator.sh` file can be read-only and still fail in a PowerShell-only
environment if `bash` points to an unavailable WSL runtime. The workspace
validator should treat such validators as available but not runnable unless the
runtime contract is satisfied.

### Reporting Model

Workspace and unit validation should both report structured issues, but they can
have different scopes.

Workspace issue example:

```json
{
  "scope": "workspace",
  "code": "PROJECT_README_MISSING_SECTION",
  "path": "agents/general/projects/example/README.md",
  "severity": "error"
}
```

Unit issue example:

```json
{
  "scope": "unit",
  "unit": "competitor-course-analysis",
  "code": "ENTRY_MISSING_PRICE",
  "path": "agents/general/projects/competitor-course-analysis/entries/example.md",
  "severity": "warning"
}
```

In generated governance feeds, unit issues should remain tied to their owning
unit so the secretary can explain both levels:

```text
Project card is valid, but its local analysis index has 2 warnings.
```

### Validation Result Semantics

Validation results should not only mean "success" or "failure." They should
tell the agent how much it can trust a unit and what action is appropriate.

Use four normalized unit states:

| State | Meaning for the agent | Typical agent behavior |
|---|---|---|
| `pass` | The checked contract is currently trustworthy. | Use the unit in maps, planning briefs, and next-step suggestions. |
| `warning` | The unit is usable, but something deserves attention. | Add to attention feed or planning context; repair only if it matters now. |
| `error` | The unit violates a required contract and should not be treated as fully reliable. | Generate repair tasks before relying on affected content. |
| `unverified` | A validator or check exists, but could not be run or confirmed in this environment. | Mark confidence as unknown; do not claim the checked content is valid. |

This distinction matters because a unit can have mixed results.

Example:

```json
{
  "unit": "competitor-course-analysis",
  "health": "warning",
  "projectCard": "pass",
  "unitValidator": "unverified",
  "reason": "Bash runtime unavailable",
  "agentMeaning": "Project card is usable for planning, but entry-level validation was not confirmed.",
  "recommendedActions": [
    "Use README and index for high-level planning.",
    "Do not assume all entries pass template validation.",
    "Run validator in Git Bash or WSL Bash before relying on entry completeness."
  ]
}
```

The agent-facing interpretation is as important as the raw validator result:

- `pass` means the agent can use the checked layer as reliable input.
- `warning` means the agent can proceed but should surface the concern when
  planning or reviewing.
- `error` means the agent should create a bounded repair task and avoid building
  further conclusions on the broken layer.
- `unverified` means the agent knows the check exists but does not know whether
  the content passes it.

The outer governance scan should preserve layer-specific status instead of
collapsing everything into one boolean. For example:

```text
Project card is valid. Local entry validation is unverified because Bash is not
available in the current runtime.
```

### Unit Health Record Shape

`health.json` should contain one normalized record per governed unit. The record
should be useful to both scripts and agents: scripts can aggregate it, while the
agent can read the interpretation and decide what to trust or repair.

Recommended top-level shape:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-11T20:00:00+08:00",
  "agent": "general",
  "units": [
    {
      "id": "competitor-course-analysis",
      "title": "競品課程分析",
      "unitType": "project",
      "path": "agents/general/projects/competitor-course-analysis",
      "status": "active",
      "overallState": "warning",
      "confidence": "partial",
      "layers": {
        "projectCard": {
          "state": "pass",
          "source": "README.md"
        },
        "unitContract": {
          "state": "pass",
          "source": "folder.config.yaml"
        },
        "roleFiles": {
          "state": "pass",
          "required": [
            "README.md",
            "RULES.md",
            "index.md",
            "TEMPLATE.md",
            "YT-SCAN-TEMPLATE.md"
          ],
          "missing": []
        },
        "readmeFreshness": {
          "state": "pass",
          "timestampField": "last_updated",
          "lastUpdated": "2026-05-11"
        },
        "unitValidation": {
          "state": "unverified",
          "validator": "validator.sh",
          "runtime": "bash",
          "reason": "Bash runtime unavailable",
          "autoRun": false
        },
        "timeAnchors": {
          "state": "pass",
          "count": 1,
          "next": {
            "type": "Review After",
            "date": "2026-05-18",
            "label": "檢查高優先待分析清單是否已推進"
          }
        }
      },
      "issues": [
        {
          "scope": "unit",
          "code": "UNIT_VALIDATOR_RUNTIME_UNAVAILABLE",
          "severity": "warning",
          "path": "agents/general/projects/competitor-course-analysis/validator.sh",
          "message": "Unit validator requires Bash, but Bash is not available in the current runtime."
        }
      ],
      "agentInterpretation": {
        "meaning": "Project card and unit contract are usable for planning, but entry-level validation was not confirmed.",
        "canUseFor": [
          "workspace map",
          "high-level planning",
          "attention feed",
          "time anchor reminders"
        ],
        "doNotAssume": [
          "all entries pass TEMPLATE.md",
          "index.md fully matches entry completeness"
        ],
        "recommendedActions": [
          "Use README and index for high-level planning.",
          "Do not claim entries are fully validated.",
          "Run validator in Git Bash or WSL Bash before relying on entry completeness."
        ]
      }
    }
  ]
}
```

Recommended fields:

| Field | Purpose |
|---|---|
| `overallState` | Rollup state for dashboards and attention queues. |
| `confidence` | Human-readable trust level, such as `high`, `partial`, `low`, or `unknown`. |
| `layers` | Layer-specific validation results; do not collapse these into one boolean. |
| `issues` | Structured issue codes for repair tasks and attention feeds. |
| `agentInterpretation` | Plain-language guidance for what the agent can trust and what it should do next. |

Rollup rule:

```text
Any error -> overallState error.
No errors but any warning or unverified layer -> overallState warning.
All required layers pass -> overallState pass.
If core project card or unit contract cannot be checked -> overallState unverified.
```

The rollup should be conservative. A `pass` project card plus an `unverified`
unit validator is not a full pass; it is a partially trusted unit.

## Unit Internal Governance Design Methodology

This methodology tells an agent how to design the inside of a unit so future
agents can understand, maintain, validate, repair, and advance it.

The agent should not start by inventing files. It should first understand the
unit's work model, then choose the lightest governance structure that makes the
unit clear and maintainable.

Core question:

```text
What internal operating system does this unit need so another agent can safely
continue the work later?
```

### Target Output

When asked to organize or normalize a unit, the agent should produce a short
unit design brief before making structural changes.

Example shape:

```yaml
unit_design_brief:
  unit_id: competitor-course-analysis
  path: agents/general/projects/competitor-course-analysis
  owner_agent: general
  unit_type: project
  purpose: Support course positioning through competitor course analysis.
  repeated_items:
    - course analysis entries
    - YouTube scan entries
  source_of_truth:
    state: README.md
    operating_rules: RULES.md
    inventory: index.md
    scan_contract: folder.config.yaml
  recommended_role_files:
    - README.md
    - RULES.md
    - index.md
    - TEMPLATE.md
    - YT-SCAN-TEMPLATE.md
    - folder.config.yaml
    - validator.sh
  validation_plan:
    workspace_layer: project card and role-file existence
    unit_layer: entry structure and index consistency
  agent_read_path:
    - README.md
    - folder.config.yaml
    - RULES.md
    - index.md
    - templates
  repair_policy:
    safe_actions:
      - update README status and next step
      - update index.md after adding entries
      - fix entry structure according to templates
    ask_human_first:
      - delete entries
      - change analysis framework
      - move material across projects
  open_questions:
    - Should YouTube scans get their own index file?
```

The design brief can live in chat during discussion. If accepted, its stable
decisions should be written into the unit's README, RULES, and
`folder.config.yaml`.

### Design Procedure

Use this procedure when adapting the method to any folder-like unit.

1. **Observe before changing**

   Read the existing folder tree, README-like files, indexes, templates, scripts,
   and recent modification signals. Do not restructure first.

2. **Classify the unit**

   Pick the closest unit type:

   - `project`: long-running work with status and next steps;
   - `collection`: repeated same-type records, such as entries or cases;
   - `staging`: temporary intake, output, uploads, or quarantine material;
   - `knowledge`: reusable reference material;
   - `archive`: inactive historical material;
   - `tooling`: scripts, validators, generators, or local automation;
   - `repo-boundary`: actual software/content repository with its own technical
     README.

   The type determines what the unit needs. A project needs status and next
   action. A collection needs an index and templates. A staging area needs
   triage rules. A repo boundary needs technical docs and should not be confused
   with an agent project card.

3. **Define the unit boundary**

   State what belongs here, what does not belong here, and what should happen to
   ambiguous material.

   Boundary questions:

   - What is this unit responsible for?
   - What material is explicitly out of scope?
   - What is the promotion path if temporary material becomes important?
   - What is the archive path if material becomes inactive?
   - Which external paths are referenced but not owned?

4. **Identify repeated objects and lifecycle**

   Governance becomes useful when a folder has repeated objects or recurring
   maintenance.

   Examples:

   - course analysis entry -> draft -> validated -> indexed -> archived;
   - output artifact -> temporary -> triaged -> promoted or archived;
   - project card -> active -> paused -> done -> archived;
   - source note -> captured -> summarized -> linked -> superseded.

   If there is no repeated object or lifecycle, do not over-govern the folder.

5. **Choose role files by need**

   Start from the smallest useful set:

   | Need | Add this role file |
   |---|---|
   | Future agent must know purpose, state, next step | `README.md` |
   | Unit has local rules, workflows, boundaries, or commands | `RULES.md` |
   | Unit has many items that need status or comparison | `index.md` |
   | Unit creates repeated same-type documents | `TEMPLATE.md` or named templates |
   | Outer scan must understand the unit reliably | `folder.config.yaml` |
   | File-level identity, ownership, or placement matters | `registry.yaml` |
   | Rules can be checked deterministically | local validator script |

   Do not add a role file just because the framework allows it. Add it when it
   removes ambiguity for future agents or enables scripts to verify facts.

6. **Design the agent read path**

   Every governed unit should make the future agent's first five minutes
   predictable.

   Default read path:

   ```text
   README.md -> folder.config.yaml -> RULES.md -> index.md -> templates -> recent files
   ```

   The read path should answer:

   - What is this unit?
   - What is the current state?
   - What is the next useful action?
   - What files are source of truth?
   - What am I allowed to change?
   - What must I update after changing something?
   - How do I validate my work?

7. **Separate semantic guidance from machine contract**

   Use prose files for meaning and machine files for deterministic behavior.

   ```text
   README.md = current meaning and planning state
   RULES.md = human/agent operating contract
   index.md = inventory and comparative status
   TEMPLATE.md = document production scaffold
   folder.config.yaml = scan and validation contract
   registry.yaml = file/item identity contract
   validator = deterministic local checks
   ```

   The outer scan should not need to infer validator behavior from `RULES.md`.
   It should read `folder.config.yaml`.

8. **Design validation in two layers**

   The workspace layer checks whether the unit exposes a valid contract.
   The unit layer checks whether the unit satisfies its own domain rules.

   For each unit validator, define:

   - command;
   - runtime;
   - mode;
   - safe-to-run status;
   - auto-run policy;
   - timeout;
   - output format;
   - issue codes or textual fallback;
   - what the agent should do if the validator is unavailable.

9. **Define synchronization rules**

   Most workspace drift comes from changing one file but forgetting the related
   files.

   Each unit should state:

   - when README status and next step must be updated;
   - when `index.md` must be updated;
   - when registry entries must be added, moved, or archived;
   - which paths trigger README freshness checks;
   - which generated paths are ignored;
   - which time anchors or review anchors should move when work changes.

10. **Define repair playbooks**

   Every common issue should map to a bounded agent action.

   Example:

   ```text
   ENTRY_MISSING_SOURCE_URL -> open the entry, find or ask for the source URL,
   update the entry, then rerun the unit validator.
   ```

   Repair playbooks should say what the agent may edit directly and what needs
   user confirmation.

11. **Define attention and reminder behavior**

   Do not turn every warning into a proactive reminder.

   - structural problems usually become repair tasks;
   - stale README or index drift usually goes to attention feed;
   - due follow-ups and deadlines can become reminders;
   - unverified validators should reduce confidence but not automatically block
     all planning;
   - noisy reminders should be demoted to attention-only.

12. **Start light and iterate**

   First make the unit understandable. Then make it verifiable. Then make it
   visualizable. Then make it proactively useful.

   Do not require `registry.yaml`, local validators, or complex metadata for
   units that do not yet need them.

### Agent-Friendly Quality Bar

A unit is agent-friendly when a future agent can answer these questions without
searching aimlessly:

- What is this unit for?
- What is its current status and next useful action?
- What material belongs here and what does not?
- What are the source-of-truth files?
- How do I add a new item correctly?
- What must I update after adding or changing something?
- How do I know whether the unit is healthy?
- Which issues can I repair directly?
- Which issues require user confirmation?
- What should be surfaced to the user proactively?

If the unit cannot answer these questions, the agent should improve the role
files before doing deeper work inside the unit.

### Anti-Patterns

Avoid these failure modes:

- README becomes a long operating manual instead of a project card.
- RULES becomes a historical essay instead of an operating contract.
- `folder.config.yaml` repeats prose but does not give scripts reliable fields.
- local validator exists but does not declare runtime, safety, or scope.
- index exists but no rule says when to update it.
- templates exist but entries do not have to follow them.
- time commitments live only in chat, not in the owning object.
- output becomes a permanent knowledge store.
- every warning becomes a reminder.
- agent deletes, moves, or rewrites high-impact material without a human-review
  boundary.

### Methodology Summary

The agent's job is not to make every folder look the same. The job is to make
each unit expose the minimum internal operating system needed for future agents
and scripts to work safely.

```text
Understand the unit -> choose role files -> define read path -> define machine
contract -> define validation -> define sync rules -> define repair playbooks ->
generate health and attention data.
```

## General-Agent Pilot

The first governed scope should be `agents/general/` only.

This pilot is not mainly about proving that every workspace can be linted. It is
about improving the general agent's secretary-like operating role:

- maintain an accurate view of ongoing content, research, collaboration, and
  planning work;
- surface projects whose README status or next step is stale;
- identify output artifacts that should be triaged, archived, deleted, or
  promoted into projects;
- help the user and the general agent plan current work and near-term next
  actions;
- generate reminders from explicit workspace facts instead of relying on memory
  or chat history.

The useful product is an **attention layer** over `agents/general/`, not a
complete governance framework.

The general pilot should answer these questions first:

- What is currently active?
- What has unclear next action?
- What changed recently but was not reflected in the project README?
- What is sitting in `output/` that may need triage?
- What should the secretary bring up before the user asks?
- Which projects are paused, done, or candidates for archive review?

For this pilot, `agents/coder/` remains out of scope except as a later consumer
of shared schemas and scripts if the general pilot proves useful.

## Recommended Starting Point

Start by making the existing `agents/general` project-card layer reliable before
building new visualization or reminder logic.

### Step 1: Normalize General Project READMEs

Use the existing project README template as the baseline:

```text
agents/_foundation/templates/project-README-template.md
```

Initial target:

- `agents/general/projects/workshop-claude-may/README.md`;
- `agents/general/projects/competitor-course-analysis/README.md`;
- `agents/general/projects/digital-asset-strategy/README.md`;
- any other active project README that currently fails validator checks.

Why this comes first:

- the existing validator already knows how to check project cards;
- secretary planning depends on `Current Status` and `Next Step`;
- time anchors and future commitment/dependency anchors need a stable owning
  README;
- visualization and planning feeds will be low quality if project cards are
  inconsistent.

### Step 2: Run Existing Validator As Baseline

Use:

```text
npm run validate:agent-workspace:json -- --warn-only
```

Treat the output as the initial health snapshot. Do not require zero errors
before starting the pilot, but use general-project README errors as the first
cleanup queue.

### Step 3: Add Minimal Time Anchor Section To Project Cards

Only add `Time Anchors` where a project actually has dates.

First-pass allowed anchor types:

- `Event At`;
- `Due At`;
- `Review After`;
- `Follow Up At`;
- `Expires At`.

Avoid adding calendar-like global state. Dates stay on the owning project card
or output metadata.

### Step 4: Build A Read-Only General Scan

Before writing any repair logic, create a read-only scan that reads
`agents/general/projects/`, `agents/general/output/`, and optionally
`agents/general/uploads/`.

Minimum generated files:

```text
agents/general/.generated/workspace-governance/health.json
agents/general/.generated/workspace-governance/attention-feed.json
agents/general/.generated/workspace-governance/time-index.json
agents/general/.generated/workspace-governance/planning-brief.json
agents/general/.generated/workspace-governance/reminder-feed.json
agents/general/.generated/workspace-governance/workspace-map.json
agents/general/.generated/workspace-governance/workspace-map.html
```

The first scan should answer:

- which projects are active, paused, done, or archived;
- which active projects have missing or vague next steps;
- which project cards have dates;
- which dates are approaching or overdue;
- which output folders look like triage candidates;
- which project cards are too long or stale.

Implemented v0 command:

```text
npm run scan:general-governance
```

Script:

```text
scripts/scan-general-workspace-governance.mjs
```

Generated files:

```text
agents/general/.generated/workspace-governance/health.json
agents/general/.generated/workspace-governance/attention-feed.json
agents/general/.generated/workspace-governance/time-index.json
agents/general/.generated/workspace-governance/planning-brief.json
agents/general/.generated/workspace-governance/reminder-feed.json
agents/general/.generated/workspace-governance/workspace-map.json
agents/general/.generated/workspace-governance/workspace-map.html
```

Implementation notes:

- the scan is read-only toward project source files;
- `.generated/` is derived runtime output and is ignored by git;
- projects without `folder.config.yaml` are still included in health as
  `unverified`, but missing config alone does not become an attention item;
- only unit validators declared `read-only`, `safe_to_run: true`, and
  `auto_run: true` are executed;
- v0 input is `agents/general/projects/*`.

### Step 5: Let Memory-Ops Consume Generated Facts

Once generated feeds are stable, update the memory-ops briefing flow to read
them as an additional input.

The briefing should still use `memory/pending-todos.md` for operational todos,
but it can use the generated governance feeds for project state, dates, and
workspace attention items.

This avoids creating a second todo system.

## Time Anchors, Not Calendar Source Of Truth

The general pilot should avoid creating a standalone hand-maintained calendar
file as a source of truth.

Calendar-like state is easy to desynchronize because dates usually belong to the
work item itself:

- a project has an event date, review date, due date, or follow-up date;
- an output artifact has an expiry date or triage date;
- a registry item may have a review-after date;
- a README may define the next planning checkpoint.

Therefore time data should live on the owning object, and calendar/reminder
views should be derived.

Recommended model:

```text
project README / registry item / output metadata
-> scan time anchors
-> time-index.json
-> reminder-feed.json
-> planning-brief.json
-> memory-ops briefing can consume the generated feeds
```

This keeps the boundary clear:

```text
schedules/ = automated jobs the agent should run at specific times.
time anchors = dates attached to workspace work items.
time-index.json = generated index of all discovered time anchors.
reminder-feed.json = generated reminders derived from time anchors and health issues.
```

Project README example:

```md
## Time Anchors

- Event At: 2026-05-18 20:00 Asia/Taipei
- Due At: 2026-05-16
- Review After: 2026-05-13
- Follow Up At: 2026-05-14
```

Structured metadata example:

```yaml
time_anchors:
  - type: event
    at: 2026-05-18T20:00:00+08:00
    label: Workshop live session
  - type: deadline
    at: 2026-05-16
    label: Finish teaching materials
  - type: review
    at: 2026-05-13
    label: Review course preparation status
```

Generated `time-index.json` item:

```json
{
  "source": "agents/general/projects/workshop-claude-may/README.md",
  "project": "workshop-claude-may",
  "type": "deadline",
  "at": "2026-05-16",
  "label": "Finish teaching materials",
  "reminderLevel": "planning"
}
```

Agent rule:

```text
If the agent believes a work item needs a date, deadline, review point, or
follow-up, it should update the owning README/registry/output metadata. It
should not maintain a separate calendar list by hand.
```

Relationship to `memory/pending-todos.md`:

```text
time anchors are source-side metadata.
pending-todos.md is an operational working list.
```

A due time anchor may generate a reminder or a candidate pending todo, but it
should not be manually copied into both places unless the item has become an
actual operational next action. The script should help detect divergence.

## Folder Governance Files

Important long-lived folders can expose three governance files.

### README.md

Human-facing and agent-facing semantic card.

Typical fields:

- purpose;
- scope;
- what belongs here;
- what does not belong here;
- status;
- last adjusted at;
- owner;
- key paths;
- next actions;
- notes.

The README is the semantic source of truth for a folder's current state.

### folder.config.yaml

Machine-facing rule file.

Typical fields:

```yaml
id: competitive-analysis
type: project-folder

required_files:
  - README.md
  - registry.yaml
  - folder.config.yaml

required_folders:
  - sources
  - reports
  - output

allowed_file_patterns:
  - "*.md"
  - "*.yaml"
  - "*.json"

readme_sync:
  enabled: true
  field: "Last Adjusted At"
  watched_paths:
    - "sources/**"
    - "reports/**"
  ignored_paths:
    - ".generated/**"
    - "health.json"

registry:
  enabled: true
  strict: true

visualization:
  include_in_map: true
  max_depth: 2
  show_files: false
```

The config is the folder's local contract with the validator.

For the general pilot, `folder.config.yaml` is also the smallest stable
interface between a unit and the outer governance scan. The outer scan should
read this file before trying to infer behavior from prose.

Minimum useful unit contract fields:

```yaml
schema_version: 1
id: competitor-course-analysis
owner_agent: general
unit_type: project

role_files:
  readme: README.md
  rules: RULES.md
  index: index.md
  templates:
    - TEMPLATE.md

required_files:
  - README.md
  - RULES.md
  - index.md

watched_paths:
  - entries/**
  - index.md

readme_freshness:
  enabled: true
  timestamp_field: last_updated
  compare_against: watched_paths_latest_modified_at

unit_validation:
  command: bash validator.sh
  runtime: bash
  mode: read-only
  safe_to_run: true
  auto_run: false
  timeout_ms: 30000
  output_format: text

visualization:
  include_in_map: true
  show_files: false
```

This means the outer scan can reliably know:

- which files define the unit's public card, rules, index, and templates;
- which paths should affect freshness and attention;
- whether a unit validator exists;
- what runtime is required to execute it;
- whether automatic execution is allowed;
- which generated map and attention views should include this unit.

### registry.yaml

Folder-level inventory and intent registry.

Example:

```yaml
registered_items:
  - id: file_competitor_notion
    path: competitors/notion.md
    type: competitor-profile
    status: active
    description: Notion competitor profile and analysis notes.

  - id: file_pricing_sources
    path: sources/notion-pricing.md
    type: source-note
    status: active
    linked_to:
      - file_competitor_notion

unregistered_policy:
  action: warn
  agent_instruction: >
    Classify this file. Register it if valid, otherwise propose a destination.
```

The registry prevents a folder from becoming "whatever happens to be here."

## README Freshness

The README freshness check detects when a folder's contents changed after the
README's recorded `Last Adjusted At`.

Example issue:

```json
{
  "code": "README_OUTDATED",
  "severity": "warning",
  "folder": "agents/general/projects/example",
  "detectedLatestModifiedAt": "2026-05-11T18:32:00+08:00",
  "readmeLastAdjustedAt": "2026-04-29",
  "recommendedAgentAction": "Review changed files and update README status, notes, next actions, and Last Adjusted At."
}
```

Important edge cases:

- generated files must not trigger README staleness;
- validator output must not trigger README staleness;
- formatting-only changes may not require semantic README updates;
- each folder should define watched and ignored paths explicitly.

## Output As Quarantine

`output/` should be treated as a quarantine or staging zone, not as a permanent
dumping ground.

It is useful for:

- one-off reports;
- screenshots;
- temporary exports;
- generated drafts;
- quick research that has not yet become a project.

It should not silently hold:

- long-lived project state;
- reusable knowledge;
- independent app or repo folders;
- unclassified raw uploads;
- dependencies or build outputs.

Output files or subfolders can carry metadata:

```yaml
type: quick-research
created_at: 2026-05-11
triage_status: temporary
related_project: null
expires_at: 2026-05-25
promotion_candidate: false
```

Possible output issue codes:

- `OUTPUT_NEEDS_TRIAGE`
- `OUTPUT_EXPIRED`
- `OUTPUT_PROMOTION_CANDIDATE`
- `OUTPUT_CONTAINS_PROJECT_MARKERS`

Promotion signals:

- older than a defined age threshold;
- referenced by an active project;
- contains reusable conclusions;
- contains project markers such as `package.json`, `.git`, `pyproject.toml`, or
  similar source-root indicators;
- manually marked as `promotion_candidate`.

## Issue Codes

Health checks should produce structured issue codes, not only prose.

First useful set:

| Code | Meaning | Typical agent action |
|---|---|---|
| `README_MISSING` | Folder lacks a required README | Create from template |
| `README_OUTDATED` | Folder changed after README last adjustment | Review changes and update README |
| `CONFIG_MISSING` | Folder lacks required `folder.config.yaml` | Create or propose config |
| `REGISTRY_MISSING` | Folder lacks required registry | Create registry from current contents |
| `UNREGISTERED_FILE` | File exists but is not in registry | Classify, register, move, or propose cleanup |
| `MISSING_REGISTERED_FILE` | Registry entry points to a missing file | Restore file or remove stale entry |
| `INVALID_FILE_NAME` | File name violates naming rules | Rename or propose corrected name |
| `INVALID_STATUS` | Status value is outside enum | Normalize to allowed value |
| `STALE_ACTIVE_PROJECT` | Active project has no recent meaningful changes | Update status or next action |
| `OUTPUT_NEEDS_TRIAGE` | Output item lacks triage decision | Archive, delete, keep temporary, or promote |
| `BROKEN_LINK` | Registered or README link target is missing | Fix link or update source |
| `INVALID_TIME_ANCHOR` | Date or time anchor cannot be parsed | Normalize or remove invalid anchor |
| `REVIEW_DUE` | Review anchor is due or overdue | Review current state and update next action |
| `DEADLINE_APPROACHING` | Deadline is within configured planning window | Surface in planning brief |
| `DEADLINE_OVERDUE` | Deadline has passed without resolution | Escalate in reminder feed |
| `UNIT_VALIDATOR_DECLARED` | Unit declares a local validator | Include validator availability in unit health |
| `UNIT_VALIDATOR_UNVERIFIED` | Unit validator exists but was not run | Mark checked layer as unverified, not passed |
| `UNIT_VALIDATOR_RUNTIME_UNAVAILABLE` | Declared validator runtime is unavailable | Report unavailable runtime and suggest compatible execution |
| `UNIT_VALIDATION_FAILED` | Local validator ran and returned failure | Generate repair tasks tied to unit issue output |
| `UNIT_VALIDATION_WARNING` | Local validator reported non-blocking warnings | Add unit to attention feed without blocking planning |

Issue codes make the system actionable. They can map directly to repair
playbooks and agent task instructions.

## Agent Tasks

The health checker can emit `agent-tasks.json`.

Example:

```json
[
  {
    "id": "task-001",
    "severity": "warning",
    "code": "README_OUTDATED",
    "folder": "agents/general/projects/example",
    "instruction": "Review files modified after 2026-04-29 and update README Last Adjusted At, Current Status, Notes, and Next Actions.",
    "inputs": [
      "agents/general/projects/example/README.md"
    ],
    "allowed_actions": [
      "edit_readme",
      "update_registry",
      "propose_moves"
    ]
  }
]
```

This turns "clean up the workspace" into a bounded queue of repair tasks.

## Visualization Data

The frontend should not crawl the full workspace directly.

Instead, scripts should generate stable per-agent data files:

```text
agents/<agent>/.generated/workspace-governance/health.json
agents/<agent>/.generated/workspace-governance/agent-tasks.json
agents/<agent>/.generated/workspace-governance/workspace-map.json
agents/<agent>/.generated/workspace-governance/mindmap.json
```

The renderer then only needs to read generated JSON.

A root dashboard can read optional rollup files generated by a separate merge
step:

```text
.generated/workspace-governance/all-agents-health.json
.generated/workspace-governance/all-agent-tasks.json
.generated/workspace-governance/workspace-map.json
```

Root rollups are derived artifacts. They must not contain hand-maintained
agent-local state.

For the `general` pilot, two additional derived views may be useful:

```text
agents/general/.generated/workspace-governance/attention-feed.json
agents/general/.generated/workspace-governance/planning-brief.json
agents/general/.generated/workspace-governance/time-index.json
agents/general/.generated/workspace-governance/reminder-feed.json
agents/general/.generated/workspace-governance/workspace-map.json
agents/general/.generated/workspace-governance/workspace-map.html
```

`attention-feed.json` should contain concrete items that deserve review, such as
stale active projects, missing next actions, outdated README files, and output
triage candidates.

`planning-brief.json` should summarize the current active project landscape in a
form the secretary can use to propose priorities and next steps.

`time-index.json` should index time anchors found in project README files,
registries, and output metadata.

`reminder-feed.json` should combine due time anchors and health issues into
actionable reminders. It is generated data, not a manually maintained calendar.
It should stay narrower than `attention-feed.json`: overdue anchors, due-today
anchors, near-term anchors, errors, and warnings attached to near-term work.
Within that feed, level still matters: overdue anchors and errors are
`escalation`, due-today or due-within-1-day anchors are `reminder`, and anchors
due in 2-3 days stay `planning`.

No time anchor is not a problem by default. A unit should only become
`unverified` for missing anchors when its `folder.config.yaml` explicitly sets
`time_anchors.required: true`.

`workspace-map.json` should be the renderer-friendly overview. It flattens each
unit into map nodes with status, health counts, next anchor, feed counts, and
agent interpretation so a frontend or secretary agent does not need to traverse
the full `health.json` shape.

`workspace-map.html` is a generated static renderer for humans. It should be
rebuilt from `workspace-map.json`, not edited directly.

Example map node:

```json
{
  "id": "competitive-analysis",
  "title": "Competitive Analysis",
  "type": "project",
  "status": "active",
  "health": "warning",
  "path": "agents/general/projects/competitive-analysis",
  "lastAdjustedAt": "2026-05-11",
  "issues": [
    "README_OUTDATED",
    "UNREGISTERED_FILE"
  ],
  "children": []
}
```

This supports:

- mind maps;
- project dashboards;
- health tables;
- active work maps;
- review queues.

## Relationship To Existing ClaudeCab Workspace Policy

This idea extends the current workspace policy rather than replacing it.

Existing rules already define key layers:

- `projects/` for long-lived work units;
- `output/` for disposable or reproducible artifacts;
- `knowledge/` for reusable cross-project knowledge;
- `plans/` for task-scoped planning documents;
- `uploads/` for staging raw user material;
- runtime/cache folders excluded from knowledge and indexes.

The governance layer adds:

- folder-level registries;
- folder-level configs;
- README freshness checks;
- structured health issue codes;
- agent task generation;
- generated visualization data.

This document should not override existing `agents/_foundation/workspace-policy.md`
or `openspec/specs/agent-workspace-structure/spec.md`. If adopted, it should be
converted into a Spectra change proposal and merged through the normal workflow.

## MVP

First implementation should be intentionally small.

Target folders:

- `agents/general/projects/`
- `agents/general/output/`
- `agents/general/uploads/` only if output triage depends on recent uploaded
  material

Deferred folders:

- `agents/coder/`
- `agents/_foundation/` except for shared templates or schemas needed by the
  pilot

Minimum folder files:

- `README.md` for important folders;
- `folder.config.yaml` for governed project roots;
- `registry.yaml` for governed project roots where file placement matters.

Minimum checks:

- required README exists;
- required config exists;
- required registry exists;
- required folders exist;
- required files exist;
- unregistered files are detected;
- registered files still exist;
- README freshness check works with ignored generated paths;
- output items older than threshold are flagged for triage;
- project status is one of the allowed values.
- project README has a visible next action or explicitly states why no next
  action exists.
- parseable time anchors are indexed from project README files, registries, and
  output metadata where present.

Minimum generated artifacts:

- `agents/general/.generated/workspace-governance/health.json`;
- `agents/general/.generated/workspace-governance/agent-tasks.json`;
- `agents/general/.generated/workspace-governance/workspace-map.json`;
- `agents/general/.generated/workspace-governance/attention-feed.json`;
- `agents/general/.generated/workspace-governance/planning-brief.json`;
- `agents/general/.generated/workspace-governance/time-index.json`;
- `agents/general/.generated/workspace-governance/reminder-feed.json`.

Optional root rollup artifacts:

- `.generated/workspace-governance/all-agents-health.json`;
- `.generated/workspace-governance/all-agent-tasks.json`;
- `.generated/workspace-governance/workspace-map.json`.

Success condition:

```text
The general agent can use generated workspace facts to explain what is active,
what needs attention, and what next steps are plausible, without crawling
aimlessly or relying only on chat memory.
```

## Risks

### Governance Overhead

Too much metadata can become its own maintenance burden.

Mitigation:

- start with important folders only;
- avoid requiring governance files for every small subfolder;
- make configs inheritable where possible;
- generate registries where possible, then let agents refine descriptions.

### False README Staleness

Modification time alone can over-report staleness.

Mitigation:

- define watched paths;
- ignore generated paths;
- consider content hashes later;
- treat the issue as a warning, not always an error.

### Registry Rot

Registries can become stale.

Mitigation:

- validate both directions: filesystem to registry and registry to filesystem;
- use stable item IDs so files can move without losing identity;
- generate repair tasks for stale entries.

### Visualization Explosion

Rendering every file produces an unreadable map.

Mitigation:

- visualize management-level nodes, not every file;
- default to project and subproject depth;
- allow folder configs to opt in or collapse details.

### Agent Overreach

Agents may modify governance rules when they should only repair workspace state.

Mitigation:

- separate repairable files from policy files;
- require explicit user approval for schema or validator changes;
- let agents propose moves/deletions before executing high-impact changes.

## Candidate Agent Capability Extensions

These are possible secretary-agent capabilities that follow the same pattern as
time anchors: source data lives with the owning object, while scripts generate
indexes and feeds for the agent to use.

### Common Anchor Model

An anchor is a small structured marker attached to the file or folder that owns
the work item. Anchors should not live in a separate global tracker unless that
tracker is generated.

Minimum normalized fields:

```yaml
id: anchor_workshop_material_deadline
anchor_type: time
source_path: agents/general/projects/workshop-claude-may/README.md
owner_scope: agents/general
subject_id: workshop-claude-may
label: Finish teaching materials
status: active
visibility: planning
created_by: human
updated_at: 2026-05-11
```

Common fields:

| Field | Meaning |
|---|---|
| `id` | Stable ID for the anchor. |
| `anchor_type` | `time`, `decision`, `commitment`, `dependency`, `source_of_truth`, `triage`, or `constraint`. |
| `source_path` | File that owns the anchor. |
| `owner_scope` | Usually `agents/general` for the pilot. |
| `subject_id` | Project, file, output item, or registry item the anchor describes. |
| `label` | Human-readable short description. |
| `status` | `active`, `resolved`, `superseded`, or `archived`. |
| `visibility` | `map`, `attention`, `planning`, or `reminder`. |
| `created_by` | `human`, `agent`, or `script`. |
| `updated_at` | Last semantic update date. |

Anchor lifecycle:

```text
created -> active -> resolved
                  -> superseded
                  -> archived
```

Agent rule:

```text
When adding a new anchor, write it to the owning object. When producing a
dashboard, reminder, or planning view, read generated indexes only.
```

### Attention And Reminder Levels

Not every issue should become a proactive reminder.

Recommended levels:

| Level | Meaning | Example |
|---|---|---|
| `map` | Show in workspace map only | A paused project exists |
| `attention` | Show in review queue | Output needs triage |
| `planning` | Use when proposing priorities | Project has deadline in 2-3 days |
| `reminder` | Proactively surface | Follow-up is due today or tomorrow |
| `escalation` | Proactively surface with urgency | Deadline is overdue |

Reminder generation should be conservative. A noisy secretary becomes easy to
ignore.

Good first-pass reminder candidates:

- follow-up anchors due today, tomorrow, or overdue;
- deadlines approaching within the configured planning window, with 2-3 day
  anchors treated as planning unless urgency is explicit;
- overdue deadlines;
- active projects blocked by missing user input;
- commitments whose due or review anchor is reached;
- output expiry or triage deadlines.

Good first-pass attention-only candidates:

- README may be stale;
- unregistered file exists;
- project status is unclear;
- output item is old but not urgent;
- duplicate or source-of-truth concern needs review.

### Secretary Planning Loop

The general agent should use generated governance data in a repeatable planning
loop:

1. Read `health.json`, `attention-feed.json`, `time-index.json`,
   `reminder-feed.json`, and `planning-brief.json`.
2. Summarize active projects and current focus.
3. Surface due, blocked, stale, or unclear items.
4. Propose a short priority set and next actions.
5. If the user accepts a date, commitment, dependency, or decision, write the
   anchor back to the owning README, registry item, or output metadata.
6. Let the next scan regenerate indexes and reminders.

The agent should avoid inventing hidden state in chat. If something matters for
future planning, it should be anchored in the workspace.

### Decision Anchors

Purpose: prevent project direction from living only in chat history.

Owning object: project README, project notes, or registry item.

Generated view: `decision-index.json`.

Useful for:

- accepted decisions;
- rejected alternatives;
- decision date;
- reason;
- owner;
- links to source material.

### Commitment Anchors

Purpose: track promises, expected follow-ups, and "we said we would" items
without relying on memory.

Owning object: project README or task note.

Generated view: `commitment-feed.json`.

Useful for:

- commitments made to the user;
- commitments made to collaborators;
- expected deliverables;
- follow-up owner;
- due or review anchor.

Example:

```yaml
commitments:
  - id: commitment_workshop_outline_review
    label: Review workshop outline and suggest next revision
    owner: general
    target: Cab
    status: active
    due_at: 2026-05-14
    source: README.md
```

### Dependency Anchors

Purpose: help the secretary explain why one thing is blocked by another.

Owning object: project README, registry item, or project config.

Generated view: `dependency-map.json`.

Useful for:

- project A depends on project B;
- deliverable depends on source material;
- output should be promoted before planning continues;
- blocker needs user input.

Example:

```yaml
dependencies:
  - id: dep_workshop_deck_needs_outline
    subject: workshop-slide-deck
    blocked_by: workshop-outline
    status: active
    reason: Slide production depends on final section order.
    unblock_action: Confirm final outline.
```

### Source-Of-Truth Anchors

Purpose: reduce duplicate or stale copies.

Owning object: folder README, registry item, or file metadata.

Generated view: `source-of-truth-index.json`.

Useful for:

- canonical file path;
- duplicate candidates;
- external source path or URL;
- files that should reference the canonical source instead of copying it.

### Inbox And Triage Anchors

Purpose: make unclassified material visible before it becomes workspace sediment.

Owning object: uploads, output, or project staging folder metadata.

Generated view: `triage-feed.json`.

Useful for:

- unclassified uploads;
- output items with no triage status;
- files that look project-like but are in output;
- stale staging folders.

### Preference And Constraint Anchors

Purpose: help the secretary plan in a way that respects user preferences and
current operating constraints.

Owning object: concise profile/policy files, not project content.

Generated view: `planning-constraints.json`.

Useful for:

- preferred planning cadence;
- types of reminders the user wants or does not want;
- current priority themes;
- areas where agent should ask before acting.

The first extension to implement should probably be **time anchors**, because
they directly improve reminders and planning. The next likely candidates are
commitment anchors and dependency anchors, because they help the secretary
explain what matters now and what is blocked.

First-pass recommendation:

- MVP: time anchors plus attention/reminder levels.
- Next: commitment anchors for promised follow-ups and deliverables.
- Next: dependency anchors for blocked work and planning order.
- Later: decision, source-of-truth, triage, and constraint indexes as the pilot
  exposes real cases.

## Open Questions

- Should `folder.config.yaml` and `registry.yaml` exist per project, per folder
  zone, or only at selected roots with inheritance?
- Should README freshness use modification time, content hash, git diff, or a
  combination?
- Should output triage be file-level, folder-level, or both?
- What is the smallest status model that works across general and coder agents?
- Should the first visualization be Mermaid/Markmap, a static HTML dashboard, or
  a JSON-only data contract?
- Which actions can agents execute directly, and which should be proposal-only?
- Which attention items should become proactive reminders, and which should stay
  as review-only dashboard items?
- How often should the general pilot refresh health, attention, and planning
  data?
- Which time anchor types should be allowed in the first pass: event, deadline,
  review, follow-up, expiry?
- Should commitment and dependency anchors be part of the first pilot, or only
  documented as future extensions?
- Which anchor fields are required in source files, and which fields can be
  normalized or inferred by the scan script?
- What threshold separates `attention` from proactive `reminder`?

## Next Discussion Targets

1. Define the `agents/general` pilot scan boundary.
2. Decide whether to extend `validate-agent-workspace.mjs` or create a
   companion `scan-general-workspace` script.
3. Define how generated `attention-feed.json`, `time-index.json`, and
   `planning-brief.json` should be consumed by `memory-ops` briefing.
4. Define the first project README anchor syntax.
5. Define issue code severity and attention/reminder levels.
6. Define `agent-tasks.json` action permissions.
7. Define the first `workspace.governance.yaml` schema for `agents/general`.
8. Convert the accepted parts into a Spectra proposal when implementation is
   ready.
