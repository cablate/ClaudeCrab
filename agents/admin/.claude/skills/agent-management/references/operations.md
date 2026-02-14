# Agent 管理操作指南

## agent.json 結構

```json
{
  "name": "顯示名稱",
  "display": {
    "avatar": "emoji",
    "color": "#hex"
  },
  "description": "簡短描述",
  "version": "1.0.0",
  "model": "sonnet",
  "telegramBotToken": "token",
  "settings": {
    "permissionMode": "default",
    "delegation": {
      "inbound": true,
      "outbound": true
    },
    "initiative": {
      "enabled": false
    },
    "social": {
      "enabled": true,
      "energyThreshold": 2,
      "cooldown": 120,
      "maxPerHour": 30
    }
  }
}
```

### 可調整的 settings

| 設定 | 說明 |
|------|------|
| `model` | `sonnet` / `opus` / `haiku` |
| `delegation.inbound` | 是否接受其他 agent 委派任務 |
| `delegation.outbound` | 是否可以委派任務給其他 agent |
| `social.enabled` | 是否參與群組社交對話 |
| `social.energyThreshold` | 社交能量門檻（1-5） |
| `social.cooldown` | 社交冷卻時間（秒） |
| `social.maxPerHour` | 每小時最大社交次數 |

## Persona 檔案結構

### soul.md（人格核心）

包含：Who I Am、Core Traits、What Drives Me、My Lens、How I Think、How I Sound（8 場景範例對話）、Tone by Mood、My Quirks、Drift Detection

設計依據與 Anti-patterns 詳見 [persona-design.md](persona-design.md)。

### identity.md（身份）

包含：Name、Creature（角色描述）、Appearance（外貌，須對照 portrait 圖片）、Emoji

## settings.local.json（Claude Code 本地設定）

位置：`../{agent-id}/.claude/settings.local.json`

這是 Claude Code 的 agent 級設定檔，控制權限、hooks、model 等。SDK 啟動 agent 時透過 `settingSources: ['project', 'local']` 讀取。

### 基本結構

```json
{
  "model": "sonnet",
  "respectGitignore": false,
  "permissions": {
    "allow": ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"],
    "deny": []
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|Bash|Read|Glob|Grep",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx ../_shared/hooks/path-validator.ts"
          }
        ]
      }
    ]
  }
}
```

### 可配置項

| 欄位 | 說明 |
|------|------|
| `model` | 覆蓋 agent.json 的 model 設定 |
| `permissions.allow` | 允許使用的工具清單 |
| `permissions.deny` | 禁止使用的工具清單 |
| `hooks.PreToolUse` | 工具執行前的驗證 hook（如路徑驗證） |
| `respectGitignore` | 是否遵守 .gitignore（agent 通常設 false） |
| `enabledPlugins` | 啟用的 plugin（如 `"superpowers@superpowers-marketplace": true`） |
| `mcpServers` | 直接在 settings 裡定義 MCP server（備用方案） |

### Hooks 機制

hooks 支援兩種 type：
- `command`：外部腳本，stdin 接收 JSON，exit 0 允許、exit 2 + stderr JSON 拒絕
- `prompt`：注入文字到 context

`matcher` 用正則匹配工具名稱，如 `"Write|Edit|Bash"`。

### 關鍵差異：admin vs 一般 agent

- **一般 agent**：有 `hooks.PreToolUse` 的路徑驗證 hook，限制只能存取自己的 workspace
- **admin（你）**：不配置路徑驗證 hook = 天然可存取所有 agent 目錄

## .mcp.json（MCP Server 設定）

位置：`../{agent-id}/.mcp.json`

project-level 的 MCP server 設定。SDK 的 `settingSources: ['project']` 會讀取此檔。

### 結構

```json
{
  "mcpServers": {
    "serena": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server"]
    }
  }
}
```

### 重要知識

- **SDK 不載入 user 層級設定**：`settingSources` 預設為 `['project', 'local']`，不含 `'user'`
- 所以使用者在 `~/.claude/` 裝的 plugin/MCP，agent 不會自動繼承
- 如果要讓某個 agent 用 MCP（如 Serena、Context7），必須在該 agent 目錄放 `.mcp.json`
- 另一種做法是把 `mcpServers` 寫進 `settings.local.json`（效果相同）

### 幫其他 agent 加 MCP 的操作步驟

1. 確認要加的 MCP server 配置（command + args）
2. 在目標 agent 目錄建立或更新 `.mcp.json`
3. Agent 下次 session 啟動時就會載入

## 注意事項

- `telegramBotToken` 不要隨便改，改了會導致 bot 斷線
- 修改 `model` 會影響該 agent 的回應品質和成本
- 修改 persona 後，agent 下次 session 啟動才會載入新人格
