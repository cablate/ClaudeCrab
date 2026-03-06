# 設計：Dashboard 完整設定管理

## Decisions

### 設定檔所有權分離

| 檔案 | 所有者 | Dashboard 操作 |
|------|--------|---------------|
| `agent.json` | ClaudeCab 框架 | 讀寫 Agent 層級設定 |
| `.claude/settings.local.json` | Claude SDK | 讀寫 SDK 管理的設定 |
| `CLAUDE.md` | 使用者 / Agent Detail 頁 | Dashboard Edit 不涉入 |

### permissions.allow 屬於 settings.local.json

SDK 會在 runtime 動態修改此檔案（使用者核准工具時自動寫入）。Dashboard 讀取完整清單顯示，儲存時寫回同一檔案。UI 使用 tag/chip 列表，支援逐一刪除與新增，涵蓋 MCP 工具及自訂工具。

### agent.json 不干預 SDK 層級工具控制

`allowedTools` / `disallowedTools` 雖在 agent.json schema 有定義且 ConfigTransformer 有串接，但從 Dashboard UI 移除，避免 agent.json 覆蓋 SDK 層級的工具權限造成混淆。手動編輯 agent.json 仍可使用這些欄位。

### systemPrompt / systemPromptFile 不進 Dashboard Edit

`loadSystemPrompt()` 優先順序：agent.json systemPrompt → systemPromptFile → CLAUDE.md。CLAUDE.md 已在 Agent Detail 頁面可直接編輯，在 Dashboard Edit 再提供 systemPrompt 輸入會造成重疊與優先級困惑。

### EJS 模板注意事項

Script block 中輸出 JSON 必須用 `<%- %>` (raw output)，不可用 `<%= %>` (HTML-encoded)。`<%= JSON.stringify(data) %>` 會將 `"` 轉為 `&quot;` 導致 JS parse error。

### settings.local.json 寫入策略

讀取現有 → 合併變更 → 寫回。不會覆蓋整個檔案，而是 merge 式更新，保留 SDK 自己寫入的其他欄位。

## Risks / Trade-offs

- 設定分散在多個檔案（agent.json + settings.local.json + CLAUDE.md），是 Claude Code SDK 的本質限制
- Schema 有定義但 runtime 未串接的欄位（`maxBudgetUsd`、`maxHistoryLength`）暫不進 UI，待 SDK 確認支援後再串接

## Affected Components

- Dashboard Edit 頁面 EJS 模板
- Dashboard 路由（讀寫 agent.json 和 settings.local.json）
- `agent.json` — Agent 層級設定
- `.claude/settings.local.json` — SDK 層級設定
