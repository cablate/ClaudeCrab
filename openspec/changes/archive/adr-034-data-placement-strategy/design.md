# 設計：Skill-Based Character System 資料配置策略

## Decisions

### 分離原則：Bot 狀態 vs 關係資料

核心判斷標準：「換一個使用者，這個東西還在嗎？」

- 還在（Bot 自己的屬性）→ skill/references/
- 不在（Bot 跟使用者的關係）→ 根目錄

### Bot State 配置（skill/references/ — 動態更新）

| 檔案路徑 | 內容 | 更新時機 |
|---------|------|---------|
| sys-proficiency/references/levels.md | 各 domain skill 使用次數與等級 | 使用 domain skill 後批次更新 |
| sys-equipment/references/loadout.md | 當前裝備的 skills 和 MCP servers | 安裝/移除工具時 |
| sys-achievements/references/unlocked.md | 已解鎖的成就列表 | 達成里程碑時 |
| sys-achievements/references/progress.md | 進行中的成就進度 | 每天批次更新 |
| sys-character-sheet/references/stats.md | 聚合數據 | 定期聚合 |
| persona/soul.md | 通用人格特質 | 發現通用人格升級時 |

### Relationship Data 配置（根目錄 — 動態更新）

MEMORY.md、USER.md、ACTIVE.md、memory/YYYY-MM-DD.md、CLAUDE.md Lessons Learned。這些是 Bot 跟特定使用者的關係資料，換使用者全部清空重來。

### Schema 配置（skill/ — 靜態規則）

sys-agent-protocols/references/memory-system.md（記憶寫入規則）、sys-proficiency/SKILL.md（等級定義）、sys-equipment/SKILL.md（裝備欄結構）、sys-achievements/SKILL.md（成就定義）。這些是遊戲規則，不會變。

### 遷移策略：扁平化 + 命名前綴

Claude Code 只支援一層目錄，採用 sys-/dom- 前綴扁平化。EQUIPMENT.md 移至 sys-equipment/references/loadout.md。根目錄其他檔案保持不動。

### 存儲演化路徑

Bot State 永遠是檔案（量小、結構化、精確讀取）。Relationship Data 現階段用 markdown 檔案，量大時可演化到 RAG 向量資料庫。memory-system 是「寫入協議」不是「存儲實作」，遷 RAG 時只改寫入目標，協議規則不動。

### Stop Hook 更新提醒

在 buildMemoryStopCheckpoint 加入檢查項：使用了 domain skill → 更新 proficiency、學到通用規則 → 更新 persona/soul.md、學到特定適應 → 寫入 MEMORY.md、達成里程碑 → 更新 achievements/。

## Risks / Trade-offs

- 每次寫入資料時需要明確判斷「這屬於 bot 還是關係？」
- 根目錄還是有檔案，不能做到「所有資料都在 skill 裡」的極簡美學
- Bot 可能寫錯位置 — 需要在 agent-protocols 明確定義寫入規則
- 灰色地帶處理 — 「從合作提煉的人格特質」需明確判斷是通用還是特定
- 緩解措施：agent-protocols/references/memory-system.md 定義明確寫入規則 + Stop Hook 提醒檢查

## Affected Components

- 各 agent 的 `.claude/skills/` — 遷移為 sys-/dom- 前綴扁平化結構
- `sys-proficiency/`、`sys-equipment/`、`sys-achievements/`、`sys-character-sheet/` — 新建 skill
- `persona/soul.md` — 維持原位
- `sys-agent-protocols/references/memory-system.md` — 定義寫入規則
- Stop Hook（buildMemoryStopCheckpoint）— 加入更新提醒
