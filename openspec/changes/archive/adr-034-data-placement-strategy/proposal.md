# Skill-Based Character System 資料配置策略

## Why

ClaudeCab 採用 Skill-Based Character System，把 MMORPG 角色養成機制搬到 AI Bot 管理上。在設計過程中遇到核心問題：「哪些資料應該放在 skill 的 references/ 裡動態更新，哪些應該放在 agent 根目錄？」這個決策影響系統的可攜性（skill 複製到其他 bot）、資料的語義清晰度（什麼屬於 bot，什麼屬於關係）、維護的複雜度（更新時找哪個檔案）。

## What Changes

採用「Bot 狀態 vs 關係資料」分離策略，三個核心原則：

1. **換使用者測試**：「換一個使用者，這個東西還在嗎？」還在 → skill/references/（Bot 自己的狀態），不在 → 根目錄（Bot 跟使用者的關係）
2. **Schema vs Instance Data**：規則定義放 skill/SKILL.md（靜態）、Bot 數值放 skill/references/（動態）、關係記錄放根目錄（動態）
3. **通用 vs 特定人格特質**：對所有使用者都適用 → persona/soul.md、只對這個使用者有效 → MEMORY.md 或 CLAUDE.md

具體配置：
- **skill/references/**：proficiency levels、equipment loadout、achievements、character-sheet stats、persona soul
- **根目錄**：MEMORY.md、USER.md、ACTIVE.md、memory/ 每日日誌、CLAUDE.md Lessons Learned

遷移現有 Agent 採用扁平化 + 命名前綴（sys-/dom-），動態資料分流（EQUIPMENT.md 移至 sys-equipment/references/loadout.md）。

## Capabilities

- 語義清晰 — 一眼看出什麼屬於 bot、什麼屬於關係
- 可攜性最大化 — 複製 skills/ 就帶走所有 bot 能力，根目錄清空開新關係
- 符合 references/ 設計意圖 — references/ 是「文件 + bot 狀態」，不是「關係資料庫」
- 遷移風險低 — 現有根目錄檔案位置不變，只新增 skill 裡的 bot 狀態追蹤
- 存儲演化解耦 — Bot State 永遠用檔案系統、Relationship Data 可未來演化到 RAG 向量資料庫，互不影響
