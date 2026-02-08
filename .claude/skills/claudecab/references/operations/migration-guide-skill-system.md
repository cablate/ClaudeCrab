# Skill-Based Character System 遷移指南

> 如何將現有 agent（如 general）遷移到新的 Skill-Based Character System

---

## 目標

將現有 agent 從扁平 skill 結構遷移到三層架構（system/persona/domain），並加入 Bot 狀態追蹤機制（proficiency, achievements, character-sheet）。

---

## 遷移前檢查清單

### 現況評估

針對要遷移的 agent（以 `general` 為例），確認：

- [ ] 當前有哪些 skills？
- [ ] 哪些是「系統協議」（agent-protocols）？
- [ ] 哪些是「人格定義」（persona）？
- [ ] 哪些是「實際能力」（agent-browser, find-skills 等）？
- [ ] 根目錄有哪些檔案？（MEMORY.md, USER.md 等）
- [ ] EQUIPMENT.md 是否存在？

### 備份

```bash
# 備份整個 agent 目錄
cp -r agents/general agents/general.backup.$(date +%Y%m%d)
```

---

## Phase 1：建立資料夾結構（10 分鐘）

### 目標

從扁平結構變成三層分類，不改任何 SKILL.md 內容。

### 操作步驟

**1. 建立三個主資料夾**

```bash
cd agents/general/.claude/skills
mkdir -p system persona domain
```

**2. 移動現有 skills**

```bash
# 系統協議 → system/
mv agent-protocols system/

# 裝備系統 → system/（需改名）
mv equip system/equipment

# 人格 → 維持頂層（不移動到 system 裡）
# persona 已經在正確位置

# 實際能力 → domain/
mv agent-browser domain/
mv find-skills domain/
mv find-mcp domain/
```

**3. 驗證結構**

```bash
tree -L 2
# 應該看到：
# .claude/skills/
# ├── system/
# │   ├── agent-protocols/
# │   └── equipment/
# ├── persona/
# └── domain/
#     ├── agent-browser/
#     ├── find-skills/
#     └── find-mcp/
```

**4. 更新 equipment skill 名稱**

```bash
# 編輯 system/equipment/SKILL.md
# 把 name: equip 改成 name: equipment
```

### 驗證

啟動 bot，執行 `/agent-protocols`，確認：
- [ ] 能正常載入 agent-protocols
- [ ] 能正常載入 persona
- [ ] 能正常使用 domain skills

---

## Phase 2：新增 Bot 狀態追蹤（30 分鐘）

### 2.1 新增 proficiency skill

**建立目錄結構**

```bash
mkdir -p system/proficiency/references
```

**建立 SKILL.md**

```yaml
---
name: proficiency
description: >
  技能熟練度追蹤。記錄 domain/ 裡每個技能的使用次數與等級。
  定義等級（★☆☆☆☆ 到 ★★★★★）、升級條件。
  觸發時機：使用 domain skill 後、session 啟動時查看。
---

# Proficiency System

## 等級定義

| 等級 | 星級 | 使用次數 | 特徵 |
|------|------|---------|------|
| Novice | ★☆☆☆☆ | 0-9 | 剛安裝 |
| Apprentice | ★★☆☆☆ | 10-49 | 開始累積經驗 |
| Adept | ★★★☆☆ | 50-199 | 有自己的最佳實踐 |
| Expert | ★★★★☆ | 200-499 | 能處理邊界情況 |
| Master | ★★★★★ | 500+ | 品質穩定，可匯出 |

## 當前等級

記錄在：[references/levels.md](references/levels.md)
```

**建立 references/levels.md**

```markdown
# Skill Proficiency Levels

**更新日期**：2026-02-08

## Domain Skills

### agent-browser ★☆☆☆☆ Novice
- 使用次數：2
- 最後使用：2026-02-02
- 狀態：新安裝

### find-skills ★☆☆☆☆ Novice
- 使用次數：5
- 最後使用：2026-02-01
- 狀態：偶爾使用

### find-mcp ★☆☆☆☆ Novice
- 使用次數：3
- 最後使用：2026-01-30
- 狀態：偶爾使用

---

*此檔案由 bot 自動維護。每次使用 domain skill 後批次更新。*
```

### 2.2 新增 achievements skill

**建立目錄結構**

```bash
mkdir -p system/achievements/references
```

**建立 SKILL.md**

```yaml
---
name: achievements
description: >
  成就里程碑系統。定義各項成就的解鎖條件。
  記錄已解鎖的成就與進行中的進度。
  觸發時機：達成里程碑時、session 啟動時查看。
---

# Achievements System

## 成就類別

### 使用里程碑
- 🎯 連續服務 7 天
- 🎯 連續服務 30 天
- 📝 總對話次數 100 / 500 / 1000

### 記憶成長
- 🧠 記憶突破 1000 tokens
- 🧠 識別 10 個 Pattern

### 技能精通
- ⚔️ 首個技能達到 ★★★☆☆
- 👑 培養出 Master 級技能

### 協作成就
- 🤝 成功委派 10 次

## 已解鎖成就

記錄在：[references/unlocked.md](references/unlocked.md)

## 進行中進度

記錄在：[references/progress.md](references/progress.md)
```

**建立 references/unlocked.md**

```markdown
# Unlocked Achievements

（目前無已解鎖成就，bot 會在達成時自動記錄）
```

**建立 references/progress.md**

```markdown
# Achievement Progress

## 進行中

### 🎯 連續服務 7 天
進度：？/7 天（需要追蹤活躍天數）

### 📝 總對話次數 100
進度：？/100（需要查詢 conversation DB）
```

### 2.3 新增 character-sheet skill

**建立目錄結構**

```bash
mkdir -p system/character-sheet/references
```

**建立 SKILL.md**

```yaml
---
name: character-sheet
description: >
  角色屬性面板。定義各項屬性的意義，聚合其他系統的數據。
  提供 bot 的整體狀態總覽。
  觸發時機：session 啟動時、定期更新。
---

# Character Sheet

## 屬性定義

### 基礎資訊
- 角色名稱：從 persona/identity.md
- 活躍天數：從 session DB
- 對話次數：從 conversation DB

### 記憶深度
計算方式：MEMORY.md 大小 + 日誌數量 + Pattern 數量

### 技能狀態
- 裝備數量：從 equipment/loadout.md
- 平均熟練度：從 proficiency/levels.md

## 當前數據

記錄在：[references/stats.md](references/stats.md)
```

**建立 references/stats.md**

```markdown
# Character Stats

**更新日期**：2026-02-08

## 基礎資訊
- **角色**：大總管（General Assistant）
- **活躍天數**：？（需查詢 DB）
- **對話次數**：？（需查詢 DB）

## 記憶深度
- MEMORY.md：？ tokens
- 日誌數量：？ 天
- 已識別 Pattern：？ 個

## 技能狀態
- 裝備數量：3 domain skills
- 平均熟練度：★☆☆☆☆ (Novice)

---

*此檔案由 bot 定期更新（每日/每週）。*
```

---

## Phase 3：memory-system 定位（設計決策）

> **結論**：memory-system 保留在 agent-protocols/references/ 內，不獨立成 skill。

### 理由

memory-system 跟其他 system skill 有根本性差異：

- **proficiency、equipment、achievements** 的資料完全在自己的 references/ 裡自洽
- **memory-system** 管的是「寫入規則」，但寫入目標是根目錄的關係資料（MEMORY.md、USER.md、memory/）
- 它本質上是一份「寫入協議」，跟 safety.md、guidelines.md 同性質——都是行為規範，不是自治模組

### 實作

不需要操作。memory-system.md 維持在 `system/agent-protocols/references/memory-system.md`。

> 詳見設計文件：[skill-based-character-system.md](../system/skill-based-character-system.md) §2 memory-system 章節

---

## Phase 4：更新 agent-protocols 啟動流程

### 目標

讓 agent-protocols 在啟動時載入新的 system skills。

### 編輯 startup-protocol.md

```markdown
# Startup Protocol

每次 session 開始時的執行順序：

## Phase 1: Identity
載入 `/persona`

## Phase 2: Memory
載入 `/memory-system`（如已分離）或讀取 memory-system.md

## Phase 3: Equipment
載入 `/equipment` 檢查當前裝備

## Phase 4: Proficiency
載入 `/proficiency` 查看技能等級

## Phase 5: Character Sheet
載入 `/character-sheet` 獲得整體狀態
```

---

## Phase 5：配置 Stop Hook 批次更新

### 目標

讓 bot 在對話結束時批次更新 proficiency/achievements。

### 編輯 src/core/constants.ts

在 `MEMORY_STOP_CHECKPOINT` 常數中加入系統更新提醒：

```typescript
export const MEMORY_STOP_CHECKPOINT =
  '【記憶檢查】結束前，根據 memory-system 規範檢查這輪有沒有該記的內容。...\n\n' +
  '【系統更新（批次）】\n' +
  '- 使用了 domain skill？→ 更新 .claude/skills/system/proficiency/references/levels.md 的使用次數\n' +
  '- 學到通用規則？→ 更新 .claude/skills/persona/references/soul.md\n' +
  '- 學到特定適應？→ 寫入 MEMORY.md 或 CLAUDE.md Lessons Learned\n' +
  '- 達成里程碑？→ 更新 .claude/skills/system/achievements/references/unlocked.md';
```

> **注意**：此常數影響所有 agent。未遷移的 agent 會收到不存在路徑的提示，但 bot 會自行忽略（不存在就跳過）。待全部 agent 遷移完成後此問題自然消失。

群組模式（`buildMemoryStopCheckpoint(groupChatId)`）使用獨立的靜默版本，不包含系統更新提醒。

---

## 驗證清單

### Phase 1 完成後

- [ ] Bot 能正常啟動
- [ ] `/agent-protocols` 正常載入
- [ ] `/persona` 正常載入
- [ ] Domain skills 正常使用（如 `/agent-browser`）
- [ ] 資料夾結構清晰（system/persona/domain）

### Phase 2 完成後

- [ ] `/proficiency` 能正常載入
- [ ] `/achievements` 能正常載入
- [ ] `/character-sheet` 能正常載入
- [ ] proficiency/levels.md 有初始數據
- [ ] 使用 domain skill 後，levels.md 有更新

### Phase 3（設計決策）

- [x] memory-system 保留在 agent-protocols/references/ 內（非獨立 skill）
- [x] 理由已記錄在設計文件（跨界協議，非自治模組）

### Phase 5 完成後

- [ ] Stop hook 有提醒系統更新
- [ ] Bot 會批次更新 proficiency/levels.md
- [ ] Bot 會在達成里程碑時更新 achievements

---

## 常見問題

### Q1: 移動 skill 後，bot 找不到？

**A**: Claude Code 支援子目錄。確認：
1. SKILL.md 的 name 欄位正確
2. 沒有拼寫錯誤
3. 重啟 bot 讓 skill 重新載入

### Q2: proficiency 如何追蹤使用次數？

**A**: 兩種方式：
1. **手動**：使用 domain skill 後，bot 手動更新 levels.md
2. **Stop Hook**：對話結束時，bot 批次檢查「今天用了哪些 skill」並更新

### Q3: character-sheet 的數據從哪來？

**A**: 聚合多個來源：
- 活躍天數、對話次數：QueryMetricsRepository
- 記憶深度：MEMORY.md 檔案大小 + memory/ 目錄檔案數
- 技能狀態：proficiency/levels.md + equipment/loadout.md

### Q4: 根目錄的 EQUIPMENT.md 要刪嗎？

**A**: 可以移到 `system/equipment/references/loadout.md`，因為這是「bot 狀態」不是「關係資料」。

---

## 進階：WebUI Dashboard 整合

遷移完成後，WebUI 可以讀取這些 skill 檔案展示角色面板：

```typescript
// 讀取 character-sheet
const statsPath = path.join(agentPath, '.claude/skills/system/character-sheet/references/stats.md');
const stats = await fs.readFile(statsPath, 'utf-8');

// 解析 markdown，渲染成 UI
renderCharacterSheet(parseMarkdown(stats));
```

---

*本指南提供 step-by-step 遷移步驟，確保平滑過渡到 Skill-Based Character System。*
