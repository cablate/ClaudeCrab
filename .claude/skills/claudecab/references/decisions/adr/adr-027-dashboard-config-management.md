# ADR-027: Dashboard 完整設定管理

**狀態**：✅ implemented
**日期**：2026-02-06
**相關**：ADR-002, ADR-022, ADR-023

---

## 背景

Dashboard 原本的 Agent 編輯頁面只支援基本資訊（名稱、描述、模型、Telegram Token），
無法涵蓋 v1.22.0 以後新增的群組協作、委派、主動互動等功能設定。
使用者需要手動編輯 `agent.json`、`settings.local.json`、`.env` 才能完整配置 Agent。

## 核心決策：設定檔所有權分離

### 原則

| 檔案 | 所有者 | Dashboard 操作 |
|------|--------|---------------|
| `agent.json` | ClaudeCab 框架 | 讀寫 Agent 層級設定（名稱、描述、model params、delegation、initiative、mcpConfigFile） |
| `.claude/settings.local.json` | Claude SDK | 讀寫 SDK 管理的設定（permissions.allow、model） |
| `CLAUDE.md` | 使用者 / Agent Detail 頁 | Dashboard Edit **不涉入**，由 Detail 頁單獨管理 |

### 關鍵決策

1. **permissions.allow 屬於 settings.local.json**
   - SDK 會在 runtime 動態修改此檔案（使用者核准工具時自動寫入）
   - Dashboard 讀取完整清單顯示，儲存時寫回同一檔案
   - UI 使用 tag/chip 列表，支援逐一刪除與新增，涵蓋 MCP 工具及自訂工具

2. **agent.json 不應干預 SDK 層級的工具控制**
   - `allowedTools` / `disallowedTools` 雖在 agent.json schema 有定義且 ConfigTransformer 有串接，
     但從 Dashboard UI 移除，避免 agent.json 覆蓋 SDK 層級的工具權限造成混淆
   - 手動編輯 agent.json 仍可使用這些欄位

3. **systemPrompt / systemPromptFile 不進 Dashboard Edit**
   - `loadSystemPrompt()` 優先順序：agent.json systemPrompt → systemPromptFile → CLAUDE.md
   - CLAUDE.md 已在 Agent Detail 頁面可直接編輯
   - 在 Dashboard Edit 再提供 systemPrompt 輸入會造成重疊與優先級困惑

4. **Schema 有定義但 runtime 未串接的欄位不進 UI**
   - 見下方「待串接欄位」章節

## Edit 頁面 Tab 設計

| Tab | 欄位 | 寫入目標 |
|-----|------|---------|
| 基本 | name, description, model, telegramBotToken | agent.json + settings.local.json(model) |
| 模型參數 | maxTokens, maxThinkingTokens, maxTurns, permissionMode | agent.json |
| 工具 | permissions.allow (tag/chip UI), mcpConfigFile | settings.local.json + agent.json |
| 群組協作 | delegation (inbound/outbound), initiative (enabled/mode/cooldown/maxPerHour) | agent.json |

## 待串接欄位（Schema 有定義，Runtime 未使用）

以下欄位在 `AgentSettingsSchema`（`src/types/agent.ts`）有 zod 定義，但 **無任何 runtime 程式碼讀取**，
也不在 `SDKOptions` 介面中。未來若需要可串接至 `ConfigTransformer.toSDKOptions()`。

| 欄位 | Schema 位置 | SDK 支援狀態 | 說明 |
|------|------------|-------------|------|
| `maxBudgetUsd` | `AgentSettingsSchema.maxBudgetUsd` | claude-agent-sdk 未確認 | 預算上限控制，可能需要 SDK 層面的計費 API |
| `maxHistoryLength` | `AgentSettingsSchema.maxHistoryLength` | claude-agent-sdk 未確認 | 對話歷史截斷長度，可能需在 query 時傳入或自行管理 |

### 如何串接（未來參考）

1. 確認 `claude-agent-sdk` 的 query options 是否支援對應參數
2. 若支援：在 `SDKOptions` 介面新增欄位 → `ConfigTransformer.toSDKOptions()` 加入映射
3. 若不支援但仍需要：在 `SessionManager.query()` 或 `AgentLoader` 層自行實作邏輯
4. 串接完成後加入 Dashboard Edit UI

## 技術細節

### EJS 模板注意事項

- Script block 中輸出 JSON 必須用 `<%- %>` (raw output)，不可用 `<%= %>` (HTML-encoded)
- `<%= JSON.stringify(data) %>` 會將 `"` 轉為 `&quot;` 導致 JS parse error

### settings.local.json 寫入策略

```
讀取現有 → 合併變更 → 寫回
```

不會覆蓋整個檔案，而是 merge 式更新，保留 SDK 自己寫入的其他欄位。
