# Agent 管理操作指南

## 目錄結構慣例

| 目錄 | 用途 |
|------|------|
| `_example/` | 新員工範本，包含所有員工預設應具備的 Skill |
| `_example/.claude/skills/` | 通用 Skill（如 sys-role-boundary、sys-self-evolution） |
| `{agent-id}/` | 各員工的獨立目錄 |
| `{agent-id}/.claude/skills/` | 該員工專屬或被賦予的 Skill |

**重要**：通用的員工預設 Skill 放在 `_example/.claude/skills/`，不是 `_shared/`。

---

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

### 特定 Agent 的專案白名單

**情境**：某個 agent 需要存取 `agents/` 外部的特定專案（如 Coder 存取金流專案），但不能破壞其他 agent 的隔離。

**解決方案**：為該 agent 建立專屬 path validator（取代共用 validator）

#### 步驟

1. **建立專屬 validator**：`agents/{agent-id}/.claude/hooks/project-whitelist.ts`
   ```typescript
   // 在 ALLOWED_PROJECTS 加入白名單路徑
   const ALLOWED_PROJECTS = [
     'E:\\TargetProject\\Path',
   ];
   
   // 整合標準 path-validator 邏輯
   // 白名單優先：匹配即允許，不匹配才走標準檢查
   ```

2. **更新 settings.local.json**：把 hook 從共用 validator 改為專屬 validator
   ```json
   "hooks": {
     "PreToolUse": [{
       "matcher": "Write|Edit|Bash|Read|Glob|Grep",
       "hooks": [{
         "type": "command",
         "command": "npx tsx ./.claude/hooks/project-whitelist.ts"
       }]
     }]
   }
   ```

3. **驗證**：該 agent 可存取白名單專案，其他 agent 不受影響

#### 模板

完整的 `project-whitelist.ts` 模板見 `agents/coder/.claude/hooks/project-whitelist.ts`（2026-02-19 實作）。

#### 設計原則

- **Per-agent 配置**：路徑權限應該 per-agent 配置，不要在全局 validator 加例外
- **白名單優於多重 hook**：專屬 validator（內建白名單 + 標準邏輯）比 hook chain 更穩定

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

## 員工自我演化機制

### 設計背景與決策脈絡

**問題起源**（2026-02-20）：

發現 Coder 建立了 `dom-engineering-wisdom` skill，嘗試用一個「Wisdom 容器」集中累積所有可複用的經驗。管理者（Admin）也跟進建立了 `dom-management-wisdom`。

**發現的問題**：

Wisdom 容器把太多東西混在一起：
- 方法論（How to do）
- 業務知識（What is）
- 經驗記錄（What happened）

這導致：
1. **邊界模糊**：不知道該更新到 Wisdom 還是獨立 Skill
2. **違反單一職責**：一個容器承載太多種類的知識
3. **無法複製**：Wisdom 是員工專屬的，好的知識無法直接給其他人
4. **跨領域重疊**：行銷手法該放在誰的 Wisdom？

**最終決策**：

取消「Wisdom 容器」概念，改為：

1. **通用的自我演化原則 Skill**（`sys-self-evolution`）
   - 教會員工：什麼時候該記錄、記錄到哪裡
   - 所有員工都載入這個 Skill

2. **知識就地歸屬**
   - 學到新東西 → 找有沒有既有的 Skill 可以放
   - 有 → 更新那個 Skill
   - 沒有 → 建立新的獨立 Skill

3. **管理者追蹤**
   - 定期掃描員工的變更
   - 決定是否同步給其他人
   - 決定是否提升為公共 Skill

### 自我演化原則

員工在工作中學到新東西時：

```
1. 判斷：這個知識未來會重複用到嗎？
   └── 否 → 不記錄（或只記到當日 memory）
   └── 是 → 繼續

2. 找歸屬：有沒有既有的 Skill 適合放這個知識？
   └── 有 → 更新那個 Skill
   └── 沒有 → 建立新的獨立 Skill

3. 通知：記錄到 changelog 或通知管理者
```

### 知識分類原則

| 類型 | 去處 | 例子 |
|------|------|------|
| 業務知識（What） | 獨立 Knowledge Skill | `knowledge-ecpay-invoice` |
| 方法論（How） | 獨立 Method Skill | `method-api-integration` |
| 專案決策 | 專案 Skill | `proj-cablate-architecture` |
| 操作記錄 | Memory / Changelog | 當日做了什麼 |

### 為什麼不用 Wisdom 容器

| Wisdom 容器的問題 | 就地歸屬的優點 |
|-------------------|----------------|
| 什麼都往裡面丟，邊界模糊 | 每個 Skill 有明確範圍 |
| 員工專屬，無法複製 | 獨立 Skill 可以給其他人 |
| 管理者難追蹤 | 新 Skill 建立 = 明確事件 |
| 跨領域知識不知放哪 | 跨領域就建跨領域的 Skill |

### 管理者的工作

1. **定期掃描**：檢視各員工新建或更新的 Skill
2. **同步判斷**：這個知識其他人需要嗎？
3. **品質把關**：Skill 設計符合標準嗎？
4. **歸屬調整**：放錯地方的知識協助搬遷

## 注意事項

- `telegramBotToken` 不要隨便改，改了會導致 bot 斷線
- 修改 `model` 會影響該 agent 的回應品質和成本
- 修改 persona 後，agent 下次 session 啟動才會載入新人格
