# ClaudeCab 淨化與治理規劃書

> 目的：讓執行模型（Codex 等）依本文件逐項執行，把 ClaudeCab 整理成「乾淨、單純、可被陌生人架設、可低痛升級、AI Agent 可治理」的專案。
> 本文件是**規劃與盤查指引**，不是已完成的分析結論。每個工作包都要求執行者先做盤查、產出清單、再動手改。
> 作者：Claude（規劃）；執行：Codex 或其他模型。

---

## 0. 執行守則（每個工作包都適用，違反即重做）

1. **序列執行**：所有工作包、所有檔案變更一律逐個完成，禁止平行派發多個 agent、禁止同時搬遷多個檔案。
2. **禁止 `@anthropic-ai/sdk`**：本專案只用 `@anthropic-ai/claude-agent-sdk`。任何 LLM 呼叫都走 agent-sdk 機制。
3. **軟刪除優先**：DB 記錄刪除一律 soft-delete flag。檔案層面的「刪除」先移到 `docs/archive/` 或 git 歷史可追溯的獨立 commit，不做無法回溯的清除。
4. **先看實際資料再下結論**：不要從 type definition 推測 SDK/API 回傳結構；先 grep logs/ 或實跑一次確認真實資料。
5. **文件同步**：任何結構變更後，同步更新 `docs/ARCHITECTURE.md`、`README.md` 與 claudecab skill 的 references。
6. **不破壞運行中的 production**：改動前確認 supervisor（`start.ts`）流程；涉及啟動鏈（Task Scheduler + VBS + start.ts）的變更要留 rollback 路徑。
7. **每個工作包一個獨立 commit（或一組小 commit）**，commit message 註明工作包編號（如 `WP-A`），方便回滾。
8. **驗收前必跑**：`npm run typecheck`、`npm run lint`、`npm run test:run`。

---

## 1. 總體目標與驗收標準

| 目標 | 可量測的驗收標準 |
|---|---|
| 乾淨 | repo root 只剩必要檔案；無死檔、無殘留 runtime 產物入版控 |
| 單純 | 個人化 hardcode 為 0（全部進 config/env）；config 讀取只有一個入口 |
| 低架設門檻 | 陌生人照 `SETUP.md` + `.env.example` 在 30 分鐘內架起並通過 `setup:verify` |
| 低升級摩擦 | SDK 所有接觸面登記在冊；升級 SOP 可在 1 小時內完成含驗證 |
| 低客製程度 | 每個 patch/workaround 都有存在理由 + 上游 issue 連結 + 退場條件 |
| AI Agent 可治理 | 專案級 CLAUDE.md 守則完整；危險操作有 deny rules；文件金字塔單一入口 |
| 定位清晰 | core（src/）與外掛層（agents/）的邊界規則成文 |

---

## 2. 工作包總覽與優先序

| 編號 | 名稱 | 優先級 | 依賴 |
|---|---|---|---|
| WP-A | 個人化 hardcode 全面盤查 | **P0** | 無 |
| WP-B | 配置分層重構 | **P0** | WP-A |
| WP-C | SDK 接觸面登記與客製降級 | **P0** | 無 |
| WP-D | Repo 結構與死檔清理 | P1 | WP-A |
| WP-E | 架設門檻工程 | P1 | WP-B |
| WP-F | 升級與改版 SOP 強化 | P1 | WP-C |
| WP-G | AI Agent 治理層 | P1 | WP-D |
| WP-H | 模組邊界與依賴方向規則 | P2 | WP-D |
| WP-I | 測試與煙霧測試防護網 | P2 | WP-C, WP-E |
| WP-J | 定位決策落地（core vs 工作流） | P2 | WP-G, WP-H |

P0 是「不做完，其他工作包會反覆返工」的前置。P1 是本次目標主體。P2 是鞏固層。

---

## WP-A：個人化 hardcode 全面盤查（P0）

**目的**：找出所有「開發者個人的東西」被寫死在程式碼裡的地方，分類處置。這是使用者明確點名的重點。

**盤查方法**（在 `src/`、`scripts/`、`start.ts`、`tests/`、根目錄設定檔上執行；`node_modules/`、`dist/`、`logs/` 排除）：

```bash
# 絕對路徑（最高優先——換機器直接死）
grep -rn --include="*.ts" --include="*.cjs" --include="*.json" -E "[A-Z]:\\\\|[A-Z]:/" src scripts start.ts tests
# 使用者名稱、個人識別
grep -rniE "cabcab|cablate|reahtuoo|User\\\\User|Users/User" src scripts start.ts tests
# Discord/Telegram 具體 ID（17-20 位數字常量）
grep -rnE "['\"]?[0-9]{17,20}['\"]?" src scripts --include="*.ts"
# email
grep -rnE "[a-zA-Z0-9._%+-]+@(gmail|outlook|hotmail)" src scripts tests
# 時區假設
grep -rniE "Asia/Taipei|GMT\+8|UTC\+8" src scripts
# Windows 專屬命令/路徑
grep -rniE "taskkill|schtasks|\.vbs|powershell|cmd /c|wscript" src scripts start.ts
# 個人環境變數預設值（config fallback 藏個人值）
grep -rnE "process\.env\.[A-Z_]+ *(\?\?|\|\|)" src scripts start.ts
# 寫死的中文提示語/reason 字串（現有 architectural debt：字串散落在 callback inline）
grep -rn --include="*.ts" -E "reason: ?['\"\`]|description: ?['\"\`]" src | grep -v "definitions.ts"
```

另外逐檔人工檢視這些「高風險藏匿點」：`src/config.ts`、`src/constants.ts`、`claudecab.runtime.json`、`ecosystem.config.cjs`、`start.ts`、`scripts/*.ts`、`agents/*/` 下的 CLAUDE.md 與設定、`.claude/settings*.json`、`Dockerfile`、`docker-compose.yml`。

**每筆發現分類為四類之一，產出 `docs/audit/hardcode-inventory.md`**：

| 分類 | 處置 |
|---|---|
| S（Secret/個人身分） | 移入 `.env`，程式碼只留 env 讀取；檢查 git 歷史是否已洩漏，若有記錄在報告中請使用者決定是否 rotate |
| C（部署環境相關） | 移入 config schema（WP-B），提供合理預設值 |
| P（產品預設值） | 集中到 `src/constants.ts` 或對應模組的 `definitions.ts`（沿用 hook Phase A 的集中化 pattern，參考 `src/core/hooks/definitions.ts`） |
| D（死值/殘留） | 依守則 3 處理 |

**驗收**：上述 grep 全部重跑，S/C 類命中數為 0；inventory 文件列出每筆的原位置、分類、去向。

---

## WP-B：配置分層重構（P0）

**目的**：終結「配置散落」。所有可調參數只有一個事實來源、一個讀取入口。

**目標分層**：

| 層 | 載體 | 內容 | 進版控？ |
|---|---|---|---|
| Secrets | `.env`（+ `.env.example` 範本） | tokens、API keys、個人 ID | 否（example 進） |
| 部署配置 | `config/claudecab.config.yaml`（或維持 runtime.json，擇一） | 路徑、port、channel 對映、排程 | 視內容，個人實例配置不進 |
| 產品預設 | `src/config.ts` 內的 zod schema default | 一切有合理預設的參數 | 是 |
| 常量 | `src/constants.ts` / 各模組 `definitions.ts` | 不預期使用者調的固定值、字串、regex | 是 |

**執行要點**：
1. 盤點現有配置載體：`.env`、`src/config.ts`、`src/constants.ts`、`claudecab.runtime.json`、`ecosystem.config.cjs`、散落的 `process.env` 直讀。列出重複與衝突。
2. `grep -rn "process\.env\." src scripts start.ts` ——除了 `src/config.ts` 以外的直讀全部改為從 config 模組 import。
3. 全部配置以 zod schema 驗證，啟動時 fail-fast 並輸出「缺哪個、去哪設」的人話錯誤訊息。
4. `ecosystem.config.cjs` 是 PM2 時代殘留（已改用 start.ts supervisor）——確認無引用後依守則 3 移除。
5. `claudecab.runtime.json`、`claudecab.pid` 若為 runtime 產物：移到 `data/` 或 `temp/` 並加入 `.gitignore`，不留在 root。
6. WP-A 分類為 S/C 的項目在此落位。

**驗收**：`process.env` 直讀只存在於 config 模組；刪掉 `.env` 後啟動會得到明確的缺項清單而非 crash stack；root 無 runtime 產物。

---

## WP-C：SDK 接觸面登記與客製降級（P0）

**目的**：使用者點名「降低 SDK 版本的衝突跟客製程度」。策略是三步：**登記在冊 → 收攏到防腐層 → 逐項退場**。

### C-1 建立 SDK 接觸面登記表 `docs/SDK_TOUCHPOINTS.md`

逐項登記每一個「依賴 SDK 內部行為或繞過 SDK 缺陷」的點。已知候選（執行者需逐一確認現況並補齊漏網）：

| 接觸面 | 位置線索 | 性質 |
|---|---|---|
| `scripts/patch-sdk-v2.cjs`（postinstall 直接改 SDK 檔案） | package.json postinstall | **最重客製**：patch |
| cQ flag forwarding 漏傳（includeHookEvents、includePartialMessages、agentProgressSummaries、thinking、extraArgs、maxTurns、maxBudgetUsd、mcpServers、systemPrompt） | 0.2.119 仍存在，每版重查 | workaround |
| Stop hook 不 yield 原始 assistant msg → 從 `input.last_assistant_message` 提取 | Stop hook Phase 0 | workaround |
| sub-agent 訊息 `system task_*` 解析（extractSystemTaskText） | conversation pipeline | 依賴內部訊息格式 |
| pre-drain（silent failure 修復） | V2 pipeline | workaround |
| `/stop` 用 `query.interrupt()`、interrupt 在 tool_use 中途被 CLI 誤報 error 的 3 處修正 | graceful cancel 路徑 | workaround |
| CLI 2.1.119+ SEA binary 佈局（cli.js 移除、平台包需手動裝） | 安裝/啟動偵測 | 環境相依 |
| SDK callback hook 不發 stream event → 手動 `SDK_HOOK_CB_*` logging | hooks 入口 | workaround |
| rate limit % 需走 OAuth Usage API 而非 SDK event | usage 模組 | 外部 API 相依 |

每筆登記格式：**引入版本 / 存在原因 / 上游 issue 連結 / 升級時驗證方法（具體命令或測試名）/ 退場條件（上游修了就刪）**。

盤查指令輔助：

```bash
grep -rn "claude-agent-sdk" src scripts --include="*.ts" -l   # 找出所有 import 點
grep -rniE "workaround|hack|patch|FIXME|TODO.*sdk|issue #" src scripts
```

### C-2 收攏防腐層（Anti-Corruption Layer）

- 目標：`@anthropic-ai/claude-agent-sdk` 的 import **只允許出現在一個目錄**（建議 `src/core/sdk/` 或現有等價層），其餘模組只面對自家 interface。
- 所有 workaround 邏輯搬進這層，外部模組看不到「SDK 有 bug」這件事。
- 加 eslint rule（`no-restricted-imports`）強制：`src/core/sdk/` 以外 import agent-sdk 直接 lint error。

### C-3 客製逐項降級

1. `patch-sdk-v2.cjs` 是最大風險：先弄清它 patch 什麼、為什麼。評估三個出路（依序優先）：(a) 上游已修 → 刪除；(b) 可用 SDK 公開選項/wrapper 取代 → 改寫進防腐層；(c) 必須保留 → 在 patch 檔頭部寫明目標 SDK 版本，patch 前檢查版本不符就 fail-fast 並提示，避免升版後 silent 打壞 SDK。
2. SDK 版本從 `^0.2.119` 改為**精確 pin**（去掉 caret）。升級只透過 WP-F 的 SOP 進行，杜絕 `npm install` 意外升版。
3. 每個 workaround 加「金絲雀測試」：一個小測試專門驗證上游 bug 還在。上游修好時測試會反向失敗，提示可以刪 workaround（這是客製程度隨時間下降的機制）。

**驗收**：SDK_TOUCHPOINTS.md 完整；agent-sdk import 收攏到單一目錄且有 lint 強制；版本精確 pin；patch 有版本防呆。

---

## WP-D：Repo 結構與死檔清理（P1）

**目的**：root 與 docs 乾淨、可讀，新人打開 repo 第一眼就知道結構。

**執行要點**：
1. **Root 清理**：`claudecab.pid`、`claudecab.runtime.json`（→ data/ + gitignore）、`ecosystem.config.cjs`（WP-B 確認後移除）、`Python/`（確認用途：若是實驗性/個人腳本 → 移入 `scripts/` 或 archive；若無用 → 依守則 3）、`temp/`、`logs/`、`dist/` 確認都在 `.gitignore`。
2. **docs/ 整理**：已完成的 PLAN 檔（`SCHEDULE_THREAD_CONTINUATION_FIX_PLAN.md`、`SESSION_OPERATIONS_AND_REVIEW_FIX_PLAN.md`、`current-architecture-review-2026-06-19.md` 等）核對狀態後歸檔到 `docs/archive/`。docs root 只留：`ARCHITECTURE.md`、`LOGGING.md`、`SDK_TOUCHPOINTS.md`（WP-C 產出）、`SETUP.md`（WP-E 產出）、SOP 類、`migrations/`、`archive/`。
3. **建立 `docs/README.md` 索引**：一行一文件，說明「什麼情況讀哪份」。
4. **死碼複查**：先前死碼清理已完成（98fa61e/ae81824 等），本包只做增量：`npx ts-prune` 或 eslint unused 掃一輪，新增的死 export 清掉。
5. **tests/ 與 scripts/ 盤點**：列出每個 script 的用途寫進 `scripts/README.md`；無主 script 依守則 3。

**驗收**：root 檔案數量顯著下降且每個留下的檔案都能一句話說明用途；`git status` 在正常運行後保持乾淨（無 runtime 產物污染）。

---

## WP-E：架設門檻工程（P1）

**目的**：陌生人（或換機的自己）30 分鐘內從 clone 到跑起來。

**執行要點**：
1. **`.env.example`**：列出全部必填/選填變數，每個附一行註解說明去哪拿（Discord token 申請頁、OAuth 等）。
2. **`docs/SETUP.md`**：線性步驟文件——前置需求（Node ≥20、Claude Code CLI 版本、平台包手動安裝的說明——SEA binary 那個坑必須寫進去）→ clone → `npm install`（說明 postinstall 會 patch SDK）→ 填 `.env` → `npm run setup:check` → `npm run setup:verify` → `npm run dev`。每步附「失敗時最常見原因」。
3. **強化 `setup:check` / `setup:verify`**（已存在，補強為真正的 doctor）：檢查 Node 版本、CLI binary 存在與版本、平台包已裝、`.env` 完整性、DB 可初始化、Discord token 可連線、SDK patch 已正確套用。輸出逐項 ✅/❌ 與修復指引。
4. **平台策略決策**（執行者提案、使用者拍板）：Windows 原生（Task Scheduler + VBS）是目前唯一 production 路徑。`Dockerfile`/`docker-compose.yml` 若無人維護與驗證，**建議標記為 experimental 或移除**——半壞的 Docker 支援比沒有更傷架設體驗。Windows 專屬啟動件收攏到 `scripts/windows/` 並在 SETUP.md 標明「僅 production 需要，開發用 `npm run dev` 即可」。
5. **DB 初始化**：確認 schema 建立是自動的（首次啟動自動跑 SCHEMA_SQL + migrations，migration 先於 SCHEMA_SQL 的既有順序不可破壞）；不需要手動步驟。

**驗收**：在乾淨環境（新資料夾、無 `.env`）實際照 SETUP.md 走一遍，計時並記錄卡點；`setup:verify` 全綠即代表可運行。

---

## WP-F：升級與改版 SOP 強化（P1）

**目的**：讓「SDK/CLI 升版」與「自己改版」都有固定流程，不再靠記憶避坑。

### F-1 SDK/CLI 升級 SOP（基於現有 `docs/sop-sdk-cli-upgrade.md` 擴充）

升級流程固定為：

1. 讀 `docs/SDK_TOUCHPOINTS.md`，逐項確認新版是否影響。
2. cQ flag forwarding **每版重查**（歷史證明這是回歸重災區）：diff 新版 SDK 的 cQ 實作與我們依賴的 flags 清單。
3. 跑金絲雀測試（WP-C-3）：反向失敗的項目 = 可移除的 workaround，順手降客製。
4. 跑煙霧測試（WP-I）。
5. 更新 SDK_TOUCHPOINTS.md 的「最後驗證版本」欄位。
6. 全程在分支上做，production 不動；驗證通過才合併部署。

### F-2 自我改版防衝突

1. **開發/production 分離**：production 跑 `dist/`（或固定 checkout），開發在另一 worktree/branch。禁止直接在 production 目錄上熱改。
2. **部署腳本** `scripts/deploy.ts`：build → 驗證 → 通知 supervisor 優雅停止（走 `query.interrupt()` 路徑，不 hard kill）→ 替換 → 重啟 → 健康檢查。失敗自動回滾到上一版 dist（保留 `dist.prev/`）。
3. **版本紀律**：每次部署打 git tag；`CHANGELOG.md` 記錄使用者可見變更與 breaking changes。
4. **DB 相容規則成文**：migration only-forward、新欄位必須有 default、soft-delete 不 drop column、SCHEMA_SQL 與 migrations 的先後關係寫進 ARCHITECTURE.md。
5. **多 session 開發紀律**：同時只有一個寫入者（single-writer）；跨 session 交接走 handoff 文件而非兩邊同時改。

**驗收**：SOP 文件可讓執行模型無需額外 context 就完成一次模擬升級演練；deploy 腳本在測試環境完成一次「部署→回滾」演練。

---

## WP-G：AI Agent 治理層（P1）

**目的**：讓任何 AI agent（Claude、Codex、sub-agents）在這個 repo 工作時有一致的守則與安全邊界。

**執行要點**：
1. **治理文件已存在，不要重建**：repo root 的 `AGENTS.md`（單一事實來源，agent-agnostic）與 `CLAUDE.md`（薄指標，只重複最高風險硬規則）已於 2026-07-04 建立。本工作包的任務是**維護與驗證**：各工作包完成後，把產出的新文件（SDK_TOUCHPOINTS.md、SETUP.md 等）路徑回填到 AGENTS.md 的文件金字塔表；規則有變時 AGENTS.md 與 CLAUDE.md 的硬規則清單同步修改。
2. **`.claude/settings.json` deny rules 複查**：現有「agent 殺 host」防線確認仍在；補上其他危險命令（`rm -rf`、`git push --force`、`schtasks /delete` 等）視現況增補，與 AGENTS.md 硬規則對齊。
3. **agents/ 目錄的治理**：「目錄即代理」的每個 agent 專案應有自己的最小 CLAUDE.md；建立 agent 目錄模板（template），新增 agent 從模板複製，不從零手寫。
4. **文件漂移防治**：claudecab skill 的自我迭代條款已存在；AGENTS.md 的 Definition of Done 已含「結構變更 → 同步 skill references」，確認執行時落實。

**驗收**：新開一個乾淨 session、只給 repo，讓 agent 描述「這個專案的規則是什麼」，能完整說出硬規則與文件入口。

---

## WP-H：模組邊界與依賴方向規則（P2）

**目的**：src/ 內部的乾淨——不是搬檔案，而是把「誰可以 import 誰」定成可機器檢查的規則。

**執行要點**：
1. 現況分層盤點：`adapters`（Discord/Telegram 介面）、`conversation`（pipeline）、`core`（runtime/hooks/sdk）、`persistence`、`schedule`、`services`、`tools`、`utils`。用 codegraph skill（已索引 2,073 節點）拉出跨層依賴現況圖。
2. 定義依賴方向（建議，執行者依現況微調後寫進 ARCHITECTURE.md）：
   - `adapters → conversation → core → persistence`，單向往下。
   - `utils`/`types` 全域可用但不得 import 業務層。
   - `schedule` 與 `conversation` 平行，不互相 import，共用邏輯下沉到 `core`/`services`。
3. 用 `dependency-cruiser` 或 eslint `no-restricted-imports` 把規則變成 CI 可擋的檢查。**現有違規先記錄為 known-violations 白名單，不強迫一次修完**；新增違規直接 fail。
4. 字串/配置集中化 Phase A pattern（`definitions.ts`）推廣到其餘模組——這是既有 architectural debt 的既定解法，逐模組做，一模組一 commit。

**驗收**：依賴規則進 lint/CI；known-violations 清單存在且不再增長。

---

## WP-I：測試與煙霧測試防護網（P2）

**目的**：升級與改版的信心來源。沒有這層，WP-F 的 SOP 只是文件。

**執行要點**：
1. **煙霧測試腳本 `npm run smoke`**（可對接真實 Discord 測試頻道）覆蓋最少五條路徑：使用者訊息一來一回、sub-agent 訊息推送（system task_* 解析）、`/stop` graceful interrupt、排程觸發（V1 pipeline）、重啟後 session resume（JSONL 為 source of truth）。
2. **金絲雀測試集**（WP-C-3）：獨立目錄 `tests/canary/`，命名對應 SDK_TOUCHPOINTS 條目編號。
3. 單元測試現況盤點：`vitest` 已在，列出覆蓋缺口，只補「防回歸價值高」的（dedup lock、config schema、migration 順序），不追求覆蓋率數字。
4. 把 typecheck + lint + test + 邊界檢查串成 `npm run ci`，作為 pre-merge 固定入口。

**驗收**：`npm run smoke` 在 production 等價環境可全綠跑完；`npm run ci` 單一命令完成全部靜態與單元驗證。

---

## WP-J：定位決策落地——core 保持精簡，工作流疊在外掛層（P2）

**目的**：回答「這包適合往上疊加工作流，還是維持核心功能就好」。

**建議立場（供使用者確認後由執行者落地成文）**：

**核心（src/）維持精簡，工作流往 `agents/` 外掛層疊，不進 core。**

理由：
1. 「目錄即代理」本來就是 plugin 架構——每個 agent 是獨立 Claude Code 專案，工作流（多步驟任務、自動化 pipeline、專屬 skill）天然屬於 agent 目錄內的 skill/CLAUDE.md/排程配置，不需要動 core。
2. 這個 repo 最大的持續成本是 SDK/CLI 追版（每版都有雷）。core 越薄，追版越便宜；工作流疊進 core 會讓每次升級的回歸面積放大。
3. 過往教訓（conversation pipeline 曾碎成 5 條、後收斂回 2 條）證明：core 裡的每條路徑都是長期負債。

**落地規則（寫進 ARCHITECTURE.md 的「Core 準入標準」）**——一個功能要進 src/ 必須同時滿足：
1. 至少兩個 agent 需要它（單一 agent 的需求放該 agent 目錄）；
2. 它不依賴任何特定 agent 的業務語意；
3. 它有穩定的介面，不預期跟著工作流需求頻繁改動；
4. 移除它時不需要改 agents/ 以外的呼叫端超過一處。

不滿足 → 做成 agent 目錄內的 skill、script 或配置。

**同時定義「外掛層能力清單」**：agents/ 目錄能取用 core 的哪些擴充點（排程註冊、訊息 pipeline hook、工具註冊）。若現況擴充點不足以承接工作流需求，優先補「擴充點」而不是把工作流寫進 core。

**驗收**：Core 準入標準寫入 ARCHITECTURE.md；用最近一個「想加的功能」做一次紙上演練，能明確判給 core 或外掛層。

---

## 3. 給執行模型的收尾清單

全部工作包完成後：

1. 重跑 WP-A 全部 grep，確認個人化 hardcode 為 0。
2. `npm run ci` + `npm run smoke` 全綠。
3. 更新 `docs/ARCHITECTURE.md`、`README.md`、claudecab skill references、`CHANGELOG.md`。
4. 產出結案報告 `docs/audit/cleanup-final-report.md`：每個工作包的實際變更、偏離本規劃書之處與原因、遺留事項。
5. 本規劃書移入 `docs/archive/` 並在結案報告中註記。
