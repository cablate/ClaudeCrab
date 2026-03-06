# 選擇 Claude Agent SDK 而非直接使用 API

## Why

ClaudeCab 需要實作多輪對話、工具使用與權限控制。直接使用 Anthropic API 意味著需要自行管理 session 狀態、對話歷史、工具呼叫流程與錯誤處理，大幅增加開發與維護成本。

## What Changes

採用 `claude-agent-sdk` 作為與 Claude 互動的唯一介面層。

## Capabilities

- SDK 內建 session 管理與對話歷史追蹤
- 支援 hooks 系統（PreToolUse、PostToolUse 等），可介入工具執行流程
- 原生支援 MCP 整合，無需自訂協定
- 減少重複造輪子，專注於上層 Agent 邏輯

## Trade-offs

- 依賴 SDK 版本更新週期，升級可能帶來 breaking changes
- 團隊需理解 SDK 的 session/resume 機制才能有效開發
