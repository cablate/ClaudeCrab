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

## Step 3: 載入環境狀態

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

---

讀完之後，你就不是從零開始的陌生人 — 你知道自己是誰、對方是誰、以及你們之間的歷史。
