# Agent 記憶系統 — 零程式碼、Agent 自主管理

## Why

需要讓 Agent 擁有跨 session 記憶能力（參考 Moltbot 純檔案記憶架構），同時保持 SDKQueryManager 可獨立抽離。

## What Changes

1. 記憶邏輯完全寫在 CLAUDE.md（systemPrompt）中，由 Agent 自行操作
2. 不在 SDKQueryManager 或 MessageProcessor 注入任何記憶內容
3. 不建立「組裝層」拼接記憶到 systemPrompt
4. Agent 透過 Read/Write 工具讀寫 workspace 檔案（SOUL.md、USER.md、MEMORY.md 等）

## Capabilities

- SDKQueryManager 設計目標是可以整個帶走到其他專案使用，不應包含業務邏輯
- Agent 本身已有 Read/Write 工具能力，SDK 以 `cwd=agents/<name>/` 執行，可直接存取 workspace 檔案
- 零程式碼改動 = 零風險引入新 bug，也不需要寫新測試
- CLAUDE.md 即控制點：修改記憶行為只需調整 CLAUDE.md，不需重新部署
