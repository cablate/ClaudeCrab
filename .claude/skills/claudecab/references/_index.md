# ClaudeCab References 導讀

> 專案知識文件索引（2026-02-16 更新）

---

## 分類導航

### 📦 產品 (product/)

| 文件 | 用途 |
|------|------|
| [vision.md](product/vision.md) | 產品定位、核心概念、路線圖 |
| [principle.md](product/principle.md) | 功能開發原則、設計原則 |
| [mmorpg-skill-system.md](product/mmorpg-skill-system.md) | **MMORPG 化 Skill 管理設計**：遊戲化 bot 管理概念、裝備系統、熟練度、角色面板 |
| [image-asset-spec.md](product/image-asset-spec.md) | **圖片資產規格標準**：各類型尺寸/格式/背景規範、假透明防範、日夜場景系統、驗證標準 |

> **歷史文件**：`mvp-gap-analysis.md`、`strategy-analysis.md` 已策展歸檔至 [`_archive/`](_archive/_index.md)

---

### 🏗️ 系統 (system/)

| 文件 | 用途 |
|------|------|
| [overview.md](system/overview.md) | 技術架構、技術棧、目錄結構（含 25+ 核心模組說明） |
| [module-map.md](system/module-map.md) | **模組地圖與耦合分析**：分層總覽、群聚圖、依賴矩陣、風險評估、檔案尺寸一覽 |
| [trigger-mechanism-map.md](system/trigger-mechanism-map.md) | 事件流、觸發路徑、Social/Initiative/Delegation cascade 風險分析 |
| [skill-based-character-system.md](system/skill-based-character-system.md) | **Skill-Based Character System 完整設計**：system/persona/domain 三層架構、遷移現況追蹤 |
| [shared-knowledge.md](system/shared-knowledge.md) | **共享知識區架構**：跨 Agent 知識發佈/訂閱機制、權限規則、目錄結構 |

---

### 📋 決策 (decisions/)

| 文件 | 用途 |
|------|------|
| [_index.md](decisions/_index.md) | 架構決策紀錄總覽（ADR-001 ~ ADR-034） |
| [stories/](decisions/stories/) | 功能故事：agent-specialization、skill-system-story、next-evolution-plan |

---

### 🔧 操作 (operations/)

| 文件 | 用途 |
|------|------|
| [quick-nav.md](operations/quick-nav.md) | 「做 X 看哪些檔案」快速導航 |
| [troubleshooting.md](operations/troubleshooting.md) | 常見問題與解法 |
| [changelog.md](operations/changelog.md) | 版本歷史（v1.25+，舊版見 [archive](_archive/operations/changelog-archive.md)） |
| [image-toolchain.md](operations/image-toolchain.md) | **內部圖片生成工具鏈**：mcp-image 參數對應、sharp 後處理指令 |

> **歷史文件**：`migration-guide-skill-system.md` 已策展歸檔至 [`_archive/`](_archive/_index.md)

---

### 🔬 研究 (research/)

| 文件 | 用途 |
|------|------|
| [agent-skill/design.md](research/agent-skill/design.md) | Agent Skill 設計原則、核心洞察 |
| [agent-skill/guide.md](research/agent-skill/guide.md) | Agent Skill 實踐指南 |
| [emergent-cooperation.md](research/emergent-cooperation.md) | 湧現式協作行為觀察（最小提示 → 自發協作推理） |

> **歷史文件**：`moltbot-gap.md`、`personality-design-report.md`、`long-term-memory-research.md` 已策展歸檔至 [`_archive/`](_archive/_index.md)

---

### 📁 歸檔 (_archive/)

策展過的歷史文件，保留完整迭代記錄作為 portfolio 材料。

| 文件 | 原始位置 | 描述 |
|------|----------|------|
| [_index.md](_archive/_index.md) | — | 歸檔目錄索引 |
| [moltbot-gap.md](_archive/research/moltbot-gap.md) | research/ | Moltbot 記憶系統差距分析 |
| [personality-design-report.md](_archive/research/personality-design-report.md) | research/ | 人格設計研究報告 |
| [long-term-memory-research.md](_archive/research/long-term-memory-research.md) | research/ | 長期記憶方案研究 |
| [mvp-gap-analysis.md](_archive/planning/mvp-gap-analysis.md) | product/ | MVP 就緒度落差分析 |
| [strategy-analysis.md](_archive/analysis/strategy-analysis.md) | product/ | 產品策略分析報告 |
| [next-evolution-plan.md](_archive/planning/next-evolution-plan.md) | decisions/stories/ | 下一階段演化規劃 |
| [migration-guide-skill-system.md](_archive/operations/migration-guide-skill-system.md) | operations/ | Skill System 遷移指南 |
| [changelog-archive.md](_archive/operations/changelog-archive.md) | operations/ | 版本歷史 v0.1.0 ~ v1.24.0 |

---

### 📖 專案敘事

| 文件 | 用途 |
|------|------|
| [project-journey.md](project-journey.md) | **專案演化之旅** — 21 天從 Telegram Bot 到多代理 RPG 辦公室的完整故事 |