## Summary

重新定義 Agent 工作目錄的語意分區，讓每個路徑有明確的「什麼能放、什麼不能放」定義，支撐員工自主運作和未來知識資料庫的遷移。

## Motivation

Agent 開始自主執行排程（反思、學習、考核），但目錄結構缺乏明確分區，導致：

1. **knowledge/ 是垃圾桶** — 反思學到的知識、使用者交辦的調查報告、工具文件、管理日誌全混在一起。員工寫入時靠直覺，找資料時靠運氣。
2. **output/ 無標準** — 只有 general 有 output/，裡面影片、圖片、電子報草稿、debug 截圖全在同一層。其他 agent 沒有產出目錄。
3. **知識沒有生命週期** — 反思學到的東西寫進 knowledge/ 後就永遠留在那裡，沒有「暫存 → 歸納進 Skill → 清除」的路徑。
4. **管理產出混入知識區** — Admin 的 growth-reviews 和 agent-changes-log 塞在 knowledge/ 裡，本質是操作紀錄不是知識。
5. **plans/、tasks/ 不在模板中** — Coder 自己長出來的，不是標準結構。
6. **未來無法遷移** — 如果要導入知識資料庫（向量搜尋、關聯排名），需要每個目錄的內容是同質的，目前混亂的結構無法乾淨地匯入。

## Proposed Solution

定義 `agents/_example/` 模板的標準目錄結構，明確每個目錄的語意、寫入規則、內容性質：

| 目錄 | 語意 | 內容性質 | 寫入者 |
|------|------|----------|--------|
| `memory/` | 工作日誌 | 當日流水帳 → 反思後結構化 | Agent 自己 |
| `knowledge/` | 知識暫存區 | 反思/研究學到的原始知識，尚未歸納進 Skill | Agent 自己 |
| `output/` | 交付產出 | 使用者交辦的成果物、過程文件、分析報告 | Agent 自己 |
| `evolution/` | 自我進化 | 反思摘要、提案、成長紀錄 | Agent 自己 / Admin |
| `schedules/` | 排程定義 | YAML 排程設定 | Admin / 使用者 |
| `plans/` | 任務規劃 | Plan mode 產出的規劃文件 | Agent 自己 |

**核心改變**：
- `knowledge/` 嚴格限定為「知識暫存區」— 只放學習到的、可被未來任務直接引用的知識素材。過程文件和交付物移到 `output/`。
- 新增 `output/` 為所有 agent 的標準目錄 — 使用者交辦產出的統一去處。
- Admin 的 `growth-reviews/` 從 `knowledge/` 移到 `evolution/reviews/` — 這是管理操作紀錄，不是知識。
- 更新所有相關協議文件（REFLECTION-PROTOCOL、sys-self-evolution、behavior.md、CLAUDE.md 模板）。
- 定義 knowledge/ 的清理機制 — 歸納進 Skill 後標記或移除。

## Capabilities

### New Capabilities

- `agent-workspace-structure`: Agent 工作目錄的標準結構定義，包含每個目錄的語意、寫入規則、內容分類

### Modified Capabilities

- `agent-self-evolution`: 更新知識內化路徑（knowledge/ 嚴格定義為暫存區 + 歸納標記機制）

## Impact

- Affected specs: `shared-knowledge`（路徑權限定義可能需更新）、`agent-self-evolution`（知識內化路徑）
- Affected code: 無程式碼變更（純文件/協議層面）
- Affected files:
  - `agents/_example/` 模板目錄結構
  - `agents/_example/CLAUDE.md` 目錄結構參考表
  - `agents/_example/.claude/rules/self-evolution.md` Layer 1 定義
  - `agents/_example/.claude/skills/sys-self-evolution/SKILL.md` 知識分類表
  - `agents/_example/.claude/skills/sys-agent-protocols/references/memory-system.md` 檔案系統表
  - `agents/_example/.claude/skills/sys-agent-protocols/references/behavior.md` 路徑權限表
  - `agents/_example/evolution/REFLECTION-PROTOCOL.md` Phase 4 內化路徑
  - 各 agent 的實際目錄遷移（knowledge/ 中的非知識文件移到 output/）
