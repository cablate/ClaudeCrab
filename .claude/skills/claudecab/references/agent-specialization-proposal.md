# ClaudeCab Agent 專門化方案設計

> 目標：讓 ClaudeCab 用戶能夠像 Moltbot 一樣，方便地建立專門化 Agent 並配置所需的 plugin/skill/MCP 能力。

## 目錄

1. [現況分析](#現況分析)
2. [技術能力對照](#技術能力對照)
3. [可行方案設計](#可行方案設計)
4. [實作建議與優先順序](#實作建議與優先順序)

---

## 現況分析

### Moltbot 的 Agent 專門化機制

Moltbot 提供了完整的 Agent 專門化生態：

**1. 快速建立 Agent**
```bash
moltbot agents add work
```

**2. 集中配置（`~/.clawdbot/moltbot.json`）**
```json5
{
  agents: {
    list: [
      { id: "home", default: true, workspace: "~/clawd-home" },
      { id: "work", workspace: "~/clawd-work",
        sandbox: { mode: "all" },
        tools: { allow: ["read"], deny: ["exec"] }
      }
    ]
  },
  bindings: [
    { agentId: "home", match: { channel: "telegram", peer: "123" } },
    { agentId: "work", match: { channel: "whatsapp", accountId: "biz" } }
  ]
}
```

**3. Skills Marketplace（ClawdHub）**
- 565+ 社群 skills
- 一鍵安裝：`npx clawdhub@latest install <skill-slug>`
- 優先順序：workspace > local > bundled

**4. SKILL.md 格式（Anthropic 標準）**
```markdown
---
name: code-review
description: Reviews code for best practices
metadata:
  moltbot:
    requires:
      bins: ["npm"]
      env: ["GITHUB_TOKEN"]
---

Instructions here...
```

### Claude Agent SDK 能力

SDK 原生支援的 Options：

| 選項 | 類型 | 說明 |
|------|------|------|
| `mcpServers` | `Record<string, McpServerConfig>` | MCP servers 配置 |
| `plugins` | `SdkPluginConfig[]` | **只支援 local plugins** |
| `skills` | `string[]` | Skill 名稱列表 |
| `agents` | `Record<string, AgentDefinition>` | 自訂 subagents |
| `hooks` | `Partial<Record<HookEvent, ...>>` | Event hooks |

**SDK 限制**：
- Plugins 只能用 `{ type: 'local', path: '...' }` 載入
- 無法像 Moltbot 從 marketplace 動態安裝

### Claude Code CLI 能力（非互動模式）

| Flag | 說明 |
|------|------|
| `--mcp-config <path>` | 載入 MCP servers 配置 |
| `--plugin-dir <path>` | 載入 local plugin 目錄 |
| `--system-prompt <text>` | 自訂 system prompt |
| `--append-system-prompt <text>` | 追加 system prompt |
| `--agents <json>` | 定義 subagents |
| `--allowedTools <tools>` | 允許的工具 |
| `--disallowedTools <tools>` | 禁用的工具 |
| `-p` / `--print` | 非互動模式（SDK 模式）|

**Plugin 安裝指令**：
```bash
# 從 marketplace 安裝
/plugin install plugin-name@marketplace-name

# 從 GitHub 安裝
/plugin marketplace add owner/repo
/plugin install plugin-name@owner-repo
```

### ClaudeCab 現況

| 模組 | 能力 |
|------|------|
| AgentLoader | 載入 `agents/` 目錄，讀取 `agent.json` + `CLAUDE.md` |
| SDKQueryManager | 封裝 SDK 呼叫，支援 `additionalOptions` 傳遞 |
| TelegramAdapter | 每個 agent 一個獨立 Telegram bot |
| 記憶系統 | CLAUDE.md 指令驅動，workspace 檔案儲存 |
| WebUI | Agent 管理、Session 查看、Memory 編輯 |

**現有 AgentConfig schema**：
```typescript
{
  name: string,
  description?: string,
  version?: string,
  model?: string,
  systemPrompt?: string,
  systemPromptFile?: string,
  allowedTools?: string[],
  disallowedTools?: string[],
  mcpConfigFile?: string,  // 已定義但未使用
  telegramBotToken?: string,
  settings?: { maxTurns?: number }
}
```

---

## 技術能力對照

| 功能 | Moltbot | SDK | CLI | ClaudeCab |
|------|---------|-----|-----|-----------|
| **MCP Servers** | 原生 | `mcpServers` | `--mcp-config` | schema 有但未實作 |
| **Skills** | ClawdHub | `skills: string[]` | 自動載入 `.claude/skills/` | 無 |
| **Plugins** | 完整 | `local` only | `/plugin install` | 無 |
| **Subagents** | multi-agent routing | `agents` option | `--agents` | 無（但有多 agent 架構）|
| **Hooks** | 完整 | `hooks` option | hooks.json | 只用 UserPromptSubmit |
| **沙箱隔離** | Docker | 無 | 無 | 無 |
| **Marketplace** | ClawdHub | 無 | `/plugin marketplace` | 無 |

---

## 可行方案設計

### 方案 A：Skills 目錄整合（推薦優先）

**原理**：利用 Claude Code 的 SKILL.md 標準，讓每個 Agent 擁有專屬 skills。

**目錄結構**：
```
agents/research/
├── agent.json
├── CLAUDE.md
├── .claude/
│   └── settings.local.json
└── skills/                      # 新增
    ├── deep-research/
    │   └── SKILL.md
    └── summarize/
        └── SKILL.md
```

**實作步驟**：

1. **AgentLoader 掃描 skills**：
   ```typescript
   // 在載入 agent 時，掃描 skills/ 目錄
   const skillsDir = path.join(agentPath, 'skills');
   const skills = fs.readdirSync(skillsDir)
     .filter(d => fs.existsSync(path.join(skillsDir, d, 'SKILL.md')));
   ```

2. **SDKQueryManager 傳遞 skills**：
   由於 SDK 的 `skills` option 需要 skill 已存在於 Claude Code 的 skills 路徑，我們改用 **system prompt 注入**：

   ```typescript
   // 讀取所有 SKILL.md 內容，注入到 system prompt
   const skillContents = skills.map(s =>
     fs.readFileSync(path.join(skillsDir, s, 'SKILL.md'), 'utf-8')
   ).join('\n\n---\n\n');

   const enrichedSystemPrompt = `${baseSystemPrompt}\n\n## Available Skills\n\n${skillContents}`;
   ```

3. **WebUI 管理介面**：
   - 列出 agent 的 skills
   - 編輯 SKILL.md
   - 從範本建立新 skill

**優勢**：
- 不依賴 CLI 安裝
- 每個 Agent 專屬 skills
- 符合 Anthropic 標準格式
- 可透過 Git 版本控制

---

### 方案 B：MCP Server 整合

**原理**：利用 SDK 的 `mcpServers` option，讓 Agent 連接外部工具。

**配置方式（agent.json）**：
```json
{
  "name": "Research Agent",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "~/docs"]
    },
    "browser": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-puppeteer"]
    }
  }
}
```

**實作步驟**：

1. **擴展 AgentConfigSchema**：
   ```typescript
   mcpServers: z.record(z.string(), z.union([
     z.object({ command: z.string(), args: z.array(z.string()).optional() }),
     z.object({ type: z.literal('sse'), url: z.string() }),
     z.object({ type: z.literal('http'), url: z.string() }),
   ])).optional()
   ```

2. **SDKQueryManager 傳遞 mcpServers**：
   ```typescript
   const sdkOptions: Options = {
     cwd: options.cwd,
     mcpServers: agent.config.mcpServers,
     // ...其他選項
   };
   ```

3. **WebUI 配置介面**：
   - MCP servers 列表管理
   - 預設範本（filesystem、browser、database）
   - 連線狀態顯示

**優勢**：
- SDK 完整支援
- 標準化協議
- 豐富的社群 MCP servers

---

### 方案 C：Plugin 混合模式

**原理**：結合 CLI 安裝 + SDK local 載入

**流程**：

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  WebUI 觸發     │ ──► │  CLI 執行安裝    │ ──► │  SDK 載入 local │
│  plugin 安裝    │     │  (非互動模式)    │     │  plugin         │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**實作步驟**：

1. **建立 Plugin 管理服務**：
   ```typescript
   class PluginManager {
     // 使用 CLI 安裝 plugin 到指定目錄
     async installPlugin(pluginSpec: string, targetDir: string): Promise<void> {
       // 方法一：直接複製（如果有 marketplace 資料）
       // 方法二：執行 CLI（需要處理互動問題）
     }

     // 列出已安裝的 plugins
     listPlugins(agentPath: string): PluginInfo[] {
       const pluginsDir = path.join(agentPath, 'plugins');
       // 掃描目錄...
     }
   }
   ```

2. **Agent 配置（agent.json）**：
   ```json
   {
     "plugins": [
       { "type": "local", "path": "./plugins/commit-commands" },
       { "type": "local", "path": "./plugins/code-review" }
     ]
   }
   ```

3. **SDKQueryManager 傳遞 plugins**：
   ```typescript
   const sdkOptions: Options = {
     plugins: agent.config.plugins?.map(p => ({
       type: 'local' as const,
       path: path.resolve(agent.path, p.path)
     })),
     // ...
   };
   ```

**挑戰**：
- CLI 安裝是互動式的，需要找到非互動方式
- 或改為手動下載 plugin 到目錄

**替代方案**：
- 提供「Plugin 範本庫」讓用戶選擇
- WebUI 直接下載 plugin 到 agent 目錄（不依賴 CLI）

---

### 方案 D：In-Process 自訂 Tools

**原理**：使用 `createSdkMcpServer()` 建立 ClaudeCab 專屬工具

**工具範例**：

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const claudecabTools = createSdkMcpServer({
  name: 'claudecab-tools',
  tools: [
    // 記憶查詢工具
    tool('search_memory', '搜尋長期記憶',
      { keyword: z.string(), limit: z.number().optional() },
      async (args, { agentPath }) => {
        const results = await searchMemoryFiles(agentPath, args.keyword);
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      }
    ),

    // 排程提醒工具
    tool('schedule_reminder', '設定提醒',
      { time: z.string(), message: z.string() },
      async (args, { sessionId }) => {
        await scheduleReminder(sessionId, args.time, args.message);
        return { content: [{ type: 'text', text: `已設定提醒：${args.time}` }] };
      }
    ),

    // 外部 API 呼叫工具
    tool('call_api', '呼叫外部 API',
      { url: z.string(), method: z.string(), body: z.string().optional() },
      async (args) => {
        const response = await fetch(args.url, { method: args.method, body: args.body });
        return { content: [{ type: 'text', text: await response.text() }] };
      }
    ),
  ]
});
```

**整合方式**：
```typescript
// 在 SDKQueryManager 中注入
const sdkOptions: Options = {
  mcpServers: {
    'claudecab': claudecabTools,
    ...agent.config.mcpServers,
  },
};
```

**優勢**：
- 完全控制工具邏輯
- 同進程執行，效能好
- 可以存取 ClaudeCab 內部狀態

---

### 方案 E：Agent Routing（進階）

**原理**：類似 Moltbot 的 bindings，讓單一 Telegram bot 路由到不同 Agent

**配置方式**：
```json
{
  "routing": {
    "rules": [
      { "match": { "chatId": "-100123456" }, "agentId": "work" },
      { "match": { "userId": "789" }, "agentId": "personal" },
      { "match": { "command": "/research" }, "agentId": "research" }
    ],
    "default": "general"
  }
}
```

**實作方式**：

1. **指令切換（簡單版）**：
   ```
   用戶：/switch research
   Bot：已切換到 Research Agent ✅
   ```

2. **自動路由（進階版）**：
   需修改 TelegramAdapter，根據 message 來源決定 agentId

**改動範圍**：
- TelegramAdapter
- SessionManager（支援跨 agent session）
- WebUI（routing 配置介面）

---

## 實作建議與優先順序

### 第一階段：基礎能力（1-2 週）

| 優先級 | 方案 | 價值 | 難度 |
|--------|------|------|------|
| P0 | **MCP Server 整合** | 高 | 低 |
| P0 | **Skills 目錄整合** | 高 | 低 |

**MCP 實作清單**：
- [x] ~~擴展 AgentConfigSchema 加入 `mcpServers`~~ SDK 自動從 `.mcp.json` 讀取
- [x] ~~修改 SDKQueryManager 傳遞 mcpServers~~ 不需要，SDK 自動處理
- [x] 配置檔從 `mcp.json` 改為 `.mcp.json`（v1.9.0）
- [ ] WebUI 新增 MCP 配置頁面（Phase 2）
- [x] 提供預設 MCP server 範本（echo server）

**Skills 實作清單**：
- [x] ~~AgentLoader 掃描 `skills/` 目錄~~ SDK 自動從 `.claude/skills/` 載入
- [x] ~~讀取 SKILL.md 注入 system prompt~~ 不需要，SDK 自動載入
- [x] 確保 `"Skill"` 在 settings.local.json 的 allow 清單（v1.9.0）
- [x] 提供 capability-discovery skill（引導用戶發現 MCP/Skills 資源）
- [ ] WebUI Skills 管理頁面（Phase 2）：
  - [ ] 列出已安裝的 skills
  - [ ] 上傳 skill 資料夾（zip）安裝到 `.claude/skills/`
  - [ ] 編輯/刪除 skill
  - [ ] 預覽 SKILL.md 內容

### 第二階段：進階能力（2-3 週）

| 優先級 | 方案 | 價值 | 難度 |
|--------|------|------|------|
| P1 | **In-Process Tools** | 高 | 中 |
| P1 | **Plugin 目錄支援** | 中 | 中 |

**In-Process Tools 實作清單**：
- [ ] 建立 `src/tools/` 目錄
- [ ] 實作 memory search tool
- [ ] 實作 schedule reminder tool
- [ ] 整合到 SDKQueryManager

### 第三階段：生態整合（3-4 週）

| 優先級 | 方案 | 價值 | 難度 |
|--------|------|------|------|
| P2 | **Agent Routing** | 中 | 高 |
| P2 | **Plugin Marketplace 整合** | 中 | 高 |

---

## 總結

ClaudeCab 可以借鏡 Moltbot 的機制，但需配合 Claude Agent SDK 的能力範圍：

1. **Skills** - SDK 自動從 `.claude/skills/` 載入（已實作 v1.9.0）
2. **MCP** - SDK 自動從 `.mcp.json` 讀取（已實作 v1.9.0）
3. **Plugins** - 只能用 local 模式，需手動管理
4. **Routing** - 需自行實作，改動較大

**v1.9.0 已完成**：MCP + Skills 基礎支援，讓 Agent 能夠使用外部工具和自訂 skills。

**下一步**：WebUI 管理介面（MCP 配置頁面、Skills 管理頁面）。
