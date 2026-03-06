# ADR-031: Hook 系統解耦 — 從引擎硬編轉為原生 Claude Code Hooks

將三個核心 hook（PathValidator、Memory Checkpoint、Stop Checkpoint）從引擎硬編遷移到 Claude Code 原生 hook 系統，透過各 agent 的 settings.local.json 和外部腳本定義。
