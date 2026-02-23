# Cab 形象視覺規範

**基於 avatar-v2-clean.png 建立的基準設定**

---

## 核心視覺元素

**⚠️ 生圖時不描述主體特徵，直接帶入參考圖**

- 基準圖：`agents/general/output/avatar-v2-clean.png`
- Prompt 只描述：構圖類型、表情、動作、背景
- 主體特徵交給參考圖決定

---

## 圖包類型規範

參考 Serin 模式，定義三種主要圖包類型：

### 類型 A：半身表情圖（主力）
- **用途**：日常表情包、貼圖
- **構圖**：Semi-chibi 風格，4 頭身比例，頭部佔畫面 60-70%
- **特徵**：頭部較大、窄肩、身體壓縮但可見到腰部、手部動作明顯
- **比例**：3:4 直式
- **參考**：serin1.jpg
- **標準錨定圖**：`output/typeA-standard.png`
- **prompt 模板**：
  ```
  Semi-chibi style, moe proportions, 4-head proportion, big head, narrow shoulders,
  half body shot showing torso and hands. [表情/動作描述].
  VTuber 2D model style. Pure white background #FFFFFF.

  Negative: realistic proportions, mature adult, broad shoulders,
  full chibi, nendoroid, stubby limbs, deformed body.
  ```

### 類型 B：CG 插圖
- **用途**：特殊場景、宣傳圖、精緻內容
- **構圖**：正常比例，可半身或全身
- **特徵**：可包含場景互動、道具、背景元素
- **比例**：1:1 或依場景需求調整
- **參考**：serin2.jpg
- **標準錨定圖**：`output/typeB-standard.png`
- **prompt 模板**：
  ```
  Normal proportions, detailed scene, [場景描述].
  [表情/動作描述]. Environmental context with [道具/背景元素].
  Pure white background #FFFFFF (or scene-appropriate background).
  Same clean anime art style.
  ```

### 類型 C：Q版大頭圖
- **用途**：簡化版表情、快速回應、極簡場合
- **構圖**：頭部 + 極少身體（2-3 頭身），超大頭比例
- **特徵**：極簡風格，表情極度誇張，身體幾乎只有輪廓
- **比例**：1:1
- **參考**：serin3.jpg
- **標準錨定圖**：`output/typeC-standard.png`
- **prompt 模板**：
  ```
  Super deformed, head focus, minimal body, 2-3 head proportion.
  Exaggerated [表情描述]. Chibi style, oversized head.
  Pure white background #FFFFFF. Same clean anime art style.
  ```

---

## 技術規格

### 通用設定
- **檔案格式**：PNG
- **背景**：白色（#FFFFFF，盡量純色但接受淡漸層，後製統一處理）
- **風格一致性**：所有類型都必須保持相同線條風格、著色方式、光影處理

### 生成流程
1. 必帶參考圖：`avatar-v2-clean.png`
2. Prompt 只描述類型、表情、動作，不描述主體特徵
3. 強調背景：`Pure white background #FFFFFF`

---

## 待規劃項目

### 第一批表情包
- [ ] 決定優先做哪個類型（建議先做類型 A）
- [ ] 列出需要的表情清單（7-10 個）
- [ ] 定義每個表情的用途場景

---

## 參考依據

- 基準圖：`agents/general/output/avatar-v2-clean.png`
- 研究資料：`knowledge/research/serin/`
- 風格參考：Serin 塞琳（自然、接地氣、不刻意）
