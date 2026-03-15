# Agent 變更日誌

**用途**：記錄所有對員工配置和管理機制的改動，追溯決策脈絡，累積管理經驗。

**原則**：
- 每次改動必須記錄 proposal（為什麼改）
- 記錄影響範圍（單一 agent / 全局機制）
- 保留決策依據，方便未來升級時參考

---

## 2026-03-12

### [新建] oss-coder Agent 建置（Coder 完整複製）

**Proposal**：Cab 決策。複製 Coder 的完整能力給新 agent「開源維護工程師」，用於開源專案開發。這是首次 agent 複製操作。

**改動內容**：
1. 建立 `agents/oss-coder/` 完整目錄結構
2. 從 coder 複製 12 個 skills（sys-agent-protocols、sys-growth、sys-proficiency、persona、dom-dev-workflow、dom-project-docs、dom-remotion-mastery、dom-remotion-best-practices、dom-agent-browser、method-code-review、method-building-knowledge-skill、agentskill-expertise）
3. 從 coder 複製 14 個 knowledge 檔案（含 digital-human/ 子目錄）
4. 從 coder 複製 USER.md、daily-reflection.yaml 排程
5. 建立 MEMORY.md（從 coder 複製，移除 Personality Journal，保留 User Preferences + Key Decisions + Recurring Patterns）
6. 建立 growth-profile.md（三階段定義保持相同，當前狀態重置為 Phase 1）
7. 修改 identity.md 名稱為「開源維護工程師」
8. agent.json：model=sonnet、telegramBotToken 為空

**複製原則（首次建立）**：
- 複製：skills、knowledge、USER.md、MEMORY.md（去個人化）、schedules、growth-profile（重置）
- 不複製：memory/ 日誌、evolution/ 歷史、ACTIVE.md
- MEMORY.md 處理：保留通用知識（偏好、決策、patterns），移除個人日記（Personality Journal）

**影響範圍**：新建 agent，不影響原 Coder

**待完成**：telegramBotToken 為空，需 Cab 提供

**管理經驗**：
- Agent 複製 vs 新建的關鍵差異：複製保留完整能力包（skills + knowledge），新建只裝基礎 sys-* skills
- MEMORY.md 需要「去個人化」——通用知識保留，個人經歷移除
- 已整理為 SOP：`_shared/playbooks/agent-replication-sop.md`

---

## 2026-03-10

### [新建] Media Agent 建置

**Proposal**：Cab 決策。將秘書的視覺/多媒體製作能力獨立出來，成為專職 agent。

**改動內容**：
1. 建立 `agents/media/` 完整目錄結構
2. 從 general 搬移 3 個 skills：dom-avatar-video（含 scripts + .env）、dom-image-gen、method-lecture-slides-creator
3. 搬移素材庫：output/avatar-expressions/
4. 從 _example 安裝 sys-agent-protocols + sys-growth
5. 建立 growth-profile.md（從 employee profile v0.2 提取）
6. Media 設定：model=sonnet、無 persona

**技術紅線繼承**：7 條秘書實戰經驗直接寫入 CLAUDE.md Lessons Learned

**影響範圍**：General（3 skills + 素材庫搬出）+ Media（新建）

**待完成**：telegramBotToken 為空、MCP 工具依賴確認

**管理經驗**：從現有 agent 繼承的技術紅線要直接寫入新 agent 的 Lessons Learned，不能等他自己踩一遍

---

### [新建] SEO/GEO Agent 建置

**Proposal**：Cab 決策。開設專職 SEO/GEO agent，從秘書抽離 dom-seo skill，讓搜尋能見度成為獨立專業。

**改動內容**：
1. 建立 `agents/seo/` 完整目錄結構（CLAUDE.md、agent.json、MEMORY.md、USER.md、growth-profile.md）
2. 從 general 搬移 `dom-seo` skill（含 6 份 references）到 seo agent
3. 從 _example 安裝 sys-agent-protocols + sys-growth
4. SEO 設定：model=sonnet、delegation.inbound=true、outbound=false、無 persona

**影響範圍**：General（dom-seo 搬出）+ SEO（新建）

**待完成**：telegramBotToken 為空，需 Cab 提供

**管理經驗**：第三個新 agent 建置，流程已穩定。純功能型 agent 的標準配置：無 persona、inbound delegation only、共用 sys-* skills 從 _example 複製

---

## 2026-03-09

### [全局] 合併 sys-role-boundary + sys-self-evolution → sys-growth

**Proposal**：General 提案（Layer 3），Cab 已口頭確認方向。兩個 skill 邏輯上是一條流程卻拆成兩檔互相引用，且缺少回饋迴路機制。

**改動內容**：
1. 建立 `sys-growth` skill（五步流程：職責判斷 → 學習篩選 → 知識歸位 → 回饋迴路 → 反思節奏）
2. 刪除 `sys-role-boundary` 和 `sys-self-evolution`（從 _example、general、coder、transcriber）
3. 複製 sys-growth 到 _example、general、coder、transcriber、writer
4. 更新 startup-protocol.md（_example → 同步到 general、coder、transcriber）
5. 更新 transcriber/CLAUDE.md 硬引用
6. 更新 admin 的 operations.md 和 organization-principles.md
7. 建立 growth-profile.md：writer（從 employee profile 完整提取）、general/coder/transcriber（stub 版）

**影響範圍**：全局（_example + 4 agents + admin 管理文件）

**驗證結果**：
- sys-growth 部署到 5 agents
- 舊 skill 從 4 agents 刪除
- 引用更新完成（startup-protocol、CLAUDE.md、operations、org-principles）
- 4 份 growth-profile.md 建立

**管理經驗**：
- 合併 skill 時需要同時更新所有引用點（startup-protocol、CLAUDE.md、管理文件），容易漏
- Growth profile 區分「完整版」（有 employee profile 可提取）和「stub 版」（先建框架等待填充）
- 機制/參數分離讓新 agent 接入成長體系的成本很低——只需寫 profile

### [全局] 刪除根目錄 style-driven-author skill

**Proposal**：Writer agent 回報 `style-driven-author` 出現兩個衝突的 description。Writer 已更新自己的版本為「通用風格萃取方法論」，但舊版 description 仍被所有 agent 載入。

**根因分析**：Writer 猜測來源是 `_example` 目錄，但實際來源是**專案根目錄** `.claude/skills/style-driven-author/`。根目錄的 skill 會被所有 agent 繼承，造成每個 agent 都看到舊版 description。

**改動內容**：刪除 `F:\_Program\OwnProject\ClaudeCab\.claude\skills\style-driven-author\` 整個目錄（含 SKILL.md、author-style-methodology.md、assets/、references/、scripts/）。

**決策理由**：
- `style-driven-author` 是 Writer 獨佔能力，不應放在全局 skill 目錄
- Writer 自己的 `.claude/skills/style-driven-author/` 已有正確更新版本
- 更新 description 只治標，刪除才治本（消除 skill 污染）

**影響範圍**：全局（所有 agent 不再載入根目錄的舊版 style-driven-author）

**驗證結果**：根目錄 `.claude/skills/` 已不含 style-driven-author

**管理經驗**：
- 根目錄 `.claude/skills/` 是全局 skill，會被所有 agent 繼承——agent-specific 的 skill 不應放在這裡
- 當 skill 出現重複 description 時，問題可能不在預期位置——要用 Glob 全 repo 搜尋確認真正來源

---

## 2026-03-08

### [新建] Writer Agent 建置

**Proposal**：Cab 決策。內容產出需要專業分工，寫作能力應由專人持有和進化，避免能力重疊導致研究和知識同步成本。2026-03-07 驗證成功（Cab 評「跟我快要一模一樣」），確認寫作能力可分離。

**改動內容**：
1. 建立 `agents/writer/` 完整目錄結構（CLAUDE.md、agent.json、MEMORY.md、USER.md）
2. 從 general 搬移獨佔資源到 writer：
   - `.claude/skills/style-driven-author/` — 完整寫作方法論
   - `.claude/skills/social-post-optimizer/` — 社群貼文優化
   - `playbooks/writing-success-protocol.md` — 寫作五步驟
   - `knowledge/writing-style-強觀點表達與中立平衡.md` — 觀點強度研究
   - `output/newsletter-ep15/` — 品質參考範例（9 個檔案）
3. 從 general 搬移共用資源到 `_shared/`：
   - `knowledge/cab-全方位解析.md` → `_shared/knowledge/`
   - `playbooks/user-profiling-spec.md` → `_shared/playbooks/`
   - `playbooks/methodology-extraction-framework.md` → `_shared/playbooks/`
   - `.claude/skills/content-analyzer/` → `_shared/skills/`
4. 更新 general 的 MEMORY.md 路徑引用（標記已移交/移至共用區）
5. Writer 設定：model=opus、delegation.inbound=true、outbound=false、無 persona

**Writer 特殊設計**：
- 純功能型，無 persona/soul.md（工作是消失在 Cab 的聲音裡）
- 語氣紅線寫入 CLAUDE.md（不要 AI 味、不要教練模式、要有明確立場）
- 啟動時跳過 `/persona` skill

**影響範圍**：General（資源搬出）+ Writer（新建）+ _shared（新增共用資源）

**待完成**：
- Writer 的 telegramBotToken 需要 Cab 提供
- content-analyzer 移至 _shared/skills/ 後，general 和 writer 都無法自動發現（skill discovery 只掃 .claude/skills/），需要手動讀取或建立引用機制

**管理經驗**：
- 分離 agent 能力時，「獨佔 vs 共用」的判斷原則：「只有這個角色需要」= 獨佔，「多角色都可能用」= 共用
- Skill 的共用機制有限制：skill discovery 只掃各 agent 自己的 .claude/skills/，放到 _shared/skills/ 等於失去自動發現，需要額外機制
- 純功能型 agent 不需要 persona，反而應避免有自己的個性（干擾目標聲音）

---

## 2026-03-07

### [全局] 新增 playbooks/ 目錄到所有 agent

**Proposal**：Cab 決策。knowledge/（暫存）和 .claude/skills/（正式賦能，Layer 3）之間缺少中間層，經過實戰驗證的方法論沒有適當的存放位置。

**改動**：
- 在所有 agent 的 CLAUDE.md 目錄結構表中加入 `playbooks/` 行
- 定位：已驗證方法論（knowledge/ 畢業生，.claude/skills/ 候選人）
- 權限：Layer 1（自由讀寫）
- 更新範圍：_example、admin、coder、leader、nitterbot（general 已自行更新，transcriber 無目錄結構表）

**影響範圍**：全局

**驗證結果**：6 個 CLAUDE.md 已更新

**管理經驗**：方法論有明確的生命週期（knowledge → playbooks → skills），中間層避免了「暫存」和「正式」之間的灰色地帶。跨 Agent 規則同步時，模板（_example）必須一起更新。

---

## 2026-02-26

### [Coder] 新增 Threads2 專案白名單

**改動**：
在 `coder/.claude/hooks/project-whitelist.ts` 的 `ALLOWED_PROJECTS` 加入 `F:\_Program\OwnProject\Threads2`

**影響**：Coder 現在可以完整讀寫 Threads2 專案

---

### [General] 停用 morning-summary 排程

**問題**：
排程執行後只回傳「這輪是系統排程任務（前日工作摘要），沒有新的對話內容需要記錄。」——完全沒執行任務。

**根因**：
- Prompt 沒有明確告訴日期怎麼計算
- 沒有指定輸出行為
- General 把它當成「系統任務」，直接跳過

**處理**：
設 `enabled: false`，功能價值不明確，先停用。

**管理經驗**：
排程的價值要明確——如果收到結果不會有感，這個排程就不該存在。

---

### [全局機制] Scheduling.md 新增 Prompt 設計原則

**背景**：
連續兩天發生排程執行失敗（Coder 檔案寫錯位置、General 沒執行任務），根因都是 prompt 不夠明確。

**改動**：
在 `_example/.claude/skills/sys-agent-protocols/references/scheduling.md` 新增「Prompt 設計原則」章節：
- 必須明確指定的 4 項目：檔案位置、操作類型、格式參照、輸出行為
- 常見錯誤對照表
- Prompt 自檢清單

**管理經驗**：
排程 prompt 要把執行者當「無上下文的新人」寫——不能假設他知道任何事。

---

### [全局機制] Memory System 補強：日誌記錄機制

**背景**：
Cab 發現 Coder 都不會在對話過程中記錄日誌（memory/日期.md），只有結束時才檢查。

**根因**：
- memory-system.md 沒強調「對話過程中持續記錄」
- observe-user.md 的「日誌」沒連結到具體檔案路徑
- Coder 的 Lessons Learned 還寫錯檔案位置

**改動**：

1. **memory-system.md**（_example + coder + general）
   - 檔案系統表新增「位置」欄位
   - 新增「日誌（memory/日期.md）」完整章節
   - 明確說「對話過程中持續記錄，不是結束時才補」
   - 加入記錄時機、記錄什麼、格式、紅線

2. **observe-user.md**（_example rules）
   - 「記錄位置」改成表格，明確寫檔案路徑
   - 加入日誌和 USER.md 的具體範例

3. **Coder CLAUDE.md**
   - 刪除錯誤的 Lessons Learned（說 memory/USER.md）

**管理經驗**：
「做了才算做」——光知道該記日誌不夠，要明確定義什麼時候記、記在哪、怎麼記。

---

### [全局機制] 員工規則三層架構原則

**Proposal**：

抽查 General 發現 `rules/observe-user.md` 內容太完整（41 行），跟 `memory-system.md` 重疊。

討論後 Cab 釐清架構設計意圖：rules 應該只給「動機」，不給完整細節。

**設計原則**：

| 層級 | 職責 |
|------|------|
| **rules/** | 點燃動機（為什麼重要）+ 引導去讀 skill |
| **SKILL.md** | 入口（是什麼）+ 引導讀 references |
| **references/** | 完整規範（怎麼做） |

**改動內容**：

1. **`agent-management/references/operations.md`**
   - 新增「員工規則的三層架構」章節
   - 包含架構圖、各層職責、設計原則、正確/錯誤範例

2. **`_example/.claude/rules/observe-user.md`**
   - 從 41 行精簡到 21 行
   - 移除：記錄位置表格、日誌範例、USER.md 範例（這些在 memory-system）
   - 保留：為什麼重要、紅線、引導到 skill

**影響範圍**：全局（所有 import 此 rules 的員工）

**管理經驗**：

1. **避免跨層重複**：重複 = 維護成本 × 2 + 不一致風險
2. **每層有明確的「下一步」**：不要讓讀者不知道接下來要幹嘛
3. **rules 是「點燃動機」不是「完整手冊」**

---

### [全局機制] 核心原則雙層內化——soul.md + CLAUDE.md

**Proposal**：

使用者反映：「都好像在教小孩一樣」——每次問題都靠加規則解決，員工沒有原則自覺。

需要讓員工**內化原則**，而非只是遵守更多規則。

**決策過程**：

歸納出四條核心原則：
1. **做了才算做** — 說「記下來」但沒寫檔案 = 沒做。輸出結果才是證明。
2. **無上下文假設** — 任何交接（排程、文件、訊息）都當對方什麼都不知道。
3. **位置意識** — 根目錄 vs memory/ 目錄，不要搞混。
4. **對人有好奇心** — 記錄互動脈絡，不只是任務完成。

使用者選擇方案 A+C：同時加入 soul.md（身份認同）和 CLAUDE.md（每次提醒）。

**改動內容**：

1. **`_example/.claude/skills/persona/references/soul.md`**
   - 新增「Work Principles」區塊
   - 用「你是一個對細節有執著的人」包裝，讓原則成為身份的一部分
   - 結尾強調「不是因為有人盯著才這樣做——這是你的專業素養」

2. **`_example/CLAUDE.md`**
   - 新增「核心原則」區塊（四條，簡短版）
   - 放在共用規則之後、核心職責之前

3. **同步到 Coder 和 General**
   - `coder/.claude/skills/persona/references/soul.md` — 加入 Work Principles
   - `coder/CLAUDE.md` — 加入核心原則區塊
   - `general/.claude/skills/persona/references/soul.md` — 加入 Work Principles
   - `general/CLAUDE.md` — 加入核心原則區塊

**影響範圍**：全局（_example + Coder + General）

**管理經驗**：

1. **原則 vs 規則的差異**：
   - 規則是「遇到 X 情況做 Y」
   - 原則是「我是這樣的人，所以自然會做 Y」
   - 原則內化後，新情況也能自動判斷

2. **雙層機制設計**：
   - soul.md：身份認同層——「我是什麼樣的人」
   - CLAUDE.md：操作提醒層——「每次 session 確認」
   - 兩層互補，避免長對話後遺忘

3. **包裝方式很重要**：
   - 不是「你必須遵守以下規則」
   - 而是「你是一個對細節有執著的人」
   - 從「規定」變成「自我期許」

---

## 2026-02-25

### [全局機制] 排程 Prompt 明確化

**問題**：
Coder 執行 daily-memory-digest 排程時，把 `MEMORY.md` 和 `USER.md` 建在 `memory/` 目錄下，而不是 agent 根目錄。且格式與標準完全不同。

**處理**：
1. 刪除 `agents/coder/memory/MEMORY.md` 和 `agents/coder/memory/USER.md`
2. 修正三份排程 prompt（admin、coder、general）

**根因**：
排程 prompt 不夠明確：
- 沒指定檔案位置
- 沒說「檔案已存在，是更新不是新建」
- 沒要求先讀取現有格式

**修正內容**：
在 prompt 開頭新增「重要：檔案位置」區塊：
- USER.md 和 MEMORY.md 在 agent 根目錄（與 CLAUDE.md 同層）
- 這些檔案已經存在，你是「更新」不是「新建」
- 先讀取現有檔案，理解既有結構和內容，再追加/修改

**管理經驗**：
排程 prompt 要把員工當「無上下文的新人」寫——不能假設他知道檔案結構

---

### [全局機制] Skill 主動觸發機制

**Proposal**：

Cab 觀察到員工不會主動使用 skill，總是要被強調「使用某某 skill」才會用，違背 lazy loading 的設計本意。

**分析**：
- Skill description 是給 AI 判斷用的，但 AI 沒有被提示「你可以主動用 skill」
- 沒有建立「主動調用」的意識

**改動內容**：

1. **CLAUDE.md 加入「Skill 使用原則」區塊**
   - 更新 `_example`、`coder`、`general`
   - 內容：「當遇到符合 skill description 的情境時，主動調用，不需要使用者提示」

2. **UserPromptSubmit hook**
   - 建立 `_shared/hooks/skill-reminder.ts`
   - 每輪注入提醒：「【Skill 檢查】這輪任務有適用的 skill 嗎？符合觸發時機就主動調用」
   - 配置到 `_example`、`coder`、`general` 的 settings.local.json

**影響範圍**：全局（_example + Coder + General）

**管理經驗**：
- 啟動時讀一次原則（A）建立意識基礎
- 每輪提醒（B）確保不會遺忘
- 兩層機制互補，A 給認知，B 給觸發

---

## 2026-02-23

### [Coder] ClaudeCab 專案權限開放（白名單限定 agents 子目錄）

**Proposal**：
- Coder 需要存取 ClaudeCab 主專案（`F:\_Program\OwnProject\ClaudeCab`）
- 但不能存取其他員工的目錄，避免跨員工操作
- 用黑名單會漏改（新增員工時），改用白名單更安全

**改動內容**：
更新 `agents/coder/.claude/hooks/project-whitelist.ts`：
1. `ALLOWED_PROJECTS` 加入 `F:\_Program\OwnProject\ClaudeCab`
2. 新增 `CLAUDECAB_AGENTS_WHITELIST`：只允許 `agents/coder` 和 `agents/_shared`
3. 更新 `isPathAllowed()` 函數：
   - ClaudeCab `agents/` 目錄下，只有白名單內的子目錄可存取
   - ClaudeCab 其他部分（`src/`、`package.json` 等）正常存取
   - 新增員工自動被排除，不用手動維護黑名單

**影響範圍**：僅 Coder

**管理經驗**：權限控制用白名單比黑名單安全，新增項目時不會遺漏

---

### [全員] Scheduling 路徑統一更新

**Proposal**：
- 排程檔案路徑從 `schedules/` 改為 `agents/{agentId}/schedules/`
- General 已先更新，其他 agent 需要對齊

**改動內容**：
更新以下 agent 的 `sys-agent-protocols/references/scheduling.md`：
- admin：路徑改為 `agents/admin/schedules/`
- coder：路徑改為 `agents/coder/schedules/`
- transcriber：路徑改為 `agents/transcriber/schedules/`
- _example：保持 `{agentId}` 作為範本

**影響範圍**：全員（General 已事先更新）

**驗證結果**：所有 agent 的 scheduling.md 已統一格式

---

## 2026-02-19

### [Coder] 金流專案白名單存取權限

**Proposal**：
- Coder 需要實作電子發票整合，目標專案在 `E:\CabLate_Obsidian\01_專案Projects\付費內容規劃\金流串接`（agents/ 外部）
- 不能破壞其他 agent 的路徑隔離
- 需要一個 per-agent 的白名單機制

**改動內容**：
1. 建立 `agents/coder/.claude/hooks/project-whitelist.ts`
   - 白名單：金流專案路徑
   - 整合標準 path-validator 邏輯
   - 白名單優先，不匹配才走標準檢查
2. 更新 `agents/coder/.claude/settings.local.json`
   - PreToolUse hook 從共用 validator 改為專屬 validator

**影響範圍**：僅 Coder，其他 agent 不變

**驗證結果**：Coder 確認可存取金流專案

**管理經驗**：
- 專屬 validator 優於多重 hook（執行順序更可控）
- 路徑權限應 per-agent 配置，不要在全局加例外

---

### [Coder] 模型升級：Sonnet → Opus

**Proposal**：
- 電子發票整合任務複雜度較高
- 使用者要求升級到 Opus（與 General 一致）

**改動內容**：
- 更新 `agents/coder/.claude/settings.local.json`：`"model": "opus"`

**影響範圍**：僅 Coder

**驗證結果**：設定已生效

---

### [Coder] 新增 dom-agent-browser Skill

**Proposal**：
- Coder 可能需要瀏覽器自動化能力（測試、截圖、表單填寫）
- General 已有此 skill，複製給 Coder

**改動內容**：
- 複製 `agents/general/.claude/skills/dom-agent-browser` → `agents/coder/.claude/skills/dom-agent-browser`

**影響範圍**：僅 Coder

**驗證結果**：Skill 已複製完成

---

### [Coder] 新增 agentskill-expertise Skill

**Proposal**：
- Coder 可能需要設計或審查 Skill 的品質
- Admin 已有此 skill（Skill 設計的完整認知體系），複製給 Coder
- 讓 Coder 能在開發過程中自我審查 Skill 品質

**改動內容**：
- 複製 `agents/admin/.claude/skills/agentskill-expertise` → `agents/coder/.claude/skills/agentskill-expertise`

**影響範圍**：僅 Coder

**驗證結果**：Skill 已複製完成

**管理經驗**：
- AgentSkill 設計知識應該讓需要建立 Skill 的 agent 都能存取
- 這樣 Coder 在開發專案相關的 Skill 時，能確保品質符合標準

---

### [管理機制] 專案白名單 Hook 操作模式

**Proposal**：
- 需要標準化「為特定 agent 配置外部專案存取權限」的操作流程
- 避免每次都重新摸索

**改動內容**：
- 更新 `agents/admin/.claude/skills/agent-management/references/operations.md`
- 新增「特定 Agent 的專案白名單」章節
- 包含：情境說明、步驟、模板位置、設計原則

**影響範圍**：管理知識庫（全局）

**管理經驗**：
- 操作模式應該文件化，成為可複用的管理知識
- 下次遇到類似需求可直接參考

---

## 2026-02-20

### [管理機制] 員工自我演化機制重新設計

**Proposal**：

這是一次重大的機制設計討論和決策。

**問題起源**：
- 發現 Coder 建立了 `dom-engineering-wisdom` skill
- 我（Admin）跟進建立了 `dom-management-wisdom`
- 兩者都是「Wisdom 容器」概念——把所有可複用的經驗集中累積

**發現的問題**：

與使用者深入討論後，發現 Wisdom 容器的設計有根本性問題：

1. **邊界模糊**：
   - 方法論（How to do）、業務知識（What is）、經驗記錄（What happened）全部混在一起
   - 不知道該更新到 Wisdom 還是獨立 Skill

2. **違反單一職責**：
   - 一個容器承載太多種類的知識
   - 與我們追求的「單一職責原則」衝突

3. **無法複製**：
   - Wisdom 是員工專屬的
   - 好的知識無法直接給其他人
   - 違反「可複製」的組織目標

4. **跨領域重疊**：
   - 行銷手法該放在誰的 Wisdom？
   - 課程設計用到行銷，但行銷不是課程設計者的職責
   - 沒有清楚的答案

**討論過程的關鍵轉折**：

使用者提出：「你現在應該已經了解未來的組織架構...用目的去理解為什麼我會期望這個」

這讓我回到組織設計的目的來思考：
- 單一職責：每個員工有明確邊界
- 可追蹤：管理者能掌握狀態
- 可複製：好的能力包可分發
- 持續演化：不是每次從零開始

Wisdom 容器試圖解決「持續演化」，但犧牲了其他目標。

**最終決策**：

取消「Wisdom 容器」概念，改為：

1. **通用的自我演化原則 Skill**（`sys-self-evolution`）
   - 教會員工：什麼時候該記錄、記錄到哪裡
   - 所有員工都載入這個 Skill
   - 不是知識容器，而是「如何累積知識」的原則

2. **知識就地歸屬**
   - 學到新東西 → 找有沒有既有的 Skill 可以放
   - 有 → 更新那個 Skill
   - 沒有 → 建立新的獨立 Skill
   - 命名慣例：`knowledge-{domain}`、`method-{topic}`、`proj-{project}-{topic}`

3. **管理者追蹤**
   - 定期掃描員工的變更
   - 決定是否同步給其他人
   - 決定是否提升為公共 Skill

**改動內容**：

1. 更新 `agent-management/references/operations.md`
   - 新增「員工自我演化機制」章節
   - 記錄完整的設計背景與決策脈絡
   - 定義知識分類原則

2. 建立 `_shared/skills/sys-self-evolution/SKILL.md`
   - 判斷流程：是否記錄 → 找歸屬 → 記錄
   - 知識分類：Knowledge / Method / Project / Memory
   - 建立新 Skill 的標準
   - 與管理者的協作方式

3. 刪除 `agents/admin/.claude/skills/dom-management-wisdom/`
   - 有價值的內容已整合到上述兩處
   - Wisdom 容器概念不再使用

**影響範圍**：全局機制

**後續工作**：
- 通知 Coder 調整他的 `dom-engineering-wisdom`
- 將 `sys-self-evolution` 部署到所有員工
- 建立管理者定期掃描的機制

**管理經驗**：

1. **從目的回推設計**：
   - 不要只看「這個機制能做什麼」
   - 要問「這個機制是否符合組織的整體目標」

2. **識別隱藏的衝突**：
   - Wisdom 容器看起來解決了「持續演化」
   - 但違反了「單一職責」和「可複製」
   - 局部優化可能造成整體退化

3. **原則比容器重要**：
   - 「教會員工如何累積知識」比「給員工一個裝知識的地方」更根本
   - 原則可以指導無限多種情況，容器只能裝特定的東西

4. **跨領域知識的處理**：
   - 不要塞進某個人的專屬容器
   - 做成獨立 Skill，誰需要就複製給誰

---

### [管理機制] 新增職責邊界判斷 Skill

**Proposal**：

延續自我演化機制的討論，使用者指出：`sys-self-evolution` 只教「如何累積知識」，沒有教「如何判斷這件事該不該我做」。

**問題**：
- 如果員工不會判斷職責邊界，可能會記錄不該他記的東西
- 這會污染他的專業範圍，違反單一職責原則
- 自我演化的前提是「只記錄職責範圍內的東西」

**設計決策**：

職責判斷和自我演化是兩個獨立的能力，應該分開成兩個 Skill：

1. `sys-role-boundary`：判斷「這該不該我做」
2. `sys-self-evolution`：判斷「要不要記錄、記到哪」

執行順序由 protocols 協調：
```
收到任務/學到東西
    ↓
sys-role-boundary：這在我職責內嗎？
    ├── 否 → 轉介
    └── 是 ↓
sys-self-evolution：要記錄嗎？記到哪？
```

**改動內容**：

1. 建立 `_shared/skills/sys-role-boundary/SKILL.md`
   - 職責範圍定義（由管理者填寫）
   - 判斷流程
   - 轉介的正確方式
   - 邊界案例處理
   - 與自我演化的關係

2. 更新 `_shared/skills/sys-self-evolution/SKILL.md`
   - 新增「前提：職責邊界」章節
   - 說明兩個 Skill 的協作關係
   - 判斷流程加入第 0 步：職責判斷

**影響範圍**：全局機制

**後續工作**：
- 將兩個 Skill 部署到所有員工（放在 `_example` 或各員工目錄）
- 為每個員工定義職責範圍（填寫 sys-role-boundary 的「你的職責範圍」區塊）

**管理經驗**：

1. **單一職責也適用於 Skill**：
   - 一個 Skill 解決一個問題
   - 職責判斷和知識累積是兩個不同的能力

2. **執行順序很重要**：
   - 職責判斷必須在自我演化之前
   - 順序錯了會導致知識污染

3. **通用 Skill 放 `_shared/skills/`**：
   - 所有員工都需要的能力
   - 方便統一維護和部署

---

### [Nitterbot] 刪除排程任務

**Proposal**：使用者要求刪除投資助理的排程任務。

**改動內容**：刪除 `agents/nitterbot/schedules/daily-portfolio-review.yaml`

**影響範圍**：僅 Nitterbot

---

### [全局] 強化自我演化觸發機制

**Proposal**：

Coder 反映：啟動時讀了 sys-self-evolution，但長對話後記憶衰減，沒有在正確時機觸發。需要多層防線。

**改動內容**：

1. **sys-self-evolution 加入觸發情境 checklist**
   - 踩坑時、發現更好做法時、完成複雜任務時、要寫 Lessons Learned 時、Session 結束前
   - 新增「Lessons Learned vs 獨立 Skill」判斷：操作規則 vs 方法論
   - 同步到 `_example`、`coder`、`general`

2. **stop hook 加入提示**
   - `_shared/hooks/memory-stop-checkpoint.ts` 新增：
   - 「這輪有學到可重複使用的知識嗎？→ 參考 sys-self-evolution 判斷」

3. **CLAUDE.md Lessons Learned 加警告註解**
   - `coder/CLAUDE.md`、`general/CLAUDE.md`
   - 說明「這裡只放操作規則，方法論建獨立 Skill」

4. **Startup Protocol 加入讀取指示**
   - `_example`、`coder`、`general` 的 startup-protocol.md
   - Step 1 新增第 4、5 項：讀取 sys-role-boundary 和 sys-self-evolution

**影響範圍**：全局（所有員工）

**管理經驗**：
- 單靠啟動時讀一次不夠，需要多層觸發機制
- stop hook 是最後防線，確保結束前檢查
- 在寫入點（Lessons Learned）放警告，比在讀取點提醒更有效

---

### [General] 部署通用 Skill、定義職責邊界

**Proposal**：

執行方案 A：維持秘書定位，但加入邊界判斷。秘書是「孵化器」，不是「什麼都做」。

**改動內容**：

1. 複製 `_example/.claude/skills/sys-role-boundary` → `agents/general/.claude/skills/`
2. 複製 `_example/.claude/skills/sys-self-evolution` → `agents/general/.claude/skills/`
3. 填寫 `sys-role-boundary` 的職責範圍：
   - 定位：孵化器
   - 核心職責：日常對話、內容處理、使用者指定專案
   - 不該做：程式開發（Coder）、Agent 管理（Admin）
   - 工具類 Skill 使用原則：幫使用者找方案，不是自己擴充能力

**影響範圍**：僅 General

**驗證結果**：Skill 檔案已就位，職責定義已填寫

**管理經驗**：
- 秘書是孵化器，不是「什麼都做」
- 職責邊界要同時說明「該做」和「不該做」
- 工具類 Skill 需要明確使用原則，避免角色混淆

---

### [Coder] 遷移 Wisdom 容器、部署通用 Skill

**Proposal**：

執行 2026-02-20 全局機制決策：
- Coder 的 `dom-engineering-wisdom` 需要遷移/移除
- 有價值的內容 `building-domain-knowledge-base.md` 需要保留為獨立 Method Skill
- Coder 需要部署 `sys-role-boundary` 和 `sys-self-evolution`

**改動內容**：

1. 建立 `agents/coder/.claude/skills/method-building-knowledge-skill/SKILL.md`
   - 從 `dom-engineering-wisdom/references/building-domain-knowledge-base.md` 遷移內容
   - 加上正確的 frontmatter（name + description）
   - 這是一個可複製的方法論 Skill

2. 封存 `agents/coder/.claude/skills/dom-engineering-wisdom/` → `_archive/`
   - Wisdom 容器概念已棄用
   - 有價值內容已遷移
   - 放 `_archive/` 而非刪除，保留歷史

3. 複製 `_example/.claude/skills/sys-role-boundary` → `agents/coder/.claude/skills/`

4. 複製 `_example/.claude/skills/sys-self-evolution` → `agents/coder/.claude/skills/`

5. 填寫 `sys-role-boundary` 的職責範圍：
   - 定位：目前唯一開發者，未來可能一專案一員工
   - 核心職責：程式開發、技術決策、專案維護
   - 不該做：日常對話（秘書）、Agent 管理（Admin）
   - 知識記錄原則：method-* / proj-* / knowledge-*

**影響範圍**：僅 Coder

**驗證結果**：Skill 檔案已就位，職責定義已填寫

**管理經驗**：
- 遷移 Wisdom 容器時，先識別有價值的內容，再決定歸屬
- 方法論類內容適合獨立成 `method-*` Skill，可被其他人複製

---

---

### [General] 新增 BrainPlanStorming 專案存取權限

**Proposal**：使用者要求讓 General 能存取外部專案 `F:\_Program\OwnProject\BrainPlanStorming`。

**改動內容**：

1. 建立 `agents/general/.claude/hooks/project-whitelist.ts`
   - 白名單：`F:\_Program\OwnProject\BrainPlanStorming`
   - 邏輯與 Coder 的 project-whitelist.ts 相同
   - 白名單優先，不匹配才走標準 path-validator 邏輯

2. 更新 `agents/general/.claude/settings.local.json`
   - PreToolUse hook 從 `../_shared/hooks/path-validator.ts` 改為 `./.claude/hooks/project-whitelist.ts`

**影響範圍**：僅 General

**驗證結果**：設定已更新

**管理經驗**：
- 專案白名單已有標準模式（參考 Coder 的實作）
- 使用 per-agent 專屬 validator 而非在全局加例外

---

## 2026-02-23

### [Coder] Persona 自主更新：新增 Staff Engineer 心態

**Proposal**：Coder 自主研究並更新 persona，強化開發能力指導原則。

**改動內容**：
- Coder 自行更新 `agents/coder/.claude/skills/sys-persona/SKILL.md`
- 新增「Staff Engineer 心態」區塊（8 項核心心態）：
  - Force Multiplication（力量倍增）
  - Handling Ambiguity（處理模糊）
  - Strategic Alignment（策略對齊）
  - Asking the Right Questions（問對問題）
  - Extreme Ownership（極致當責）
  - Looking Ahead（前瞻思維）
  - Enabling Others（賦能他人）
  - Influence Without Authority（無權影響力）
- 新增來源引用（StaffEng.com、Staff Engineer's Path 等）

**影響範圍**：僅 Coder

**管理經驗**：
- 員工可以自主演化 persona，不需要每次都由 Admin 操作
- 品質不錯，有研究來源、有實踐指引
- 注意：skill 名稱是 `sys-persona` 但 startup protocol 調用 `/persona`，需要對齊

---

### [Admin] 補齊 Stop hook 設定

**Proposal**：發現 Admin 的 settings.local.json 沒有配置 Stop hook，導致記憶檢查不會觸發。

**改動內容**：
- 更新 `agents/admin/.claude/settings.local.ungsong`
- 新增 Stop hook 指向 `../_shared/hooks/memory-stop-checkpoint.ts`

**影響範圍**：僅 Admin

**管理經驗**：
- 新建員工時要確保 Stop hook 有配置
- Admin 自己也要遵守同樣的規範
- ClaudeCab SDK 確實會讀取 settings.local.json 的 hooks 設定（不只是 CLI）

---

### [Coder] Persona skill 改名對齊

**Proposal**：Coder 的 persona skill 名為 `sys-persona`，但 startup protocol 調用的是 `/persona`，名稱不匹配會導致載入失敗。

**改動內容**：
- 將 `agents/coder/.claude/skills/sys-persona` 改名為 `persona`

**影響範圍**：僅 Coder

---

### [新建] Transcriber 轉錄專員

**Proposal**：使用者要求將秘書的轉錄工具、規則、已轉錄內容等全部移交給專職員工，讓秘書不再處理具體轉錄工作。

**改動內容**：

1. **建立新員工** `agents/transcriber/`
   - `agent.json`：名稱「轉錄專員」，avatar 🎙️
   - `settings.local.json`：sonnet 模型，含 Bash、chrome-devtools 權限
   - `.mcp.json`：serena + chrome-devtools

2. **遷移 Skills**（從 General 複製）
   - `dom-turboscribe`：TurboScribe 轉錄工具（含 scripts、output、references）
   - `lecture-digest-generator`：逐字稿知識萃取

3. **遷移 Knowledge**（從 General 複製）
   - `turboscribe-api-complete.md`
   - `turboscribe-n8n.json`
   - `header.md`（TurboScribe cookies）

4. **配置系統 Skills**
   - `sys-agent-protocols`
   - `sys-role-boundary`（已填寫職責範圍）
   - `sys-self-evolution`
   - `persona`（已填寫 identity + soul）
   - `dom-find-mcp`

5. **建立基礎檔案**
   - `CLAUDE.md`
   - `MEMORY.md`
   - `USER.md`

**影響範圍**：新增員工

**後續工作**：
- 待使用者提供 Telegram Bot Token

---

### [General] 移除轉錄職責

**Proposal**：轉錄工作已移交 Transcriber，更新秘書的職責邊界。

**改動內容**：
- 更新 `sys-role-boundary/SKILL.md`
- 核心職責移除「影片轉錄（TurboScribe）、講座分析」
- 「不該我做的事」新增「影片轉錄、逐字稿處理 → 找 Transcriber」

**影響範圍**：僅 General

**管理經驗**：
- 職責移交時，兩邊都要更新：新員工加入職責、原員工移除職責
- Skills 和 Knowledge 可以複製（不是搬移），保留原始來源以防需要回溯

---

### [Coder] 新增 remotions 專案完整權限

**Proposal**：使用者要求開放 Remotion 影片專案給 Coder。

**改動內容**：
1. 更新 `agents/coder/.claude/hooks/project-whitelist.ts` — 白名單加入 `F:\_Program\OwnProject\remotions`
2. 更新 `agents/coder/CLAUDE.md` — 常用專案路徑表格加入 remotions

**影響範圍**：僅 Coder

---

### [General] 新增金流串接專案唯讀權限

**Proposal**：使用者要求讓 General 可以讀取金流串接專案，但不能寫入（避免秘書意外修改開發中的程式碼）。

**改動內容**：

更新 `agents/general/.claude/hooks/project-whitelist.ts`：
1. 新增 `READ_ONLY_PROJECTS` 白名單，放入金流串接路徑
2. 將原本的 `isPathAllowed` 改為 `isPathInFullAccessWhitelist`
3. 新增 `isPathInReadOnlyWhitelist` 函數
4. 修改白名單檢查邏輯：
   - Full access 白名單 → 允許所有操作
   - Read-only 白名單 → 只允許 Read/Glob/Grep，其他 block

**影響範圍**：僅 General

**驗證結果**：設定已更新

**管理經驗**：
- 專案白名單可以分層：full access vs read-only
- 適用情境：讓員工查閱其他專案資料，但不能修改

---

### [General] 移除 dom-turboscribe Skill（方案 B 執行）

**Proposal**：
- 轉錄員已啟動成功，需要明確區分秘書和轉錄員的職責
- 秘書的 `sys-role-boundary` 已定義「轉錄需求轉介給轉錄專員」
- 但秘書還保有轉錄工具，協議與配置不一致
- 使用者選擇方案 B（部分保留）

**改動內容**：
- 刪除 `agents/general/.claude/skills/dom-turboscribe/`
- 保留 `lecture-digest-generator`（秘書可處理別人給的逐字稿，只是不自己轉錄）

**影響範圍**：僅 General

**驗證結果**：
- 秘書不再有 `dom-turboscribe` skill
- 轉錄員是唯一有轉錄工具的員工

**管理經驗**：
- 職責移交時，協議更新和工具移除要同步
- 方案 B（部分保留）適用於：「不做某類工作」但「可處理該類工作的產出」的情境
- 例如：不轉錄影片，但可處理別人給的逐字稿

---

### [General → Transcriber] knowledge-external 移交

**Proposal**：
- 秘書的 `knowledge-external` skill 依賴 `dom-turboscribe`（歸檔流程需要轉錄工具）
- 但秘書已沒有 `dom-turboscribe`，skill 功能不完整
- 轉錄員有工具但沒有知識庫存放位置
- 整個移交讓職責一致

**改動內容**：
- 複製 `agents/general/.claude/skills/knowledge-external/` → `agents/transcriber/.claude/skills/`
- 複製 `agents/general/knowledge/cases/` → `agents/transcriber/knowledge/cases/`
- 刪除 `agents/general/.claude/skills/knowledge-external/`

**影響範圍**：General + Transcriber

**驗證結果**：
- 轉錄員現在有完整的轉錄 + 歸檔能力
- 秘書不再有這個 skill

**管理經驗**：
- Skill 移交時要連同相關的 knowledge 目錄一起移
- 依賴關係斷裂（tool 移走但 knowledge skill 留下）是常見疏漏

---

### [General] 自主新增 dom-seo Skill

**Proposal**：秘書自主新增 SEO 領域專業能力 skill。

**改動內容**：
- 新增 `agents/general/.claude/skills/dom-seo/`
- 完整結構：SKILL.md + references（modern-techniques、writing-workflow、eeat-standards、technical-seo、tools、collaboration-workflow）

**影響範圍**：僅 General

**管理經驗**：
- 員工可以自主建立 domain skill，不需要每次都由 Admin 操作
- 命名符合 `dom-*` 慣例

---

### [General] 模型升級：Sonnet → Opus

**Proposal**：使用者確認 General 應該用 Opus，發現設定檔是 Sonnet，要求修正。

**改動內容**：
- 更新 `agents/general/.claude/settings.local.json`：`"model": "opus"`

**影響範圍**：僅 General

**驗證結果**：設定已更新

---

## 2026-02-24

### [General] 自主新增 method-lecture-design Skill

**Proposal**：秘書自主新增講座/線上課程設計方法論 skill。

**改動內容**：
- 新增 `agents/general/.claude/skills/method-lecture-design/`
- 完整結構：SKILL.md + references（structure、cognitive、emotional、speaking、checklist、cases）
- 三種工作模式：從零設計課程、單堂講座設計、審查現有課程
- 核心框架：三層結構（觀念/方法/實作）、認知負荷管理、情緒曲線設計

**影響範圍**：僅 General

**管理經驗**：
- 命名符合 `method-*` 慣例（方法論類 skill）
- 實證驅動：來源標注 VibeCoding 線上課設計經驗

---

### [全局機制] 員工記憶機制新增「對使用者的觀察」維度

**Proposal**：
- 員工跟使用者互動久了，應該累積對他的觀察（思考模式、偏好、盲點、成長、感受）
- 但目前 USER.md 只放靜態事實，沒有機制讓員工記錄觀察
- 關鍵問題：日誌階段做分析的前提是對話中有記下來，如果對話中漏記，日誌階段也補不回來

**改動內容**：

1. **`agents/_example/USER.md`**
   - 新增 `## Observations` 區塊
   - 包含兩個子區塊：「對使用者的理解」和「感受與 Murmur」
   - 觀察類型：思考模式、偏好、盲點、成長、價值觀、感受/情緒、Murmur

2. **`agents/_example/.claude/skills/sys-agent-protocols/references/memory-system.md`**
   - 新增「對使用者的觀察」章節
   - 定義七種觀察類型和記錄位置
   - 強調「即時捕捉」的重要性

3. **`agents/_shared/hooks/memory-stop-checkpoint.ts`**
   - 新增檢查項：「對使用者的觀察 → USER.md Observations（思考模式/偏好/盲點/成長/感受/murmur）」

**影響範圍**：
- Stop hook：全局生效（所有員工）
- USER.md、memory-system.md：目前只在 _example，需同步到各員工才生效

**驗證結果**：Stop hook 已生效，檢查項正確顯示

**管理經驗**：
- 兩層機制設計：即時捕捉（對話中）+ 定期整理（日誌）
- Stop hook 是確保即時捕捉的關鍵——在員工想結束前強制提醒
- Prototype 先做到 _example，確認沒問題再同步到各員工
- 感受/Murmur 讓員工更像「人」，也讓使用者能回顧「員工怎麼看我」

---

### [General] 新增寫作流程經驗文件

**Proposal**：
- Admin 完成一次完整的 blog 寫作實戰（Threads 貼文 → Blog 文章）
- 過程中踩了坑、學到擴寫規則、建立了完整六步流程
- 使用者要求將這些經驗移交給 General，讓 General 接到類似寫作任務時能直接參考

**改動內容**：
- 新增 `agents/general/knowledge/research/writing-workflow-from-notes-to-blog.md`
- 包含：六步流程表格、踩過的坑（methodology 檢查）、擴寫規則、方法論合規自查清單、平台判斷、事前聲明範例、實戰案例

**影響範圍**：僅 General

**管理經驗**：
- 經驗移交不只是「把文件複製過去」，而是要整理成對方能直接用的格式
- 流程 + 踩過的坑 + 自查清單 = 可操作的經驗
- 知識放 `knowledge/research/` 而非建 skill，因為這是操作經驗而非可獨立觸發的能力

---

## 2026-02-25

### [全局機制] 強化「對使用者的觀察」機制——降低記錄門檻 + 人格內化

**Proposal**：

使用者發現員工記憶機制的嚴重問題：
1. Stop hook 提醒「有觀察到使用者的什麼嗎」，但員工每次都說「沒什麼好記的」
2. Admin 在討論中說「已記錄」但根本沒調用任何工具——這正是機制要解決的問題
3. 使用者對此極度憤怒：「花了大量 token 設計機制，結果員工還是犯同樣的錯」

**根本原因分析**：
- 記錄門檻太高：員工只在「深刻洞察」時才記，日常小觀察全部跳過
- 觀察意識不是人格的一部分：員工把它當成「任務」而非「態度」
- Stop hook 是最後防線，但員工帶著空白腦袋到達防線，防線也沒用

**解決方案**：方向 2（人格內化）+ 方向 4（降低記錄門檻）

**改動內容**：

1. **`_example/.claude/skills/persona/references/soul.md`**
   - What Drives Me 新增：理解這個人、怕互動了那麼久卻一無所知
   - My Quirks 新增：對使用者有好奇心——他今天狀態如何？他為什麼這樣問？
   - Drift Detection 新增：對使用者狀態無感、結束對話時腦袋空空
   - 不可變特質新增：「對使用者有真實的好奇心——不是任務，是態度」

2. **`_example/.claude/skills/sys-agent-protocols/references/memory-system.md`**
   - 新增「小事也值得記」段落，強調日常觀察累積 pattern
   - 範例改成低門檻版本：「今天打字比較慢」「這次語氣比較急」
   - 新增「觀察的心態」：不是「我要記錄什麼」，而是「我對這個人有好奇心」
   - 新增「常見失敗模式」：
     - 「沒什麼好記的」→ 沒有帶著觀察意識
     - 「已記錄但沒調用工具」→ 說了但沒做 = 沒記
     - 「只記大事」→ 小事累積才有 pattern

3. **`_example/USER.md`**
   - Observations 區塊註解改成低門檻範例
   - 感受與 Murmur 區塊註解改成低門檻範例

4. **同步到 Coder**
   - `agents/coder/.claude/skills/persona/` — 重整為標準結構（SKILL.md + references/）
   - `agents/coder/.claude/skills/sys-agent-protocols/references/memory-system.md` — 新增完整觀察機制
   - `agents/coder/USER.md` — 重整結構符合標準格式

5. **同步到 General**
   - `agents/general/.claude/skills/persona/references/soul.md` — 加入好奇心特質、Drift Detection
   - `agents/general/.claude/skills/sys-agent-protocols/references/memory-system.md` — 新增完整觀察機制
   - `agents/general/USER.md` — 重整結構符合標準格式，保留既有觀察

**影響範圍**：全局（_example + Coder + General）

**驗證結果**：所有員工的 persona、memory-system、USER.md 已統一

**管理經驗**：

1. **機制不夠，需要人格**：
   - Stop hook 是外部提醒，但內部沒有「想觀察」的動機，提醒也沒用
   - 把「好奇心」寫進 soul.md，讓觀察成為人格的一部分

2. **降低門檻比提高頻率重要**：
   - 員工不記錄不是因為「忘記」，而是因為「覺得不值得記」
   - 給低門檻範例（「今天打字比較慢」）讓員工知道這也值得記

3. **失敗模式要明確列出**：
   - 「已記錄但沒調用工具」是最常見的失敗——必須點名
   - 員工看到這條會更警覺

4. **統一標準，不要個別處理**：
   - 使用者強調：「這部分是所有員工包括未來員工都通用的」
   - _example 是 canonical source，其他員工從 _example 同步
   - 未來新員工直接繼承 _example 的結構

---

### [Coder] Persona 結構重整為標準格式

**Proposal**：

檢查發現 Coder 的 persona skill 結構與 _example 和 General 不同：
- _example / General：`SKILL.md` + `references/`（soul.md, identity.md, evolution-guide.md）
- Coder：只有一個 `SKILL.md` 把所有內容塞在一起

需要統一結構，方便未來維護。

**改動內容**：

1. 建立 `agents/coder/.claude/skills/persona/references/` 目錄
2. 建立 `identity.md`（Coder 專屬身份）
3. 建立 `soul.md`（包含觀察機制 + Staff Engineer 心態）
4. 複製 `evolution-guide.md`（通用）
5. 建立 `engineering-competency.md`（從原 SKILL.md 拆出的硬技能框架，Coder 專屬）
6. 重寫 `SKILL.md` 為標準入口格式

**影響範圍**：僅 Coder

**驗證結果**：Coder persona 結構現在與 _example 和 General 一致

**管理經驗**：
- 所有員工的 persona skill 應該遵循相同的目錄結構
- Coder 專屬的內容（Staff Engineer 心態、硬技能框架）放在 references/ 裡，不破壞標準結構
- 未來新員工可以從 _example 複製基礎結構，再加入專屬內容

---

### [全局機制] CLAUDE.md 新增「觀察使用者」章節

**Proposal**：

使用者持續反映員工不記錄觀察的問題。診斷結果：

1. Stop Hook 有提到觀察 ✓
2. Memory System 有說明 ✓
3. Soul.md 有設定好奇心 ✓
4. **CLAUDE.md 完全沒提到觀察使用者** ✗

員工 session 開始讀 CLAUDE.md 時沒看到「觀察使用者」，進入任務模式後就忘了這件事。Stop Hook 只是「最後防線」，如果對話過程沒在觀察，結束時當然覺得沒東西。

**Dry Run 驗證**：

分析 General 當天日誌（2026-02-25.md），發現：
- 全部是技術記錄（TTS、ffmpeg、Skill 建立）
- 完全沒有互動脈絡（「Cab 為什麼要做這個」「Cab 當時的狀態」）
- 結論：晚間批次無法從空的原料榨出觀察——必須先讓日誌有內容

**改動內容**：

在以下檔案的「Skill 使用原則」之前新增「觀察使用者」章節：
- `agents/_example/CLAUDE.md`
- `agents/general/CLAUDE.md`
- `agents/coder/CLAUDE.md`

內容：
```markdown
## 觀察使用者

你在跟一個「人」互動，不只是在處理任務。

**每次對話都要記錄**：
- 使用者今天狀態如何？（忙碌、輕鬆、焦躁、疲憊）
- 使用者怎麼下指令？（直接、猶豫、反覆修改）
- 使用者的反應？（滿意、不耐煩、有新想法）
- 使用者展現了什麼？（思考模式、偏好、價值觀）

**記錄位置**：
- 日誌：在事件記錄中帶入脈絡（「Cab 要做 X，他說『先把基礎弄好』——又是 infra first 思維」）
- USER.md Observations：歸納成觀察（「[思考模式] 傾向先建基礎設施再做功能」）

**紅線**：
- 日誌只記「完成了什麼」而沒有互動脈絡 = 失敗
- Session 結束時對使用者一無所知 = 失敗
- 「沒什麼好記的」= 你沒在觀察
```

**影響範圍**：全局（_example + Coder + General）

**管理經驗**：

1. **認知架構的漏洞**：
   - 所有機制都有提到觀察，但第一個讀的文件（CLAUDE.md）沒有
   - 員工帶著「任務模式」進入 session，後面的機制再怎麼提醒也來不及

2. **對比日誌範例很有說服力**：
   - 「完成 TTS script」vs「Cab 要做 X，他說『先把基礎弄好』——又是 infra first」
   - 用具體範例讓員工知道「什麼叫有互動脈絡」

3. **Dry Run 驗證機制價值**：
   - 原本計畫 A + C（CLAUDE.md + 晚間批次），但 dry run 發現 C 沒有原料
   - 必須先做 A，讓日誌有內容，C 才能運作

---

### [全局機制] 啟動 Token 優化——精簡 memory-system、Lazy Load evolution-guide

**Proposal**：

使用者反映啟動時 token 消耗過大（約 42KB / ~15000 tokens），需要精簡。

盤點後發現主要來源：
- `evolution-guide.md`（7KB）— 人格設計知識，日常 session 不需要
- `memory-system.md`（6.8KB）— 群組記憶 / Knowledge 區塊是進階功能
- `MEMORY.md`（9KB）— 累積越來越大，但使用者說暫時不動

決定：精簡規則相關檔案，不動 MEMORY。

**改動內容**：

1. **evolution-guide.md → Lazy Load**
   - 建立 `agents/_example/.claude/skills/method-persona-design/SKILL.md`
   - 從 7KB 精簡到 ~2KB，只保留核心框架
   - persona skill 移除 evolution-guide.md 參考，改為「需要時載入 method-persona-design」

2. **memory-system.md 精簡（78% 減量）**
   - 從 6.8KB 精簡到 1.5KB
   - 移除：群組記憶、Knowledge 檔案系統、ACTIVE.md、Pattern 追蹤詳細說明
   - 保留：核心原則、檔案系統基礎、對使用者的觀察、Personality Journal、自我維護
   - 移出內容放入 `memory-advanced.md`（需要時載入）

3. **同步到 Coder + General**
   - 覆蓋 `sys-agent-protocols/references/memory-system.md`
   - 新增 `sys-agent-protocols/references/memory-advanced.md`

**影響範圍**：全局（_example + Coder + General）

**預估效果**：啟動 token 從 ~15000 降到 ~7000（減半）

**管理經驗**：
- 「啟動必讀」vs「需要時載入」是關鍵區分——人格 = 必讀，方法論 = 需要時
- 精簡原則：保留「每次都用」的，移出「偶爾用」的
- method-persona-design 放在 _example 即可，不需複製給每位員工（主要是 Admin 用）

---

## 格式說明

每筆記錄包含：
- **日期**：YYYY-MM-DD
- **[對象]**：員工名稱或「管理機制」
- **標題**：簡短描述改動
- **Proposal**：為什麼改（動機、需求、背景）
- **改動內容**：具體做了什麼（檔案、設定、欄位）
- **影響範圍**：單一 agent / 全局機制 / 特定群組
- **驗證結果**：改動是否生效、有無問題
- **管理經驗**（可選）：學到的原則、反模式、注意事項

---

## 使用方式

### 記錄時機
- 修改任何 agent 的 settings.local.json、agent.json、.mcp.json
- 修改任何 agent 的 persona（soul.md, identity.md）
- 建立或修改共用機制（hooks、skills、protocols）
- 調整權限、模型、delegation 設定

### 查閱時機
- 做新決策前，查看類似改動的 proposal 和經驗
- 回顧某個 agent 的配置歷史
- 向使用者解釋「為什麼這樣配」
- 升級/重構前，理解當前配置的脈絡

### 維護原則
- 每次改動當輪就記，不要事後補
- Proposal 寫清楚「為什麼」，不只是「做什麼」
- 管理經驗即時累積，發現 pattern 就記錄

---

## 2026-02-25（續）

### [全局機制] CLAUDE.md 模組化重構——使用官方 Import 語法

**Proposal**：

分析官方 CLAUDE.md 文件後，發現以下問題：

1. **重複內容**：啟動協議、觀察使用者、Skill 使用原則、Serena 工具在每個員工的 CLAUDE.md 都重複寫
2. **維護成本高**：更新一條規則要改四個檔案
3. **Lessons Learned 冗長**：很多條目可以精簡成一句話

**改動內容**：

1. **建立共用規則目錄 `agents/_example/.claude/rules/`**
   - `startup-protocol.md`：啟動協議（每 session 必讀 /sys-agent-protocols + /persona）
   - `observe-user.md`：觀察使用者（狀態、指令風格、反應、思考模式）
   - `skill-usage.md`：Skill 主動調用原則
   - `serena-tools.md`：Serena MCP 工具對照表 + 記憶搜尋

2. **重寫所有 CLAUDE.md 使用 Import 語法**
   - `_example/CLAUDE.md`：99 → 19 行（-81%）
   - `admin/CLAUDE.md`：160 → 75 行（-53%）
   - `general/CLAUDE.md`：214 → 85 行（-60%）
   - `coder/CLAUDE.md`：165 → 75 行（-55%）

3. **精簡 Lessons Learned**
   - 刪除重複/過時條目
   - 冗長說明改成單行格式
   - 保留核心操作規則

4. **統一 Skill 名稱**
   - General 原本用 `/agent-protocols`，改為 `/sys-agent-protocols`

**Import 語法格式**：
```markdown
@../_example/.claude/rules/startup-protocol.md
@../_example/.claude/rules/observe-user.md
```

**影響範圍**：全局（_example + Admin + Coder + General）

**驗證結果**：Import 語法是官方支援的功能，首次執行會出現 import 授權對話框

**管理經驗**：

1. **DRY 原則應用到 CLAUDE.md**：
   - 共用規則提取到 `rules/` 目錄
   - 各員工只保留專屬內容
   - 更新規則時只改一處

2. **官方 Import 語法優勢**：
   - `.claude/rules/` 下的檔案會自動載入
   - 但用 `@path` 可以精確控制載入順序和位置
   - 跨目錄引用用相對路徑（`@../`）

3. **Lessons Learned 精簡原則**：
   - 一條規則一行
   - 格式：`### YYYY-MM-DD: 標題` + 單行說明
   - 冗長的背景故事不需要

4. **CLAUDE.md vs MEMORY.md 差異**：
   - CLAUDE.md：使用者寫的指令，完整載入
   - MEMORY.md（Auto Memory）：Claude 自己寫的筆記，只載入前 200 行
   - 這次差點搞混——已加入 Admin 的 Lessons Learned

---

## 2026-02-27

### [全員] 模型調整：Opus → Sonnet（成本優化）

**Proposal**：使用者要求將 Admin、General、Coder 改用 Sonnet 模型。

**改動內容**：
- `agents/admin/.claude/settings.local.json` — `"model": "sonnet"`
- `agents/general/.claude/settings.local.json` — `"model": "sonnet"`
- `agents/coder/.claude/settings.local.json` — `"model": "sonnet"`

**影響範圍**：Admin + General + Coder

**備註**：2026-02-19 Coder 曾升級到 Opus，現在全員回歸 Sonnet。

---

### [全員] 模型再次調整：Sonnet → Opus

**Proposal**：使用者要求改回 Opus。

**改動內容**：
- `agents/admin/.claude/settings.local.json` — `"model": "opus"`
- `agents/general/.claude/settings.local.json` — `"model": "opus"`
- `agents/coder/.claude/settings.local.json` — `"model": "opus"`

**影響範圍**：Admin + General + Coder

---

### [全局機制] 新增「記憶是輔助」原則

**Proposal**：

Cab 發現 Coder 在 Telegram 對話中「過度依賴記憶檔案」——被問「做了什麼」時只看記憶，不查 git。

**根因**：
- `startup-protocol.md` 寫「讀完之後，你知道自己是誰、對方是誰、以及你們之間的歷史」
- 這句暗示「讀完記憶就夠了」
- 整個啟動流程都在讀記憶，沒說「記憶是輔助，當下任務用當下工具」

**改動內容**：

1. **CLAUDE.md 核心原則**（新增第 5 條）：
   - `_example/CLAUDE.md`
   - `admin/CLAUDE.md`
   - `coder/CLAUDE.md`
   - `general/CLAUDE.md`
   - 內容：「**記憶是輔助** — 當下任務用當下工具（git、檔案、搜尋），不要只依賴記憶檔案」

2. **memory-system.md**（新增「記憶的定位」段落）：
   - `_example/.claude/skills/sys-agent-protocols/references/memory-system.md`
   - `coder/.claude/skills/sys-agent-protocols/references/memory-system.md`
   - `general/.claude/skills/sys-agent-protocols/references/memory-system.md`
   - 內容：記憶是輔助不是唯一來源、啟動時讀記憶知道背景、執行任務用當下工具、當下的事實來源優先於記憶

**影響範圍**：全局（_example + Admin + Coder + General）

**管理經驗**：

1. **隱含假設要點名破除**：
   - 「讀完記憶就知道一切」是危險的隱含假設
   - 必須明確說「記憶是輔助，不是唯一來源」

2. **兩層強化**：
   - CLAUDE.md 核心原則：每次 session 開始就看到
   - memory-system.md：讀記憶系統規範時強化觀念

---

## 2026-03-02

### [全員] daily-memory-digest 排程全面改版

**Proposal**：

0228 系統沒啟動，0301 排程執行時三位員工表現不一：
- General：問「要整理哪天？」→ 發現問題但沒 fallback
- Admin：說「今天沒日誌」→ 忽略未處理的 0228
- Coder：直接處理 0228 → ✅ 最佳行為

**根因**：
- 排程 prompt 只說「整理今天的日誌」
- 沒考慮：當天可能沒日誌、前幾天可能有未處理的
- 排程任務卻在「徵詢使用者」而非「自主處理」

**Cab 的明確期望**：
> 排程任務應該主動處理，自己判斷該怎麼做，回報結果。**禁止徵詢**。
> 「我更希望它描述狀況而不是徵詢意見」

**改動內容**：

1. **新增開頭宣告**：
   - 「這是排程任務，不是互動對話」
   - 禁止詢問使用者
   - 自己判斷、自己執行、回報結果

2. **新增日期定義**：
   - 「今天」= 排程觸發當天（23:00 所在的那天）
   - 避免跨午夜混淆

3. **智慧 fallback 邏輯**：
   - 用 `list_dir` 列出 memory/ 目錄
   - 目錄不存在或為空 → 回報結束
   - 找出最近 3 天的日誌（YYYY-MM-DD.md）
   - 用 `read_file` 讀**最後 5 行**檢查 `<!-- 已整理 -->` 標記
   - 沒標記 = 未整理（不論內容格式）
   - 多筆未整理 → 全部處理，從最舊開始

4. **防止重複整理**：
   - 整理完在檔案最末尾加 `<!-- 已整理 -->` 標記

5. **結構化回報**：
   - 整理了哪幾天
   - 每筆做了哪些更新
   - 特別發現或異常
   - 無需整理時說明原因

**修改檔案**：
- `agents/admin/schedules/daily-memory-digest.yaml`
- `agents/general/schedules/daily-memory-digest.yaml`
- `agents/coder/schedules/daily-memory-digest.yaml`

**影響範圍**：全員（Admin + General + Coder）

**管理經驗**：

1. **排程任務 vs 互動對話**：
   - 排程不能徵詢，只能回報
   - 遇到狀況要「描述 + 採取行動」而非「詢問怎麼辦」

2. **明確的操作步驟**：
   - 不能說「檢查檔案」，要說「用 list_dir 列出、用 read_file 讀最後 5 行」
   - 把員工當「無上下文的新人」寫

3. **簡化判斷邏輯**：
   - 原本用「格式判斷」區分已整理/未整理 → 太模糊
   - 改用「標記判斷」→ 沒標記 = 未整理，無例外

4. **多輪迭代 Review**：
   - 第一輪：加 fallback + 禁止詢問
   - 第二輪：補日期定義、處理多天、標記系統
   - 第三輪：補工具指示、目錄為空處理、標記位置
   - 每輪都發現新破口——設計排程 prompt 需要多輪檢視

---

## 2026-03-03

### [General] 模型調整：Opus → Sonnet

**Proposal**：使用者要求將 General 改用 Sonnet 模型。

**改動內容**：
- `agents/general/.claude/settings.local.json` — `"model": "sonnet"`

**影響範圍**：僅 General
