---
name: equip
description: 自我配置技能。根據職責定位搜尋、安裝、記錄適合的 skills 和 MCP servers。觸發：「幫我配置」、「裝備新技能」、「我想成為 X 專家」、「更新我的能力」。
---

# Equip - 系統化能力配置

## 流程概覽

執行系統化的 7 階段能力評估流程：

**Phase 1-4（自動化）**：
角色定義 → 能力框架 → 現況盤點 → 缺口分析 → 產出報告

**Phase 5-7（互動式）**：
工具搜尋 → 建議報告 → 確認安裝

---

## Phase 1-4: 自動化評估

執行這些階段，自動產出能力缺口報告。

### 1. 定義角色

讀取 `/persona` skill 的 identity.md 並提取角色定義。

範例："個人 AI 助手"

### 2. 推導能力框架

推導角色所需能力。

**快速模式（預設）**：
1. 從 AI 訓練資料推導能力
2. 若 `capability-frameworks.md` 已有框架，參考並更新
3. 若無現有框架，產生新框架並附加到檔案

**深度模式（選用）**：
1. 執行快速模式
2. 補充 WebSearch：
   - 搜尋 "{role} required skills 2026"
   - 搜尋 "{role} essential tools"
   - 搜尋 "{role} best practices"
3. 整合 AI 推導 + WebSearch 結果

對新興角色或不熟悉領域，建議使用深度模式。

格式參考：[capability-frameworks-template.md](references/capability-frameworks-template.md)

### 3. 盤點現況

讀取 `EQUIPMENT.md`，列出已安裝的 skills 和 MCP servers。

記錄現有工作流程及其支援的能力。

### 4. 分析缺口

比對所需能力與已安裝工具，標記每項：
- ✓ 已滿足（有支援工具）
- ❌ 缺口（需要但缺少）
- 🟡 部分滿足（有工具但不完整）

**產出**：產生 `capability-gap-report.md`：

```markdown
# 能力缺口分析報告

**角色**：{role}
**日期**：{YYYY-MM-DD}

## 能力缺口

### 1. {能力名稱}
**需求**：{描述}
**搜尋關鍵字**：{keyword1}, {keyword2}, {keyword3}

### 2. {能力名稱}
...

## 已滿足能力
✓ {能力 1}（{工具名稱}）
✓ {能力 2}（{工具名稱}）
```

---

## Phase 5-7: 互動式探索

執行這些階段時需要使用者確認。

### 5. 搜尋工具

針對每個缺口，使用識別的關鍵字搜尋：

```bash
/find-skills {keyword}
/find-mcp {keyword}
claude plugin search {keyword}
```

收集每個能力缺口的搜尋結果。

### 6. 產出建議

產生完整的配置建議報告：

```markdown
## 安裝建議

### {能力名稱}

**Skills 搜尋結果**：
- {owner/repo@skill} - {描述}

**MCP 搜尋結果**：
- {server-name} - {描述} - {url}

**Claude Code Plugin 搜尋結果**：
- {plugin-name} - {描述}

**推薦方案**：{skill/mcp/plugin} - {理由}

---

## 安裝指令（待確認）

```bash
# Skills
npx skills add {owner/repo@skill} -g -y

# MCPs（必須使用 --scope local，依 CLAUDE.md 規範）
claude mcp add --scope local --transport {type} {name} {url/command}

# Plugins
claude plugin install {plugin-name} --scope local
```

呈現此報告供使用者審閱。

### 7. 確認並安裝

1. 使用者審閱建議
2. 使用者確認要安裝的工具
3. 執行安裝指令：
   - **Skills**：`npx skills add {owner/repo@skill} -g -y`
   - **MCPs**：`claude mcp add --scope local --transport {type} {name} {url/command}`
   - **Plugins**：`claude plugin install {plugin-name} --scope local`
4. 更新 `EQUIPMENT.md` 記錄新安裝的工具

---

## 資源檔案

### references/capability-frameworks.md
Phase 2 產出 agent 能力框架的檔案。首次執行時產出；後續執行時參考並更新。

### references/capability-frameworks-template.md
手動建立能力框架時的空白模板。提供結構與格式指引。

---

## 相依項目

- `/persona` skill - 角色定義
- `EQUIPMENT.md` - 當前工具清單
- `/find-skills` skill - Skills 探索
- `/find-mcp` skill - MCP server 探索

---

## 工具類型

### 1. Skills
來自 skills.sh 平台的可重用技能包。

**安裝**：`npx skills add {owner/repo@skill} -g -y`

### 2. MCP Servers
提供外部服務整合的 Model Context Protocol 伺服器。

**安裝**：`claude mcp add --scope local --transport {http/sse/stdio} {name} {url/command}`

### 3. Claude Code Plugins
來自官方/社群的功能擴充。

**搜尋**：`claude plugin search {keyword}`
**安裝**：`claude plugin install {plugin-name} --scope local`

---

## 注意事項

- Phase 1-4 自動執行以減少使用者摩擦
- Phase 5-7 需要使用者確認以避免非預期安裝
- 所有 MCP/Plugin 安裝必須使用 `--scope local`（依 CLAUDE.md 指引）
- 能力推導是動態的，會適應角色脈絡
- 搜尋關鍵字可能需要迭代以找到最佳工具
