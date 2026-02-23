# Agent 變更日誌

**用途**：記錄所有對員工配置和管理機制的改動，追溯決策脈絡，累積管理經驗。

**原則**：
- 每次改動必須記錄 proposal（為什麼改）
- 記錄影響範圍（單一 agent / 全局機制）
- 保留決策依據，方便未來升級時參考

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
