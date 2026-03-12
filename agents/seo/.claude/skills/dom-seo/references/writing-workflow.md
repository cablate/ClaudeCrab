# SEO 內容撰寫完整工作流程

8 階段系統化流程，從關鍵字研究到發布後優化。

---

## Stage 1: 關鍵字研究與意圖分析

### 目標
找到值得寫的關鍵字：有搜尋量、競爭度合理、符合商業目標。

### 工具
- **Semrush Keyword Magic Tool**：關鍵字探索、搜尋量、難度評估
- **Ahrefs Keywords Explorer**：競爭對手關鍵字、SERP 分析
- **Google Keyword Planner**：免費基礎工具

### 執行步驟

1. **種子關鍵字輸入**
   - 輸入主題核心詞（例：「咖啡沖煮」）
   - 工具會展開相關關鍵字（數千至數萬個）

2. **篩選條件**
   - 搜尋量：>100/月（依產業調整）
   - Keyword Difficulty (KD): <40（新站）、<60（有權威的站）
   - Intent 匹配：資訊型、導航型、交易型

3. **意圖分類**
   | Intent | 特徵 | 範例 | 內容類型 |
   |--------|------|------|----------|
   | 資訊型 | how to, what is, guide | 「如何手沖咖啡」 | 教學、指南 |
   | 導航型 | 品牌名、產品名 | 「Hario V60」 | 評測、介紹 |
   | 交易型 | buy, best, review | 「最佳咖啡機推薦」 | 比較、購買指南 |

4. **長尾關鍵字挖掘**
   - 80% 搜尋量來自長尾（低競爭、高轉換）
   - 例：「手沖咖啡」→「手沖咖啡水溫幾度最好」
   - 工具：Semrush "Questions" 功能

5. **AI Intent Matrix 系統化覆蓋**（2026-03 新增）
   - 公式：`[維度A] × [維度B] × [維度C]` = 批量微意圖長尾
   - 列出 3-5 個關鍵維度，每維度 5-10 個變數
   - 組合生成標題清單，不管有沒有搜索量（語意覆蓋優先）
   - 範例：`[器具] × [變數] × [問題]` = V60 × 水溫 × 怎麼調

### 產出
- 主要關鍵字 1 個（文章核心）
- 次要關鍵字 3-5 個（融入內容）
- 長尾關鍵字 10-20 個（FAQ、小標題）
- 使用者意圖分類
- AI Intent Matrix 標題清單（若為 Topic Cluster 規劃）

---

## Stage 2: 競爭對手內容分析

### 目標
理解 SERP Top 10 的內容，找到差異化空間。

### 工具
- **Frase.io**：自動分析 SERP，生成內容大綱
- **Surfer SEO**：內容優化建議（字數、關鍵字密度、LSI 關鍵字）
- **手動分析**：實際閱讀 Top 3 文章

### 分析重點

1. **內容結構**
   - 標題層級（H1, H2, H3）
   - 段落組織方式
   - 視覺元素（圖表、影片）

2. **涵蓋的子主題**
   - 哪些子主題被反覆提及？
   - 哪些角度尚未被覆蓋？
   - 有沒有明顯遺漏？

3. **內容深度與字數**
   - SERP Top 10 平均字數
   - 深度分析 vs 淺層介紹
   - **目標**：平均字數 +10%

4. **Featured Snippets 格式**
   - 是否有 Featured Snippet？
   - 格式：段落、列表、表格？
   - 如何優化以爭取 Position 0？

### 產出
- SERP Top 10 平均字數
- 必須涵蓋的子主題清單
- 差異化角度（我們的獨特價值）
- Featured Snippet 目標格式

---

## Stage 3: 內容大綱規劃

### 目標
結構化內容，確保邏輯清晰、涵蓋完整。

### 先判斷內容層級（2026-03 新增）

根據 Topic Cluster 架構，先確認這篇文章的定位：

| 層級 | 字數 | 功能 | 內鏈方向 |
|------|------|------|----------|
| **Boss/Pillar Page** | 3000-5000 | 主題總整理 + 功能性元件 | 被所有下層文章連入 |
| **Cluster Page** | 1500-2500 | 深入子主題 | ↔ 雙向連結 Boss + 同層 |
| **Long-tail 微意圖頁** | 800-1500 | AI Intent Matrix 批量產出 | → 自然轉接到 Boss/Cluster |

**Boss Page 硬性要求**：
1. 精簡總整理（不是下層文章的複製貼上）
2. 功能性元件（計算機、比較工具、產生器）

### 大綱結構範本

```markdown
# [主要關鍵字] - [副標題/價值主張]

## 引言（150-200 字）
- 勾起興趣（問題、數據、故事）
- 清楚定義主題
- 預告文章價值

## 核心章節（依意圖組織）

### [子主題 1]
- 要點 1
- 要點 2
- 實例/數據

### [子主題 2]
...

## FAQ（常見問題）
- 問題 1
- 問題 2
（使用 FAQ Schema）

## 結論與 CTA
- 總結重點
- 行動呼籲（訂閱、下載、購買）

## 視覺元素規劃
- 特色圖片
- 圖表/截圖
- 嵌入影片
```

### E-E-A-T 檢查

規劃階段就要思考：
- [ ] **Experience**：這篇文章展現真實經驗嗎？（案例、實測）
- [ ] **Expertise**：是否引用專家/權威來源？
- [ ] **Authoritativeness**：作者資訊是否透明？
- [ ] **Trustworthiness**：是否提供可信證據？

### 產出
- 完整內容大綱（H2, H3 層級）
- 每章節要點列表
- 視覺元素規劃
- E-E-A-T 元素確認

---

## Stage 4: 撰寫與優化

### 撰寫原則

1. **為人類撰寫，不是為演算法**
   - 自然語言優先
   - 不硬塞關鍵字
   - 每段落一個明確重點

2. **融入關鍵字**
   - 主要關鍵字：H1、引言、前 100 字、結論
   - 次要關鍵字：H2、內文自然分布
   - 長尾關鍵字：FAQ、小標題

3. **段落與可讀性**
   - 段落長度：2-4 句（手機閱讀友善）
   - 使用副標題拆解長內容
   - 列表、表格提升掃描性

### 長度指引

| 內容類型 | 建議字數 | 備註 |
|---------|---------|------|
| 部落格文章 | 1500-2500 | 資訊型內容 |
| Pillar Page | 3000-5000 | Topic Cluster 核心頁 |
| Product Review | 2000-3000 | 交易型內容 |
| FAQ | 800-1500 | 快速解答型 |

**依競爭程度調整**：SERP Top 10 平均字數 +10%

### 撰寫技巧

**引言公式**：
1. 問題/痛點（勾起共鳴）
2. 承諾/解方（這篇文章能給你什麼）
3. 證據/權威（為何該信任我們）

**範例**：
> 你是否曾經手沖咖啡時，明明用了高品質豆子，卻沖出苦澀的味道？（問題）
> 這篇指南將教你精準控制水溫、研磨度、沖煮時間，讓你在家也能沖出咖啡館等級的風味。（承諾）
> 我們實測了 20+ 種沖煮參數組合，並訪談了 3 位 SCA 認證咖啡師。（證據）

### LSI 關鍵字（Latent Semantic Indexing）

不是重複主關鍵字，而是語意相關詞：
- 主關鍵字：「手沖咖啡」
- LSI：「V60」「濾杯」「悶蒸」「注水手法」「咖啡粉研磨度」

工具：
- Surfer SEO（自動建議 LSI）
- Google 搜尋「People Also Ask」

---

## Stage 5: On-page SEO 檢查清單

### 必檢項目

#### Title Tag
- [ ] 包含主要關鍵字（靠前）
- [ ] 長度：50-60 字元
- [ ] 吸引點擊（數字、問句、價值主張）
- [ ] 範例：「手沖咖啡完全指南：5 步驟沖出完美風味（2026）」

#### Meta Description
- [ ] 總結文章價值
- [ ] 長度：150-160 字元
- [ ] 包含主要關鍵字
- [ ] 有 CTA（點擊誘因）
- [ ] 範例：「學習專業咖啡師的手沖技巧，掌握水溫、研磨度、沖煮時間的黃金比例。附實測數據與常見問題排解。立即閱讀 →」

#### URL 結構
- [ ] 簡潔且包含關鍵字
- [ ] 使用連字號（-）分隔
- [ ] 避免日期、ID、無意義參數
- [ ] 範例：`/hand-drip-coffee-guide/`（好）vs `/blog/post-12345`（差）

#### 標題層級
- [ ] H1：只有一個，包含主關鍵字
- [ ] H2：主要章節，包含次要關鍵字
- [ ] H3：子章節，自然融入長尾關鍵字
- [ ] 層級結構合理（不跳級）

#### 圖片優化
- [ ] 檔案名稱描述性（`hand-drip-coffee-setup.jpg`）
- [ ] Alt Text 描述性文字（包含關鍵字但自然）
- [ ] 壓縮（WebP 格式，<200KB）
- [ ] 尺寸適當（避免超大圖）

#### 內部連結
- [ ] 每 1000 字 2-5 個語意相關內部連結，全頁不超過 150 個
- [ ] 錨文字自然（不硬塞關鍵字）
- [ ] 連結到 Boss/Pillar Page（Topic Cluster 結構）
- [ ] 雙向連結（新文章 ↔ 舊文章）
- [ ] Long-tail 文章用 Micro-context 轉接到核心頁面（教完解決方案後自然帶出）
- [ ] 連結放在正文最相關位置，不要塞在 footer

#### 外部連結
- [ ] 2-3 個權威來源
- [ ] 開新分頁（`target="_blank"`）
- [ ] 加 `rel="noopener"`（安全性）
- [ ] 範例：研究數據、官方文件、專家訪談

---

## Stage 6: Schema Markup 實作

### 最低要求：Article Schema

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "手沖咖啡完全指南",
  "image": "https://example.com/image.jpg",
  "author": {
    "@type": "Person",
    "name": "作者名稱",
    "url": "https://example.com/author"
  },
  "publisher": {
    "@type": "Organization",
    "name": "網站名稱",
    "logo": {
      "@type": "ImageObject",
      "url": "https://example.com/logo.png"
    }
  },
  "datePublished": "2026-02-23",
  "dateModified": "2026-02-23"
}
```

### 進階：FAQ Schema

若文章有 FAQ 段落：

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [{
    "@type": "Question",
    "name": "手沖咖啡水溫幾度最好？",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "依烘焙度調整：淺焙 90-95°C，中焙 85-90°C，深焙 80-85°C。"
    }
  }]
}
```

### 進階：HowTo Schema

操作指南型內容：

```json
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "如何手沖咖啡",
  "step": [{
    "@type": "HowToStep",
    "name": "準備器具",
    "text": "準備濾杯、濾紙、手沖壺、磨豆機..."
  }]
}
```

### 驗證工具
- **Google Rich Results Test**：https://search.google.com/test/rich-results
- **Schema Markup Validator**：https://validator.schema.org/

---

## Stage 7: AI Overview 優化

### 目標
被 AI（ChatGPT、Perplexity、Google AI Overviews）引用。

### 優化技巧

#### 1. 清晰的定義與回答
在引言或首段直接回答核心問題：

> **手沖咖啡是什麼？**  
> 手沖咖啡（Pour Over Coffee）是一種用熱水手動注入咖啡粉的沖煮方式，透過控制水溫、研磨度、注水速度來萃取咖啡風味。

#### 2. Definition List 格式
AI 容易解析的結構：

```markdown
**關鍵術語**：
- **悶蒸（Bloom）**：初次注水，讓咖啡粉釋放二氧化碳
- **萃取率（Extraction）**：水從咖啡粉中溶解出風味物質的比例
```

#### 3. 事實陳述 + 引用來源
AI 偏好有來源的資訊：

> 根據 Specialty Coffee Association (SCA) 標準，理想萃取率為 18-22%。

#### 4. 結構化數據
表格、列表格式：

| 烘焙度 | 水溫 | 研磨度 |
|--------|------|--------|
| 淺焙 | 90-95°C | 中細 |
| 中焙 | 85-90°C | 中 |
| 深焙 | 80-85°C | 中粗 |

---

## Stage 8: 發布後監控與優化

### 監控指標

#### Google Search Console
- **印象數**：文章被顯示幾次
- **點擊率（CTR）**：印象 → 點擊的轉換率
- **平均排名**：SERP 位置

#### Core Web Vitals
- **LCP** (Largest Contentful Paint): <2.5s
- **FID** (First Input Delay): <100ms
- **CLS** (Cumulative Layout Shift): <0.1

#### 使用者行為（Google Analytics）
- **跳出率**：<70% 為佳
- **停留時間**：>2 分鐘為佳
- **頁面瀏覽深度**：是否滾動到底部

### 優化循環

#### 每 3 個月審視
- 表現不佳的內容（排名 >20、CTR <2%）
- 更新過時資訊（日期、數據）
- 補充遺漏的子主題
- 調整內部連結結構

#### 低排名頁面診斷
1. **內容品質**：是否太淺？缺乏獨特價值？
2. **技術問題**：載入速度慢？Mobile 體驗差？
3. **內部連結不足**：孤島頁面？
4. **競爭過高**：關鍵字難度超出網站權威？

#### 更新策略
- 補充最新資訊（「2026 更新」）
- 新增影片、圖表（提升停留時間）
- 擴充字數（新增子主題）
- 改善 Title/Meta（提升 CTR）

---

## 工具整合工作流程

```
Stage 1-2: 研究
├─ Semrush Keyword Magic Tool
├─ Ahrefs Keywords Explorer
└─ Frase.io SERP Analysis

Stage 3-4: 撰寫
├─ Google Docs / Notion（撰寫）
├─ Surfer SEO（即時優化建議）
└─ Grammarly（語法檢查）

Stage 5-6: On-page SEO
├─ Yoast SEO / Rank Math（WordPress）
├─ Schema Markup Generator
└─ Google Rich Results Test

Stage 7: AI 優化
└─ 手動檢查：清晰定義、引用來源、結構化資料

Stage 8: 監控
├─ Google Search Console
├─ Google Analytics
└─ PageSpeed Insights
```

---

**最後更新**：2026-03-11
**來源**：SEO Content Writing Handbook + 產業最佳實踐 + darkseoking 社群驗證
