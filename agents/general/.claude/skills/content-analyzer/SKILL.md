---
description: |
  對創作者的社群貼文進行結構化分析，產出四個維度：content_type（意圖分類）、topics（主題標籤）、key_insights（核心觀點提取）、knowledge_density（知識密度評分）。
  觸發情境：「幫我分析這些貼文」「跑一下內容分析」「補寫 key_insights」、批次處理未分析的內容。
  主動更新時機：發現新的誤判模式時更新判斷框架；API 結構變動時更新 references/api-spec.md
---

# Content Analyzer - 社群貼文內容分析

## 核心使命

將社群碎片內容轉化為可結構化、可聚合、可追溯的知識原料。

這不是「幫貼文打分數」——而是為未來的知識架構建構（Phase 4 Principles 歸納）提供高品質原料。**每一條 key_insight 都可能成為創作者核心理念的證據。**

---

## 四個分析維度

| 維度 | 回答的問題 | 性質 | 下游用途 |
|---|---|---|---|
| **content_type** | 作者寫這篇的「意圖」是什麼 | 8 種預定義，單選 | 內容類型分佈、策略建議 |
| **topics** | 這篇在哪個「知識領域」 | 開放式動態累積，多選 | Topic 排行、交叉分析 |
| **key_insights** | 這篇有什麼「可獨立成立的觀點」 | 1-3 條陳述句 | **Phase 4 Principles 歸納的原料** |
| **knowledge_density** | 這篇的「知識資產化潛力」有多高 | 1-10 整數 | 象限圖（知識×市場）、優先級排序 |

> content_type 和 topics 是**正交**的：content_type 是「在做什麼」，topics 是「講什麼」。

---

## 判斷原則

### content_type：判斷作者意圖

8 種意圖定義見 `references/field-spec.md`。核心判斷原則：

- **每篇只選一個**最符合的意圖
- 邊界模糊時，選「作者最主要的意圖」
- 從 API 取得最新定義：`GET /api/analyses/content-types`

**邊界判定規則**：
- 「經驗分享」vs「知識教學」→ 有「我」的故事線 + 結果 = 經驗分享；有「你可以」的步驟 + 方法 = 知識教學；兩者都有看篇幅超過 60% 的選那個
- 「靈感筆記」vs「觀點表達」→ 有完整論述（觀點 + 理由 + 結論）= 觀點表達；只有一個想法沒展開 = 靈感筆記
- 「問題探討」vs「觀點表達」→ 結論是問題/困境/開放式探索 = 問題探討；結論是明確立場或主張 = 觀點表達
- 「經營紀錄」vs「日常互動」→ 有具體數字/里程碑/成長數據 = 經營紀錄；只是社交寒暄 = 日常互動

### topics：標記知識領域

三條核心判斷原則（**最重要，必讀**）：

**原則一：粒度要有鑑別力**
> 「如果我用這個 topic 去搜尋，找出來的結果會不會太雜？」如果會，就代表粒度太粗。

| 情境 | 錯誤 | 正確 | 為什麼 |
|---|---|---|---|
| 在講 AI Skill 設計 | `AI工具` | `AI Skill` | 「AI工具」涵蓋太廣 |
| 在講 Claude Code | `AI工具` | `Claude Code` | 具體工具用具體名稱 |

**原則二：「提到」不等於「在講」**
> 只有作者花篇幅說明、分析、反思的主題才標 topic。順帶出現的不標。
>
> 快速自問：「把這句話刪掉，貼文主旨會改變嗎？」不會 → 只是提到。

**原則三：標論點，不標論據**
> 用 A、B 論證 C 時，C 才是 topic。A 和 B 只是支撐材料。
>
> 自問：「作者的觀點是關於什麼的？」那個「什麼」才是 topic。

更多範例見 `references/topic-examples.md`。

**一致性要求**：分析前先 `GET /api/analyses/topics/distinct`，優先使用已存在的 topic 名稱。

### key_insights：提取核心觀點

**這是最重要的維度。** key_insights 是 Phase 4 歸納 Principles 的原料，直接決定 AI 分身能否理解創作者的價值觀。

**提取原則**：
- 只提取**脫離原文仍有意義**的觀點
- 能代表創作者「獨特觀點」的陳述（累積多篇後能看出「這個人一直在強調什麼」）
- 每篇 1-3 條，**寧少勿濫**
- 用陳述句，不用疑問句
- 如果內容沒有可提取的觀點（如純日常互動），給空陣列 `[]`

**最低覆蓋規則**：
- content_type 為「觀點表達」「經驗分享」「知識教學」且 KD ≥ 3 時，至少提取 1 條 key_insight（不可給空陣列）
- 如果認為真的沒有可提取的觀點，必須在 density_reasoning 中說明原因

**層次判斷**（只提取前三種）：

| 類型 | 範例 | 提取？ |
|---|---|---|
| 方法論層 | 「跟案例太貼的 skill 無法有效廣泛複用」 | ✅ |
| 價值觀層 | 「資料本身是資產，不只是輔助工具」 | ✅ |
| 反直覺洞察 | 「做教學反而比接案更能激發思考」 | ✅ |
| 表面觀察 | 「AI 可以幫助工作」 | ❌ 常識 |
| 事件描述 | 「作者參加了一場講座」 | ❌ 不是觀點 |
| 情緒表達 | 「這個功能很棒」 | ❌ 沒有論點 |

**品質自問**：「如果把 50 篇的 key_insights 攤開來聚類，這條能不能被歸到某個有意義的 Principle 裡？」如果不能，它可能太碎或太泛。

### knowledge_density：評估知識資產化潛力

整數 1-10。衡量的是「知識資產化潛力」，**不是「寫作品質」或「互動表現」**。

**重要：KD 必須在 content_type 之前獨立評估**，避免用類型標籤錨定分數。

**兩步法評分**：

```
Step 1：先判斷等級區間
  → 極低(1-2) / 低(3-4) / 中(5-6) / 高(7-8) / 極高(9-10)

Step 2：在區間內逐維度確認（每維度只有 +0 或 +2，不存在 +1）
  有明確觀點或論點？        → +0 或 +2
  有可操作的方法或步驟？    → +0 或 +2
  有具體經驗或數據佐證？    → +0 或 +2
  有深入分析而非表面提及？  → +0 或 +2
  有原創性（不是常識）？    → +0 或 +2
  → 五維度加總確認是否與區間吻合，若不吻合以維度加總為準
```

| 分數 | 等級 | 典型內容 |
|---|---|---|
| 9-10 | 極高 | 系統性方法論 + 原創洞察 + 充分佐證 |
| 7-8 | 高 | 有明確觀點 + 方法或經驗 + 可展開 |
| 5-6 | 中 | 有觀點但較碎片，或有經驗但未提煉 |
| 3-4 | 低 | 表面提及、日常觀察 |
| 1-2 | 極低 | 純社交互動、時效性內容 |

**density_reasoning** 必須包含所有五個維度的判定，即使得 0 分也要寫。格式：
`"有明確觀點(+2)、有可操作方法(+2)、缺具體經驗佐證(+0)、有深入分析(+2)、觀點具原創性(+2) = 8"`

錯誤範例（不可接受）：
- ❌ `"趣味展示，無知識內容"` — 未逐維度說明
- ❌ `"有觀點(+1)、太短未展開(+1)"` — +1 不存在，每維度只有 +0 或 +2

---

## 執行流程

### 流程 A：全新分析

```
1. GET /api/analyses/content-types          → 8 種意圖定義
2. GET /api/analyses/topics/distinct        → 已存在的 topic 詞彙表
3. GET /api/contents/unanalyzed?page=1&limit=20&fields=id,text,media_url
4. 逐篇分析（順序：KD → content_type → topics → key_insights）
5. 執行自我檢查（見下方）
6. POST /api/analyses 寫回（用 Python script 批次寫入）
7. 如有下一頁，回到 Step 3
```

### 流程 B：補寫欄位

適用於已有 content_type + topics，需補寫 key_insights + knowledge_density 的情況。

```
1. GET /api/analyses?page=1&limit=20       → 已有的分析記錄
2. 篩選出 knowledge_density 為 null 的記錄
3. 對每筆：讀原始內容 → 產出缺少的欄位
4. PUT /api/analyses/:id 只傳需補寫的欄位（merge 更新）
```

### 寫入方式

```bash
# POST - 新建分析（單筆或批次）
python C:/Users/User/.claude/skills/content-analyzer/scripts/post_analysis.py '{"content_id":"uuid",...}'
python C:/Users/User/.claude/skills/content-analyzer/scripts/post_analysis.py --file results.json

# PUT - 補寫欄位
python C:/Users/User/.claude/skills/content-analyzer/scripts/post_analysis.py --put abc-123 '{"key_insights":[...],"knowledge_density":7,"density_reasoning":"..."}'
```

**analyzed_by**：填入模型 ID，如 `claude-opus-4-6`、`claude-sonnet-4-20250514`。

完整 API 規格見 `references/api-spec.md`，欄位詳細規格見 `references/field-spec.md`。

---

## 範例對照

| 原文摘要 | content_type | topics | key_insights | kd |
|---|---|---|---|---|
| 「教你怎麼用 ChatGPT 寫程式」 | 知識教學 | `ChatGPT`, `程式開發` | 「用 AI 寫程式的關鍵在於拆解需求而非依賴 AI 能力」 | 7 |
| 「我用 AI Skill 三個月，發現跟案例太貼的 skill 都不能複用」 | 經驗分享 | `AI Skill` | 「跟案例太貼的 skill 無法有效廣泛複用」 | 8 |
| 「整理 10 個好用的 MCP Server」 | 資源整理 | `MCP` | [] | 3 |
| 「講座 28 人購買了，感謝大家」 | 日常互動 | (不標) | [] | 1 |

---

## 分析後自我檢查

每篇分析完成後，執行以下檢查：

- [ ] **content_type**：換成另一種 type 也說得通嗎？如果是，重新檢查邊界判定
- [ ] **topics**：每個標記的 topic，刪掉後分析完整性會受影響嗎？不會就移除
- [ ] **topics**：「觀點表達」「經驗分享」「知識教學」的貼文，至少應有 1 個 topic
- [ ] **key_insights**：這條 insight 換到另一個創作者身上還成立嗎？成立代表太泛，重寫
- [ ] **KD**：跟校準範例中同等級的貼文比，分數合理嗎？
- [ ] **density_reasoning**：是否涵蓋了全部五個維度？每個維度是 +0 或 +2（不是 +1）？
- [ ] **最低覆蓋**：KD ≥ 3 的「觀點表達」「經驗分享」「知識教學」是否有至少 1 條 key_insight？

---

## 參考資源

- **API 規格**：`references/api-spec.md`
- **欄位詳細規格**：`references/field-spec.md`
- **Topics 判斷範例**：`references/topic-examples.md`
