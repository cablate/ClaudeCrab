# SDK 模式 vs Legacy 模式

## Why

早期同時存在 SDK 模式與 Legacy 模式（直接使用 @anthropic-ai/sdk 手動管理對話歷史），透過環境變數 `USE_CLAUDE_AGENT_SDK` 切換。

## What Changes

保留 SDK 與 Legacy 兩種模式，透過環境變數切換。

## Capabilities

- 提供過渡期間的相容性

## Trade-offs

- 已廢棄（v1.4.0 移除 Legacy 模式）
- SDK 為唯一模式，Legacy 模式已無使用場景
- `USE_CLAUDE_AGENT_SDK` 環境變數已移除
