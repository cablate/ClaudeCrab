---
name: dom-seo
description: SEO 領域專業能力。觸發時機：撰寫文章前需要 SEO 優化策略；規劃內容主題群（Topic Clusters）；YMYL 領域內容規劃；優化 AI Overview 與 Featured Snippets；建立語意網絡與主題權威；執行 E-E-A-T 標準審查。核心價值：整合現代語意 SEO 技術（神經網路、Topic Maps、Entity Authority）與完整內容撰寫工作流程，從關鍵字思維轉向語意網絡思維，確保內容同時滿足 Google 演算法與 AI Overview 引用需求。主動更新時機：新演算法更新、發現新打法、工具演進、技術標準變化時更新策略。
---

# dom-seo

SEO 領域專業能力。從語意網絡思維到完整撰寫工作流程。

---

## 核心原則

### 1. 從關鍵字思維轉向語意網絡思維

Google 使用神經網路計算語意關係，不是關鍵字匹配。重點不是「塞關鍵字」，而是「建立完整的主題知識網絡」。

**核心概念**：
- **語意距離**：同主題的多篇文章必須有明確語意差異
- **Topic Maps**：覆蓋主題的「上下左右」相關知識
- **Topic Clusters**：25+ 篇深度互聯文章建立主題權威

→ 詳見 `references/modern-techniques.md`

### 2. 主題權威優先於頁面權威

Google 評估整個網站在該主題的深度，不是單一頁面。

**實踐**：
- Hub-and-Spoke 架構（Pillar Page + Cluster Pages）
- 實體權威累積（使用者訊號 + 內容深度 + 外部認可）
- 專注深耕，避免主題分散

### 3. 為 AI 優化，而非只為搜尋排名優化

2026 年 60%+ 搜尋為 Zero-click，目標是被 AI（ChatGPT、Perplexity、Google AI Overviews）引用。

**優化重點**：
- 清晰定義、可引用的事實陳述
- 結構化內容（表格、列表、定義）
- Schema Markup（FAQ、HowTo、Article）

→ 詳見 `references/technical-seo.md`（AI Overview 優化章節）

### 4. E-E-A-T 是內容品質的基線

Experience, Expertise, Authoritativeness, Trustworthiness 不是技巧，而是內容本質。

**YMYL 主題**（金融、醫療、法律）要求更高標準：專家撰寫、證照展示、權威來源引用。

→ 詳見 `references/eeat-standards.md`

---

## 實戰策略（概要）

### Strategy 1: AI Intent Matrix（系統化內容生成）
公式化長尾覆蓋：`[維度A] × [維度B] × [維度C]` = 批量生成語意相關的長尾內容。

### Strategy 2: Micro-context Authority Hijacking（權威引流）
Long-tail 頁面（易排名）→ 自然錨文字內部連結 → 核心商業頁面（權威累積）。

### Strategy 3: YMYL 新站破局
過期權威域名 + 極致 E-E-A-T + 高品質 Backlinks + 專注子領域。

### Strategy 4: Schema Markup（結構化資料）
必做：Article、FAQ、HowTo、BreadcrumbList Schema。

### Strategy 5: Core Web Vitals（技術 SEO 基線）
LCP <2.5s、FID <100ms、CLS <0.1。

→ 完整策略詳見 `references/modern-techniques.md` 和 `references/technical-seo.md`

---

## 完整撰寫工作流程（8 階段）

1. **關鍵字研究與意圖分析**：找出值得寫的關鍵字（搜尋量、競爭度、意圖）
2. **競爭對手內容分析**：SERP Top 10 分析，找差異化空間
3. **內容大綱規劃**：結構化大綱 + E-E-A-T 檢查
4. **撰寫與優化**：為人類撰寫，自然融入關鍵字
5. **On-page SEO 檢查**：Title、Meta、URL、H1-H3、圖片、內外部連結
6. **Schema Markup 實作**：Article、FAQ、HowTo Schema
7. **AI Overview 優化**：清晰定義、表格、引用來源
8. **發布後監控與優化**：Google Search Console、Core Web Vitals、使用者行為

→ 詳見 `references/writing-workflow.md`（含每階段詳細步驟、工具、範例）

---

## 觸發時機

調用此 Skill 的時機：
- 撰寫文章前需要 SEO 優化策略
- 規劃內容主題群（Topic Clusters）
- YMYL 領域內容規劃（需極致 E-E-A-T）
- 優化 AI Overview 與 Featured Snippets
- 建立語意網絡與主題權威
- 執行 E-E-A-T 標準審查
- 技術 SEO 檢查（Schema、Core Web Vitals）

---

## 工具推薦（概要）

### 關鍵字研究
- Semrush Keyword Magic Tool（付費，推薦）
- Ahrefs Keywords Explorer（付費，推薦）
- Google Keyword Planner（免費）

### 內容優化
- Frase.io（SERP 分析 + 大綱生成）
- Surfer SEO（即時優化建議）
- Clearscope（語意關鍵字）

### 技術 SEO
- Google Search Console（必用，免費）
- Screaming Frog（網站爬蟲）
- PageSpeed Insights（Core Web Vitals）

### Schema
- Google Rich Results Test（驗證）
- Schema Markup Generator（快速生成）

→ 完整工具清單與使用指南：`references/tools.md`

---

## 常見錯誤與修正

| 錯誤 | 後果 | 修正方法 |
|------|------|----------|
| 關鍵字填充 | 語句不自然，排名下降 | 使用語意相關詞（LSI），自然融入 |
| 忽略使用者意圖 | 內容類型錯誤（資訊型寫成推銷） | 依意圖調整內容（資訊→教學，交易→評測） |
| 內容過淺 | 無法與 SERP Top 10 競爭 | 參考平均字數 +10%，補充子主題 |
| 缺乏內部連結 | 文章孤島，無法建立 Topic Cluster | 每篇 3-5 個內部連結 |
| 忽略 Mobile 體驗 | Core Web Vitals 不合格 | Mobile-Friendly Test，優化載入速度 |
| 缺乏 E-E-A-T | YMYL 主題排名被壓制 | 專家撰寫、引用來源、透明作者資訊 |

---

## References（詳細內容）

- **modern-techniques.md** — darkseoking 現代 SEO 技術（語意距離、Topic Maps、Entity Authority）
- **writing-workflow.md** — 完整 8 階段 SEO 內容撰寫流程
- **eeat-standards.md** — E-E-A-T 執行標準與 YMYL 強化
- **technical-seo.md** — Schema、Core Web Vitals、AI Overview 技術實作
- **tools.md** — SEO 工具清單與使用指南
- **collaboration-workflow.md** — 與寫作 Skill 的協作流程（分工機制、品質保證）