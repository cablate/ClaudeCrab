---
id: ADR-006
title: SDK 模式 vs Legacy 模式
status: deprecated
date: 2026-01-26
deprecated: 2026-01-27
---

# ADR-006: SDK 模式 vs Legacy 模式（已廢棄）

## 狀態

已廢棄（v1.4.0 移除 Legacy 模式）

## 原始決策

保留 SDK 與 Legacy 兩種模式，透過環境變數切換

## 廢棄原因

v1.4.0 移除 Legacy 模式，SDK 為唯一模式。Legacy 模式（直接使用 @anthropic-ai/sdk 手動管理對話歷史）已無使用場景。`USE_CLAUDE_AGENT_SDK` 環境變數已移除。
