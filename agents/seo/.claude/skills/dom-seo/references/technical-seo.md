# Technical SEO 技術基礎

Schema Markup、Core Web Vitals、AI Overview 優化

---

## Schema Markup（結構化資料）

### 為什麼需要 Schema

**問題**：Google 爬蟲只看到 HTML，不知道哪些是「作者」「發布日期」「評分」。

**解決**：用 Schema.org 標準格式標記資料，明確告訴 Google「這是什麼」。

**好處**：
- Rich Results（豐富搜尋結果）：星級評分、FAQ、食譜卡片
- AI Overview 更容易引用
- Featured Snippets 機會提升

### 必須實作的 Schema

#### 1. Article Schema（所有文章）

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "手沖咖啡完全指南",
  "description": "學習專業咖啡師的手沖技巧...",
  "image": "https://example.com/coffee-guide.jpg",
  "author": {
    "@type": "Person",
    "name": "李小明",
    "url": "https://example.com/author/lixiaoming"
  },
  "publisher": {
    "@type": "Organization",
    "name": "咖啡研究室",
    "logo": {
      "@type": "ImageObject",
      "url": "https://example.com/logo.png"
    }
  },
  "datePublished": "2026-02-23",
  "dateModified": "2026-02-23"
}
```

**必填欄位**：
- `headline`（標題）
- `image`（特色圖片，至少 1200x630px）
- `author`（作者資訊）
- `publisher`（網站資訊）
- `datePublished`（發布日期）

#### 2. FAQ Schema（常見問題）

若文章有 FAQ 段落，必須加：

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "手沖咖啡水溫幾度最好？",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "依烘焙度調整：淺焙 90-95°C，中焙 85-90°C，深焙 80-85°C。水溫越高，萃取越強；水溫越低，酸質越明顯。"
      }
    },
    {
      "@type": "Question",
      "name": "研磨度如何調整？",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "手沖建議中細研磨（細砂糖大小）。過細會導致過萃（苦澀），過粗則萃取不足（酸澀、水感）。"
      }
    }
  ]
}
```

**效果**：
- 出現在 SERP 的「People Also Ask」區塊
- 佔據更多 SERP 空間
- CTR 提升 20-30%（實證數據）

#### 3. HowTo Schema（操作指南）

教學型文章（步驟式內容）：

```json
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "如何手沖咖啡",
  "description": "5 步驟沖出完美風味",
  "image": "https://example.com/howto-coffee.jpg",
  "totalTime": "PT10M",
  "step": [
    {
      "@type": "HowToStep",
      "name": "準備器具",
      "text": "準備濾杯、濾紙、手沖壺、磨豆機、咖啡豆 15g、熱水 250ml。",
      "image": "https://example.com/step1.jpg"
    },
    {
      "@type": "HowToStep",
      "name": "研磨咖啡豆",
      "text": "設定研磨度為中細（細砂糖大小），研磨 15g 咖啡豆。",
      "image": "https://example.com/step2.jpg"
    }
  ]
}
```

#### 4. BreadcrumbList Schema（麵包屑導覽）

幫助 Google 理解網站結構：

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "首頁",
      "item": "https://example.com/"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "咖啡教學",
      "item": "https://example.com/coffee/"
    },
    {
      "@type": "ListItem",
      "position": 3,
      "name": "手沖咖啡指南",
      "item": "https://example.com/coffee/hand-drip-guide/"
    }
  ]
}
```

#### 5. Product Schema（產品評測）

若是產品評測文章：

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Hario V60 手沖壺",
  "image": "https://example.com/hario-v60.jpg",
  "description": "經典鵝頸壺，注水穩定...",
  "brand": {
    "@type": "Brand",
    "name": "Hario"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "reviewCount": "152"
  },
  "offers": {
    "@type": "Offer",
    "price": "50.00",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  }
}
```

**效果**：
- SERP 顯示星級評分
- 價格資訊
- 庫存狀態

### Schema 實作方式

#### 方法 1：JSON-LD（推薦）

放在 `<head>` 或 `<body>` 結尾：

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  ...
}
</script>
```

**優點**：
- 獨立於 HTML，易維護
- Google 推薦方式
- 不影響頁面顯示

#### 方法 2：Microdata（不推薦）

直接在 HTML 標籤加屬性：

```html
<article itemscope itemtype="https://schema.org/Article">
  <h1 itemprop="headline">手沖咖啡指南</h1>
  <time itemprop="datePublished" datetime="2026-02-23">2026-02-23</time>
</article>
```

**缺點**：
- 與 HTML 混合，難維護
- 較舊的方式

### 驗證工具

1. **Google Rich Results Test**  
   https://search.google.com/test/rich-results
   - 貼上 URL 或程式碼
   - 檢查是否有錯誤
   - 預覽 Rich Results 效果

2. **Schema Markup Validator**  
   https://validator.schema.org/
   - 驗證 Schema 語法正確性

3. **Google Search Console**  
   - 「強化功能」→ 查看 Rich Results 錯誤
   - 修正後「要求建立索引」

---

## Core Web Vitals（核心網頁指標）

### 定義

Google 評估網頁使用者體驗的三大指標（2021 成為排名因素）。

| 指標 | 定義 | 標準 |
|------|------|------|
| **LCP** (Largest Contentful Paint) | 最大內容繪製時間 | <2.5s（優）<br>2.5-4s（需改進）<br>>4s（差） |
| **FID** (First Input Delay) | 首次輸入延遲 | <100ms（優）<br>100-300ms（需改進）<br>>300ms（差） |
| **CLS** (Cumulative Layout Shift) | 累計版面配置位移 | <0.1（優）<br>0.1-0.25（需改進）<br>>0.25（差） |

**2024 更新**：FID 將被 **INP** (Interaction to Next Paint) 取代。

### LCP 優化（載入速度）

**常見問題**：
- 圖片過大
- 伺服器回應慢
- JavaScript/CSS 阻塞渲染

**優化方法**：

#### 1. 圖片優化
```html
<!-- 使用 WebP 格式 -->
<img src="image.webp" alt="手沖咖啡">

<!-- Lazy Loading（非首屏圖片） -->
<img src="image.jpg" loading="lazy">

<!-- 優先載入首屏圖片 -->
<link rel="preload" as="image" href="hero-image.jpg">
```

- 壓縮圖片（TinyPNG、Squoosh）
- 使用 WebP（比 JPEG 小 25-35%）
- 設定圖片寬高（避免 CLS）

#### 2. 使用 CDN
- Cloudflare（免費）
- AWS CloudFront
- 快取靜態資源（圖片、CSS、JS）

#### 3. 減少 JavaScript 阻塞
```html
<!-- 延遲載入非必要 JS -->
<script src="analytics.js" defer></script>

<!-- Async 載入 -->
<script src="ads.js" async></script>
```

#### 4. 伺服器優化
- 使用快速主機（SSD、HTTP/2）
- 開啟 Gzip/Brotli 壓縮
- 快取策略（Browser Cache、Server Cache）

### FID/INP 優化（互動回應）

**常見問題**：
- JavaScript 執行時間過長
- 主執行緒被阻塞

**優化方法**：
- 拆分大型 JavaScript 檔案
- 移除未使用的 JS
- 使用 Web Workers（背景執行）

### CLS 優化（版面穩定性）

**常見問題**：
- 圖片/廣告沒有設定尺寸
- 動態注入內容（廣告、嵌入影片）
- Web Fonts 載入時字體閃爍

**優化方法**：

#### 1. 設定圖片/影片尺寸
```html
<!-- 明確寬高 -->
<img src="image.jpg" width="800" height="600" alt="...">

<!-- 或用 CSS aspect-ratio -->
<style>
img {
  aspect-ratio: 16 / 9;
}
</style>
```

#### 2. 預留廣告空間
```css
.ad-container {
  min-height: 250px; /* 預留高度 */
}
```

#### 3. Font Loading 優化
```css
/* 使用 font-display: swap */
@font-face {
  font-family: 'MyFont';
  src: url('font.woff2');
  font-display: swap; /* 避免 FOIT */
}
```

### 檢測工具

1. **PageSpeed Insights**  
   https://pagespeed.web.dev/
   - 分析 Desktop + Mobile
   - 提供優化建議

2. **Google Search Console**  
   - 「核心網頁指標」報告
   - 查看哪些頁面需改進

3. **Chrome DevTools**  
   - Lighthouse（F12 → Lighthouse）
   - Performance 面板（詳細分析）

---

## AI Overview 優化

### 目標
被 AI（Google AI Overviews、ChatGPT、Perplexity）引用。

### 為什麼重要

**Zero-click 搜尋趨勢**：
- 2026 年 60%+ 搜尋不點擊任何連結
- AI 直接在 SERP 回答問題
- **新目標**：被 AI 引用（不只排名）

### AI 偏好的內容格式

#### 1. 清晰的定義與回答

在文章開頭**直接回答**核心問題：

```markdown
## 手沖咖啡是什麼？

手沖咖啡（Pour Over Coffee）是一種用熱水手動注入咖啡粉的沖煮方式。
透過控制水溫（85-95°C）、研磨度（中細）、注水速度來萃取咖啡風味。
相較於機器沖煮，手沖能更精確控制萃取過程，展現咖啡豆的獨特風土特性。
```

**AI 會直接引用這段**。

#### 2. Definition List 格式

AI 容易解析的結構化定義：

```markdown
**關鍵術語**：

- **悶蒸（Bloom）**：初次注水（粉量 2 倍水），讓咖啡粉釋放二氧化碳。時間：30 秒。
- **萃取率（Extraction）**：水從咖啡粉中溶解出風味物質的比例。理想範圍：18-22%（SCA 標準）。
- **TDS（Total Dissolved Solids）**：咖啡中溶解固體的濃度。理想範圍：1.15-1.35%。
```

#### 3. 表格與結構化數據

AI 偏好表格格式：

| 烘焙度 | 水溫 | 研磨度 | 風味特性 |
|--------|------|--------|----------|
| 淺焙 | 90-95°C | 中細 | 果酸、花香、茶感 |
| 中焙 | 85-90°C | 中 | 平衡、焦糖、巧克力 |
| 深焙 | 80-85°C | 中粗 | 苦甜、堅果、煙燻 |

#### 4. 事實陳述 + 引用來源

AI 偏好有來源的資訊（Trustworthiness）：

```markdown
根據 Specialty Coffee Association (SCA) 標準，理想萃取率為 18-22%。
研究顯示，萃取率低於 18% 會導致酸澀（Under-extraction），
高於 22% 則會苦澀（Over-extraction）（來源：SCA Brewing Standards, 2023）。
```

#### 5. 步驟式指南

AI 喜歡清晰的步驟：

```markdown
## 手沖咖啡 5 步驟

1. **準備器具**：濾杯、濾紙、手沖壺、咖啡豆 15g、熱水 250ml（粉水比 1:15-1:17）
2. **研磨**：中細研磨（細砂糖大小）
3. **悶蒸**：注入 30ml 熱水（粉量 2 倍），悶蒸 30 秒
4. **注水**：分 3 次注水，總時間 2-3 分鐘
5. **享用**：移除濾杯，輕搖均勻，倒入杯中
```

#### 6. FAQ 格式

AI Overview 常引用 FAQ：

```markdown
## 常見問題

**Q: 手沖咖啡一定要用鵝頸壺嗎？**  
A: 不一定。鵝頸壺能穩定控制水流，但一般細口壺也可以。關鍵是注水穩定。

**Q: 為什麼我的手沖咖啡很苦？**  
A: 可能原因：1) 水溫過高（>95°C）2) 研磨過細 3) 萃取時間過長（>3.5 分鐘）。
```

### Schema 加強 AI 引用

#### FAQ Schema（必做）
前面提過的 FAQ Schema，AI Overview 會優先引用。

#### Speakable Schema（語音搜尋）
標記哪些段落適合語音朗讀：

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "speakable": {
    "@type": "SpeakableSpecification",
    "xpath": [
      "/html/head/title",
      "/html/body/article/section[1]/p"
    ]
  }
}
```

### AI Overview 檢測

目前無官方工具，但可觀察：
- Google 搜尋你的關鍵字，是否出現 AI Overview
- 若出現，你的內容是否被引用
- ChatGPT/Perplexity 搜尋，是否引用你的網站

---

## Featured Snippets 策略

### 定義

出現在 SERP "Position 0"（排名第一之上）的特殊區塊。

**效果**：
- CTR 提升 850%（Ahrefs 數據）
- 佔據兩個 SERP 位置（Snippet + 原排名）
- 語音搜尋優先來源

### Featured Snippets 類型

| 類型 | 範例問題 | 格式 |
|------|----------|------|
| 段落 | 「什麼是手沖咖啡」 | 50-60 字精簡回答 |
| 列表 | 「手沖咖啡步驟」 | 有序/無序列表 |
| 表格 | 「咖啡烘焙度比較」 | 表格格式 |
| 影片 | 「如何手沖咖啡」 | YouTube 影片 |

### 優化方法

#### 1. 段落 Snippet
在 H2 標題下，直接用 50-60 字回答：

```markdown
## 什麼是手沖咖啡？

手沖咖啡是用熱水手動注入咖啡粉的沖煮方式，透過控制水溫、研磨度、注水速度來萃取風味。相較於機器沖煮，手沖能更精確控制萃取過程。
```

#### 2. 列表 Snippet
使用有序列表（步驟）或無序列表（要點）：

```markdown
## 手沖咖啡步驟

1. 準備器具（濾杯、濾紙、手沖壺、咖啡豆）
2. 研磨咖啡豆（中細研磨）
3. 悶蒸 30 秒（粉量 2 倍水）
4. 分次注水（2-3 分鐘）
5. 移除濾杯，享用
```

#### 3. 表格 Snippet
用 Markdown 表格或 HTML `<table>`：

```markdown
| 烘焙度 | 水溫 | 風味 |
|--------|------|------|
| 淺焙 | 90-95°C | 果酸、花香 |
| 中焙 | 85-90°C | 焦糖、巧克力 |
| 深焙 | 80-85°C | 苦甜、堅果 |
```

### 目標問題類型

Featured Snippets 常出現在：
- **定義型**：「什麼是 X」「X 是什麼意思」
- **步驟型**：「如何 X」「怎麼 X」
- **比較型**：「X vs Y」「X 和 Y 的差別」
- **列表型**：「X 的好處」「X 的種類」

### 檢測工具

- **Ahrefs**：Content Gap → 找出競爭對手的 Featured Snippets
- **Semrush**：Keyword Magic Tool → 篩選有 Snippet 的關鍵字
- **手動搜尋**：Google 你的關鍵字，觀察是否有 Snippet

---

## 參考資源

### 官方工具
- Google Rich Results Test: https://search.google.com/test/rich-results
- PageSpeed Insights: https://pagespeed.web.dev/
- Google Search Console: https://search.google.com/search-console

### Schema 資源
- Schema.org 官方文件: https://schema.org/
- Google Schema Markup 指南: https://developers.google.com/search/docs/appearance/structured-data

### Core Web Vitals
- web.dev (Google): https://web.dev/vitals/
- Chrome UX Report: https://developer.chrome.com/docs/crux/

### 延伸閱讀
- "The Complete Guide to Schema Markup" (Moz, 2026)
- "Core Web Vitals Optimization Guide" (web.dev)
- "How to Win Featured Snippets" (Ahrefs Blog)

---

**最後更新**：2026-02-23  
**來源**：Google 官方文件 + SEO 產業最佳實踐
