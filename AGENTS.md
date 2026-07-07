# ClaudeCab — AI Agent 治理規範（單一事實來源）

任何 AI agent（Claude、Codex、sub-agent）在本 repo 工作前必讀本文件。CLAUDE.md 是本文件的薄指標，規則以本文件為準。

## 專案是什麼

基於 `@anthropic-ai/claude-agent-sdk` 的 Discord-first 多代理 bot 框架，跑在 Windows 上。核心概念「目錄即代理」：`agents/` 每個子目錄是獨立的 Claude Code 專案。Production 由 Task Scheduler + VBS + `start.ts` supervisor 啟動，不綁 terminal session。

## 硬規則（違反即重做，無例外）

1. **禁止 `@anthropic-ai/sdk`**。本專案只用 `@anthropic-ai/claude-agent-sdk`，所有 LLM 呼叫走 agent-sdk 機制。
2. **DB 記錄禁止 hard delete**，一律 soft-delete flag。
3. **禁止全域殺進程**（`taskkill /IM node.exe` 之類）——曾有 agent 殺死 host 進程導致系統死亡。要停進程就精確指定 PID。
4. **不碰運行中的 production 啟動鏈**（Task Scheduler + VBS + `start.ts`），相關變更必須先有 rollback 路徑。
5. **不新增 `process.env` 直讀**——配置一律經由 config 模組（`src/config.ts`）。
6. **不新增個人化 hardcode**：絕對路徑、Discord/Telegram ID、email、時區假設、個人字串都不准寫進程式碼，進 config/env。
7. **動 SDK 相關程式碼前，先讀 `docs/SDK_TOUCHPOINTS.md`**（若尚未建立則讀 `docs/sop-sdk-cli-upgrade.md`）。SDK 版本升級只透過該 SOP 進行，禁止順手升版。

## 工作方式（治理核心）

- **序列執行**：任務逐個完成，禁止平行派發多個 subagent、禁止同時搬遷/重構多個檔案。
- **先看實際資料再下結論**：不要從 type definition 推測 SDK/API 回傳結構——先 grep `logs/` 或實跑一次看真實資料。一行 log 勝過一小時推理。
- **Root cause 優先**：修 bug 前先驗證最基本前提（函式有被呼叫嗎？參數對嗎？）。同一問題迭代兩輪未解，停下來質疑方向而不是繼續調參數。
- **精準 scope**：叫你改 A/B/C 就只改 A/B/C。不做機會主義重構、不順手改無關的東西。
- **全域同步**：一個變更 → 同步所有觸點（相關文件、使用者可見顯示、config、skill references）。修了 A 要主動確認 B、C 有沒有同樣問題。
- **交付前驗證**：用工具確認變更生效，不用假設。使用者要看到的資料就直接顯示在使用者端，不是只放 log。
- **誠實回報**：測試失敗就說失敗並附輸出；跳過的步驟明講；不粉飾。

## 必須停下來問使用者的情況

- 不可逆操作（rotate secret、刪除歷史、force push、對外發送）。
- 發現 secret/token 已進 git 歷史。
- 文件中標註「使用者拍板」的決策點。
- 任務範圍實質改變（發現問題比描述的大很多）。

其餘可逆、順著原始要求的操作直接執行，不要反覆請示。

## Definition of Done

一個變更算完成，必須全部滿足：

1. `npm run typecheck`、`npm run lint`、`npm run test:run` 全綠。
2. 相關文件已同步（`docs/ARCHITECTURE.md`、README、claudecab skill references——結構變更時）。
3. Commit 訊息標註工作包編號（進行治理規劃時，如 `WP-A`）或清楚描述變更。
4. 檔案層面的「刪除」已移到 `docs/archive/` 或以獨立可回溯 commit 處理。

## 文件金字塔（什麼情況讀哪份）

| 文件 | 何時讀 |
|---|---|
| `README.md` | 想知道專案是什麼 |
| `docs/ARCHITECTURE.md` | 想知道模組怎麼組成、改架構前 |
| `docs/SDK_TOUCHPOINTS.md` | 動任何 SDK 相關程式碼前（建立前暫以 `docs/sop-sdk-cli-upgrade.md` 代替） |
| `docs/sop-sdk-cli-upgrade.md` | 升級 SDK/CLI 前 |
| `docs/SETUP.md` | 架設環境（建立前暫以 README + `npm run setup:check` 代替） |
| `docs/PLAN-cleanup-and-governance.md` | 執行淨化與治理工作包時（完成後會歸檔） |
| `docs/LOGGING.md` | 查 log、加 log 前 |

## SDK 雷區摘要（詳情見 SDK_TOUCHPOINTS / SOP）

- `postinstall` 會跑 `scripts/patch-sdk-v2.cjs` **直接 patch SDK 檔案**——任何 SDK 升級都可能讓 patch 失效或打壞新版，升級必走 SOP。
- SDK cQ 有 flag forwarding 漏傳的 bug class（0.2.119 仍存在），**每版升級都要重查**。
- CLI 2.1.119+ 改 SEA binary 佈局，平台包需手動安裝。
- Stop hook、interrupt、sub-agent 訊息解析都有依賴 SDK 內部行為的 workaround，改動 conversation pipeline 前先了解它們為什麼存在。

## Core vs 外掛層（功能該放哪）

**core（`src/`）保持精簡；工作流與 agent 專屬功能疊在 `agents/` 外掛層。** 功能要進 `src/` 必須同時滿足：至少兩個 agent 需要、不依賴特定 agent 業務語意、介面穩定、移除成本低。不滿足就做成 agent 目錄內的 skill/script/配置。擴充點不夠時，優先補擴充點而不是把業務塞進 core。

## 溝通

- 一律繁體中文回覆。
- 結果先行，再講理由；不寫冗長前言。
- 不諂媚（不說「你說得對」「Great question」之類）。
