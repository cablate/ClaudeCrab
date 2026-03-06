# Hook 系統解耦 — 從引擎硬編轉為原生 Claude Code Hooks

## Why

目前三個核心 hook 硬編在 `MessageProcessor.ts` 和 `ScheduleExecutor.ts` 裡：PathValidator（工作區隔離）、Memory Checkpoint（記憶檢查提示）、Stop Checkpoint（結束前記憶寫入提醒）。問題在於每個 agent 的 hook 行為綁死在引擎裡無法個別調整、新增 `allowAllAgents` flag 等特殊邏輯讓引擎越來越複雜、引擎需要了解每個 hook 的業務邏輯。

## What Changes

將三個 hook 從引擎遷移到 Claude Code 原生 hook 系統，透過各 agent 的 `settings.local.json` 和外部腳本定義：

- **Phase 1**：PathValidator 外部化 — 抽成獨立腳本 `agents/_shared/hooks/path-validator.js`，各 agent settings.local.json 配置 PreToolUse hook
- **Phase 2**：Stop Hook 外部化 — 抽成外部腳本 `agents/_shared/hooks/memory-stop-checkpoint.ts`，各 agent settings.local.json 配置 Stop hook
- **UserPromptSubmit 保留在引擎** — 內容幾乎全是 runtime 條件式（時間、chatId、isNewSession、isGroupChat），無法有意義地拆到靜態設定
- **Phase 3**：清理 — 移除 `allowAllAgents` flag、引擎中的 hook 組裝邏輯、更新 `_example/` 模板

## Capabilities

- Per-agent 自訂：每個 agent 可以有不同的 hook 配置
- 引擎簡化：引擎不再需要了解 hook 業務邏輯
- Admin 不需特殊 flag：不配置 PathValidator hook = 無限制
- 可維護性：hook 邏輯獨立，易於測試和修改
