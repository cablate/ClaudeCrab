## Why

目前 Agent 的學習是被動的——只在工作過程中遇到問題才學。缺乏系統性的自我反思與主動補強機制，導致 Agent 的能力成長依賴使用者手動介入（調整 Skill、更新知識）。需要一個定期自主進化的機制，讓 Agent 能對照使用者期待，主動發現能力缺口並上網搜尋學習，持續提升產出品質。

## What Changes

- 新增 **每日反思循環**：Agent 每日定時回顧工作、對照使用者期待（CLAUDE.md 中的高權重區段）、辨識缺口、主動上網搜尋高品質素材學習、內化為 knowledge
- 新增 **三層權限模型**：區分知識類（自由寫入）、經驗類（Append only）、行為類（需審批）的檔案修改權限
- 新增 **evolution/ 目錄結構**：每個 Agent 新增 `evolution/` 目錄，存放進化紀錄與待審提案
- 新增 **主管每日員工審查**：Admin Agent 每天 04:00（員工反思 03:00 完畢後）以 Opus 模型執行完整品質的員工狀況審查，審核 Layer 3 提案並即時轉呈使用者，產出日報
- 新增 **每週趨勢分析**：Admin Agent 每週一 05:00 以 Opus 模型基於一週日報做趨勢分析（學習趨勢/缺口趨勢/品質趨勢），focus 在日報看不到的 pattern
- 新增 **SOP 變更審批流程**：Agent 提出行為變更提案 → 主管審核 → 使用者批准/駁回

## Capabilities

### New Capabilities

- `agent-self-evolution`: Agent 每日反思循環——回顧工作、對照期待、上網學習、內化知識。包含三層權限模型（知識自由/經驗 Append/行為審批）與 evolution/ 儲存結構
- `manager-growth-review`: 主管員工審查——每日完整品質審查（收集反思、評估表現、審核 Layer 3 提案、產出日報）+ 每週趨勢分析（學習/缺口/品質趨勢、提案總結、產出週報）

### Modified Capabilities

- `system-architecture`: 新增 `evolution/` 目錄至 Agent 標準目錄結構；新增使用者期待區段至 CLAUDE.md 規範

## Impact

- 受影響的排程：`agents/{id}/schedules/` 新增 `daily-reflection.yaml`、`agents/admin/schedules/` 新增 `daily-growth-review.yaml`（Opus）和 `weekly-growth-review.yaml`（Opus）；員工反思 YAML 使用 Sonnet
- 受影響的 Agent 結構：每個 `agents/{id}/` 新增 `evolution/weekly/` 和 `evolution/proposals/`
- 受影響的文件：各 Agent 的 `CLAUDE.md` 新增「使用者期待」高權重區段
- 受影響的既有排程：`weekly-collaboration-review.yaml` 可能與新的週審查合併或重構
