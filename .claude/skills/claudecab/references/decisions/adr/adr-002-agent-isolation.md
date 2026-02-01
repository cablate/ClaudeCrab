---
id: ADR-002
title: Agent Isolation - 使用 settingSources + systemPrompt
status: accepted
date: 2026-01-26
updated: 2026-01-30
---

# ADR-002: Agent Isolation - 使用 settingSources + systemPrompt

## 背景

SDK 會遞迴向上搜尋父目錄的 CLAUDE.md，即使遇到 .git 也不會停止

## 問題

當 agent 目錄在專案內時，會載入專案根目錄的 CLAUDE.md 而非 agent 自己的

## 決策（v1.11.0 更新）

1. 使用 `settingSources: ['project']` - 載入 agent 的設定檔 **和 skills**
2. 透過 `systemPrompt` 參數明確傳遞 agent 的 CLAUDE.md 內容（覆蓋 SDK 搜尋到的）

## 理由

- `'local'` 無法載入 skills（v1.11.0 發現的問題）
- `'project'` 會載入 `.claude/skills/` 目錄
- 明確傳遞 `systemPrompt` 確保 agent isolation（假設 SDK 優先使用傳入的參數）

## 變更歷程

- 原始決策（v1.0）：使用 `['local']` 完全隔離
- v1.11.0 更新：改用 `['project']` 以支援 skills，同時保留明確傳遞 `systemPrompt`

## 實作位置

`src/core/SDKQueryManager.ts`
