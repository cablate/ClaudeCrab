## Context

ClaudeCab 的 Agent 目前只在工作過程中被動學習——遇到問題才找解法，完成後記在 Lessons Learned 或 memory。缺乏系統性的反思與主動學習機制。

現有排程基礎：
- `agents/admin/schedules/daily-memory-digest.yaml`（23:00，記憶整理）
- `agents/admin/schedules/weekly-collaboration-review.yaml`（週日 21:00，協作審查）

現有 Agent 目錄結構：`CLAUDE.md`, `MEMORY.md`, `USER.md`, `memory/`, `knowledge/`, `schedules/`

使用者期待 Agent 能：定期反思 → 發現缺口 → 主動上網搜尋學習 → 內化為知識 → 持續提升產出品質。

## Goals / Non-Goals

**Goals:**

- Agent 每日自動反思工作狀況，對照使用者期待辨識能力缺口
- Agent 主動上網搜尋高品質素材填補缺口，內化為 knowledge
- 主管 Agent 每週審查各 Agent 成長狀況，產出週報
- 建立三層權限模型，讓知識累積自主但行為變更需審批
- SOP 變更走 提案 → 主管審核 → 使用者批准 流程

**Non-Goals:**

- 不實作 Agent 之間的知識共享機制（未來可擴充）
- 不修改引擎層程式碼——整個機制透過排程 YAML + CLAUDE.md 指令驅動
- 不實作自動化的品質評分系統（由主管 Agent 主觀評估）
- 不建立 Web UI 供使用者操作（透過 Telegram 週報互動）

## Decisions

### Decision: 排程時間安排

Daily Reflection（含 Memory Cleanup）03:00 → Admin Growth Review 04:00 → Weekly Trend 週一 05:00。原本獨立的 daily-memory-digest（23:00）已合併到 daily-reflection Phase 0。

**理由**：凌晨執行避免跟使用者白天互動衝突，且確保員工反思（03:00）完成後 Admin 才做審查（04:00），形成明確的先後鏈。Memory Cleanup 合併後減少 3 個排程執行，消除重複讀取 memory/，且整理好的日誌直接餵給反思流程。

**替代方案**：保持 memory-digest 獨立在 23:00。否決原因：兩個排程重複讀取 memory/，且 23:00 整理的乾淨日誌在 03:00 反思時沒有被利用。合併後流程更順暢。

### Decision: 三層權限模型而非二元控制

採用三層（自由/Append only/審批）而非簡單的二元（可改/不可改）。

| 層級 | 範圍 | 權限 |
|------|------|------|
| 🟢 Layer 1 | memory/, knowledge/, MEMORY.md, USER.md | 自由讀寫 |
| 🟡 Layer 2 | CLAUDE.md Lessons Learned, Skill references/ | Append only |
| 🔴 Layer 3 | 核心原則, soul.md, behavior.md, schedules/, 新 Skill | 提案 → 主管 → 使用者 |

**理由**：二元控制太粗糙——Agent 連記錄操作經驗都要審批的話會卡住日常學習；但完全自由又有改壞核心人格的風險。三層在自主性和安全性之間取得平衡。

**替代方案**：全部自由 + 事後 review。否決原因：不可逆的人格漂移發生後才發現為時已晚。

### Decision: 使用者期待存放於 CLAUDE.md 高權重區段

Agent 反思時對照的「使用者期待」直接寫在各 Agent 的 CLAUDE.md 最上層區段。

**理由**：CLAUDE.md 是每次 session 都會載入的檔案，具備最高權重。使用者期待不應該埋在 knowledge 或 memory 裡被忽略。

**替代方案**：獨立 `expectations.md` 檔案。否決原因：新增檔案需要修改啟動協議確保載入，而 CLAUDE.md 天然就是必讀的。

### Decision: evolution/ 獨立目錄而非混入 memory/

進化紀錄存放在 `agents/{id}/evolution/` 獨立目錄。

結構：
```
evolution/
├── weekly/          # 週反思彙整
└── proposals/       # Layer 3 變更提案（待審核）
```

**理由**：主管需要快速掃描所有 Agent 的進化紀錄。獨立目錄比從 memory/ 裡過濾方便。檔案按週彙整，不需要每天一個檔——只有值得記錄的洞察才寫。

**替代方案**：在 memory/ 裡用 tag 標記。否決原因：主管 Agent 需要跨 Agent 讀取，tag 過濾比目錄直接讀取慢且不穩定。

### Decision: 反思是合成者不是收集者

Daily Reflection 不重複收集工作中已學的內容，而是：
1. 回顧已記錄的學習內容（不重做）
2. 跨記錄比對找 meta-pattern
3. 對照使用者期待辨識未覆蓋缺口
4. 針對缺口主動上網搜尋學習
5. 內化新知識到 knowledge/

**理由**：Agent 在工作中已經會學習和記錄。如果反思再做一次相同的事，是浪費。反思的獨特價值在於「退後一步看全局」和「主動補缺」。

### Decision: 每日完整品質審查而非僅週報

Admin 每天 04:00（Opus 模型）跑一次跟週報同品質的員工審查，而非只在週末彙總。

**理由**：員工每天都會跑 daily-reflection 並可能產出 Layer 3 提案。如果使用者要等一週才能看到狀況和審核提案，反應太慢。每日審查讓使用者可以：(1) 每天確認每位員工的狀況，(2) 及時審核 Layer 3 提案而非積壓一週。

**替代方案**：每日一行摘要 + 週報完整審查。否決原因：使用者明確要求每天都要同品質的審查，一行摘要不夠。

**影響**：
- 新增 `agents/admin/schedules/daily-growth-review.yaml`（04:00 觸發，Opus 模型）
- 週報（weekly-growth-review）轉型為「週趨勢分析」，每週一 05:00（Opus 模型）
- 提案超時升級從「兩週」改為「連續 3 天」
- 日報儲存在 `knowledge/growth-reviews/daily/`，週報儲存在 `knowledge/growth-reviews/weekly/`
- 日報內建 copy-paste 提案審批指令塊，讓使用者可以直接複製貼到 Admin 對話執行

### Decision: 週報合併現有 weekly-collaboration-review

新的 `weekly-growth-review.yaml` 取代現有的 `weekly-collaboration-review.yaml`，擴充其職責為：協作健康度 + 成長審查 + SOP 提案審核。

**理由**：兩個排程在同一時段做類似的事（審查 Agent 狀況）會重複且混亂。合併後主管只需一次審查，使用者只收一份週報。

**替代方案**：保持兩個獨立排程。否決原因：使用者每週收兩份報告，且審查範圍重疊。

### Decision: 模型分層——Opus vs Sonnet

Admin 審查類排程（daily-growth-review、weekly-growth-review）使用 Opus 模型；員工反思類排程（daily-reflection）使用 Sonnet 模型。

**理由**：審查需要跨 agent 綜合判斷、辨別敷衍 vs 真進步、撰寫使用者可讀報告——需要高判斷力。員工反思是單 agent 照 protocol 執行，結構化程度高，Sonnet 足以勝任。

**替代方案**：全用 Opus。否決原因：成本過高且員工反思不需要那麼強的推理能力。

### Decision: 報告字數不設上限

日報和週報均不設字數上限。

**理由**：audit 發現 1500/2000/3000 字元限制導致報告被壓縮成摘要，使用者看不到員工具體搜尋了什麼、學了什麼。寧可完整也不要壓縮。

### Decision: 使用者回饋信號結構化提取

員工 daily reflection Phase 2 新增使用者回饋信號提取（修正、批評、表揚、重寫），結構化記錄於反思輸出。

**理由**：audit 發現員工只對照 CLAUDE.md 期待，但忽略使用者在對話中的即時回饋（例如「不要這樣寫」「這很好」）。回饋信號是最直接的品質校準來源。

### Decision: Copy-paste 提案審批機制

日報中每個待審提案附帶可複製貼上的指令塊，使用者貼到 Admin 對話即可批准/駁回並觸發執行。

**理由**：audit 發現原設計缺乏使用者批准 → Admin 執行的回流機制。內建指令塊是最低摩擦的解法。

### Decision: 學習方向——全球理論 + 使用者素材庫

員工搜尋學習方向從「使用者熟悉的創作者」改為「全球成功案例與理論 + 使用者個人素材庫」。

**理由**：具體創作者列表會過時且限制學習範圍。讓員工廣泛學習全球最佳實踐，同時從使用者自己的歷史產出中學習風格偏好，更能產出「像使用者自己寫的」內容。

## Risks / Trade-offs

- **[上網搜尋品質不穩定]** → Agent 搜尋到的素材品質可能參差不齊。Mitigation：在 knowledge/ 記錄時標註來源，週報中由主管抽查。
- **[反思流於形式]** → Agent 可能每天產出「沒什麼缺口」的空洞報告。Mitigation：使用者期待區段提供明確的品質標準，讓 Agent 有具體對照依據。
- **[Layer 3 提案積壓]** → 如果使用者不看週報，提案會一直等待。Mitigation：提案有時效標記，超過兩週未處理的提案在週報中升級為「需要關注」。
- **[排程執行失敗]** → 03:00 的 reflection 如果因 session 問題失敗，23:00 的 digest 不受影響（兩者獨立）。失敗時記錄在排程日誌中。

## Open Questions

- 使用者期待區段的具體格式？（建議：條列式，每條帶可衡量的標準）
- 主管 Agent 是否需要 PathValidator 的特殊權限來讀取其他 Agent 的 evolution/ 目錄？（目前 admin 可能已有跨 Agent 讀取權限）
