# ADR-007: 多機器人架構 — 每個 Agent 獨立 Bot

從單一 Bot + `/switch` 切換模式，改為每個 Agent 擁有獨立 Telegram Bot Token，由 `PlatformOrchestrator` 統一管理生命週期。
