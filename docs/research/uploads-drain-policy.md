# Uploads Drain Policy

> Date: 2026-04-30
> Applies to: `agents/*/uploads`
> Goal: Keep uploads as a short-lived staging area, not a long-term storage folder.

## Policy Statement

`uploads` is an inbox. It is not a project folder, knowledge base, archive, or git-tracked source of truth.

Every uploaded file should eventually be moved into one of four states:

| State | Meaning |
|---|---|
| Project material | Used by a named project and moved into that project folder |
| Archive | Raw source retained locally but not intended for git |
| Triage | Unknown value; needs later inspection |
| Delete | Runtime/cache/duplicate/generated material with no durable value |

## Core Rule

Drain uploads at session end.

If the session used uploaded files, the session should end with:

1. Project material moved to the correct project.
2. Private/raw material moved to `_archive`.
3. Unknown files moved to `_archive/triage`.
4. Exact duplicates deleted only after hash comparison.
5. Empty date folders removed.

## Destination Rules

### Project material

Move files into the owning project:

```text
agents/<agent>/projects/<project>/
```

Recommended subfolders:

| Material type | Destination |
|---|---|
| CSV / Excel / JSON data | `data/` |
| Photos / screenshots / visuals | `assets/` or `visual/` |
| Source messages / prompt inputs | `references/` |
| Raw transcripts used by a project | `transcripts/` |
| Generated reports | `workspace/` or `output/` depending on project convention |

Do not leave project-critical material in uploads after the session.

### Private material

Move private source files to:

```text
agents/<agent>/uploads/_archive/private/<yyyy-mm-dd>/
```

Examples:

- Tax documents.
- Personal call transcripts.
- Contracts or financial documents.
- Identity or account material.
- Anything containing private personal data.

Private raw files should not be moved into `projects/` or `knowledge/` unless explicitly sanitized.

### Meeting transcripts and raw notes

If the transcript has already been summarized or converted into a debrief, move the raw source to:

```text
agents/<agent>/uploads/_archive/meetings/<yyyy-mm-dd>/
```

If the transcript is still an active source for a project, move it to:

```text
agents/<agent>/projects/<project>/transcripts/
```

### Tool feedback and raw agent outputs

If the raw file is already integrated into a report, move it to:

```text
agents/<agent>/uploads/_archive/<source-type>/<yyyy-mm-dd>/
```

Examples:

- `codex-feedback/`
- `claude-feedback/`
- `browser-snapshots/`
- `debug-logs/`

### Triage material

Move unknown files to:

```text
agents/<agent>/uploads/_archive/triage/<yyyy-mm-dd>/
```

Triage is not permanent storage. If possible, add a short note near the file or in a cleanup report explaining why the file is unknown.

### Delete candidates

Delete only after verifying the resolved path and category.

Common delete candidates:

- Runtime folders, such as `Python/`, `pythoncore-*`, bundled interpreters.
- Dependency folders, such as `node_modules/`.
- Build/cache folders, such as `.next/`, `dist/`, `.cache/`, `__pycache__/`.
- Upload-generated duplicates with identical hash.
- Temporary exports already moved to a project folder.

Do not delete user-created source files just because they look redundant. For duplicates, compare hash first.

## Forbidden Folder Check

These folders should almost never live under `uploads`:

```text
Python/
pythoncore-*/
node_modules/
.git/
.next/
dist/
build/
.cache/
__pycache__/
```

If found:

1. Verify the full resolved path is inside the intended uploads date directory.
2. Confirm it is not the only copy of user-created material.
3. Delete or move to a delete-candidate quarantine.
4. Record the action in a cleanup report.

## Git Boundary

Raw uploads should generally stay ignored.

For this repo, `agents/*/uploads/` is ignored. That is intentional.

Before staging moved files, ask:

- Is this reusable source material?
- Is it safe to publish?
- Is it small enough for git?
- Is it better represented by a summary instead of raw data?
- Does it contain private, customer, financial, or account information?

Prefer committing sanitized summaries, reusable examples, and project docs. Avoid committing raw private transcripts, tax files, large screenshots, and one-off exports unless there is a clear reason.

## Session-End Checklist

Use this checklist when a task used uploaded files:

- List new or touched files under `agents/<agent>/uploads`.
- Identify project-owned files.
- Move project material into `projects/<project>/...`.
- Move private files into `_archive/private/<date>`.
- Move processed meeting raw files into `_archive/meetings/<date>`.
- Move uncertain files into `_archive/triage/<date>`.
- Delete runtime/cache folders after resolved-path verification.
- Delete exact duplicates only after hash comparison.
- Remove empty date directories.
- Run `git status --short --untracked-files=all`.
- Decide separately what moved project material should be staged.

## Periodic Audit Checklist

Run periodically, or before a major release:

- Count upload date directories.
- Find folders larger than 50 MB.
- Search for forbidden folder names.
- Inspect `_archive/triage`.
- Confirm `_archive/private` is ignored by git.
- Review old project material left in uploads.

Useful PowerShell snippets:

```powershell
$uploads = 'F:\_Program\OwnProject\ClaudeCab\agents\general\uploads'
Get-ChildItem -Directory -Force -LiteralPath $uploads |
  ForEach-Object {
    $sum = Get-ChildItem -Recurse -File -Force -LiteralPath $_.FullName |
      Measure-Object -Property Length -Sum
    [PSCustomObject]@{
      Name = $_.Name
      Files = $sum.Count
      MB = [math]::Round($sum.Sum / 1MB, 2)
    }
  } | Sort-Object MB -Descending
```

```powershell
$uploads = 'F:\_Program\OwnProject\ClaudeCab\agents\general\uploads'
Get-ChildItem -Recurse -Directory -Force -LiteralPath $uploads |
  Where-Object {
    $_.Name -in @('Python','node_modules','.git','.next','dist','build','.cache','__pycache__') -or
    $_.Name -like 'pythoncore-*'
  } |
  Select-Object FullName
```

## Decision Heuristics

Use these rules when uncertain:

- If a file directly supports a project output, move it to that project.
- If a file is private raw evidence, archive it locally and write a sanitized summary elsewhere.
- If a file is unknown but potentially useful, triage it instead of deleting.
- If a folder is runtime/dependency/cache material, treat it as a delete candidate.
- If two files look duplicated, hash compare before deleting.
- If a file is large and not source-of-truth, prefer summary over git commit.

## Why This Matters

Unmanaged uploads create silent structural decay. The folder looks harmless because every file arrived for a reason, but over time the original context disappears.

The goal of this policy is not neatness for its own sake. The goal is to preserve useful context, protect private material, reduce workspace weight, and keep future agents from wasting time rediscovering what old uploads were.
