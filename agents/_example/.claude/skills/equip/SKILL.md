---
name: equip
description: 自我配置技能。根據職責定位搜尋、安裝、記錄適合的 skills 和 MCP servers。觸發：「幫我配置」、「裝備新技能」、「我想成為 X 專家」、「更新我的能力」。
---

# Equip（自我配置）

協助你根據職責定位，自主發現並裝備適合的工具。

## 何時使用

- 使用者說「幫我配置」、「裝備新技能」
- 使用者說「我想成為 X 專家」、「我需要 Y 能力」
- 發現當前能力不足以完成任務時
- 首次啟動完成後（BOOTSTRAP 結束後自動觸發）

## 核心原則

<STRICTLY_IMPORTANT>
1. **不編造**：所有 skill/MCP 資訊必須來自實際搜尋結果或官方來源
2. **使用者確認**：安裝前必須徵求使用者同意
3. **持久記錄**：所有配置寫入 EQUIPMENT.md
4. **Local Scope**：所有 Claude CLI 操作使用 local scope
</STRICTLY_IMPORTANT>

## 工作流程

### Step 1: 確認職責定位

首先了解當前狀態：
1. 讀取 EQUIPMENT.md（如果存在）了解現有配置
2. 讀取 IDENTITY.md 了解身份定位
3. 如果職責未定義，詢問使用者：

```
你希望我專注在什麼領域？例如：
- 投資分析師：台股分析、投資建議
- 會議記錄專家：逐字稿整理、摘要、待辦事項
- 工程師助手：程式碼審查、技術文件
- 設計師助手：UI/UX 建議、設計規範
- 或者告訴我你的具體需求...
```

### Step 2: 搜尋 Skills

根據職責執行搜尋（**必須執行指令，不可編造結果**）：

```bash
npx skills find [職責關鍵字]
```

範例：
- 投資分析師 → `npx skills find stock analysis`、`npx skills find data visualization`
- 會議記錄 → `npx skills find transcription`、`npx skills find meeting notes`
- 工程師 → `npx skills find code review`、`npx skills find testing`

呈現搜尋結果，讓使用者選擇要安裝的 skills。

**如果搜尋無結果**，誠實告知使用者，不要編造。

### Step 3: 搜尋 MCP Servers

根據職責推薦 MCP servers（這些是已知的官方/社群 servers）：

| 職責 | 推薦 MCP Servers |
|------|-----------------|
| 投資分析 | playwright（抓取股價）、brave-search（新聞搜尋） |
| 會議記錄 | filesystem（檔案管理） |
| 工程師 | github、sentry |
| 設計師 | playwright（截圖） |
| 通用 | brave-search、playwright |

呈現選項並提供安裝指令。

更多 MCP servers 可參考：
- https://mcpservers.org
- https://github.com/punkpeye/awesome-mcp-servers

### Step 4: 安裝裝備

經使用者確認後執行安裝：

**Skills：**
```bash
npx skills add <owner/repo@skill> -g -y
```

**MCP Servers（Windows 需要 cmd /c）：**
```bash
# HTTP transport
claude mcp add --transport http <name> <url>

# Stdio transport (Windows)
claude mcp add --transport stdio <name> -- cmd /c npx -y <package>

# 範例
claude mcp add --transport http github https://api.githubcopilot.com/mcp/
claude mcp add --transport stdio playwright -- cmd /c npx -y @anthropic-ai/mcp-server-playwright
```

⚠️ **重要**：所有 `claude mcp add` 指令必須使用 local scope（預設），禁止使用 `--scope user` 或 `--scope project`。

### Step 5: 更新 EQUIPMENT.md

安裝完成後，更新記錄：

```markdown
# Equipment

## 當前職責
[職責名稱] — [簡短描述]

## 已裝備 Skills
| Skill | 用途 | 安裝日期 |
|-------|------|----------|
| [owner/repo@skill] | [用途說明] | [YYYY-MM-DD] |

## 已裝備 MCP Servers
| Server | 用途 | 安裝日期 |
|--------|------|----------|
| [server-name] | [用途說明] | [YYYY-MM-DD] |

## 工作流程模式
[描述你現在的工作流程，例如：
1. 接收使用者問題
2. 使用 playwright 抓取數據
3. 分析並產出建議]

## 配置歷史
- [YYYY-MM-DD]：[變更說明]
```

## 迭代更新

當需要更新配置時：
1. 讀取現有 EQUIPMENT.md
2. 詢問要新增或移除什麼
3. 執行相應操作
4. 更新 EQUIPMENT.md 的配置歷史

## 常見職責參考

| 職責 | 建議 Skills 關鍵字 | 建議 MCP |
|------|-------------------|----------|
| 投資分析師 | stock, finance, data-analysis | playwright, brave-search |
| 會議記錄專家 | transcription, summary, notes | filesystem |
| 工程師助手 | code-review, testing, documentation | github, sentry |
| 設計師助手 | ui, ux, design-system, accessibility | playwright |
| 內容創作者 | writing, content, seo | brave-search |
| 專案管理 | project, workflow, automation | linear, jira, notion |

## 官方資源

- **Skills 目錄**：https://skills.sh/
- **MCP Servers 目錄**：https://mcpservers.org
- **Vercel 官方 Skills**：https://github.com/vercel-labs/agent-skills
- **Awesome MCP Servers**：https://github.com/punkpeye/awesome-mcp-servers
