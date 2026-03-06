# Tasks

## Phase 1：PathValidator 外部化

- [x] 將 PathValidator 邏輯抽成獨立腳本 agents/_shared/hooks/path-validator.js
- [x] 各 agent settings.local.json 配置 PreToolUse hook 指向 path-validator.js
- [x] admin agent 不配置 PathValidator hook
- [x] 從 MessageProcessor.ts 和 ScheduleExecutor.ts 移除硬編的 PathValidator hook

## Phase 2：Stop Hook 外部化

- [x] Stop hook 抽成外部腳本 agents/_shared/hooks/memory-stop-checkpoint.ts
- [x] 各 agent settings.local.json 配置 Stop hook
- [x] 從 MessageProcessor.ts 移除硬編 Stop hook
- [x] 從 constants.ts 移除相關常數
- [x] 評估 UserPromptSubmit — 保留在引擎（runtime 條件式無法靜態外部化）

## Phase 3：清理

- [x] 移除 allowAllAgents flag
- [x] 移除引擎中的 hook 組裝邏輯
- [x] 更新 _example/ 模板的 settings.local.json
