# PathValidator 路徑權限強制執行

## Why

ADR-015 建立了共享知識區架構，定義了路徑權限規則（自己的工作區讀寫皆可、`_shared/knowledge/` 所有 bot 可讀、`_shared/knowledge/{自己}/` 可寫入）。但這些規則只存在於 Agent 的 skill 文件中（safety.md），是「建議性」而非「強制性」的。Agent 可能因為不注意或被使用者誘導而違反規則。

## What Changes

選擇程式內建路徑驗證（方案 B），在 `MessageProcessor` 直接注入 `PreToolUse` hook，使用 `PathValidator` 驗證路徑。放棄方案 A（每個 agent 目錄放 hooks.ts）因維護成本高。

PathValidator 類別接收 `agentId`, `workspacePath`, `sharedPath`，提供 `validate(toolName, toolInput)` 檢查路徑是否允許。攔截的工具包括 Read、Write、Edit、Glob、Grep、Bash（解析 command 字串中的路徑）。

權限矩陣：
- `agents/{自己}/`：讀寫皆可
- `agents/_shared/knowledge/`：僅讀取
- `agents/_shared/knowledge/{自己}/`：讀寫皆可
- `agents/{其他}/` 及其他路徑：禁止

## Capabilities

- Agent 工作區隔離從「建議」變成「強制」
- 新增 agent 自動受到保護，無需任何配置
- 零維護成本，所有 agent 自動套用相同規則

## Trade-offs

- 無法客製化（目前不是問題，未來可透過 settings.json 開放 additionalReadPaths/additionalWritePaths）
