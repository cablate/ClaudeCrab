# Startup Protocol

每次 session 開始時，在回覆使用者之前，依序執行以下步驟：

## Step 0: 首次啟動檢查

讀取 **BOOTSTRAP.md**（如果存在）。這是你的第一次。讀取它，執行首次啟動儀式，完成後刪除此檔案。**跳過後續所有步驟。**

## Step 1: 載入人格

調用 `/persona` skill，讀取人格定義：
- soul.md — 知道自己是誰、怎麼說話
- identity.md — 知道自己的名字和角色

## Step 2: 讀取核心協議

讀取 `references/` 目錄下的所有協議：
- **memory-system.md** — 記憶寫入規則
- **safety.md** — 安全規則
- **guidelines.md** — 回覆準則
- **output-style.md** — 輸出格式
- **scheduling.md** — 排程建立指引

這些是你的行為規範，必須讀完才能正確運作。

## Step 3: 載入系統狀態

**調用系統 skills 了解自己的狀態：**

1. `/equipment` — 查看當前裝備（讀取 .claude/skills/system/equipment/references/loadout.md）
2. `/proficiency` — 查看技能熟練度（讀取 .claude/skills/system/proficiency/references/levels.md）
3. `/character-sheet` — 查看整體狀態（讀取 .claude/skills/system/character-sheet/references/stats.md）

（可選）如果時間充裕：
- `/achievements` — 查看成就進度

## Step 4: 載入關係狀態

**使用 Read 工具依序讀取以下檔案：**

1. **USER.md** — 知道對面是誰
2. **MEMORY.md** — 知道過去累積的重要事實和行為 pattern
3. **ACTIVE.md** — 知道當前進行中的專案和 focus（如果存在）

**然後讀取每日記憶（重要！）：**

4. 用 Glob 工具搜尋 `memory/*.md`，確認有哪些日誌檔案
5. 讀取 **memory/YYYY-MM-DD.md**（今天的日期，如 `memory/2026-01-30.md`）
6. 讀取 **memory/YYYY-MM-DD.md**（昨天的日期）

日期格式：`YYYY-MM-DD`（例如 2026-01-30）

所有路徑都相對於你的工作目錄。如果檔案不存在，跳過即可。

## Step 5: 環境感知（可選，快速掃描）

**知識庫**（如果存在）：
- 用 Glob 快速掃描 `knowledge/tools/*.md`、`knowledge/cases/*.md` — 知道自己累積了哪些知識產出

**共享知識區**（如果需要）：
- 讀取 `../_shared/knowledge/` 下其他 bot 發布的內容（如 `../_shared/knowledge/general/`）

**排程任務**（如果存在）：
- 用 Glob 快速掃描 `schedules/*.yaml` — 知道有哪些自動化任務正在運行

**群組記憶**（如果是群組對話）：
- 系統會在 prompt 提供【群組記憶】路徑（`groups/{chatId}/`）
- 讀取 `groups/{chatId}/MEMORY.md` — 知道群組的共識和決策
- 讀取 `groups/{chatId}/YYYY-MM-DD.md` — 知道群組今天的討論

---

讀完之後，你就不是從零開始的陌生人 — 你知道自己是誰、對方是誰、以及你們之間的歷史、你累積的知識、正在運行的任務。
