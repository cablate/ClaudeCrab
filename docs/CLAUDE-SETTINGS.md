# Agent 的 `.claude` 設定指引

ClaudeCab 把每個 `agents/<id>/` 當成一個獨立 Claude Code 專案。Claude Code（`claude-agent-sdk`）會以該目錄為工作目錄，讀取底下的 `.claude/` 設定。本文說明 ClaudeCab 會用到哪些設定，以及去哪裡查完整 schema。

> 如果你是要部署 ClaudeCab 的 AI assistant：**先讀本節，再動設定。**

## 給 AI 的首要規則

`.claude/settings.local.json`、permissions 規則語法、可用 model 名稱、MCP server 設定的**完整 schema 以 Claude Code 官方文件為唯一事實來源**。這些 schema 會隨 Claude Code 版本演進，**不要憑訓練記憶猜欄位或語法**——設定前先查：

| 主題 | 官方文件 |
|---|---|
| settings 階層與所有欄位 | https://code.claude.com/docs/en/settings |
| permissions 規則與工具名 | https://code.claude.com/docs/en/permissions |
| permission mode（default / acceptEdits / plan / bypassPermissions） | https://code.claude.com/docs/en/permission-modes |
| MCP server 設定 | https://code.claude.com/docs/en/mcp |

如果上述連結已搬移，從 https://code.claude.com/docs 進入找對應頁面。

## ClaudeCab 實際依賴的欄位

ClaudeCab 只會主動讀取並組裝以下欄位，其餘欄位原汁原味透傳給 Claude Code（標準 Claude Code 行為，行為細節查官方文件）：

| 欄位 | ClaudeCab 用途 |
|---|---|
| `model` | 組裝進 SDK session，決定 agent 用的模型。 |
| `env.ANTHROPIC_API_KEY` / `env.ANTHROPIC_AUTH_TOKEN` | provider 認證；agent 層優先於全域 `.env`。 |
| `env.ANTHROPIC_BASE_URL` | 第三方 proxy / Anthropic-compatible provider 端點。OAuth 模式不要設。 |
| `permissions.allow` / `permissions.deny` | 直接透傳 Claude Code，控制 agent 可用的工具。 |

> `agent.json` 不再放 `model`、`allowedTools`、`systemPrompt` 等 runtime 欄位；這些一律放 `.claude/settings.local.json`，避免同一個 agent 有兩個互相覆蓋的來源。`npm run setup:check` 會把殘留在 `agent.json` 的這些欄位視為錯誤。

## settings.local.json 範例（含說明）

下列是常見設定組合。`_comment` 欄位僅供閱讀，**實際檔案不需要**；Claude Code 對未知欄位寬容，但保持檔案乾淨比較好維護。

```json
{
  "model": "sonnet",
  "permissions": {
    "allow": [
      "Read",
      "Edit",
      "Bash(npm run test:*)"
    ],
    "deny": [
      "Bash(rm -rf:*)"
    ]
  },
  "env": {
    "ANTHROPIC_API_KEY": "your-provider-key",
    "ANTHROPIC_BASE_URL": "https://your-provider-endpoint"
  }
}
```

重點：

- `model` 可用簡稱（`sonnet` / `opus` / `haiku`）或完整 model id；可用值與最新名稱以官方文件為準。
- `permissions.allow` / `deny` 的**規則語法（工具名、萬用字元、`Tool(specifier)` 寫法）查** https://code.claude.com/docs/en/permissions —— 不要用猜的，規則寫錯會讓工具被靜默擋掉或放行。
- `env` 放 provider 需要的 `ANTHROPIC_*` 變數；`ANTHROPIC_API_KEY` 與 `ANTHROPIC_AUTH_TOKEN` 擇一，**不要同時填**。
- 使用 Claude Code OAuth / 訂閱時，`env` 整個留空（或只留非認證變數），由主機 `claude login` 提供憑證。

## 變更後是否重啟

改 `model` 或 `env` 後，既有 SDK session 不會自動套用新值。請透過 admin console 關閉該 session，或重啟 ClaudeCab 後再測。`permissions` 即時生效（由 Claude Code 處理）。

## `.mcp.json`

`agents/<id>/.mcp.json` 用來讓這個 agent 額外掛 MCP server。ClaudeCab 核心只內建 `file-send` MCP tool；其他 MCP server 的**設定格式與傳輸方式（stdio / SSE / HTTP）查官方文件**：

https://code.claude.com/docs/en/mcp

空的最小範例（不掛任何額外 server）：

```json
{
  "mcpServers": {}
}
```

## 相關文件

- [docs/SETUP.md](SETUP.md) — 認證模式與 provider 設定的完整步驟。
- [.claude/skills/claudecab-deploy/references/config-matrix.md](../.claude/skills/claudecab-deploy/references/config-matrix.md) — 設定欄位速查與重啟規則。
- [docs/SDK_TOUCHPOINTS.md](SDK_TOUCHPOINTS.md) — 動 SDK / settings 程式碼前必讀（開發者用）。
