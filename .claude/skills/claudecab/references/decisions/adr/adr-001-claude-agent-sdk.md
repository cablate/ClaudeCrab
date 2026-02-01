---
id: ADR-001
title: 選擇 Claude Agent SDK 而非直接使用 API
status: accepted
date: 2026-01-26
---

# ADR-001: 選擇 Claude Agent SDK 而非直接使用 API

## 背景

需要實作多輪對話、工具使用、權限控制

## 決策

使用 @anthropic-ai/claude-agent-sdk

## 理由

- SDK 內建 session 管理、對話歷史、工具執行
- 支援 hooks 系統（PreToolUse, PostToolUse 等）
- 支援 MCP 整合
- 減少重複造輪子

## 後果

- 依賴 SDK 版本更新
- 需要理解 SDK 的 session/resume 機制
