# ClaudeCab References 導讀

> 專案知識文件索引

---

## 分類導航

### 📦 產品 (product/)

| 文件 | 用途 |
|------|------|
| [vision.md](product/vision.md) | 產品定位、核心概念、路線圖 |
| [mvp-gap-analysis.md](product/mvp-gap-analysis.md) | **MVP 就緒度落差分析**：P0~P2 優先級問題清單、修復順序、配置複雜性評估 |
| [principle.md](product/principle.md) | 功能開發原則、設計原則 |
| [strategy-analysis.md](product/strategy-analysis.md) | **產品策略分析報告**：市場定位、OpenClaw 競品對比、差異化策略、行動建議 |
| [mmorpg-skill-system.md](product/mmorpg-skill-system.md) | **MMORPG 化 Skill 管理設計**：遊戲化 bot 管理概念、裝備系統、熟練度、角色面板 |
| [image-asset-spec.md](product/image-asset-spec.md) | **圖片資產規格標準**：各類型尺寸/格式/背景規範、假透明防範、生成 prompt template、驗證標準 |

---

### 🏗️ 系統 (system/)

| 文件 | 用途 |
|------|------|
| [overview.md](system/overview.md) | 技術架構、技術棧、目錄結構 |
| [trigger-mechanism-map.md](system/trigger-mechanism-map.md) | 事件流、觸發路徑、cascade 風險分析 |
| [skill-based-character-system.md](system/skill-based-character-system.md) | **Skill-Based Character System 完整設計**：system/persona/domain 三層架構、5 個獨立 system skills + 內嵌協議（memory-system）、存儲演化策略、實作指南 |

---

### 📋 決策 (decisions/)

| 文件 | 用途 |
|------|------|
| [_index.md](decisions/_index.md) | 架構決策紀錄總覽（ADR-001 ~ ADR-031） |
| [adr/adr-031-data-placement-strategy.md](decisions/adr/adr-031-data-placement-strategy.md) | **資料配置策略 ADR**：Bot 狀態 vs 關係資料分離、存儲演化路徑（files → RAG） |
| [stories/agent-specialization.md](decisions/stories/agent-specialization.md) | Agent 專門化功能提案 |
| [stories/skill-system-story.md](decisions/stories/skill-system-story.md) | Skill-Based Character System 功能提案 |

---

### 🔧 操作 (operations/)

| 文件 | 用途 |
|------|------|
| [quick-nav.md](operations/quick-nav.md) | 「做 X 看哪些檔案」快速導航 |
| [migration-guide-skill-system.md](operations/migration-guide-skill-system.md) | **Skill System 遷移指南**：Phase 1~5 step-by-step 操作與驗證清單 |
| [troubleshooting.md](operations/troubleshooting.md) | 常見問題與解法 |
| [changelog.md](operations/changelog.md) | 版本歷史 (v0.1.0 ~ v1.11.0) |
| [image-toolchain.md](operations/image-toolchain.md) | **內部圖片生成工具鏈**：mcp-image 參數對應、sharp 後處理指令、完整流程範例 |

---

### 🔬 研究 (research/)

| 文件 | 用途 |
|------|------|
| [agent-skill/design.md](research/agent-skill/design.md) | Agent Skill 設計原則、核心洞察 |
| [agent-skill/guide.md](research/agent-skill/guide.md) | Agent Skill 實踐指南 |
| [moltbot-gap.md](research/moltbot-gap.md) | Moltbot 記憶系統差距分析 |
| [emergent-cooperation.md](research/emergent-cooperation.md) | 湧現式協作行為觀察（最小提示 → 自發協作推理） |
| [persona-design.md](research/persona-design.md) | **Agent Persona 設計指南**：soul.md / identity.md 欄位設計依據、SillyTavern 競品對照、新建 Agent Checklist | 湧現式協作行為觀察（最小提示 → 自發協作推理） |
