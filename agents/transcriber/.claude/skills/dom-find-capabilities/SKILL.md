---
name: find-capabilities
description: |
  協助使用者發現和安裝新能力——MCP servers 或 Agent Skills。
  觸發情境：「如何讓你能做 X」、「有沒有工具可以...」、「找一個能做 Y 的」、「你可以做 X 嗎」（X 是特定專業能力）、想擴展 Agent 能力。
  主動更新時機：MCP 或 Skills 生態系統有變動時更新。
---

# Find Capabilities

擴展 Agent 能力的兩種方式：MCP Servers（外部工具連接）和 Agent Skills（專業知識包）。

---

## 一、MCP Servers

MCP (Model Context Protocol) 讓 AI Agent 連接外部工具——操作瀏覽器、存取檔案、呼叫 API、連接資料庫等。

### 如何發現

- https://mcpservers.org — MCP Servers 目錄
- https://github.com/punkpeye/awesome-mcp-servers — GitHub 精選列表
- https://github.com/modelcontextprotocol/servers — 官方 servers 列表

### 如何安裝

**Remote HTTP（推薦）：**
```bash
claude mcp add --transport http <name> <url>
# 範例：claude mcp add --transport http notion https://mcp.notion.com/mcp
# 帶認證：claude mcp add --transport http api https://api.example.com/mcp --header "Authorization: Bearer token"
```

**Remote SSE：**
```bash
claude mcp add --transport sse <name> <url>
```

**Local Stdio：**
```bash
claude mcp add --transport stdio --env KEY=VALUE <name> -- <command> [args...]
```

**重要**：所有選項（`--transport`、`--env`、`--scope`）必須在 server 名稱**之前**。

### 常見 MCP Servers

| 類別 | Server | 安裝指令 |
|------|--------|----------|
| 版本控制 | GitHub | `claude mcp add --transport http github https://api.githubcopilot.com/mcp/` |
| 監控 | Sentry | `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` |
| 搜尋 | Brave | `claude mcp add --transport stdio brave-search --env BRAVE_API_KEY=key -- npx -y @anthropic-ai/mcp-server-brave-search` |
| 瀏覽器 | Playwright | `claude mcp add --transport stdio playwright -- npx -y @anthropic-ai/mcp-server-playwright` |
| 資料庫 | PostgreSQL | `claude mcp add --transport stdio db -- npx -y @bytebase/dbhub --dsn "postgresql://..."` |

### 安裝範圍

| Scope | 說明 |
|-------|------|
| `local`（預設） | 只在當前專案可用 |
| `project` | 存在 `.mcp.json`，可進版控 |
| `user` | 跨所有專案可用 |

### OAuth 認證

許多雲端 MCP 需要 OAuth：先加入 server → 在 Claude Code 中 `/mcp` → 選擇 server → 瀏覽器完成登入。

### Windows 注意事項

Windows 上 `npx` 必須加 `cmd /c` 包裝：
```bash
claude mcp add --transport stdio my-server -- cmd /c npx -y @some/package
```

### 管理指令

```bash
claude mcp list          # 列出所有 servers
claude mcp get <name>    # 查看詳情
claude mcp remove <name> # 移除 server
/mcp                     # 在 Claude Code 中檢查狀態
```

---

## 二、Agent Skills

從開放的 Agent Skills 生態系統搜尋和安裝專業知識包。

<STRICTLY_IMPORTANT>
**不編造，先搜後答。**
所有 skill 資訊必須來自 `npx skills find` 的實際輸出或 https://skills.sh/。
沒有執行搜尋就不要列出任何 skills。
</STRICTLY_IMPORTANT>

### 如何發現

```bash
npx skills find [query]
```

範例：
- 「React 效能」→ `npx skills find react performance`
- 「幫我審 PR」→ `npx skills find pr review`

### 如何安裝

```bash
npx skills add <owner/repo@skill> -y
```

安裝到當前工作目錄的 `.claude/skills/`，只有這個 agent 能用。

### 常見類別

| 類別 | 搜尋關鍵字 |
|------|------------|
| 網頁開發 | react, nextjs, typescript, tailwind |
| 測試 | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| 程式碼品質 | review, lint, refactor, best-practices |

### 管理指令

```bash
npx skills check   # 檢查更新
npx skills update  # 更新所有 skills
```

### 找不到時

1. 誠實說明沒找到
2. 提議用通用能力直接協助
3. 建議自建：`npx skills init my-skill`

詳細 CLI 操作指南見 [cli-guide.md](references/cli-guide.md)。

---

## 相關資源

- [Claude Code MCP 官方文檔](https://code.claude.com/docs/en/mcp)
- [MCP 官方網站](https://modelcontextprotocol.io)
- [Skills 目錄](https://skills.sh/)
- [MCP Servers 目錄](https://mcpservers.org)
