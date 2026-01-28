## ClaudeCab 專案

使用 `/claudecab` skill 進行所有專案相關操作：
- **開發前**：先載入 skill 了解架構與現況
- **開發後**：若有變更，透過 skill 更新 `references/` 對應文件
- **發現落差**：若 skill 內容與專案現況不符，立即更新 skill 進行對齊

---

## MANDATORY: 程式碼操作必須使用 Serena MCP

<STRICTLY_IMPORTANT>
所有程式碼搜尋、閱讀、編輯，**必須優先使用 Serena 工具**（`mcp__plugin_serena_serena__*`）。
如果你的工具列表中沒有 Serena 工具，請立即告知使用者：「本專案需要 Serena MCP plugin，請執行 /plugin 安裝 serena@claude-plugins-official 後重啟 Claude Code。」
</STRICTLY_IMPORTANT>

**Serena 工具對照：**
- 找 symbol → `find_symbol`（非 Grep）
- 看檔案結構 → `get_symbols_overview`（非 Read 整檔）
- 看 method 內容 → `find_symbol` + `include_body=true`
- 追蹤引用 → `find_referencing_symbols`
- 搜尋 pattern → `search_for_pattern`
- 編輯 → `replace_content` / `replace_symbol_body`
- 插入 → `insert_after_symbol` / `insert_before_symbol`
- 重新命名 → `rename_symbol`（自動全 codebase 更新）

**啟動：** 每次對話開始先用 `activate_project` 啟動當前工作目錄的專案