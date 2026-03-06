# Tasks

## Phase 1：基礎能力
- [x] SDK 自動從 `.mcp.json` 讀取 MCP 配置（v1.9.0）
- [x] 配置檔從 `mcp.json` 改為 `.mcp.json`（v1.9.0）
- [x] SDK 自動從 `.claude/skills/` 載入 Skills
- [x] 確保 `"Skill"` 在 settings.local.json 的 allow 清單（v1.9.0）
- [x] 提供 capability-discovery skill
- [x] WebUI Skills 管理頁面：列出、上傳、編輯、刪除、預覽（v1.9.0）

## Phase 2：進階能力
- [x] 建立 `src/tools/` 目錄（已有 notifyAgentTool、sendFileTool、ttsTool）
- [x] 整合 In-Process Tools 到 SDKQueryManager（McpToolSetup → MessageProcessor → SDKQueryManager 管線已完成）
- [ ] 實作 memory search tool
- [ ] 實作 schedule reminder tool