# Dashboard 完整設定管理

## Why

Dashboard 原本的 Agent 編輯頁面只支援基本資訊（名稱、描述、模型、Telegram Token），無法涵蓋 v1.22.0 以後新增的群組協作、委派、主動互動等功能設定。使用者需要手動編輯 `agent.json`、`settings.local.json`、`.env` 才能完整配置 Agent。

## What Changes

### 設定檔所有權分離

| 檔案 | 所有者 | Dashboard 操作 |
|------|--------|---------------|
| `agent.json` | ClaudeCab 框架 | 讀寫 Agent 層級設定（名稱、描述、model params、delegation、initiative、mcpConfigFile） |
| `.claude/settings.local.json` | Claude SDK | 讀寫 SDK 管理的設定（permissions.allow、model） |
| `CLAUDE.md` | 使用者 / Agent Detail 頁 | Dashboard Edit 不涉入，由 Detail 頁單獨管理 |

### 關鍵決策

1. **permissions.allow 屬於 settings.local.json** — SDK 會在 runtime 動態修改此檔案，Dashboard 讀取完整清單顯示，儲存時寫回同一檔案。UI 使用 tag/chip 列表。
2. **agent.json 不應干預 SDK 層級的工具控制** — `allowedTools`/`disallowedTools` 從 Dashboard UI 移除，避免覆蓋 SDK 層級權限造成混淆。
3. **systemPrompt / systemPromptFile 不進 Dashboard Edit** — CLAUDE.md 已在 Agent Detail 頁面可直接編輯，避免重疊與優先級困惑。
4. **Schema 有定義但 runtime 未串接的欄位不進 UI**。

### Edit 頁面 Tab 設計

| Tab | 欄位 | 寫入目標 |
|-----|------|---------|
| 基本 | name, description, model, telegramBotToken | agent.json + settings.local.json(model) |
| 模型參數 | maxTokens, maxThinkingTokens, maxTurns, permissionMode | agent.json |
| 工具 | permissions.allow (tag/chip UI), mcpConfigFile | settings.local.json + agent.json |
| 群組協作 | delegation (inbound/outbound), initiative (enabled/mode/cooldown/maxPerHour) | agent.json |

## Capabilities

- Dashboard 可完整管理 Agent 所有設定，無需手動編輯設定檔
- 設定檔所有權清晰，不會互相覆蓋
- settings.local.json 採用 merge 式更新，保留 SDK 自己寫入的其他欄位
