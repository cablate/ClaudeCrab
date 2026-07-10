# ClaudeCrab

**本專案的完整治理規範在 [AGENTS.md](AGENTS.md)，為單一事實來源。開工前必讀並遵循，本檔只是指標。**

以下僅重複最高風險的硬規則（與 AGENTS.md 同步，修改時兩邊一起改）：

1. 禁止 `@anthropic-ai/sdk` — 只用 `@anthropic-ai/claude-agent-sdk`。
2. DB 記錄禁止 hard delete，一律 soft-delete。
3. 禁止全域殺進程（`taskkill /IM node.exe`）——曾導致 host 系統死亡。
4. 不碰 production 啟動鏈（Task Scheduler + VBS + `start.ts`），變更必留 rollback。
5. 動 SDK 相關程式碼前，先讀 `docs/SDK_TOUCHPOINTS.md`（未建立前讀 `docs/sop-sdk-cli-upgrade.md`）；禁止順手升 SDK 版本。

其餘工作方式（序列執行、先看實際資料、精準 scope、Definition of Done、文件金字塔、core 準入標準）→ 讀 AGENTS.md。
