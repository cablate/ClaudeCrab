# ADR-031: Hook 系統解耦 — 從引擎硬編轉為原生 Claude Code Hooks

## 狀態

**PathValidator 已完成遷移**（2026-02-12）。UserPromptSubmit / Stop 仍在引擎內。

## 背景

目前三個核心 hook 硬編在 `MessageProcessor.ts` 和 `ScheduleExecutor.ts` 裡：

1. **PathValidator**（PreToolUse）— 工作區隔離，防止 agent 存取其他 agent 的檔案
2. **Memory Checkpoint**（UserPromptSubmit）— 注入記憶檢查提示
3. **Stop Checkpoint**（Stop）— 結束前記憶寫入提醒

問題：
- 每個 agent 的 hook 行為綁死在引擎裡，無法個別調整
- 新增 `allowAllAgents` flag 等特殊邏輯讓引擎越來越複雜
- 引擎需要了解每個 hook 的業務邏輯

## 決策

將三個 hook 從引擎遷移到 Claude Code 原生 hook 系統，透過各 agent 的 `settings.local.json` 和外部腳本定義。

## 原生 Hook 機制摘要

### 設定格式（settings.local.json）

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|Bash",
        "hooks": [
          { "type": "command", "command": "node path-validator.js", "timeout": 5 }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "prompt", "prompt": "記憶檢查提示..." }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "prompt", "prompt": "結束前記憶寫入..." }
        ]
      }
    ]
  }
}
```

### Hook 類型

| 類型 | 說明 |
|------|------|
| `command` | 外部腳本，stdin 接收 JSON，stdout/stderr 回傳決策 |
| `prompt` | 給 Claude 的提示文字 |

### I/O 協議

- **Input**（stdin）：`{ session_id, cwd, hook_event_name, tool_name, tool_input }`
- **Output**（stdout）：`{ hookSpecificOutput: { permissionDecision: "allow|deny" }, systemMessage }`
- **Deny 捷徑**：stderr + exit code 2

### 環境變數

- `$CLAUDE_PROJECT_DIR` — 專案根目錄
- `$TOOL_INPUT` — 工具輸入（prompt 類型可用）

## 遷移計畫

### Phase 1: PathValidator 外部化

1. 將 `PathValidator` 邏輯抽成獨立腳本 `agents/_shared/hooks/path-validator.js`
2. 腳本讀 stdin，判斷路徑權限，輸出 allow/deny
3. 每個 agent 的 `settings.local.json` 配置 PreToolUse hook 指向此腳本
4. admin agent 不配置此 hook（天生有完整存取權）
5. 從 `MessageProcessor.ts` 和 `ScheduleExecutor.ts` 移除硬編的 PathValidator hook

### Phase 2: Memory/Stop Checkpoint 外部化

1. `UserPromptSubmit` hook → prompt 類型，內容從 `constants.ts` 移到 settings
2. `Stop` hook → prompt 類型，同上
3. 從引擎移除對應的硬編 hook

### Phase 3: 清理

1. 移除 `allowAllAgents` flag（不再需要）
2. 移除引擎中的 hook 組裝邏輯
3. 更新 `_example/` 模板的 `settings.local.json`

## 優勢

- **Per-agent 自訂**：每個 agent 可以有不同的 hook 配置
- **引擎簡化**：引擎不再需要了解 hook 業務邏輯
- **Admin 不需特殊 flag**：不配置 PathValidator hook = 無限制
- **可維護性**：hook 邏輯獨立，易於測試和修改

## 風險

- 外部腳本的效能（每次 tool call 都要啟動 process）
- 需要確保 `_example/` 模板包含正確的 hook 配置，新建 agent 才會有保護
- Windows 路徑處理在外部腳本中需要特別注意
