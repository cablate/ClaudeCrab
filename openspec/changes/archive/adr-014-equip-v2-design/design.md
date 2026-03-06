# 設計：Equip-v2 Skill 設計決策：AI 推導 vs 靜態模板

## Decisions

### AI 動態推導取代腳本驅動

使用 AI 動態推導 + 現有工具（find-skills/find-mcp），Phase 1-4 自動執行，Phase 5-7 互動執行。不使用腳本，避免過度工程化，利用 AI 本身的推導能力，更靈活適應不同角色。

### capability-frameworks.md 為動態產出

`capability-frameworks.md` 是 Phase 2 執行產出，記錄「我（當前 agent）的能力定義」，可回顧、修改、更新。`capability-frameworks-template.md` 是格式參考，手動編輯時使用。

### WebSearch 漸進式迭代

- 快速模式（預設）：AI 推導 + 參考 capability-frameworks.md
- 深度模式（選用）：+ WebSearch 補強（搜尋「{role} required skills 2026」等）
- 建議對新興角色使用深度模式

### 完整工具生態系統支援

- Skills：可重用技能包（skills.sh）
- MCP Servers：外部服務整合（Model Context Protocol）
- Claude Code Plugins：編輯器功能擴展

### skill-creator 為標準開發流程

Step 1 理解使用案例 → Step 2 規劃可重用資源 → Step 3 初始化 skill → Step 4 編輯 skill → Step 5 打包 skill。關鍵原則：Progressive disclosure、保持簡潔、避免重複。

### 祈使語氣撰寫規範

中文 SKILL.md 使用祈使語氣（imperative mood），而非陳述語氣。

## Risks / Trade-offs

- V2.1 需根據實際使用反饋評估 WebSearch 有效性
- 工具搜尋關鍵字的準確性需持續觀察與迭代
- 快速可用 > 完美，先測試再優化

## Affected Components

```
.claude/skills/equip-v2/
├── SKILL.md (完整繁體中文 workflow)
└── references/
    ├── capability-frameworks.md (Phase 2 執行產出)
    └── capability-frameworks-template.md (格式參考)
```
