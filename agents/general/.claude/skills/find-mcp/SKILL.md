---
name: find-mcp
description: 協助使用者發現、安裝、配置 MCP servers。當使用者詢問「如何讓你能做 X」、「有沒有 MCP 可以...」、「怎麼連接 X 服務」時觸發此 skill。
---

# Find MCP Servers

協助使用者發現和配置 MCP (Model Context Protocol) servers，擴展 Agent 能力。

## 何時使用此 Skill

當使用者：
- 詢問「如何讓你能做 X」（X 可能需要外部工具）
- 說「有沒有 MCP 可以...」或「找一個能做 X 的工具」
- 想連接外部服務（GitHub、Slack、資料庫等）
- 詢問如何擴展 Agent 能力

## MCP 是什麼？

MCP (Model Context Protocol) 是讓 AI Agent 連接外部工具的開放標準。透過 MCP servers，Agent 可以操作瀏覽器、存取檔案、呼叫 API、連接資料庫等。

## 如何發現 MCP Servers

### 1. 官方 MCP 註冊表

Anthropic 提供官方 MCP 註冊表 API：
```
https://api.anthropic.com/mcp-registry/docs
```

### 2. 瀏覽社群資源

- https://mcpservers.org - MCP Servers 目錄
- https://github.com/punkpeye/awesome-mcp-servers - GitHub 精選列表
- https://github.com/modelcontextprotocol/servers - 官方 servers 列表

## 如何安裝 MCP Server

### 方法一：Remote HTTP Server（推薦）

```bash
# 基本語法
claude mcp add --transport http <name> <url>

# 範例：連接 Notion
claude mcp add --transport http notion https://mcp.notion.com/mcp

# 帶認證 Header
claude mcp add --transport http secure-api https://api.example.com/mcp \
  --header "Authorization: Bearer your-token"
```

### 方法二：Remote SSE Server

```bash
# 基本語法
claude mcp add --transport sse <name> <url>

# 範例：連接 Asana
claude mcp add --transport sse asana https://mcp.asana.com/sse
```

### 方法三：Local Stdio Server

```bash
# 基本語法
claude mcp add [options] <name> -- <command> [args...]

# 範例：加入 Airtable server
claude mcp add --transport stdio --env AIRTABLE_API_KEY=YOUR_KEY airtable \
  -- npx -y airtable-mcp-server
```

**重要：選項順序**
- 所有選項（`--transport`、`--env`、`--scope`）必須在 server 名稱**之前**
- `--` 分隔 server 名稱和要執行的命令

## 常見 MCP Servers 安裝指令

### GitHub
```bash
claude mcp add --transport http github https://api.githubcopilot.com/mcp/
# 然後用 /mcp 進行 OAuth 認證
```

### Sentry（錯誤監控）
```bash
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp
```

### PostgreSQL
```bash
claude mcp add --transport stdio db -- npx -y @bytebase/dbhub \
  --dsn "postgresql://user:pass@host:5432/dbname"
```

### Brave Search
```bash
claude mcp add --transport stdio brave-search \
  --env BRAVE_API_KEY=your-key \
  -- npx -y @anthropic-ai/mcp-server-brave-search
```

### Playwright（瀏覽器自動化）
```bash
claude mcp add --transport stdio playwright -- npx -y @anthropic-ai/mcp-server-playwright
```

## 管理 MCP Servers

```bash
# 列出所有已配置的 servers
claude mcp list

# 查看特定 server 詳情
claude mcp get github

# 移除 server
claude mcp remove github

# 在 Claude Code 中檢查狀態
/mcp
```

## 安裝範圍（Scope）

| Scope | 說明 | 使用時機 |
|-------|------|----------|
| `local` | 只在當前專案可用（預設） | 專案專用配置 |
| `project` | 存在 `.mcp.json`，可進版控 | 團隊共用 |
| `user` | 跨所有專案可用 | 個人常用工具 |

```bash
# 指定範圍
claude mcp add --scope user --transport http github https://api.githubcopilot.com/mcp/
```

## OAuth 認證

許多雲端 MCP servers 需要 OAuth 認證：

1. 先加入 server
2. 在 Claude Code 中輸入 `/mcp`
3. 選擇要認證的 server
4. 在瀏覽器完成登入

## Windows 注意事項

Windows 上使用 `npx` 必須加上 `cmd /c` 包裝：

```bash
claude mcp add --transport stdio my-server -- cmd /c npx -y @some/package
```

否則會遇到 "Connection closed" 錯誤。

## 疑難排解

### MCP Server 沒有載入
1. 用 `claude mcp list` 確認已加入
2. 用 `/mcp` 檢查連線狀態
3. 確認環境變數已設定

### OAuth 認證失敗
1. 用 `/mcp` 清除認證後重試
2. 確認瀏覽器可以開啟認證頁面

### 找不到適合的 MCP
1. 到 [mcpservers.org](https://mcpservers.org) 搜尋
2. 用 WebSearch 搜尋 "MCP server for X"
3. 考慮用 `mcp-builder` skill 自己建立

## 分類索引

| 類別 | 常見 MCP Servers |
|------|------------------|
| **版本控制** | github, gitlab |
| **專案管理** | linear, jira, asana, notion |
| **通訊** | slack, discord |
| **資料庫** | postgres, sqlite, mongodb |
| **搜尋** | brave-search, exa |
| **監控** | sentry |
| **瀏覽器** | playwright |
| **檔案** | filesystem, google-drive |

## 相關資源

- [Claude Code MCP 官方文檔](https://code.claude.com/docs/en/mcp)
- [MCP 官方網站](https://modelcontextprotocol.io)
- [MCP Servers 目錄](https://mcpservers.org)
- [Awesome MCP Servers](https://github.com/punkpeye/awesome-mcp-servers)
