---
id: ADR-007
title: 多機器人架構 — 每個 Agent 獨立 Bot
status: accepted
date: 2026-01-27
---

# ADR-007: 多機器人架構 — 每個 Agent 獨立 Bot

## 背景

原本使用單一 Telegram Bot + `/switch` 指令切換 Agent，用戶體驗不佳且架構耦合

## 決策

1. 每個 Agent 在 `agent.json` 中配置自己的 `telegramBotToken`
2. 新增 `PlatformOrchestrator` 統一管理所有 Adapter 的生命週期
3. 移除 `/switch`、`/list` 指令與 `switchAgent()` 方法
4. Session Key 從 `platform::userId` 改為 `platform::agentId::userId`

## 理由

- 一對一綁定更直覺：用戶直接跟特定 Bot 對話
- 解耦：各 Agent 的 Bot 互不影響，單一 Bot 啟動失敗不影響其他
- 通用設計：`PlatformOrchestrator` 根據 config 中的 token 欄位自動判斷平台，未來可擴展到 Slack、Discord
- Token 存放在 `agent.json` 中，與 Agent 配置集中管理

## 影響

- 移除環境變數 `TELEGRAM_BOT_TOKEN`
- DB Schema 升級至 v2（UNIQUE 約束加入 `agent_id`）
- 舊 Session 不相容（重啟後自動建新 Session）

## 實作位置

- `src/core/PlatformOrchestrator.ts`（新增）
- `src/core/AdapterRegistry.ts`（修改為複合鍵）
- `src/adapters/TelegramAdapter.ts`（綁定 agentId）
- `src/index.ts`（使用 Orchestrator 啟動）
