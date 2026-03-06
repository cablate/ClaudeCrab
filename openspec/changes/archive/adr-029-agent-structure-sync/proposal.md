# Agent 架構同步機制

## Why

ClaudeCab 的多 agent 架構中，每個 agent 目錄是獨立的 Claude Code 工作區。隨著 `general` agent 演化出完整生態（5 個 skills、protocol files、USER.md、MEMORY.md 等），其他 agent（如 `coder`）仍停留在最初骨架，造成能力落差。新建 agent 靠 `_example/` 模板起步，但已存在的 agent 沒有升級路徑，也沒有任何機制偵測或通知「哪個 agent 落後了」。

## What Changes

採用混合式架構：系統層 Health Check + Agent 層自我校準。

**系統層（AgentLoader）**：
- 以 `agents/_example/` 目錄結構為 source of truth，runtime 掃描
- `checkHealth(agentId)` 用 `fs.access()` 檢查檔案存在性（零 token 成本）
- 分級：healthy（required 全在 + optional >= 80%）、degraded（required 全在 + optional < 80%）、minimal（有 required 缺失）
- Required items：agent.json、CLAUDE.md、settings.local.json、agent-protocols skill、persona skill
- `scaffoldAgent(agentId)` 從 `_example/` 複製缺少的檔案（絕不覆寫現有）

**Agent 層（BOOTSTRAP.md 自我校準）**：
- Scaffold 後可選產生 BOOTSTRAP.md
- Agent 下次啟動時偵測到 → 讀取執行首次設定 → 自我客製化 → 刪除

**WebUI 整合**：Agent list 顯示健康度小圓點，Agent detail 提供 Health tab 含補齊按鈕。

觸發時機為 On-demand（WebUI 按鈕），不自動燒 token。

## Capabilities

- 偵測 agent 結構落差並分級報告
- 一鍵補齊缺少的檔案
- 新 agent 可透過 BOOTSTRAP.md 自我校準
- WebUI 視覺化健康度

## Trade-offs

- 不在每次 loadAgent 時自動 health check
- 不做跨 agent skill diff（v2 再考慮）
- 不強制阻擋 minimal agent 運行（資訊性，不阻斷）
- 不做 skill registry（`_example/` 就是 single source of truth）
