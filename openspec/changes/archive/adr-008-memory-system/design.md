# 設計：Agent 記憶系統 — 零程式碼、Agent 自主管理

## Decisions

### CLAUDE.md 作為唯一控制點

記憶邏輯完全定義在 CLAUDE.md（systemPrompt）中，不在程式碼層注入任何記憶內容。修改記憶行為只需調整 CLAUDE.md，不需重新部署。

### Agent 自主讀寫 workspace 檔案

Agent 透過 Read/Write 工具讀寫 workspace 檔案（SOUL.md、USER.md、MEMORY.md 等），SDK 以 `cwd=agents/<name>/` 執行，可直接存取。

### 不建立組裝層

不在 SDKQueryManager 或 MessageProcessor 注入記憶內容，不建立「組裝層」拼接記憶到 systemPrompt，保持 SDKQueryManager 可獨立抽離。

## Risks / Trade-offs

- Agent 是否遵守記憶協議取決於 LLM 的指令遵從能力（無法程式化保證）
- 記憶寫入時機依賴 Agent 判斷，可能偶爾漏記
- 可接受：Moltbot 官方也承認此機制 "is still evolving"，漏記比記太多好

## Affected Components

- `agents/general/CLAUDE.md`（記憶協議定義）
- `agents/general/SOUL.md`、`USER.md`、`IDENTITY.md`、`MEMORY.md`、`memory/`（workspace 檔案）
