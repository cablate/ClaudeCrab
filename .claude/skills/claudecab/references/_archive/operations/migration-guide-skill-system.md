# Skill-Based Character System 遷移指南

> **類型**：遷移指南 / 規劃文件
> **時間範圍**：~2026-02-08（設計）
> **狀態**：✅ 已完成歸檔（歷史文件，不再更新）
> **後續影響**：定義了 agent skill 目錄從扁平結構遷移到「扁平 + 命名前綴」架構的完整路徑（5 個 Phase）。為後續的 MMORPG 遊戲化系統（proficiency、achievements、character-sheet）提供了具體的目錄結構設計和實作步驟。

---

## 背景：為什麼做這件事

ClaudeCab 的 agent 使用 Claude Code 的 skill 機制（`.claude/skills/<name>/SKILL.md`）來組織能力模組。隨著功能增長，需要一套分類體系來區分不同性質的 skill：

- **系統協議**（sys-*）：agent 的行為規範、記憶協議
- **人格定義**（persona）：角色身份、性格特質
- **領域能力**（dom-*）：實際的功能技能（瀏覽器操作、搜尋等）

同時，MMORPG 遊戲化系統的設計需要新增三個追蹤模組：技能熟練度（proficiency）、成就系統（achievements）、角色面板（character-sheet）。

### 關鍵技術限制

**Claude Code 只支援一層目錄**（`.claude/skills/<name>/SKILL.md`），巢狀目錄中的 SKILL.md 不會被發現。因此採用**命名前綴**代替子目錄來表達三層概念。

---

## 核心發現 / 決策

### 五階段遷移設計

| Phase | 內容 | 預估時間 | 關鍵決策 |
|-------|------|---------|---------|
| **Phase 1** | 重新命名現有 skill 目錄（加 sys-/dom- 前綴） | 10 分鐘 | 不改 SKILL.md 的 name 欄位，只改資料夾名 |
| **Phase 2** | 新增 proficiency + achievements + character-sheet | 30 分鐘 | 以 Markdown 檔案追蹤數據（levels.md, unlocked.md, stats.md） |
| **Phase 3** | memory-system 定位決策 | 設計決策 | **保留在 agent-protocols/references/ 內，不獨立成 skill**（因為它是「寫入協議」而非「自治模組」） |
| **Phase 4** | 更新 agent-protocols 啟動流程 | 10 分鐘 | 啟動時依序載入：Identity → Memory → Equipment → Proficiency → Character Sheet |
| **Phase 5** | 配置 Stop Hook 批次更新 | 15 分鐘 | 在 MEMORY_STOP_CHECKPOINT 常數中加入系統更新提醒 |

### 目標目錄結構

```
agents/general/.claude/skills/
├── sys-agent-protocols/    # 行為規範、記憶協議
├── sys-equipment/          # 裝備系統
├── sys-proficiency/        # 技能熟練度追蹤
├── sys-achievements/       # 成就里程碑
├── sys-character-sheet/    # 角色屬性面板
├── persona/                # 人格定義（不加前綴）
├── dom-agent-browser/      # 瀏覽器操作能力
├── dom-find-skills/        # Skill 搜尋能力
└── dom-find-mcp/           # MCP 搜尋能力
```

### 關鍵設計決策：memory-system 不獨立

memory-system 保留在 `sys-agent-protocols/references/` 而非獨立成 skill，理由：
- proficiency、equipment、achievements 的資料在自己的 references/ 裡自洽
- memory-system 管的是「寫入規則」，寫入目標是根目錄的關係資料（MEMORY.md、USER.md）
- 本質上是「寫入協議」，與 behavior.md 同性質——行為規範，不是自治模組

### 遊戲化追蹤設計

| 模組 | 追蹤內容 | 更新時機 |
|------|---------|---------|
| **Proficiency** | 各 domain skill 使用次數與等級（★1-5） | 使用 domain skill 後 / Stop Hook 批次 |
| **Achievements** | 里程碑解鎖（連續服務、對話次數、技能精通） | 達成條件時 / Stop Hook 檢查 |
| **Character Sheet** | 聚合面板（角色資訊 + 記憶深度 + 技能狀態） | 每日 / 每週定期更新 |

---

## 執行結果

此文件是**遷移規劃**，定義了完整的操作步驟和驗證清單。部分 Phase 已在後續開發中執行（如 skill 目錄重組），遊戲化追蹤模組的完整實作則仍在演進中。

---

## 回顧：學到了什麼

1. **平台限制決定架構形式**：Claude Code 一層目錄限制直接決定了「命名前綴」方案。理解平台約束是架構設計的第一步。
2. **分類的價值**：sys-/persona/dom- 前綴讓 skill 的性質一目了然，降低了認知負擔。
3. **「協議」vs「模組」的區分**：memory-system 的定位決策揭示了一個設計原則——如果一個組件的「管轄範圍」超出自身目錄（需要寫入根目錄檔案），它更適合做為協議而非獨立模組。
4. **批次更新 vs 即時更新**：Stop Hook 批次更新是一個務實的折中——避免每次 skill 使用都觸發寫入，集中在對話結束時處理。

---

## 關聯文件

- 設計基礎：[skill-based-character-system.md](../system/skill-based-character-system.md)
- 遊戲化設計：[mmorpg-skill-system.md](../product/mmorpg-skill-system.md)
- 相關 ADR：涉及 skill 系統的架構決策
