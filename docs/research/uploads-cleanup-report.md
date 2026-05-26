# General Uploads Cleanup Report

> Date: 2026-04-30
> Scope: `agents/general/uploads`
> Purpose: Record the cleanup outcome and preserve the case as workspace hygiene material.

## Executive Summary

`agents/general/uploads` had become a staging area with no drain policy. It contained 10 date directories, about 3,860 files, and roughly 189 MB of mixed material. About 90% of the footprint came from one accidental Python runtime copy under `2026-04-14/Python`.

Cleanup result:

| Metric | Before | After |
|---|---:|---:|
| Upload date directories | 10 | 0 |
| Upload root contents | Date buckets | `_archive` only |
| Upload size | ~189 MB | 6.06 MB |
| Deleted runtime files | 0 | 3,826 |
| Exact duplicate files removed | 0 | 4 |
| Empty date directories removed | 0 | 10 |

The cleanup moved reusable project material into project folders, moved private or raw source material into `_archive`, deleted the accidental runtime copy, and then completed a second triage pass so no files remain under `uploads/_archive/triage`.

## Actions Performed

### 1. Deleted accidental runtime

Deleted:

```text
agents/general/uploads/2026-04-14/Python/
```

Result:

- `3,826` files removed.
- `166.68 MB` released.
- Deletion was constrained to the exact resolved path under `agents/general/uploads/2026-04-14/Python`.

### 2. Moved project material

| Source material | Destination |
|---|---|
| ReYi logistics Excel files and `analysis_output.txt` | `agents/general/projects/lecture-reyi-training/data/` |
| AgentSkill event photos | `agents/general/projects/lecture-agentskill/assets/` |
| SagaSu source message | `agents/general/projects/video-stateless-agent/references/sagasu-message.txt` |
| Shi Daxia lecture transcripts | `agents/general/projects/collab-kevin/transcripts/` |
| Threads CSV exports | `agents/general/projects/cab-late-threads/data/` |
| CC deep engineering PDF, JSON, and page previews | `agents/general/projects/cc-deep-engineering/visual/` |

### 3. Archived private and raw material

| Material | Destination | Git handling |
|---|---|---|
| Private call transcript from 2026-04-14 | `agents/general/uploads/_archive/private/2026-04-14/` | ignored by `.gitignore` |
| Tax PDF and screenshots from 2026-04-28 | `agents/general/uploads/_archive/private/2026-04-28/` | ignored by `.gitignore` |
| Raw meeting transcripts from 2026-04-16 | `agents/general/uploads/_archive/meetings/2026-04-16/` | ignored by `.gitignore` |
| Google Meet notes from 2026-04-20 | `agents/general/uploads/_archive/meetings/2026-04-20/` | ignored by `.gitignore` |
| Codex feedback raw messages | `agents/general/uploads/_archive/codex-feedback/` | ignored by `.gitignore` |

### 4. Classified remaining triage material

Uncertain files were not deleted. A second pass moved them from `triage` into more precise archive categories:

| Material | Final location | Reason |
|---|---|---|
| `2026-04-14/image.png` | `uploads/_archive/screenshots/unknown/2026-04-14/` | Screenshot-like image; content not required for repo |
| `2026-04-17/image.png` | `uploads/_archive/screenshots/unknown/2026-04-17/` | Screenshot-like image; content not required for repo |
| `2026-04-18/image.png` | `uploads/_archive/screenshots/unknown/2026-04-18/` | Screenshot-like image; content not required for repo |
| `2026-04-21/1Agent......01_1Agent.txt` | `uploads/_archive/external-notes/agent-memory/2026-04-21/agent-memory-context-window.txt` | External note/transcript about agent memory and context windows |
| `2026-04-29/zip.zip` | `uploads/_archive/skill-packages/neat-freak/2026-04-29/neat-freak.zip` | Skill package archive containing `SKILL.md` and references |

`uploads/_archive/triage` is now empty and was removed.

### 5. Removed exact duplicates

Four duplicate ReYi Excel uploads were removed only after exact hash comparison:

- `-_1.xlsx`
- `67.-3_1.xlsx`
- `6._1.xls`
- `7.__1.xls`

The duplicates appeared to be upload-generated `_1` copies.

## Current State

`agents/general/uploads` now contains only:

```text
agents/general/uploads/_archive/
```

Size:

- `6.06 MB`
- `19` files

Project material moved into `agents/general/projects/...` was reviewed for git safety. Raw data, customer material, third-party transcripts, screenshots, and copied external posts were kept local and ignored through project-level `.gitignore` rules.

Added ignore rules:

| Project | Ignored local material |
|---|---|
| `cab-late-threads` | `/data/` |
| `lecture-reyi-training` | `/data/` |
| `collab-kevin` | `/transcripts/` |
| `cc-deep-engineering` | `/visual/` |
| `video-stateless-agent` | `/references/sagasu-message.txt` |

## Privacy Boundary

Private call transcripts and tax documents were kept out of project folders and out of git-tracked paths.

Relevant ignore rule:

```text
agents/*/uploads/
```

This means `uploads/_archive/private` is suitable for local retention, but it is not suitable as a long-term knowledge base. If a private file is later summarized, create a sanitized note in a proper project or knowledge folder and keep the raw source in archive.

## Lessons

### Uploads is a staging area, not storage

`uploads` behaved like a door-side shoe pile. Files arrived there because it was the easiest place to put them, but no later step moved them to their final home.

The problem was not file volume alone. The deeper issue was lack of lifecycle:

1. Upload.
2. Use during task.
3. Classify.
4. Move to project, archive, triage, or delete.
5. Remove empty buckets.

Without step 3 and 4, uploads silently becomes a junk drawer.

### Large accidental folders are structural signals

The Python runtime copy was an extreme case, but it exposed a real boundary problem: without an entrance check, anything can land in uploads, including runtimes, caches, and generated dependencies.

The fix is not just periodic cleanup. The better fix is an upload drain policy plus forbidden-folder detection.

### Session-end drain beats monthly cleanup

The best time to classify uploaded material is at the end of the session that used it. After 30 days, filenames and context are no longer reliable. Classification becomes slower and riskier.

For agent workflows, the practical rule is:

> If a file was used to produce an output, move or archive it before ending the session.

## Follow-Up Tasks

1. Documentation and project `.gitignore` changes were committed in `e8f37df docs: document uploads drain policy`.
2. Adopt `uploads-drain-policy.md` as the standard session-end workflow.
3. Consider a lightweight guard script that flags large runtime-like folders under `uploads`.
4. Periodically audit `_archive/private` and `_archive/screenshots/unknown` for retention needs.
