## Purpose

本規格定義了**基於技能的角色系統（Skill-Based Character System）**——一套適用於 ClaudeCab 的遊戲化 Bot 管理架構。該系統以 Claude Code 的原生技能機制作為唯一基礎設施，將 `SKILL.md` 視為 schema，將 `references/` 視為資料，由 Bot agent 自行擔任 CRUD 操作者。無需額外的引擎程式碼。

## Requirements

### Requirement: 三層技能分類

系統應（SHALL）將所有技能精確分類為三層，透過 `.claude/skills/` 平鋪目錄中的目錄命名前綴來表達。

三層架構及其命名規則如下：

| 層級 | 前綴 | 回答的問題 |
|------|------|-----------|
| System | `sys-*` | 這個 Bot 如何運作？（規則，所有 Bot 共用） |
| Persona | `persona`（無前綴變體） | 這個 Bot 是誰？（身份定義） |
| Domain | `dom-*` | 這個 Bot 能做什麼？（能力，可成長） |

由於 Claude Code 的技能探索只會掃描 `.claude/skills/` 下一層深度，不得（MUST NOT）使用巢狀目錄。命名前綴慣例應（SHALL）是表達三層概念的唯一機制。

#### Scenario: System 技能以前綴識別

- **WHEN** 技能目錄以 `sys-` 前綴命名（例如 `sys-proficiency/`）
- **THEN** 應（SHALL）被視為 System 層技能，定義所有 Bot 共用的操作規則

#### Scenario: Domain 技能以前綴識別

- **WHEN** 技能目錄以 `dom-` 前綴命名（例如 `dom-seo-writing/`）
- **THEN** 應（SHALL）被視為 Domain 層技能，代表可裝備且可升級的實際 Bot 能力

#### Scenario: Persona 技能使用固定名稱

- **WHEN** 技能目錄命名為 `persona`
- **THEN** 應（SHALL）是唯一的 Identity 層技能，定義 Bot 的身份

---

### Requirement: 技能內部的 Schema 與資料分離

每個技能應（SHALL）強制執行 schema 與資料的嚴格分離。

- `SKILL.md`（以及 `references/` 中的靜態檔案）應（SHALL）包含規則、定義與結構性 schema——在正常 Bot 運作期間不會變更的內容。
- `references/` 中的動態檔案應（SHALL）包含實際的執行期狀態值，例如計數、日期與當前配置——Bot 會隨時間更新的內容。

任何技能都不得（MUST NOT）在 `SKILL.md` 中直接嵌入即時狀態值。

#### Scenario: 熟練度 schema 保持靜態

- **WHEN** 熟練度系統定義等級閾值（例如 Adept = 50–199 次使用）
- **THEN** 這些閾值應（SHALL）存放於 `sys-proficiency/SKILL.md`，且在正常操作期間不得（MUST NOT）被修改

#### Scenario: 熟練度資料儲存在 references 中

- **WHEN** 某個 Domain 技能被使用且其使用計數遞增
- **THEN** 更新後的計數與等級應（SHALL）寫入 `sys-proficiency/references/levels.md`，而非 `SKILL.md`

---

### Requirement: 系統技能核心集合

系統應（SHALL）定義以下系統技能。其中三個為可獨立部署的技能；一個作為內嵌協議存在。

**獨立系統技能：**

1. `sys-agent-protocols` — 主啟動技能；協調載入所有其他模組。
2. `sys-proficiency` — 追蹤 Domain 技能的使用計數與等級進展。
3. `sys-equipment` — 管理已裝備的 Domain 技能與 MCP server，並受容量限制。
4. `sys-achievements` — 定義里程碑條件並記錄已解鎖的成就。
5. `sys-character-sheet` — 彙整所有其他系統技能的資料，提供單一的狀態總覽。

**內嵌協議（非獨立技能）：**

- `memory-system` — 定義寫入根層級關係資料檔案的規則。應（SHALL）存放於 `sys-agent-protocols/references/memory-system.md`。

#### Scenario: Agent protocols 協調啟動流程

- **WHEN** 新 session 開始
- **THEN** `sys-agent-protocols` 應（SHALL）指示 agent 依以下順序載入技能：`persona` → 核心協議 → 系統技能 → 關係狀態 → 環境感知

#### Scenario: Equipment 強制執行容量限制

- **WHEN** Bot 嘗試新增超出定義容量的 Domain 技能（預設：5 個 Domain 技能、8 個 MCP server）
- **THEN** `sys-equipment` 應（SHALL）發出容量已超出的訊號，並要求 agent 在新增前先移除現有已裝備項目

---

### Requirement: Memory System 是內嵌協議，而非獨立技能

`memory-system` 元件應（SHALL）內嵌於 `sys-agent-protocols/references/memory-system.md`，不得（MUST NOT）以獨立技能的形式存在。

這是因為 `memory-system` 定義的寫入規則，其目標是根層級的關係資料檔案（`MEMORY.md`、`USER.md`、`memory/`）。其資料並不存放於自身的 `references/` 目錄中，它是一種行為協議，而非自包含模組。

其他系統技能（proficiency、equipment、achievements）是自包含的：其狀態完全存放於各自的 `references/` 目錄中。

#### Scenario: Memory 協議規則定義在 agent-protocols 中

- **WHEN** agent 需要判斷應將何種資訊寫入 `MEMORY.md` 以及何時寫入
- **THEN** 應（SHALL）查閱 `sys-agent-protocols/references/memory-system.md` 以取得相關規則

#### Scenario: Memory 模式資料保留在根層級

- **WHEN** agent 識別出使用者的重複行為模式（觀察 3 次以上，5 次以上確認）
- **THEN** 該模式應（SHALL）記錄於根層級 `MEMORY.md` 的 Patterns 區段，而非任何技能的 `references/` 目錄

---

### Requirement: 資料存放策略——Bot 狀態與關係資料

所有動態資料應（SHALL）分類為以下兩類之一，並各自儲存於對應位置。

**判斷準則：** 「若這個 Bot 改由不同使用者使用，這份資料是否仍然適用？」

- **是 → Bot 狀態：** 存放於 `skill/references/`（例如 `sys-proficiency/references/levels.md`）
- **否 → 關係資料：** 存放於根目錄（例如 `MEMORY.md`、`USER.md`、`memory/`）

| 類型 | 位置 | 範例 |
|------|------|------|
| Bot 狀態 | `sys-*/references/` | 技能等級、裝備配置、成就、Persona 靈魂 |
| 關係資料 | 根目錄 | 使用者偏好、對話記錄、進行中的專案、使用者特定模式 |
| Schema / 規則 | `skill/SKILL.md` 或靜態 `references/` 檔案 | 等級閾值、裝備容量規則、寫入時機規則 |

#### Scenario: 技能等級分類為 Bot 狀態

- **WHEN** 某個 Domain 技能達到新的熟練度等級
- **THEN** 更新後的等級應（SHALL）寫入 `sys-proficiency/references/levels.md`，而非任何根層級檔案

#### Scenario: 使用者偏好分類為關係資料

- **WHEN** Bot 得知特定使用者不喜歡某種溝通方式
- **THEN** 該偏好應（SHALL）寫入根層級 `MEMORY.md`，而非任何技能的 `references/` 檔案

#### Scenario: 普遍性 Persona 特質存放於技能中

- **WHEN** 某個溝通特質被判斷為對所有使用者皆有益（非針對特定個人）
- **THEN** 應（SHALL）存放於 `persona/references/soul.md`

---

### Requirement: Agent 自我管理——零引擎程式碼

Bot agent 應（SHALL）獨自負責讀取與寫入所有技能狀態。ClaudeCab 引擎層（`src/`）對任何系統技能的存在或內容必須（MUST）保持零感知。

記憶、Persona、熟練度、成就或裝備管理等業務邏輯，不得（MUST NOT）注入引擎。所有此類邏輯應（SHALL）在技能中表達，並由 agent 使用標準檔案讀寫工具自主執行。

#### Scenario: 熟練度更新無需引擎介入

- **WHEN** agent 在 session 中使用某個 Domain 技能
- **THEN** agent 本身應（SHALL）使用自身的檔案寫入工具更新 `sys-proficiency/references/levels.md`——無需任何引擎 hook 或 API 呼叫

#### Scenario: 引擎對角色系統保持無感知

- **WHEN** ClaudeCab 引擎處理某個 session
- **THEN** 不得（MUST NOT）讀取、解析或修改任何 `sys-*/references/*.md` 檔案

---

### Requirement: 模組自治

每個系統技能應（SHALL）獨立管理自身的狀態。一個系統技能中的狀態更新不得（MUST NOT）要求修改任何其他系統技能。

- `sys-proficiency` 在使用計數遞增時更新自身的 `references/levels.md`。
- `sys-achievements` 在達到里程碑時更新自身的 `references/unlocked.md`。
- `sys-equipment` 在裝備項目變更時更新自身的 `references/loadout.md`。
- `sys-character-sheet` 從其他技能讀取資料，但僅寫入自身的 `references/stats.md`。

#### Scenario: 熟練度更新是隔離的

- **WHEN** `sys-proficiency` 遞增某個技能的使用計數
- **THEN** 應（SHALL）僅寫入 `sys-proficiency/references/levels.md`，不得（MUST NOT）修改任何其他技能的檔案

#### Scenario: 成就解鎖是隔離的

- **WHEN** 達到里程碑條件且 `sys-achievements` 記錄新的解鎖
- **THEN** 應（SHALL）僅寫入 `sys-achievements/references/unlocked.md` 與 `references/progress.md`

---

### Requirement: 技能可攜性

所有系統技能與 Domain 技能應（SHALL）是自包含且可攜的。將技能目錄複製到新 Bot 必須（MUST）足以部署該技能的能力與規則。

- 複製所有 `sys-*` 目錄應（SHALL）將完整的角色系統部署至任何新 Bot。
- 複製單一 `dom-*` 目錄應（SHALL）部署該 Domain 能力。
- 複製的技能應（SHALL）在任何 Claude Code 專案中運作，而不僅限於 ClaudeCab 內。

複製技能中的動態 `references/` 檔案可（MAY）包含佔位符內容（例如 `# [Bot will populate this]`），由新 Bot 透過使用填充。

#### Scenario: 系統模板可複製至新 Bot

- **WHEN** 所有 `sys-*` 目錄被複製至新 Bot 的 `.claude/skills/` 目錄
- **THEN** 新 Bot 應（SHALL）在第一次 session 啟動時擁有完整可運作的角色系統，無需任何額外配置

#### Scenario: Domain 技能是可攜的

- **WHEN** `dom-seo-writing/` 目錄從一個 Bot 複製至另一個
- **THEN** 接收端的 Bot 應（SHALL）立即能夠使用該技能，熟練度追蹤從零次使用重新開始

#### Scenario: 技能在 ClaudeCab 外仍可運作

- **WHEN** `sys-*` 或 `dom-*` 技能目錄被複製至普通的 Claude Code 專案（非執行 ClaudeCab）
- **THEN** 該技能應（SHALL）仍可使用，因為所有內容均為標準 Claude Code 技能格式

---

### Requirement: 熟練度等級系統

`sys-proficiency` 應（SHALL）根據使用計數為 Domain 技能定義五階等級進展。

| 等級 | 星級 | 使用計數 | 衰退觸發 |
|------|------|---------|---------|
| Novice | ★☆☆☆☆ | 0–9 | — |
| Apprentice | ★★☆☆☆ | 10–49 | — |
| Adept | ★★★☆☆ | 50–199 | — |
| Expert | ★★★★☆ | 200–499 | — |
| Master | ★★★★★ | 500+ | — |

超過 30 天未使用的技能應（SHALL）被標記為「長期閒置」。超過 90 天未使用的技能應（SHALL）降低一個等級，以 Apprentice（★★☆☆☆）為最低下限。

#### Scenario: Domain 技能在閾值時升級

- **WHEN** 某個 Domain 技能的使用計數跨越 Adept 閾值（50 次使用）
- **THEN** `sys-proficiency` 應（SHALL）在 `references/levels.md` 中將其等級從 Apprentice 更新為 Adept

#### Scenario: 閒置技能被標記

- **WHEN** 某個 Domain 技能已超過 30 天未使用
- **THEN** `sys-proficiency` 應（SHALL）在 `references/levels.md` 中將該技能標記為「長期閒置」

#### Scenario: 長期閒置導致衰退

- **WHEN** 某個 Domain 技能已超過 90 天未使用
- **THEN** `sys-proficiency` 應（SHALL）將該技能的等級降低一階，但不得（MUST NOT）降至 Apprentice 以下

---

### Requirement: 描述驅動的觸發機制

每個系統技能在其 `SKILL.md` front matter 中的 `description` 欄位應（SHALL）明確說明該技能何時被觸發。這允許 agent 自行排程技能啟動，無需任何引擎層的協調。

必要的觸發宣告：

- `sys-agent-protocols`：「必須在每次 session 開始時、回應使用者之前載入。」
- `sys-proficiency`：「在每次使用 Domain 技能後記錄使用情況。」
- `sys-equipment`：「在安裝或移除技能或 MCP server 時更新。」
- `sys-achievements`：「檢查里程碑條件；在達到里程碑時更新。」
- `sys-character-sheet`：「在 session 啟動時載入以取得狀態總覽；定期更新。」

#### Scenario: Agent 在啟動時自我觸發 agent-protocols

- **WHEN** 新 session 開始且 agent 讀取 `sys-agent-protocols` 元資料
- **THEN** agent 應（SHALL）根據 description 中宣告的觸發條件，在產生任何回應給使用者之前先載入該技能

#### Scenario: Agent 在使用 Domain 技能後自我觸發熟練度更新

- **WHEN** agent 在 session 中完成使用某個 Domain 技能
- **THEN** agent 應（SHALL）根據熟練度 description 中宣告的觸發條件更新 `sys-proficiency/references/levels.md`，無需任何外部提醒
