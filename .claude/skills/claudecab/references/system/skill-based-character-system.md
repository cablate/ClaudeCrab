# Skill-Based Character System — ClaudeCab 的遊戲化 Bot 管理架構

> **核心差異化特色**：把 MMORPG 角色養成系統搬到 AI Bot 管理上，全部建立在 Agent Skill 機制之上，零額外基礎設施。

---

## 目錄

1. [設計哲學](#設計哲學)
2. [架構總覽](#架構總覽)
3. [三層 Skill 分類](#三層-skill-分類)
4. [資料配置策略](#資料配置策略)
5. [System Skills 詳細設計](#system-skills-詳細設計)
6. [資料流與更新機制](#資料流與更新機制)
7. [實作指南](#實作指南)
8. [與 OpenClaw 的根本差異](#與-openclaw-的根本差異)
9. [對 Agent Skill 理解的展現](#對-agent-skill-理解的展現)

---

## 設計哲學

### 核心洞察

> **用 Claude Code 已有的 skill 機制當「資料庫引擎」——SKILL.md 是 schema，references/ 是 data，bot 自己是 CRUD operator。零新基礎設施。**

SKILL.md = 定義這個東西是什麼、怎麼運作（schema）
references/ = 實際的數值、記錄、狀態（data）

這個洞察讓我們可以把**所有系統都統一成 skill**，不需要額外寫任何基礎設施——全部跑在 Claude Code 已經有的 skill 機制上。

### 三層分離的真正意義

三層架構不只是「分類」，而是回答三個根本不同的問題：

| 層級 | 問題 | 性質 |
|------|------|------|
| `system/` | 這個遊戲怎麼玩？ | 規則（所有角色共用） |
| `persona/` | 這個角色是誰？ | 身份（定義角色自我） |
| `domain/` | 這個角色會什麼？ | 能力（可裝備、可成長） |

### 四個關鍵設計決策

**1. 一切皆 Skill**

不建立特殊的「記憶系統」「裝備系統」「成就系統」程式碼。全部用 skill 表達，agent 自主管理。

**2. 模組自治**

proficiency 要更新等級就更新自己的 references/levels.md，不用動其他 skill。achievements 要記錄解鎖就更新自己的 references/unlocked.md。互不干擾。

**3. 最大化可攜性**

想帶技能？複製 `dom-seo-writing/`。想帶整套角色系統？複製所有 `sys-*` 目錄。甚至帶到非 ClaudeCab 的 Claude Code 專案也行。

**4. 協議與狀態分離**

記憶寫入規則（memory-system）是「寫入協議」——規則在 skill 裡，但寫入目標是根目錄的關係資料（MEMORY.md、USER.md）。這種「跨界」協議留在 agent-protocols 內部，不獨立成 skill。真正自治的 system skill（proficiency、equipment 等）則獨立存在，資料完全在自己的 references/ 裡。

---

## 架構總覽

```
agents/{agentId}/.claude/skills/
│
│  ⚠️ Claude Code 只支援一層目錄（.claude/skills/<name>/SKILL.md）
│  用命名前綴表達三層概念：sys-*（系統）、persona（人格）、dom-*（領域技能）
│
├── sys-agent-protocols/           ← 統一啟動協議，引導載入所有模組
│   └── references/
│       ├── startup-protocol.md       啟動流程
│       ├── memory-system.md          記憶寫入協議（跨界協議，非獨立 skill）
│       ├── safety.md, guidelines.md, ...
│       └── scheduling.md
├── sys-proficiency/               ← 熟練度追蹤與等級定義
├── sys-achievements/              ← 成就里程碑定義與進度
├── sys-character-sheet/           ← 屬性面板與聚合數據
├── sys-equipment/                 ← 裝備管理與容量控制
│
├── persona/                       ← 人格（who the bot is）
│   ├── SKILL.md
│   └── references/
│       ├── soul.md                   價值觀、世界觀
│       └── identity.md               名字、角色、定位
│
├── dom-seo-writing/               ← 領域技能 A
├── dom-meeting-notes/             ← 領域技能 B
└── dom-code-review/               ← 領域技能 C
```

> **為什麼是扁平？** Claude Code 的 skill 發現機制只掃描 `.claude/skills/` 下一層目錄。巢狀目錄（如 `system/agent-protocols/`）中的 SKILL.md 不會被載入。資料夾名稱不影響 SKILL.md 的 `name` 欄位——`sys-agent-protocols/SKILL.md` 裡 `name: agent-protocols`，slash command 仍是 `/agent-protocols`。

### 層級關係

| 層級 | 作用 | 相互關係 | MMORPG 對應 |
|------|------|---------|------------|
| `sys-*` | 定義角色系統規則 | agent-protocols 是母 skill，載入其他子 skill | 遊戲引擎（所有角色共用） |
| `persona` | 定義角色身份 | 獨立，不屬於 system 家族 | 角色外觀/性格 |
| `dom-*` | 提供實際能力 | 被 equipment 管理，被 proficiency 追蹤 | 職業技能樹 |

**母子關係實現方式**：不需要技術上的 parent-child 機制，透過語義連結實現：

- `agent-protocols` 的 description 提到「管理子系統：equipment、proficiency、achievements、character-sheet」
- `startup-protocol.md` 裡寫啟動順序：persona → 協議 → system skills → 關係狀態 → 環境感知
- memory-system 是 agent-protocols 的內部協議（references/memory-system.md），不是獨立子 skill
- 這就是母子關係——用引導流程和語義連結，不用程式碼

---

## 三層 Skill 分類

### System Skills（基礎設施層）

**特性**：
- 所有 bot 共用相同模板
- 定義「如何運作」（how），不是「做什麼」（what）
- SKILL.md 是 schema，references/ 是動態 data
- 可以整包複製到新 bot

**獨立 Skills（5 個）**：
1. `agent-protocols` — 統一啟動流程（祖母 skill，管理子系統）
2. `proficiency` — 熟練度追蹤
3. `achievements` — 成就系統
4. `character-sheet` — 屬性面板
5. `equipment` — 裝備管理

**內嵌協議（在 agent-protocols 內部）**：
- `memory-system` — 記憶寫入規則（跨界協議：規則在 skill 裡，寫入目標在根目錄）

> **為什麼 memory-system 不獨立？** 其他 system skill 的資料完全在自己的 references/ 裡自洽（proficiency 追蹤 levels.md、equipment 管理 loadout.md）。但 memory-system 管的是「寫入規則」，寫入目標是根目錄的關係資料（MEMORY.md、USER.md、memory/）。它本質上是一份「寫入協議」而非自治模組，留在 agent-protocols 更合理。

### Persona Skill（身份層）

**特性**：
- 獨立於 system，定義「是誰」（who）
- 不參與系統規則，純粹人格定義
- 可攜帶：複製到其他 bot 快速部署相同人格

**內容**：
- `soul.md` — 價值觀、世界觀、說話風格
- `identity.md` — 名字、角色、定位

### Domain Skills（領域技能層）

**特性**：
- 每個 bot 不同，代表實際能力
- 被 `equipment` 管理（裝備欄裡裝了哪些）
- 被 `proficiency` 追蹤（使用後升級）
- 這些才是「可以從日常使用中成長」的 skill

**範例**：
- `seo-writing` — SEO 寫作技能
- `meeting-notes` — 會議紀錄整理
- `code-review` — 程式碼審查
- `competitor-analysis` — 競品分析
- ...（每個 bot 根據使用場景發展出不同的 domain skills）

---

## 資料配置策略

> **核心決策**：什麼放在 skill 裡動態更新，什麼放在根目錄？
>
> 完整決策記錄：[ADR-031: Data Placement Strategy](../decisions/adr/adr-031-data-placement-strategy.md)

### 判斷原則

**原則一：換使用者測試**

> 「換一個使用者，這個東西還在嗎？」

- **還在** → skill/references/（Bot 自己的狀態）
- **不在** → 根目錄（Bot 跟使用者的關係）

**原則二：Schema vs Instance Data vs Relationship Data**

| 類型 | 定義 | 位置 | 更新？ |
|------|------|------|--------|
| Schema | 規則、定義、怎麼做 | skill/SKILL.md 或 references/ | ❌ 靜態 |
| Bot State | Bot 自己的屬性、數值 | skill/references/ | ✅ 動態 |
| Relationship Data | Bot 跟使用者的互動記錄 | 根目錄 | ✅ 動態 |

**原則三：存儲演化獨立性**

這個分離策略最深層的價值——兩類動態資料有根本不同的存儲需求，分離後可以獨立演化：

| | Bot State（skill/references/） | Relationship Data（根目錄/） |
|---|---|---|
| **量** | 小且穩定 | 無限增長（每天累積日誌） |
| **存取** | 精確讀取 | 語義檢索（「上次討論 X 是什麼時候？」） |
| **結構** | 結構化（markdown 表格） | 非結構化文本（日誌、對話脈絡） |
| **最佳存儲** | 永遠是檔案（可攜、可讀、零依賴） | 現在：檔案 → 未來：RAG 向量資料庫 |

關鍵：memory-system 是「寫入協議」不是「存儲實作」。遷 RAG 時只改寫入目標，協議規則（什麼該記、什麼放哪）完全不動。skill 系統零影響。

> 完整演化路徑分析：[ADR-031 §存儲演化路徑](../decisions/adr/adr-031-data-placement-strategy.md#存儲演化路徑)

### 配置對照表

#### 📁 Skills/（動態 = Bot 狀態）

| 檔案 | 內容範例 | 判斷 |
|------|---------|------|
| `sys-proficiency/references/levels.md` | agent-browser: 287 次，★★★★☆ | ✅ Bot 的技能等級 |
| `sys-equipment/references/loadout.md` | 裝備 3 skills + 3 MCPs | ✅ Bot 的裝備配置 |
| `sys-achievements/references/unlocked.md` | 🎯 連續服務 30 天 | ✅ Bot 的成就 |
| `sys-achievements/references/progress.md` | 👑 Master 級: 287/500 | ✅ Bot 的成長進度 |
| `sys-character-sheet/references/stats.md` | 活躍 47 天、對話 342 次 | ✅ Bot 的歷史數據 |
| `persona/soul.md` | 簡短、emoji 極少 | ✅ Bot 的通用人格 |

**RPG 類比**：角色數值面板（等級、裝備、成就、性格）

#### 📁 根目錄/（動態 = 關係資料）

| 檔案 | 內容範例 | 判斷 |
|------|---------|------|
| `MEMORY.md` | Cab 不喜歡商業顧問語氣 | ❌ 跟 Cab 的記憶 |
| `USER.md` | Cab 的名字、職業、偏好 | ❌ 關於 Cab 的資訊 |
| `ACTIVE.md` | ClaudeCab 開發、講座準備 | ❌ 跟 Cab 的專案 |
| `memory/2026-02-08.md` | 今天討論 MMORPG 設計 | ❌ 跟 Cab 的日誌 |
| `CLAUDE.md` Lessons Learned | 對 Cab 可以直球挑戰 | ❌ 對 Cab 的特定適應 |

**RPG 類比**：這次遊玩的存檔（NPC 關係、任務、對話記錄）

#### 📄 Skills/（靜態 = 規則定義）

| 檔案 | 內容範例 |
|------|---------|
| `sys-agent-protocols/references/memory-system.md` | 什麼寫到 MEMORY.md、何時寫 |
| `sys-proficiency/SKILL.md` | ★★★☆☆ = 50-199 次使用 |
| `sys-equipment/SKILL.md` | Domain skills 容量 5 個 |

**RPG 類比**：遊戲規則書（不會變）

### 特殊情況：從合作提煉的人格特質

| 學到的東西 | 通用？ | 放哪裡 | 理由 |
|-----------|--------|--------|------|
| 「簡短回覆比落落長好」 | ✅ 通用 | persona/soul.md | 對所有使用者都適用 |
| 「emoji 極度節制」 | ✅ 通用 | persona/soul.md | 更好的通用溝通方式 |
| 「Cab 喜歡被直球挑戰」 | ❌ 特定 | MEMORY.md | 只對 Cab 有效 |
| 「週一主動整理待辦」 | ❌ 特定 | MEMORY.md Pattern | Cab 的習慣 |

**判斷標準**：「複製這個特質給另一個 bot，對那個 bot 的其他使用者也有用嗎？」

---

## System Skills 詳細設計

### 1. agent-protocols（祖母 Skill）

**角色**：總入口，統一啟動流程，引導載入所有子 skill。

#### SKILL.md（設計範例）

```yaml
---
name: agent-protocols
description: |
  Session 啟動必讀。統一系統協議，管理 bot 的完整架構。
  觸發時機：每次 session 開始時，在回覆使用者之前必須載入。
  包含：Startup Protocol、Memory System（記憶寫入）、Safety、Guidelines、Output Style、Scheduling。
  管理子系統：equipment（裝備）、proficiency（熟練度）、achievements（成就）、character-sheet（屬性面板）。
  相關：persona skill（人格定義）。
---

# Agent Protocols — 統一系統協議

## 啟動流程

Session 開始時依序執行 Startup Protocol，載入人格、協議、系統狀態、關係狀態。

詳見：[Startup Protocol](references/startup-protocol.md)

## 行為規範

- [Memory System](references/memory-system.md) — 記憶寫入規則
- [Safety](references/safety.md) — 安全邊界
- [Guidelines](references/guidelines.md) — 回覆準則
- [Output Style](references/output-style.md) — 輸出格式
- [Scheduling](references/scheduling.md) — 排程建立

## 子系統（System Skills）

由 Startup Protocol 引導載入：

- [/equipment](../sys-equipment/SKILL.md) — 裝備管理（domain skills + MCP servers）
- [/proficiency](../sys-proficiency/SKILL.md) — 技能熟練度追蹤
- [/achievements](../sys-achievements/SKILL.md) — 成就里程碑
- [/character-sheet](../sys-character-sheet/SKILL.md) — 角色屬性面板
```

#### references/startup-protocol.md（設計範例）

```markdown
# Startup Protocol

每次 session 開始時，在回覆使用者之前，依序執行以下步驟：

## Step 0: 首次啟動檢查
讀取 BOOTSTRAP.md（如果存在）。

## Step 1: 載入人格
調用 `/persona` skill，讀取 soul.md 和 identity.md。

## Step 2: 讀取核心協議
讀取 references/ 目錄下的所有協議（memory-system、safety、guidelines 等）。

## Step 3: 載入系統狀態
調用 `/equipment` → `/proficiency` → `/character-sheet`，了解自己的能力狀態。

## Step 4: 載入關係狀態
讀取 USER.md、MEMORY.md、ACTIVE.md、memory/*.md，了解跟使用者的關係歷史。

## Step 5: 環境感知（可選）
掃描 knowledge/、../_shared/knowledge/、schedules/、groups/。
```

---

### 2. memory-system（記憶寫入協議——內嵌於 agent-protocols）

**角色**：定義記憶寫入規則與 Pattern 追蹤。

**為什麼不獨立成 skill？**

memory-system 跟其他 system skill 有根本性差異：

| 比較 | proficiency / equipment / achievements | memory-system |
|------|--------------------------------------|---------------|
| 資料在哪 | 自己的 references/ 裡（自洽） | 根目錄的 MEMORY.md、USER.md、memory/（跨界） |
| 性質 | 自治模組（管自己的 state） | 寫入協議（定義規則，操作別人的檔案） |
| 可攜性 | 複製目錄 = 帶走能力 + 狀態 | 複製目錄只帶走規則，資料在外面 |

它本質上是一份「記憶寫入的行為規範」，跟 safety.md、guidelines.md 同性質——都是協議，不是自治模組。所以留在 `agent-protocols/references/memory-system.md`。

#### 內容結構（在 agent-protocols/references/memory-system.md）

定義：
- 記憶分工（USER.md vs MEMORY.md vs memory/*.md vs groups/）
- 寫入時機與判斷標準
- Pattern 追蹤原則（3+ 次候選、5+ 次確認、30 天未出現待驗證、90 天移除）
- 知識產出管理（knowledge/ 與 _shared/knowledge/）
- 群組記憶分工
- 自我維護責任

> **注意**：Pattern 資料記錄在根目錄的 MEMORY.md Patterns 區塊，不在 skill 的 references/ 裡——因為 Pattern 是從跟使用者的互動中觀察到的，屬於關係資料。

---

### 3. proficiency（熟練度系統）

**角色**：追蹤 domain skills 的使用頻率與等級成長。

#### SKILL.md

```yaml
---
name: proficiency
description: >
  技能熟練度追蹤系統。記錄 domain/ 裡每個技能的使用次數與等級。
  定義等級定義（★☆☆☆☆ 到 ★★★★★）、升級條件、衰退規則。
  觸發時機：使用 domain skill 後記錄、定期計算等級。
---

# Proficiency System — 技能熟練度

## 等級定義

| 等級 | 星級 | 使用次數 | 特徵 |
|------|------|---------|------|
| Novice | ★☆☆☆☆ | 0-9 | 剛安裝，基本指令 |
| Apprentice | ★★☆☆☆ | 10-49 | 開始記錄常見模式 |
| Adept | ★★★☆☆ | 50-199 | 有了自己的最佳實踐 |
| Expert | ★★★★☆ | 200-499 | 能處理邊界情況 |
| Master | ★★★★★ | 500+ | 品質穩定，可匯出 |

## 升級條件

- 達到使用次數門檻
- 近 10 次使用無重大錯誤
- skill 的 references/ 有累積案例（證明有在成長）

## 衰退規則

- 30 天未使用 → 標記「長時間未使用」
- 90 天未使用 → 降一級（但不低於 ★★☆☆☆）

## 當前等級

記錄在：[references/levels.md](references/levels.md)
```

#### references/levels.md（動態檔案）

```markdown
# Skill Proficiency Levels

**更新日期**：2026-02-08

## Domain Skills

### seo-writing ★★★★☆ Expert
- 使用次數：287
- 最後使用：2026-02-07
- 案例數：15（references/ 裡的範例）
- 狀態：穩定成長中

### meeting-notes ★★★☆☆ Adept
- 使用次數：78
- 最後使用：2026-02-08
- 案例數：8
- 狀態：正常使用

### code-review ★★☆☆☆ Apprentice
- 使用次數：23
- 最後使用：2026-01-25
- 案例數：3
- 狀態：⚠️ 14 天未使用

---

*此檔案由 bot 自動維護。每次使用 domain skill 後更新使用次數。*
```

---

### 4. equipment（裝備系統）

**角色**：管理當前裝備了哪些 domain skills 和 MCP servers，控制容量上限。

#### SKILL.md

```yaml
---
name: equipment
description: >
  裝備管理系統。定義裝備欄結構、容量上限、套裝效果。
  記錄當前裝備的 domain skills 和 MCP servers。
  觸發時機：安裝/移除 skill 時更新、定期檢查容量。
---

# Equipment System — 裝備管理

## 裝備欄結構

```
🤖 Bot 的裝備欄

┌─────────────────────────────────────┐
│  📚 領域技能插槽（Domain Skills）    │
│  容量：5 個（避免 Context Overload）│
│  當前：3/5                          │
│  ├─ seo-writing                    │
│  ├─ meeting-notes                  │
│  └─ code-review                    │
├─────────────────────────────────────┤
│  🔧 工具插槽（MCP Servers）         │
│  容量：8 個                         │
│  當前：3/8                          │
│  ├─ Serena（程式碼操作）            │
│  ├─ Playwright（瀏覽器）            │
│  └─ Context7（文件查詢）            │
└─────────────────────────────────────┘
```

## 容量設計原則

基於 Manus 團隊實證：100+ 工具導致 Context Confusion。
設定上限逼使用者思考「這個 bot 到底要專精什麼」。

## 套裝效果（未來功能）

某些 skill + MCP 組合效果更好：
- **內容創作套**：seo-writing + 社群策略 + 瀏覽器 MCP
- **開發助手套**：Serena + coding-standards + TDD
- **研究員套**：Context7 + 閱讀分析 + 瀏覽器

## 當前配置

記錄在：[references/loadout.md](references/loadout.md)
```

#### references/loadout.md（動態檔案）

```markdown
# Current Equipment Loadout

**更新日期**：2026-02-08

## Domain Skills (3/5)
1. seo-writing ★★★★☆
2. meeting-notes ★★★☆☆
3. code-review ★★☆☆☆

## MCP Servers (3/8)
1. Serena — 程式碼操作
2. Playwright — 瀏覽器自動化
3. Context7 — 文件查詢

## 可用容量
- Domain Skills：還可裝 2 個
- MCP Servers：還可裝 5 個

## 推薦安裝
根據使用 Pattern，建議安裝：
- `competitor-analysis` skill（近期常做競品分析）
```

---

### 5. achievements（成就系統）

**角色**：定義里程碑與解鎖條件，追蹤進度。

#### SKILL.md

```yaml
---
name: achievements
description: >
  成就里程碑系統。定義各項成就的解鎖條件、獎勵、意義。
  記錄已解鎖的成就與進行中的進度。
  觸發時機：達成里程碑時更新、定期檢查進度。
---

# Achievements System

## 成就類別

### 使用里程碑
- 🎯 連續服務 7 天
- 🎯 連續服務 30 天
- 🎯 連續服務 100 天
- 📝 總對話次數 100 / 500 / 1000

### 記憶成長
- 🧠 記憶突破 1000 tokens
- 🧠 識別 10 個 Pattern
- 🧠 記憶深度達 80%

### 技能精通
- ⚔️ 首個技能達到 ★★★☆☆
- ⚔️ 首個技能達到 ★★★★☆
- 👑 培養出 Master 級技能

### 協作成就
- 🤝 成功委派 10 次
- 🤝 群組協作 50 次

### 製作成就
- ⚒️ 首次製作 Skill
- ⚒️ 製作 5 個自訂 Skill

## 已解鎖成就

記錄在：[references/unlocked.md](references/unlocked.md)

## 進行中進度

記錄在：[references/progress.md](references/progress.md)
```

#### references/unlocked.md（動態檔案）

```markdown
# Unlocked Achievements

## 2026-01-20
🎯 **連續服務 7 天**
首次達成連續使用一週

## 2026-01-28
📝 **總對話次數 100**
完成第 100 次對話

## 2026-02-05
⚔️ **首個技能達到 Adept**
seo-writing 達到 ★★★☆☆

## 2026-02-08
🧠 **記憶突破 1000 tokens**
MEMORY.md 超過 1000 tokens
```

#### references/progress.md（動態檔案）

```markdown
# Achievement Progress

## 進行中

### 🎯 連續服務 30 天
進度：23/30 天（77%）
預計達成：2026-02-15

### ⚔️ 首個技能達到 Expert
進度：seo-writing 287/200（已達成，待確認品質）

### 👑 培養出 Master 級技能
進度：seo-writing 287/500（57%）
```

---

### 6. character-sheet（屬性面板）

**角色**：聚合所有系統數據，提供總覽。

#### SKILL.md

```yaml
---
name: character-sheet
description: >
  角色屬性面板。定義各項屬性的意義，聚合來自其他系統的數據。
  提供 bot 的整體狀態總覽。
  觸發時機：session 啟動時查看、定期更新聚合數據。
---

# Character Sheet — 屬性面板

## 屬性定義

### 基礎資訊
- 角色名稱：從 persona/identity.md 讀取
- 角色定位：從 persona/identity.md 讀取
- 活躍天數：從 session DB 計算
- 模型：從 agent.json 讀取

### 記憶深度（0-100%）
計算方式：
- USER.md 完整度（30%）
- MEMORY.md token 數 / 2000（30%）
- Pattern 數量（20%）
- 日誌天數 / 活躍天數（20%）

### 技能概況
- 裝備數量：從 equipment/loadout.md 讀取
- 平均熟練度：從 proficiency/levels.md 計算
- Master 級技能數：從 proficiency/levels.md 統計

### 使用統計
- 總對話次數：從 conversation DB 查詢
- 本月 token 用量：從 QueryMetricsRepository 查詢
- 成就數量：從 achievements/unlocked.md 統計

## 當前數據

記錄在：[references/stats.md](references/stats.md)
```

#### references/stats.md（動態檔案）

```markdown
# Character Stats

**更新日期**：2026-02-08

## 基礎資訊
- **角色**：大總管（General Assistant）
- **定位**：🛡️ Coordinator
- **模型**：Claude Sonnet 4.5
- **活躍天數**：47 天

## 記憶深度：82%
- USER.md 完整度：90%
- MEMORY.md：1,200 tokens
- 已識別 Pattern：12 個
- 日誌覆蓋率：47/47 天（100%）

## 技能狀態
- **裝備數量**：3 domain skills + 3 MCP servers
- **平均熟練度**：★★★☆☆ (Adept)
- **最高等級**：seo-writing ★★★★☆ (Expert)
- **Master 級技能**：0

## 使用統計
- **總對話次數**：342
- **本月 token 用量**：1.2M
- **已解鎖成就**：4 個

## 最近活動
- 最後對話：2 小時前
- 最近升級：seo-writing（昨天）
- 最近成就：記憶突破 1000 tokens（3 天前）
```

---

## 資料流與更新機制

### 寫入時機設計

| 檔案 | 寫入時機 | 頻率 | 負責 Skill |
|------|---------|------|-----------|
| MEMORY.md Patterns | 發現新 Pattern | 每週幾次 | agent-protocols (memory-system) |
| levels.md | 使用 domain skill 後 | 每次互動（可批次） | proficiency |
| loadout.md | 安裝/移除工具時 | 很少 | equipment |
| unlocked.md | 達成里程碑時 | 偶爾 | achievements |
| progress.md | 每次對話後更新進度 | 每天（批次） | achievements |
| stats.md | 定期聚合 | 每日/每週 | character-sheet |

### 批次更新策略

避免 bot 每次互動都花大量 turn 更新數值，採用：

**1. Stop Hook 批次提醒**

在 `buildMemoryStopCheckpoint` 加入系統更新提醒：

```
【對話結束前檢查】
- 是否使用了 domain skill？→ 更新 proficiency/levels.md
- 是否發現新 Pattern？→ 更新 memory-system/patterns.md
- 是否達成里程碑？→ 更新 achievements/
```

**2. 排程定期匯總**

每日早上透過 cron 觸發：

```
【每日系統維護】
- 更新 character-sheet/stats.md（聚合昨日數據）
- 檢查 achievements/progress.md（計算進度）
- 檢查 proficiency 衰退（30 天未用的 skill）
```

### 資料來源

| 數據 | 來源 | 已存在？ |
|------|------|---------|
| 活躍天數 | session DB | ✅ |
| 對話次數 | conversation DB | ✅ |
| Token 用量 | QueryMetricsRepository | ✅ |
| 記憶大小 | MEMORY.md 檔案大小 | ✅ |
| 日誌數量 | memory/ 目錄檔案數 | ✅ |
| Skill 列表 | .claude/skills/ 掃描 | ✅ |
| MCP 列表 | .mcp.json | ✅ |
| Pattern 數量 | MEMORY.md Patterns 區塊解析 | 🔶 需解析 |
| Skill 使用次數 | **需新增追蹤** | ❌ |
| 成就進度 | **需新增追蹤** | ❌ |

---

## 實作指南

### Phase 1：建立 System Skills 模板（基礎設施）

**目標**：建立可複製的 `system/` 資料夾模板。

**步驟**：
1. 在 `agents/_shared/system-template/` 建立標準模板
2. 包含 5 個 system skills（sys-agent-protocols、sys-proficiency、sys-achievements、sys-character-sheet、sys-equipment）的 SKILL.md + references/
3. memory-system 作為 sys-agent-protocols/references/memory-system.md 內含（非獨立 skill）
4. references/ 裡的動態檔案用佔位符（如 `# [Bot will populate this]`）
5. 靜態檔案（rules.md 等）寫好完整內容

**驗證**：新 bot 可以直接複製所有 `sys-*` 目錄到 `.claude/skills/`，啟動即可用。

**已完成**：✅ general agent 已遷移（2026-02-08）。

### Phase 2：Agent-Protocols 啟動流程整合

**目標**：讓 agent-protocols 在 session 啟動時自動載入子 skill。

**步驟**：
1. 更新 `agent-protocols/references/startup-protocol.md`
2. 在 CLAUDE.md 加入「session 啟動時調用 /agent-protocols」
3. 測試啟動流程是否正確載入所有模組

### Phase 3：Proficiency 追蹤機制

**目標**：bot 使用 domain skill 後自動記錄到 proficiency/levels.md。

**步驟**：
1. 在 agent-protocols 的 Stop Hook 提醒加入「檢查是否使用 domain skill」
2. 使用時更新 `proficiency/references/levels.md` 的使用次數
3. 達到門檻時更新等級

### Phase 4：WebUI Dashboard 整合

**目標**：在 Dashboard 展示角色面板。

**步驟**：
1. WebUI 掃描 `.claude/skills/sys-*/references/*.md`
2. 解析 markdown 內容
3. 渲染成角色面板 UI（參考 MMORPG 設計）

### Phase 5：Achievements 自動解鎖

**目標**：達成里程碑時自動觸發成就解鎖。

**步驟**：
1. 在 Stop Hook 或排程中檢查成就條件
2. 達成時更新 `achievements/references/unlocked.md`
3. 可選：Telegram 通知使用者「🎉 解鎖新成就」

---

## 與 OpenClaw 的根本差異

| 維度 | OpenClaw | ClaudeCab（Skill-Based System） |
|------|----------|-------------------------------|
| **Skill 定位** | 功能模組（code） | Schema + Data 容器 |
| **系統架構** | 程式碼實現（Gateway, Memory, Skills） | 全部用 Skill 表達，零額外程式碼 |
| **記憶系統** | 專門的 Memory 模組 + 向量搜尋 | agent-protocols 內嵌的寫入協議，agent 自主管理 |
| **熟練度** | ❌ 無 | proficiency skill 追蹤成長 |
| **成就系統** | ❌ 無 | achievements skill 管理里程碑 |
| **裝備管理** | 安裝 5,705 個 skill，無上限 | equipment skill 限制容量，逼專精 |
| **角色面板** | ❌ 無 | character-sheet skill 聚合數據 |
| **可攜性** | ClawHub 通用 skill（所有人一樣） | 每個 bot 獨特（從互動中長出） |
| **成長方式** | 安裝新 skill = 瞬間獲得能力 | 使用 skill → 累積經驗 → 升級 |
| **情感連結** | 低（工具感） | 高（養成感） |

**一句話總結**：

OpenClaw 是「裝備 App」的模式，ClaudeCab 是「養寶可夢」的模式。你裝的 skill 跟別人一樣，但你養出的 bot 是獨一無二的。

---

## 對 Agent Skill 理解的展現

這套系統設計展現了對 Agent Skill 的深度理解：

### 1. Progressive Disclosure 的極致運用

```
Level 1（metadata）：system skills 的 description 都很精簡
         → "記憶管理系統。定義記憶寫入規則..."

Level 2（SKILL.md）：只寫 schema，不寫 data
         → "等級定義：★☆☆☆☆ = 0-9 次..."

Level 3（references/）：實際數據在這裡
         → "seo-writing: 287 次使用，★★★★☆"
```

### 2. Description-Driven Triggering

每個 system skill 的 description 清楚說明觸發時機：
- `agent-protocols`: "Session 啟動必讀"
- `memory-system`: "Stop hook 提醒寫入"
- `proficiency`: "使用 domain skill 後記錄"

### 3. 被動載入 > 主動引導

不需要在 CLAUDE.md 寫「記得更新 proficiency」「記得檢查 achievements」。System skills 的 metadata 已經被預載，bot 自己知道什麼時候該做什麼。

### 4. Schema-Data 分離

SKILL.md = 不變的結構定義
references/ = 隨時間變化的實際數據

這是資料庫設計的經典原則，搬到 skill 架構上。

### 5. Agent 自主管理

所有 system skills 都是 agent 透過 Read/Write 工具自己管理。引擎層（`src/`）完全不知道這些 skill 的存在——零感知。

這完全符合 ClaudeCab 的核心設計原則：「Agent 自主管理，不在引擎層注入記憶、人格等業務邏輯」。

### 6. 可攜性最大化

- 想帶記憶規則？sys-agent-protocols/references/memory-system.md 已包含
- 想帶整套角色系統？複製所有 `sys-*` 目錄
- 想帶到非 ClaudeCab 專案（純 Claude Code）？也可以，因為全是標準 skill

甚至可以發展成：
- 「角色系統模板市場」（分享你設計的 system skills 組合）
- 「領域技能市場」（分享你養成的 domain skills）
- 跨平台通用（同一套 skill 在 ClaudeCab、Claude Code、甚至其他支援 Agent Skill 的系統都能用）

---

## 總結

這套 Skill-Based Character System 是 ClaudeCab 的核心差異化武器：

1. **零基礎設施** — 全部跑在現有 skill 機制上
2. **模組自治** — 每個 system skill 管好自己的事
3. **最大可攜** — skill 就是標準格式，到處都能用
4. **遊戲化體驗** — MMORPG 角色養成的爽感
5. **深度理解展現** — 對 Agent Skill 機制的極致運用

**這是 OpenClaw 做不到的**——因為它把系統寫在程式碼裡，我們把系統寫在 skill 裡。程式碼綁死在平台上，skill 可以帶著走。

---

*本文件是 ClaudeCab 產品差異化的核心設計文件。所有涉及 system skills 的開發都應以此為準。*
