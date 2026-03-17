#!/bin/bash
# Stop hook: trigger memory checkpoint
# Injects prompt once per session pointing to checklist file.

MARKER="/tmp/claude-memory-check-$(echo "$(pwd)" | md5sum | cut -c1-8)-$(date +%Y%m%d)"

if [ -f "$MARKER" ]; then
  exit 0
fi

touch "$MARKER"

CHECKLIST=".claude/skills/sys-growth/references/session-end-checklist.md"
echo "{\"decision\":\"approve\",\"reason\":\"⚠️ Session 結束前，讀取 $CHECKLIST 並靜默執行所有檢查項。\"}"
