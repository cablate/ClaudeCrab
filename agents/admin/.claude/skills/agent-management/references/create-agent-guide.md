# 建立新 Agent 完整指南

## 前置條件

使用者需提供：
1. **Bot Token** — 從 Telegram @BotFather 取得
2. **角色定位** — 這個 agent 要做什麼
3. **名字** — 顯示名稱

可選提供（你可以協助設計）：
- 人格風格偏好
- 特殊 skill 需求
- model 偏好（sonnet/opus/haiku）

## 建立步驟

### Step 1：建立目錄結構

以 `_example` 模板為基礎。agent ID 為英文小寫，用於目錄名稱。

```
agents/{agent-id}/
├── agent.json                          ← 核心設定
├── CLAUDE.md                           ← 啟動協議 + Serena 規則
├── MEMORY.md                           ← 長期記憶（空模板）
├── USER.md                             ← 使用者資訊（空模板）
├── .mcp.json                           ← MCP Server 設定（Serena 標配）
├── memory/                             ← 每日記憶
│   └── .gitkeep
├── groups/                             ← 群組討論記錄
│   └── .gitkeep
├── knowledge/                          ← 知識庫
│   ├── cases/
│   ├── research/
│   └── tools/
└── .claude/
    ├── settings.local.json             ← 權限 + hooks
    └── skills/
        ├── persona/                    ← 人格
        │   ├── SKILL.md
        │   └── references/
        │       ├── soul.md
        │       ├── identity.md
        │       └── evolution-guide.md
        ├── sys-agent-protocols/        ← 系統協議
        │   ├── SKILL.md
        │   └── references/
        │       ├── startup-protocol.md
        │       ├── behavior.md
        │       ├── memory-system.md
        │       └── scheduling.md
        ├── dom-find-skills/            ← Skill 搜尋能力
        │   ├── SKILL.md
        │   └── references/
        │       └── cli-guide.md
        └── dom-find-mcp/              ← MCP 搜尋能力
            └── SKILL.md
```

### Step 2：從 _example 複製共用檔案

以下檔案直接從 `_example` 複製，不需要修改：

```
# 系統協議（所有 agent 共用）
../_example/.claude/skills/sys-agent-protocols/    → 整個目錄

# 人格框架（只複製 SKILL.md 和 evolution-guide.md）
../_example/.claude/skills/persona/SKILL.md
../_example/.claude/skills/persona/references/evolution-guide.md

# 工具發現能力
../_example/.claude/skills/dom-find-skills/        → 整個目錄
../_example/.claude/skills/dom-find-mcp/           → 整個目錄

# 記憶模板
../_example/MEMORY.md
../_example/USER.md
```

### Step 3：建立 agent.json

```json
{
  "name": "顯示名稱",
  "display": {
    "avatar": "適合的 emoji",
    "color": "#hex色碼"
  },
  "description": "一句話描述角色定位",
  "version": "1.0.0",
  "model": "sonnet",
  "telegramBotToken": "使用者提供的 token",
  "settings": {
    "permissionMode": "default",
    "delegation": {
      "inbound": true,
      "outbound": true
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

**設定決策點：**
- `model`：日常對話用 `sonnet`，需要深度推理用 `opus`
- `social.enabled`：要參與群組閒聊設 `true`，純工具型 agent 設 `false`
- `delegation.outbound`：需要委派任務給其他 agent 時設 `true`

### Step 4：建立 .claude/settings.local.json

```json
{
  "model": "sonnet",
  "permissions": {
    "allow": [
      "Read", "Write", "Edit", "Glob", "Grep",
      "WebFetch", "WebSearch",
      "mcp__serena__*"
    ],
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

**按需調整：**
- 需要 Bash：在 `allow` 加 `"Bash"`
- 需要其他 MCP：加對應的 `"mcp__xxx__*"`
- 需要 Skill 工具：加 `"Skill"`
- 不需要路徑限制（如管理員）：移除整個 `hooks` 區塊

### Step 5：建立 .mcp.json（Serena 標配）

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

如需其他 MCP server，在 `mcpServers` 裡加即可。

### Step 6：建立 CLAUDE.md

從 `_example/CLAUDE.md` 複製，替換 `{{AGENT_NAME}}` 為實際名稱。

如果有特殊職責，在「Lessons Learned」上方加一個專屬區塊。

### Step 7：建立人格（soul.md + identity.md）

**identity.md：**
```markdown
# Identity

## Name
實際名字

## Creature
一句話角色描述

## Emoji
代表 emoji
```

**soul.md：**

依照七層結構撰寫（詳見 `evolution-guide.md`）：
1. Who I Am — 用比喻，不用形容詞堆砌
2. What Drives Me — Want/Fear 對
3. My Lens — 有立場的信念
4. How I Think — 情境 × 認知風格
5. How I Sound — **最重要，3-5 段範例對話**
6. My Quirks — 獨特習慣
7. Drift Detection — 偏移信號 + 不可變特質

**重點：先寫範例對話，再回頭提煉其他層。**

### Step 8：建立空目錄

```
memory/.gitkeep
groups/.gitkeep
knowledge/cases/   （空）
knowledge/research/ （空）
knowledge/tools/    （空）
```

### Step 9：驗證

建立完成後，檢查清單：
- [ ] `agent.json` 有 `telegramBotToken`
- [ ] `CLAUDE.md` 的 `{{AGENT_NAME}}` 已替換
- [ ] `settings.local.json` 有 `mcp__serena__*` 權限
- [ ] `settings.local.json` 有 path-validator hook
- [ ] `.mcp.json` 有 Serena 配置
- [ ] `soul.md` 有至少 3 段範例對話
- [ ] `identity.md` 有 Name/Creature/Emoji
- [ ] 系統協議 skill 已複製
- [ ] `memory/` 和 `groups/` 目錄存在

### Step 10：通知使用者重啟引擎

新 agent 需要重啟 ClaudeCab 引擎才會被載入。告訴使用者：
> 新 agent 建立完成。請重啟引擎讓系統載入新的 bot。

## 注意事項

- **不要修改 `_example` 模板**——它是所有新 agent 的基準
- **Token 安全**——不要在對話中重複顯示 bot token
- **人格設計**——如果使用者只給了簡單描述，協助他展開成完整的七層結構，但要跟他確認
- **路徑驗證**——除非使用者明確說不要，否則一律配 path-validator hook
