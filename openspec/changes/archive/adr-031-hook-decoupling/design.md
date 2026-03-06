# 設計：Hook 系統解耦

## Decisions

### 原生 Hook 機制

採用 Claude Code 原生 hook 系統，設定在 `settings.local.json` 中。支援兩種 hook 類型：`command`（外部腳本，stdin 接收 JSON，stdout/stderr 回傳決策）和 `prompt`（給 Claude 的提示文字）。

I/O 協議：
- Input（stdin）：`{ session_id, cwd, hook_event_name, tool_name, tool_input }`
- Output（stdout）：`{ hookSpecificOutput: { permissionDecision: "allow|deny" }, systemMessage }`
- Deny 捷徑：stderr + exit code 2

### Phase 1：PathValidator 外部化

將 PathValidator 邏輯抽成獨立腳本 `agents/_shared/hooks/path-validator.js`。腳本讀 stdin 判斷路徑權限，輸出 allow/deny。每個 agent 的 settings.local.json 配置 PreToolUse hook 指向此腳本。admin agent 不配置此 hook（天生有完整存取權）。從 MessageProcessor.ts 和 ScheduleExecutor.ts 移除硬編的 PathValidator hook。

### Phase 2：Stop Hook 外部化

Stop hook 改為 command 類型外部腳本 `agents/_shared/hooks/memory-stop-checkpoint.ts`。腳本讀 stdin `{ stop_hook_active }` flag 決定 allow/block。UserPromptSubmit 保留在引擎 — 內容幾乎全是 runtime 條件式，無法有意義地拆到靜態設定。

### Phase 3：清理

移除 `allowAllAgents` flag、引擎中的 hook 組裝邏輯、更新 `_example/` 模板的 settings.local.json。

## Risks / Trade-offs

- 外部腳本的效能（每次 tool call 都要啟動 process）
- 需要確保 `_example/` 模板包含正確的 hook 配置，新建 agent 才會有保護
- Windows 路徑處理在外部腳本中需要特別注意

## Affected Components

- `agents/_shared/hooks/path-validator.js` — 新增，PathValidator 外部腳本
- `agents/_shared/hooks/memory-stop-checkpoint.ts` — 新增，Stop hook 外部腳本
- `src/core/MessageProcessor.ts` — 移除硬編的 PathValidator hook 和 Stop hook
- `src/core/ScheduleExecutor.ts` — 移除硬編的 PathValidator hook
- `src/core/constants.ts` — 移除相關常數
- 各 agent 的 `settings.local.json` — 配置原生 hook
- `agents/_example/` — 更新模板 settings.local.json
