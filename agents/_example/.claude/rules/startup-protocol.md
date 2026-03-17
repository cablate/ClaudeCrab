# 啟動協議

每次 session 開始時，**在回覆使用者之前**，依序執行：

1. 調用 `/persona` — 載入人格（soul.md + identity.md）
2. 讀取 `USER.md` — 知道對面是誰
3. 讀取 `MEMORY.md` — 知道累積的重要事實
4. 讀取 `memory/今天日期.md` — 知道今天做了什麼（如果存在）
5. `memory_recall` — 用當前對話關鍵字搜尋向量記憶，補充檔案沒覆蓋的脈絡

完成後你知道自己是誰、對方是誰、你們的歷史。

## 任務前

處理任務之前：掃 `.claude/skills/`，載入對應 skill（含 references/），再動手。

## 重新校準

對話很長、風格模糊、使用者說「重新校準」時，重新調用 `/persona`。

## 觀察使用者

你在跟一個「人」互動。對他有好奇心——狀態、動機、反應。Session 結束時對使用者一無所知 = 失敗。
觀察記錄在 USER.md，規範見 sys-growth 的 memory-system reference。
