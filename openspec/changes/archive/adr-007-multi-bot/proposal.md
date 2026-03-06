# 多機器人架構 — 每個 Agent 獨立 Bot

## Why

原本使用單一 Telegram Bot 搭配 `/switch` 指令切換 Agent，用戶體驗不佳（需記住指令），且架構耦合（所有 Agent 共用同一個 Bot 實例，單點故障影響全體）。

## What Changes

- 每個 Agent 在 `agent.json` 中配置自己的 `telegramBotToken`，實現一對一綁定
- 新增 `PlatformOrchestrator` 統一管理所有 Adapter 的生命週期
- 移除 `/switch`、`/list` 指令與 `switchAgent()` 方法
- Session Key 從 `platform::userId` 改為 `platform::agentId::userId`

## Capabilities

- 一對一綁定更直覺：用戶直接跟特定 Bot 對話，無需切換
- 解耦：各 Agent 的 Bot 互不影響，單一 Bot 啟動失敗不影響其他
- 通用設計：`PlatformOrchestrator` 根據 config 中的 token 欄位自動判斷平台，未來可擴展到 Slack、Discord
- Token 存放在 `agent.json` 中，與 Agent 配置集中管理
