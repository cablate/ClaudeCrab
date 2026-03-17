---
name: agentskill-expertise
description: Agent Skill 的完整認知體系與設計知識庫。載入後具備 Agent Skill 的全維度理解——底層機制、設計哲學、架構模式、常見誤區。使用時機：設計新 Skill 時作為設計依據；調整現有 Skill 時判斷改動方向是否正確；Review Skill 設計品質時作為評估標準；討論 Skill 相關議題時確保認知準確；需要判斷某個做法應該用 Skill 還是其他方式實現時。主動更新時機：發現新的設計模式或反模式時更新 references/design-patterns.md；技術機制有新發現時更新第三章；實際設計 Skill 過程中產生新洞察時更新對應章節。
---

# AgentSkill Expertise - Agent Skill 知識體系

## 概述

這是關於 Agent Skill 的完整知識體系——不是操作手冊（那是官方文件的工作），而是理解 Skill **為什麼這樣設計**、**怎樣才算設計得好**、**常見的坑在哪裡**的認知基底。

任何涉及 Skill 的工作（新建、調整、Review、拆分、合併）都應該以此為判斷依據。

---

## 一、本質理解：Skill 到底是什麼

### 三層理解深度

| 層級 | 理解 | 能做到什麼 | 常見問題 |
|------|------|-----------|---------|
| 表面 | 「Skill 是讓 AI 記住指令的方式」 | 能寫出格式正確的 Skill | 把 Skill 當進階版 System Prompt |
| 機制 | 「Skill 是 Progressive Disclosure 的實現」 | 能理解觸發機制和載入流程 | 技術正確但設計糟糕 |
| **本質** | **「Skill 是知識外化為 AI 可主動發現、按需載入的格式」** | **能設計出真正有效的 Skill** | — |

### 關鍵認知

- **不是規則集合**：一個價值觀涵蓋一大片規則。給原則，不是給規則。
- **不是 Prompt 包裝**：Skill 有 metadata 預載機制，對話開始前就在 context 裡，本質不同於 Prompt。
- **不是工具功能**：是知識管理的標準化格式。寫一次，跨平台通用，累積的知識只會越來越有價值。
- **官方定位**：「Domain Expertise（領域知識）」——不是指令、不是流程、是知識。

---

## 二、底層機制

### Progressive Disclosure（漸進式揭露）

```
Level 1：metadata（name + description, ~100 tokens）
         → Session 啟動就在，永遠在 context 裡
         → AI 判斷是否載入的唯一依據

Level 2：SKILL.md 完整內容（<5k tokens）
         → AI 判斷相關時才載入

Level 3+：references/, scripts/, assets/
         → 需要更細節時才讀
```

### 對話開始前的狀態差異

| | 傳統做法 | Skill 架構 |
|--|---------|-----------|
| 對話開始時 | AI 腦袋是空的 | AI 已載入所有 Skill 的 metadata |
| 你需要做的 | 每次複製貼上 / 寫「記得讀 X」 / 全塞進 CLAUDE.md | 什麼都不用做 |
| 原則 | 不說 = 不知道 | 對話開始前，AI 就已經準備好了 |

**這是根本差異**——不是對話中做什麼不同，而是對話開始前就已經不同了。

### Description 機制

- AI 用**語義匹配**判斷是否載入，不是關鍵字比對
- Description 是 Level 1 唯一被讀的內容
- 系統對 `<available_skills>` 區塊強制 **15,000 字元**預算（所有 Skill 共用）

**寫法原則**：
- ❌ 功能導向：「這是一個寫作 Skill」→ 太模糊，不知何時觸發
- ✅ 情境導向：「當需要結論先行、可掃描、專業語氣的技術寫作時觸發」→ 觸發時機明確
- ✅ 包含更新時機：「主動更新時機：XXX 時更新 YYY」→ 讓 AI 知道何時該迭代

### 少即是多

**Anthropic 官方**：
> "Find the smallest set of high-signal tokens that maximize likelihood of desired outcome."

**Manus 團隊實戰**：
> "The biggest performance gains didn't come from adding complex RAG pipelines. The gains came from removing things."
> 100+ 工具會導致 Context Confusion——AI 幻覺參數或調用錯誤工具。

**結論**：Skill 的設計原則是精簡、分批、按需載入。

---

## 三、設計原則

### 原則 1：給原則，不是給規則

| 做法 | 範例 | 結果 |
|------|------|------|
| 規則 | 「不要用核彈、震撼這種字」 | AI 換個方式寫，焦慮感還是在 |
| 原則 | 「不希望文章散發焦慮感」 | AI 理解了為什麼，自動避開所有焦慮型寫法 |
| 更深一層 | 「實事求是」（底層價值觀） | 一個價值觀涵蓋一大片規則 |

**判斷方法**：如果你的 SKILL.md 裡有 50+ 條具體規則，多半可以提煉出幾條原則來取代。

### 原則 2：被動載入 > 主動引導

| 做法 | 問題 |
|------|------|
| CLAUDE.md 裡寫「記得讀 X」「記得讀 Y」 | 忘記寫就不會被讀；CLAUDE.md 越來越肥 |
| 做成 Skill，讓 metadata 自然預載 | AI 自動判斷何時需要，按需載入 |

**應用**：任何「記得讀 X」的需求，都應該考慮轉為 Skill 的 references。

### 原則 3：設計方法 > 模仿範本

- 別人的 Skill 是解決別人的問題，照抄不一定適合你
- 正確做法：從自己的協作痛點出發，用設計思維五階段

### 原則 4：先拆後合

- 不確定顆粒度時，先為每個場景各做一個 Skill
- 做著做著發現核心原則重疊 → 合併成一個，用情境分流
- 不要一開始就想「最佳顆粒度」

### 原則 5：協議與人格分離

建立 AI 助理時，「怎麼做」和「是誰」應該分離：

```
CLAUDE.md（精簡，只放入口和 rules 引用）

.claude/rules/          ← 怎麼做（每次自動載入）
├── startup-protocol.md
├── permissions.md
└── serena-tools.md

.claude/skills/
├── sys-growth/    ← 成長機制（按需載入）
│   ├── SKILL.md
│   └── references/ (behavior.md, memory-system.md, ...)
└── persona/       ← 是誰（人格）← 可整包複製到其他專案
    ├── SKILL.md
    └── references/ (soul.md, identity.md)
```

好處：rules 自動載入（零成本觸發）、人格可攜帶、成長機制按需載入。

---

## 四、設計流程：五階段

| 階段 | 核心問題 | 正確做法 | 常見錯誤 |
|------|---------|---------|---------|
| 1. 同理心 | AI 什麼時候會迷失？ | 從「協作痛點」出發 | 從「我想要什麼」出發 |
| 2. 定義問題 | 這個 Skill 要解決什麼？ | 清晰、可衡量的設計目標 | 模糊的願望 |
| 3. 構思 | Metadata 和原則怎麼寫？ | 產生 3+ 方案再選最好的 | 接受第一個想法 |
| 4. 原型 | MV Skill 能跑嗎？ | 最小可行版本，先測試再迭代 | 完美主義 |
| 5. 測試 | 找到？理解？解決？ | 驗證三個設計假設 | 只問「有沒有 bug」 |

### MV Skill 標準

一個 v1.0 只需要：
1. 清晰的 description
2. 處理核心情境（80% 的情況）
3. 一個具體範例
4. 可以實際測試

### 測試三問

1. AI 能否**找到**這個 Skill？（description 夠清楚嗎）
2. AI 能否**理解**這個 Skill？（指令夠明確嗎）
3. 這個 Skill 是否**解決了問題**？（設計假設成立嗎）

三個都「是」→ 成功。有任何「否」→ 迭代。

---

## 五、應用判斷：什麼該做成 Skill

### 判斷標準

> 「這個知識、方法、流程，我希望 AI 永遠記得嗎？」
> 如果是，就該外化為 Skill。

### 適合做成 Skill 的

| 類型 | 範例 |
|------|------|
| 流程規劃 | SOP、客服流程、Review 流程 |
| 學習方法 | 你自己的學習法、思考框架 |
| 價值觀與原則 | 回應風格、決策框架、做人原則 |
| 知識體系 | 書籍知識 → 可調用顧問、專案技術決策 |
| 多 Skill 協作 | 對話收尾 → 自動觸發記憶更新 |
| 專案知識 | 技術決策、架構選型、設計規範 |

### 不適合做成 Skill 的

| 類型 | 原因 | 更好的做法 |
|------|------|-----------|
| 一次性指令 | 沒有重複使用價值 | 直接在對話中說 |
| 快速變動的資訊 | 維護成本太高 | 放在對話 context 或文件中 |
| 非常長的內容（>10k tokens） | 載入會佔用太多 context | 拆成多個 Skill 或放在 references |

---

## 六、Skill 演化模式

每個 Skill 通常經歷類似的演化：

```
v1：規則/案例導向
    └── 列了一堆規則，AI 機械執行
         │
    發現問題：遇到新情況就失靈，或結果「不對味」
         │
v2：原則/世界觀導向
    └── 給核心原則，AI 自己判斷
         │
    效果驗證：AI 能處理未預見的情況
         │
v3+：持續迭代
    └── 根據實際使用微調原則、補充邊界情況
```

**實證案例**：

| Skill | v1（規則導向） | 問題 | v2（原則導向） |
|-------|--------------|------|--------------|
| 數位秘書 | 遇到 A 做 X，遇到 B 做 Y | 規則沒覆蓋的就不處理 | 好秘書的核心原則（主動預判、讓老闆專注） |
| 寫作風格 | 不要用某些字、標題這樣寫 | AI 被框住，寫出來沒靈魂 | 世界觀驅動（我討厭焦慮感、實事求是） |
| AI 助理架構 | 全部塞在 CLAUDE.md 500+ 行 | 越來越肥、忘記寫就不讀 | 協議 vs 人格分離，兩個獨立 Skill |

---

## 七、常見誤區

| 誤區 | 錯誤理解 | 正確理解 |
|------|---------|---------|
| Skill = 進階 Prompt | 把 prompt 包成 Skill 格式就好 | Skill 有 metadata 預載機制，本質不同 |
| 規則越多越好 | SKILL.md 50+ 條規則很完整 | 原則取代規則，精簡更有效 |
| Description 隨便寫 | 只是說明文字 | 是 AI 判斷載入的唯一依據 |
| 越多 Skill 越好 | 裝 100 個就很強 | Tool Overload 會讓 AI 幻覺 |
| 模仿範本就好 | 找別人的照抄 | 別人的痛點不是你的痛點 |
| CLAUDE.md 要窮舉 | 所有引導都寫在 CLAUDE.md | 被動載入 > 主動引導 |
| Skill 是靜態的 | 寫好就不用動了 | 好的 Skill 會隨使用持續演化 |
| Description 觸發情境重疊 | 多個 Skill 都能處理某情境很好 | 重疊會導致 AI 載入錯誤的 Skill，需明確區隔邊界 |

---

## 八、Review Skill 的檢查清單

設計新 Skill 或調整現有 Skill 時，用這份清單驗證：

### Frontmatter（必備）
- [ ] SKILL.md 開頭有 YAML frontmatter（`---` 包圍）
- [ ] 包含 `name` 欄位（skill 的識別名稱）
- [ ] 包含 `description` 欄位（Progressive Disclosure Level 1）

### Description 品質
- [ ] 描述的是「使用情境」而非「功能分類」
- [ ] AI 讀完 description 能判斷「什麼時候該載入」
- [ ] 精簡但資訊量足夠（不浪費 15,000 字元預算）
- [ ] 包含主動更新時機（何時該迭代這份 Skill）

### 內容設計
- [ ] 以原則/價值觀為主，不是規則窮舉
- [ ] 有具體範例（至少一個）
- [ ] 長內容放在 references/，不是全塞在 SKILL.md
- [ ] SKILL.md < 5k tokens

### 架構合理性
- [ ] 顆粒度適當（一個 Skill 解決一類問題）
- [ ] 與其他 Skill 沒有大面積重疊
- [ ] Description 觸發情境與其他 Skill 無重疊（避免 AI 載入錯誤的 Skill）
- [ ] 如果是多 Skill 協作，規則裡有明確的連動指引

### 可維護性
- [ ] 有明確的「何時更新」說明
- [ ] 結構允許追加內容而不需要重寫
- [ ] references 是獨立文件，可以單獨更新

---

## 九、何時更新這份 Skill

> **AI 主動更新規則**：以下情境發生時，AI 應主動提議更新。

| 情境 | 更新什麼 |
|------|----------|
| 設計 Skill 過程中發現新模式或踩坑 | `references/design-patterns.md` |
| 發現新的常見誤區 | 第七章 |
| 技術機制有新發現（官方更新、新研究） | 第二章 + `references/evidence.md` |
| Review 檢查清單需要新增項目 | 第八章 |
| Skill 演化模式有新案例 | 第六章 |
| Agent Skill 生態有新發展 | `references/ecosystem.md` |

### 更新原則

1. **實證驅動**：只收錄經過實踐驗證的洞察
2. **保留演化脈絡**：更新時標注「何時、因何事發現」
3. **精簡為上**：這份 Skill 本身也要遵循「少即是多」

---

## 參考資源

- **設計模式與反模式**：`references/design-patterns.md`
- **官方引用與證據**：`references/evidence.md`
- **生態系統追蹤**：`references/ecosystem.md`
- **Skill 設計模板**：`references/skill-template.md`
