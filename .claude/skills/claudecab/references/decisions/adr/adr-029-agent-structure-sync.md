# ADR-029: Agent 架構同步機制

**日期**：2026-02-06
**狀態**：📋 proposed
**關聯**：AgentLoader、WebUI、_example 模板、BOOTSTRAP.md

## 背景

ClaudeCab 的多 agent 架構中，每個 agent 目錄是獨立的 Claude Code 工作區。隨著 `general` agent 演化出完整生態（5 個 skills、protocol files、USER.md、MEMORY.md 等），其他 agent（如 `coder`）仍停留在最初骨架，造成能力落差：

- `general`：完整 skills + protocols + 記憶系統 + MCP 配置
- `coder`：僅 agent.json + CLAUDE.md + .claude/
- 新建 agent 靠 `_example/` 模板起步，但已存在的 agent 沒有升級路徑
- 沒有任何機制偵測或通知「哪個 agent 落後了」

## 決策

採用**混合式架構**：系統層 Health Check + Agent 層自我校準。

### 系統層（AgentLoader）

1. **判斷基準**：以 `agents/_example/` 目錄結構為 source of truth，runtime 掃描
2. **Health Check**：`checkHealth(agentId)` 用 `fs.access()` 檢查檔案存在性（零 token 成本）
3. **分級**：
   - **healthy**：required 全在 + optional ≥80%
   - **degraded**：required 全在 + optional <80%
   - **minimal**：有 required 缺失
4. **Required items**：agent.json、CLAUDE.md、settings.local.json、agent-protocols skill、persona skill
5. **Scaffold**：`scaffoldAgent(agentId)` 從 `_example/` 複製缺少的檔案（絕不覆寫現有）

### Agent 層（BOOTSTRAP.md 自我校準）

1. Scaffold 後可選產生 `BOOTSTRAP.md`
2. Agent 下次啟動時，startup protocol 偵測到 → 讀取執行首次設定 → 自我客製化 → 刪除
3. 包含：自訂人格、初始化記憶、設定使用者檔案、確認裝備

### WebUI 整合

- Agent list：健康度小圓點（綠/黃/紅）
- Agent detail：Health tab — 分類 checklist + 「補齊」按鈕 + 「補齊 + 自我校準」按鈕

### 觸發時機

On-demand（WebUI 按鈕），不自動燒 token。

## 不做的

- 不在每次 loadAgent 時自動 health check
- 不做跨 agent skill diff（v2 再考慮）
- 不強制阻擋 minimal agent 運行（資訊性，不阻斷）
- 不做 skill registry（`_example/` 就是 single source of truth）

## 影響範圍

| 檔案 | 操作 |
|------|------|
| `src/types/agent.ts` | 新增 health report 型別 |
| `src/core/AgentLoader.ts` | 新增 checkHealth(), scaffoldAgent() |
| `src/webui/api/agents.api.ts` | 新增 health + scaffold API |
| `src/webui/views/agents/detail.ejs` | 加 Health tab |
| `src/webui/views/agents/list.ejs` | 加健康度指標 |
| `agents/_example/` | 補 .gitkeep、placeholder |
