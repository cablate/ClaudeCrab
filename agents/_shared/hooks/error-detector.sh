#!/bin/bash
# error-detector.sh — PostToolUse (Bash) hook
# 偵測 Bash 工具輸出中的錯誤，提醒 agent 記錄到 .learnings/ERRORS.md
#
# 設定方式（在各 agent 的 .claude/settings.local.json）：
#   "hooks": {
#     "PostToolUse": [{
#       "matcher": "Bash",
#       "hooks": [{
#         "type": "command",
#         "command": "bash agents/_shared/hooks/error-detector.sh"
#       }]
#     }]
#   }
#
# 行為：
# - 讀取 $CLAUDE_TOOL_OUTPUT 環境變數
# - 匹配常見錯誤模式
# - 只在偵測到錯誤時才輸出提醒（平時完全靜默，零 token 開銷）
# - 不修改任何檔案，不執行任何指令，純讀取

output="${CLAUDE_TOOL_OUTPUT:-}"

# 沒有輸出就靜默退出
if [ -z "$output" ]; then
  exit 0
fi

# 錯誤模式清單（不區分大小寫的用 -i，其他用精確匹配避免誤報）
error_detected=false

# 通用錯誤
if echo "$output" | grep -qi "^error:" ||
   echo "$output" | grep -q "^Error:" ||
   echo "$output" | grep -qi "fatal:" ||
   echo "$output" | grep -qi "FAILED" ||
   echo "$output" | grep -q "command not found" ||
   echo "$output" | grep -q "No such file or directory" ||
   echo "$output" | grep -q "Permission denied" ||
   echo "$output" | grep -q "permission denied"; then
  error_detected=true
fi

# Node.js / npm
if echo "$output" | grep -q "npm ERR!" ||
   echo "$output" | grep -q "Cannot find module" ||
   echo "$output" | grep -q "MODULE_NOT_FOUND" ||
   echo "$output" | grep -q "ERR_MODULE_NOT_FOUND"; then
  error_detected=true
fi

# Python
if echo "$output" | grep -q "Traceback (most recent call last)" ||
   echo "$output" | grep -q "SyntaxError:" ||
   echo "$output" | grep -q "ModuleNotFoundError:"; then
  error_detected=true
fi

# TypeScript / JavaScript
if echo "$output" | grep -q "TypeError:" ||
   echo "$output" | grep -q "ReferenceError:" ||
   echo "$output" | grep -q "SyntaxError:"; then
  error_detected=true
fi

# System
if echo "$output" | grep -q "ENOENT" ||
   echo "$output" | grep -q "EACCES" ||
   echo "$output" | grep -q "EPERM" ||
   echo "$output" | grep -q "ENOMEM"; then
  error_detected=true
fi

# Exit code（只匹配非零）
if echo "$output" | grep -qE "exit code [1-9]|Exit code: [1-9]|exited with code [1-9]"; then
  error_detected=true
fi

# 只在偵測到錯誤時才輸出
if [ "$error_detected" = true ]; then
  cat << 'EOF'
<error-detected>
偵測到指令錯誤。如果這個錯誤值得記錄（非一次性的、可能再次遇到），
請記錄到 `.learnings/ERRORS.md`，格式參考該檔案頂部的模板。
如果這個錯誤已經在 ERRORS.md 中有記錄，更新其 Recurrence 計數。
</error-detected>
EOF
fi
