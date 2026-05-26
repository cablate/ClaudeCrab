# Knowledge Hygiene Report

> Date: 2026-04-30
> Scope: `agents/general/knowledge`, `agents/coder/knowledge`
> Purpose: Record B6 cleanup outcome and preserve the case as CC engineering handbook material.

## Executive Summary

`agents/general/knowledge` had a classic backup sediment problem. The canonical `tech-kb/` knowledge repo was small and useful, but it had accumulated several local backup/copy/link-test siblings. Those backups dominated the knowledge layer while adding no current navigation value.

Cleanup result:

| Area | Before | After |
|---|---:|---:|
| `general/knowledge` | backup-heavy, dominated by `tech-kb*` copies | 965 files / 2.29 MB |
| `coder/knowledge` | 653 KB / 78 files, clean | unchanged |
| Validator | 0 errors / 0 warnings before cleanup | 0 errors / 0 warnings after cleanup |

## Canonical Source

Canonical knowledge repo:

```text
agents/general/knowledge/tech-kb/
```

Remote:

```text
https://github.com/cablate/llm-atomic-wiki.git
```

Because the canonical repo has a remote, redundant local bare backups and Windows copy folders are not needed as long-term knowledge assets.

## Deleted Backup Sediment

Deleted only these whitelisted paths:

| Deleted item | Reason |
|---|---|
| `tech-kb - 複製/` | Windows Explorer copy residue; older duplicate |
| `tech-kb-git-backup/` | Local bare repo backup; remote already exists |
| `tech-kb-link-backup-20260417-033516/` | Link/symlink experiment backup |
| `tech-kb-link-backup-20260417-034252/` | Link/symlink experiment backup |
| `tech-kb-link-test-backup-20260417-031402/` | Link/symlink test backup |
| `tools/` | Empty directory |

No reusable knowledge notes were deleted. `agents/coder/knowledge` was not changed.

## Safety Checks

Before deletion:

- Confirmed every delete target resolved under `agents/general/knowledge`.
- Confirmed canonical `tech-kb/` has GitHub remote.
- Confirmed canonical `tech-kb/` was not part of the delete list.
- Used native PowerShell `Remove-Item -LiteralPath` on explicit paths only.

## Lesson

Knowledge rot is different from output rot.

`output/` often decays because artifacts turn into projects. `uploads/` decays because staging files never get drained. `plans/` decays because completed plans stay visible as active work. `knowledge/` decays because people make safety copies before experiments, then forget to delete them.

The fix is not only taxonomy. Knowledge also needs backup policy:

- If a knowledge tree is a git repo with a remote, the remote is the backup.
- Local backup folders need an expiry date.
- Timestamped experiment backups should be deleted after the experiment is complete.
- Same-prefix backup clusters like `tech-kb*` should be flagged during workspace hygiene checks.
