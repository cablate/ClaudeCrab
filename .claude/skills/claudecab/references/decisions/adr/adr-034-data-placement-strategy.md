# ADR-034: Skill-Based Character System 資料配置策略

> 原編號 ADR-031，因與 ADR-031 Hook 系統解耦衝突，重新編號為 ADR-034。

**狀態**：✅ Accepted & Implemented (general agent)
**日期**：2026-02-08
**決策者**：Cab
**相關文件**：[skill-based-character-system.md](../../system/skill-based-character-system.md), [mmorpg-skill-system.md](../../product/mmorpg-skill-system.md)

---

## Context

ClaudeCab 採用 Skill-Based Character System，把 MMORPG 角色養成機制搬到 AI Bot 管理上。在設計過程中遇到核心問題：

**「哪些資料應該放在 skill 的 references/ 裡動態更新，哪些應該放在 agent 根目錄？」**

這個決策影響：
- 系統的可攜性（skill 複製到其他 bot）
- 資料的語義清晰度（什麼屬於 bot，什麼屬於關係）
- 維護的複雜度（更新時找哪個檔案）

---

## Decision

採用「Bot 狀態 vs 關係資料」分離策略：

### 原則一：換使用者測試

> **判斷標準**：「換一個使用者，這個東西還在嗎？」

- **還在** → skill/references/（Bot 自己的狀態）
- **不在** → 根目錄（Bot 跟使用者的關係）

### 原則二：Schema vs Instance Data

| 類型 | 定義 | 位置 | 範例 |
|------|------|------|------|
| **Schema** | 規則、定義、怎麼做 | skill/SKILL.md 或 references/*.md（靜態） | 「★★★☆☆ = 50-199 次使用」 |
| **Bot State** | Bot 自己的屬性、數值 | skill/references/*.md（動態） | 「agent-browser: 287 次，★★★★☆」 |
| **Relationship Data** | Bot 跟使用者的互動記錄 | 根目錄（動態） | 「Cab 偏好簡短回覆」 |

### 原則三：通用 vs 特定人格特質

從合作中提煉的人格特質：

| 類型 | 判斷 | 位置 | 範例 |
|------|------|------|------|
| **通用人格升級** | 對所有使用者都適用 | persona/soul.md | 「簡短、emoji 極少」 |
| **特定使用者適應** | 只對這個使用者有效 | MEMORY.md 或 CLAUDE.md Lessons Learned | 「Cab 喜歡被直球挑戰」 |

---

## 具體配置表

### 📁 Skills/（動態更新 = Bot 狀態）

| 檔案路徑 | 內容 | 更新時機 |
|---------|------|---------|
| `sys-proficiency/references/levels.md` | 各 domain skill 的使用次數與等級 | 使用 domain skill 後批次更新 |
| `sys-equipment/references/loadout.md` | 當前裝備的 skills 和 MCP servers | 安裝/移除工具時 |
| `sys-achievements/references/unlocked.md` | 已解鎖的成就列表 | 達成里程碑時 |
| `sys-achievements/references/progress.md` | 進行中的成就進度 | 每天批次更新 |
| `sys-character-sheet/references/stats.md` | 聚合數據（活躍天數、對話次數等） | 定期聚合（每日/每週） |
| `persona/soul.md` | 通用人格特質（價值觀、說話風格） | 發現通用人格升級時 |

**核心邏輯**：這些是 Bot 本身的屬性。換一個使用者，Bot 還是 Lv.50 的射箭手、還是裝備鐵劍+3、還是屠龍者成就持有者。

### 📁 根目錄/（動態更新 = 關係資料）

| 檔案路徑 | 內容 | 更新時機 |
|---------|------|---------|
| `MEMORY.md` | 跟這個使用者的長期記憶、Pattern | 每次對話後 |
| `USER.md` | 關於這個使用者的資訊 | 發現新資訊時 |
| `ACTIVE.md` | 跟這個使用者的進行中專案 | 專案變化時 |
| `memory/YYYY-MM-DD.md` | 跟這個使用者的每日日誌 | 每天 |
| `CLAUDE.md` Lessons Learned | 針對這個使用者的特定適應規則 | 學到特定適應時 |

**核心邏輯**：這些是 Bot 跟特定使用者的關係資料。換一個使用者，這些全部清空重來。

### 📄 Skills/（靜態 = 規則定義）

| 檔案路徑 | 內容 | 性質 |
|---------|------|------|
| `sys-agent-protocols/references/memory-system.md` | 記憶寫入規則（什麼寫到哪、何時寫） | 靜態規則 |
| `sys-proficiency/SKILL.md` | 等級定義（★☆☆☆☆ 到 ★★★★★） | 靜態定義 |
| `sys-equipment/SKILL.md` | 裝備欄結構、容量上限 | 靜態定義 |
| `sys-achievements/SKILL.md` | 成就定義、解鎖條件 | 靜態定義 |

**核心邏輯**：這些是遊戲規則。不會變。

---

## Consequences

### 優點

1. **語義清晰** — 一眼看出什麼屬於 bot、什麼屬於關係
2. **可攜性最大化** — 複製 skills/ 就帶走所有 bot 能力，根目錄清空開新關係
3. **符合 References/ 設計意圖** — references/ 是「文件 + bot 狀態」，不是「關係資料庫」
4. **遷移風險低** — 現有根目錄檔案位置不變，只新增 skill 裡的 bot 狀態追蹤
5. **存儲演化解耦** — 兩類資料可以獨立演化存儲後端，互不影響（見下方「存儲演化路徑」）

### 缺點

1. **需要明確判斷** — 每次寫入資料時要問「這屬於 bot 還是關係？」
2. **根目錄還是有檔案** — 不能做到「所有資料都在 skill 裡」的極簡美學（但這不是真正的缺點，因為關係資料本來就該在外面）

### 風險

1. **bot 可能寫錯位置** — 需要在 agent-protocols 裡明確定義「什麼寫到哪」的規則
2. **灰色地帶處理** — 「從合作提煉的人格特質」需要明確判斷是通用還是特定

**緩解措施**：
- 在 agent-protocols/references/memory-system.md 定義明確的寫入規則
- 在 Stop Hook 提醒 bot 檢查「今天學到的是通用規則還是特定適應」

---

## 存儲演化路徑

這個分離策略最深層的價值：**不同類型的資料有不同的存儲演化需求，分離後可以獨立演化，互不影響。**

### Bot State（skill/references/）— 永遠是檔案

| 特徵 | 說明 |
|------|------|
| 量 | 小且穩定（levels.md 永遠就那幾個 skill 的數值） |
| 存取模式 | 精確讀取（「agent-browser 用了幾次？」） |
| 結構 | 結構化（markdown 表格、固定格式） |
| 最佳存儲 | 檔案系統（可攜、可讀、bot 直接 Read/Write） |

不需要語義搜尋，不需要資料庫。markdown 檔案是最佳選擇——可攜性、可讀性、零依賴。

### Relationship Data（根目錄/）— 可演化到 RAG

| 特徵 | 說明 |
|------|------|
| 量 | 無限增長（每天一份日誌，180 天 = 180 個檔案） |
| 存取模式 | 語義檢索（「上次討論 token 經濟模型是什麼時候？」） |
| 結構 | 非結構化文本（日誌、記憶、對話脈絡） |
| 最佳存儲 | 現在：檔案（夠用）→ 未來：向量資料庫（量大時遷移） |

```
演化路徑：

Phase 1（現在）：markdown 檔案
├── memory/2026-02-08.md
├── MEMORY.md
└── 夠用，量不大

Phase 2（量大時）：RAG 向量資料庫
├── 每日日誌 → embedding 存入向量 DB
├── MEMORY.md → 可保留為 curated summary，或也入 DB
├── bot 寫入介面不變（write protocol 不動）
└── bot 讀取改為語義檢索（search protocol 調整）
```

### 為什麼這個解耦很重要？

1. **memory-system 是「寫入協議」不是「存儲實作」** — 遷 RAG 時只改寫入目標，協議規則（什麼該記、什麼放哪）完全不動
2. **skill 系統零影響** — proficiency、achievements、character-sheet 跟關係資料的存儲後端無關
3. **漸進式遷移** — 可以先遷日誌（量最大），MEMORY.md 和 USER.md 後遷或不遷
4. **不被鎖死** — 今天選 markdown 是因為夠用，不是因為架構綁死在檔案系統上

---

## 白話版類比

```
Bot = RPG 角色

skills/references/（動態）= 角色數值面板
├── 等級：射箭 Lv.50、煉金 Lv.20
├── 裝備：鐵劍+3、皮甲、治療藥水
├── 成就：屠龍者、百戰精英
└── 性格：勇敢、謹慎（通用特質）

根目錄/（動態）= 這次遊玩的存檔
├── 跟 NPC "Cab" 的對話記錄
├── 跟 "Cab" 一起解的任務清單
├── 對 "Cab" 的了解（他喜歡直球對決）
└── 今日冒險日誌

重開存檔（換使用者）時：
✅ 角色數值保留 — 還是 Lv.50 射箭手、還有屠龍者成就
❌ 存檔清空 — 不認識新 NPC、沒有共同任務、從頭建立關係
```

---

## Implementation Notes

### 遷移現有 Agent（如 general）

**Phase 1: 扁平化 + 命名前綴**（Claude Code 只支援一層目錄）
```bash
.claude/skills/
├── sys-agent-protocols/ ← 移動 + 加前綴
├── sys-equipment/       ← equip 改名 + 加前綴
├── sys-proficiency/     ← 新建
├── sys-achievements/    ← 新建
├── sys-character-sheet/ ← 新建
├── persona/             ← 維持原位
├── dom-agent-browser/   ← 移動 + 加前綴
├── dom-find-skills/     ← 移動 + 加前綴
└── dom-find-mcp/        ← 移動 + 加前綴
```

**Phase 2: 動態資料分流**
- `EQUIPMENT.md` → 移到 `sys-equipment/references/loadout.md`
- 根目錄其他檔案（MEMORY.md, USER.md, ACTIVE.md, memory/）保持不動

### Stop Hook 更新提醒

在 `buildMemoryStopCheckpoint` 加入：

```markdown
【對話結束前系統更新】
- 使用了 domain skill？→ 更新 proficiency/levels.md
- 學到通用規則？→ 更新 persona/soul.md
- 學到特定適應？→ 寫入 MEMORY.md 或 CLAUDE.md
- 達成里程碑？→ 更新 achievements/
```

---

## Alternatives Considered

### 方案 A：所有資料都在 Skill 裡

```
system/memory-system/references/
├── rules.md
├── MEMORY.md          ← 實際記憶也放這
├── USER.md
└── memory/
```

**拒絕理由**：
- References/ 語義混淆（既是文件又是資料庫）
- 違反「記憶是關係產物」的核心洞察
- 可攜性反而降低（複製 memory-system skill 會帶走跟舊使用者的記憶）

### 方案 B：Bot 狀態也放根目錄

```
根目錄/
├── MEMORY.md
├── proficiency.md     ← 放這
├── achievements.md    ← 放這
└── equipment.md       ← 放這
```

**拒絕理由**：
- 根目錄過於臃腫
- Bot 狀態跟關係資料混在一起，語義不清
- 複製 bot 給新使用者時不知道哪些該清空哪些該保留

---

## Related Decisions

- **ADR-012**: Skill First — Agent 行為規範用 Skill 管理
- **ADR-013**: Keyword Index in Description — Skill description 用關鍵詞索引而非內容窮舉
- **ADR-027**: Dashboard Config Management — Dashboard 如何讀寫 agent 配置

---

## References

- [Skill-Based Character System 完整設計](../../system/skill-based-character-system.md)
- [MMORPG Skill System 設計](../../product/mmorpg-skill-system.md)
- [AgentSkill Expertise 知識體系](C:\Users\User\.claude\skills\agentskill-expertise\SKILL.md)

---

*本 ADR 記錄了 ClaudeCab 在 Skill-Based Character System 實作中關於「資料配置策略」的核心決策，是理解整套系統設計的關鍵文件。*
