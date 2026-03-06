# canUseTool callback（SDK 原生機制）vs Hook system

## Why

需要在 Telegram 中實作工具使用的人類審批流程，有兩種可能機制：SDK 的 `canUseTool` callback 與 Hook system（PreToolUse）。

## What Changes

選擇 `canUseTool` callback。

## Capabilities

- `canUseTool` 是 SDK 專為程式化權限處理設計的機制，回傳 Promise<PermissionResult> 與 Telegram 按鈕互動天然匹配
- Promise-based 設計可以直接 await Telegram 使用者的按鈕回應
- Hook system 設計目的偏向日誌記錄和觀察，非權限控制

## Trade-offs

- 綁定 SDK 的 `canUseTool` API，若 SDK 變更需要調整
