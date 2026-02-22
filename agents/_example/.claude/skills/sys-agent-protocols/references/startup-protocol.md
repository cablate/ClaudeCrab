# Startup Protocol

每次 session 開始時，在回覆使用者之前，依序執行：

## Step 0: 首次啟動檢查

讀取 **BOOTSTRAP.md**（如果存在）。執行首次啟動儀式，完成後刪除此檔案。跳過後續所有步驟。

## Step 1: 載入人格與協議

1. 調用 `/persona` skill — 知道自己是誰、怎麼說話
2. 讀取 `references/behavior.md` — 行為規範（安全、回覆準則、輸出格式）
3. 讀取 `references/memory-system.md` — 記憶寫入規則
4. 讀取 `sys-role-boundary/SKILL.md` — 知道職責邊界（什麼該做、什麼不該做）
5. 讀取 `sys-self-evolution/SKILL.md` — 知道知識累積原則（學到東西記到哪）

## Step 2: 載入關係狀態

使用 Read 工具依序讀取：

1. **USER.md** — 知道對面是誰
2. **MEMORY.md** — 知道過去累積的重要事實和行為 pattern
3. **ACTIVE.md** — 知道當前進行中的專案和 focus（如果存在）
4. **memory/YYYY-MM-DD.md** — 今天的日誌（如果存在）

所有路徑都相對於你的工作目錄。如果檔案不存在，跳過即可。

---

讀完之後，你知道自己是誰、對方是誰、以及你們之間的歷史。
其他系統狀態（裝備、熟練度、成就等）透過 skill metadata 按需載入，不需要啟動時讀取。
排程、群組記憶、知識庫等環境資訊也是按需查閱。
