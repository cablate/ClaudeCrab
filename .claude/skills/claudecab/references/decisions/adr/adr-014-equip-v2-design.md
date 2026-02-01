---
id: ADR-014
title: Equip-v2 Skill 設計決策：AI 推導 vs 靜態模板
status: accepted
date: 2026-02-01
---

# ADR-014: Equip-v2 Skill 設計決策：AI 推導 vs 靜態模板

## 背景

原始 equip skill 採用「邊想邊裝」模式，缺乏明確的需求分析階段。使用者提出需求：能否先根據角色盤點技能清單，再批量搜尋安裝？

經研究 AI agent capability planning 最佳實踐（CrewAI、Competency Matrix），提出系統化流程：角色定義 → 能力框架 → 現況盤點 → 缺口分析 → 工具搜尋 → 配置報告 → 批量安裝。

## 關鍵決策點

### 1. 腳本驅動 vs AI 推導

**初始方案**（被否決）：
- 建立 `.js` 腳本自動化 Phase 5-7（工具搜尋、報告產出、批量安裝）
- 為常見角色預建 capability template

**最終方案**：
- 使用 AI 動態推導 + 現有工具（find-skills/find-mcp）
- Phase 1-4 自動執行，Phase 5-7 互動執行
- 不使用腳本，保持簡單

**理由**：
- 避免過度工程化
- 利用 AI 本身的推導能力
- 現有工具已足夠（find-skills/find-mcp）
- 更靈活適應不同角色

### 2. 靜態範例 vs 動態產出

**問題**：`capability-frameworks.md` 應該是什麼？

經過多次討論與調整：

| 方案 | 內容 | 問題 |
|------|------|------|
| 預建範例集 | 投資顧問、數據分析師等常見角色 | 每個人角色定位不同，照抄無意義 |
| 空白模板 | 僅提供格式參考 | 無法累積經驗 |
| **動態產出**（✅ 最終方案） | Phase 2 推導後寫入，累積當前 agent 的能力定義 | 可回顧、修改、更新 |

**決策**：
- `capability-frameworks.md` = **Phase 2 執行產出**，記錄「我（當前 agent）的能力定義」
- `capability-frameworks-template.md` = **格式參考**，手動編輯時使用

### 3. WebSearch 補強：必要 vs 選用

**提案**：Phase 2 推導能力框架時加入 WebSearch，補充最新資訊。

**權衡**：
- ✅ 優點：不受訓練資料 cutoff 限制，獲取 2024-2026 最新最佳實踐
- ❌ 缺點：增加執行時間

**決策**：採用**漸進式迭代**
- **快速模式（預設）**：AI 推導 + 參考 capability-frameworks.md
- **深度模式（選用）**：+ WebSearch 補強（搜尋「{role} required skills 2026」等）
- 建議對新興角色使用深度模式

**理由**：快速可用 > 完美，先測試再優化（V2.1 backlog）

### 4. 工具生態系統：Skills vs MCPs vs Plugins

**問題**：SKILL.md 初版缺少 Claude Code Plugin 支援。

**決策**：完整支援三種工具類型
- **Skills**：可重用技能包（skills.sh）
- **MCP Servers**：外部服務整合（Model Context Protocol）
- **Claude Code Plugins**：編輯器功能擴展

**Phase 調整**：
- Phase 5：加入 `claude plugin search`
- Phase 6：報告加入 Plugin 搜尋結果
- Phase 7：安裝指令加入 `claude plugin install --scope local`

### 5. Skill 開發流程：直接建立 vs skill-creator

**問題**：初版直接建立 `.claude/skills/equip-v2/SKILL.md`，未使用 skill-creator。

**教訓**：skill-creator 不只是打包工具，而是**完整的開發流程規範**。

**正確流程**（已更新到 CLAUDE.md）：
1. **Step 1**: 理解使用案例（具體範例）
2. **Step 2**: 規劃可重用資源（scripts/references/assets）
3. **Step 3**: 初始化 skill（`python scripts/init_skill.py`）
4. **Step 4**: 編輯 skill（SKILL.md + 資源檔案）
5. **Step 5**: 打包 skill（`python scripts/package_skill.py`）

**關鍵原則**：
- Progressive disclosure（metadata → SKILL.md → references）
- 保持簡潔（預設 Claude 很聰明，只加必要資訊）
- 避免重複（SKILL.md 與 references 不重複）

### 6. 撰寫風格：陳述語氣 vs 祈使語氣

**問題**：中文化後使用陳述語氣（「自動執行這些階段以產出...」「根據角色推導...」）

**skill-creator 規範**：使用**祈使語氣（imperative mood）**

**修正**：
- ❌ 陳述：「自動執行這些階段以產出...」
- ✅ 祈使：「執行這些階段，自動產出...」
- ❌ 陳述：「根據角色推導所需能力」
- ✅ 祈使：「推導角色所需能力」

## 最終架構

### 7 階段流程

**Phase 1-4（自動化）**：
1. 定義角色（讀取 IDENTITY.md）
2. 推導能力框架（AI 推導 + 選用 WebSearch）
3. 盤點現況（解析 EQUIPMENT.md）
4. 分析缺口（比對產出報告）

**Phase 5-7（互動式）**：
5. 工具搜尋（find-skills/find-mcp/plugin search）
6. 建議報告（整合搜尋結果）
7. 確認安裝（使用者確認後批量安裝）

### 檔案結構

```
.claude/skills/equip-v2/
├── SKILL.md (完整繁體中文 workflow)
└── references/
    ├── capability-frameworks.md (Phase 2 執行產出)
    └── capability-frameworks-template.md (格式參考)
```

## 相關文件

- 決策過程：`memory/2026-02-01.md`
- 教訓記錄：`CLAUDE.md` (Lessons Learned section)
- Demo 執行結果：`memory/2026-02-01.md` (Demo Run section)

## 影響範圍

- ✅ 建立系統化能力配置流程
- ✅ 確立 skill-creator 為 skill 開發標準流程
- ✅ 定義動態產出檔案 vs 靜態參考檔案的使用場景
- ✅ 確立祈使語氣為中文 SKILL.md 撰寫規範
- ✅ 支援完整工具生態系統（Skills/MCPs/Plugins）

## 後續優化方向

- V2.1：根據實際使用反饋評估 WebSearch 有效性
- 持續累積 capability-frameworks.md 內容
- 觀察工具搜尋關鍵字的準確性，必要時迭代
