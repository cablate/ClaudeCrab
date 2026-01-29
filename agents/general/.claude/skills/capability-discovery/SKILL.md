---
name: capability-discovery
description: 當用戶詢問有什麼功能、工具、能力可以使用時，介紹 MCP 和 Skills 生態系統並引導發現新能力
---

# 能力發現引導

當用戶詢問以下類型問題時觸發此 skill：
- 「你有什麼功能？」「你能做什麼？」
- 「有什麼工具可以用？」「有哪些 MCP？」
- 「怎麼讓你學會新技能？」「可以新增功能嗎？」
- 「有什麼 skills 可以用？」

## 回應框架

### 1. 先說明現有能力

說明你目前已經具備的能力（根據實際配置）：
- 基本對話和問答
- 網頁搜尋和資料查詢（如果有 WebSearch/WebFetch）
- 已安裝的 MCP tools（列出可用的）
- 已載入的 skills（列出 /commands）

### 2. 介紹擴展機制

簡單解釋兩種擴展方式：

**MCP (Model Context Protocol)**
- 讓 AI 連接外部工具和服務
- 例如：GitHub 操作、資料庫查詢、Slack 整合、瀏覽器自動化
- 需要管理員配置

**Skills**
- 專門的工作流程和知識
- 例如：程式碼審查、文件撰寫、資料分析
- 透過 SKILL.md 檔案定義

### 3. 提供發現資源

引導用戶到以下資源探索：

**MCP Servers**
- 官方 Registry: https://registry.modelcontextprotocol.io/
- MCP.so: https://mcp.so/ (17,000+ servers)
- PulseMCP: https://www.pulsemcp.com/servers

**Skills**
- SkillsMP: https://skillsmp.com/ (71,000+ skills)
- SkillHub: https://www.skillhub.club/
- Anthropic 官方: https://github.com/anthropics/skills

### 4. 引導下一步

告訴用戶：
- 如果找到想要的功能，可以告訴管理員進行配置
- 說明需要提供的資訊（MCP server 名稱/URL，或 skill 名稱）
- 提醒某些 MCP 需要 API key 或認證

## 語氣指引

- 保持友善和鼓勵探索的態度
- 不要一次給太多資訊，可以分階段引導
- 如果用戶有具體需求，幫助他們在資源中搜尋
- 承認自己的限制，但強調可擴展性

## 範例對話

用戶：「你能做什麼？」

回應：「我目前可以幫你：
- 日常對話和問答
- 網路搜尋查資料
- [其他已配置的能力]

如果你需要更多功能，比如操作 GitHub、查詢資料庫、自動化瀏覽器等，可以透過 MCP 擴展。想了解有哪些可用的擴展嗎？」

---

用戶：「有什麼 MCP 可以用？」

回應：「MCP 讓我可以連接外部工具。一些熱門的 MCP servers：

🔧 **開發工具**
- GitHub - PR/Issue 操作
- Sentry - 錯誤監控
- PostgreSQL - 資料庫查詢

🌐 **生產力**
- Slack - 訊息整合
- Notion - 知識庫
- Google Drive - 文件存取

📊 **資料**
- Airtable - 結構化資料
- Supabase - 後端服務

你可以到 https://mcp.so/ 探索更多（超過 17,000 個）！
找到想要的功能後，告訴管理員來幫你配置。」
