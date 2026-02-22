# Remotion 實戰經驗

## Case Study: ClaudeCrab 30 秒宣傳片

**日期**：2026-02-22
**成果**：38 秒影片，7 個場景，完整但偏保守

---

## 問題：安全牌陷阱

### 現象

整部影片的動畫模式高度重複：
```
元素 A fade in → 元素 B fade in → 元素 C fade in → 場景轉換 → 重複
```

用到的技術只有：
- `spring()` + `interpolate()` — 基本 easing
- `Sequence` — 場景切換
- opacity / translateY / scale — 三板斧

### 沒用到的能力

| 套件 | 可用場景 | 為什麼沒用 |
|------|----------|-----------|
| D3.js | Directory 目錄樹 | 可以 force-directed 展開動畫 |
| Three.js | CTA logo | 3D 旋轉 + 粒子爆發 |
| Lottie | 打字動畫、成功特效 | 預製動畫更精緻 |
| GSAP | 複雜時間軸 | 多元素同步編排 |
| @remotion/gif | 實際操作展示 | 錄影比截圖更有說服力 |

---

## 反思：什麼時候該升級技術？

### 保守策略適合

- 時間緊迫，需要快速交付
- 內容本身就是賣點（截圖夠精彩）
- 目標受眾不在乎動畫精緻度

### 應該升級的訊號

- 同樣的動畫模式重複 3 次以上
- 靜態展示無法傳達動態特性（如：Live Office 的即時更新）
- CTA 需要記憶點（generic fade in 沒印象）

---

## 具體改進方向

### 1. Directory 場景 → D3 Force Layout

```tsx
// 不要這樣
const items = ["general/", "coder/", "researcher/"];
items.map((item, i) => <FadeInItem delay={i * 20} />);

// 應該這樣
import { forceSimulation, forceLink, forceManyBody } from "d3-force";
// 讓節點自然展開，有物理感
```

### 2. Live Office → 錄影 GIF

```tsx
// 不要這樣
<Img src={staticFile("screenshot.png")} />

// 應該這樣
import { Gif } from "@remotion/gif";
<Gif src={staticFile("live-office-demo.gif")} />
// 實際展示 Agent 狀態變化、氣泡出現
```

### 3. CTA → Three.js 粒子

```tsx
// 不要這樣
<div style={{ transform: `scale(${spring})` }}>🦀</div>

// 應該這樣
import { Canvas } from "@react-three/fiber";
// 3D logo 旋轉 + 點擊瞬間粒子爆發
```

### 4. 打字效果 → Lottie

```tsx
// 不要這樣（假打字）
const chars = text.slice(0, Math.floor(progress * text.length));

// 應該這樣
import { Lottie } from "@remotion/lottie";
// 使用專業設計的打字動畫 JSON
```

---

## 30 秒影片的節奏公式

```
[0-3s]  Hook：必須在 3 秒內抓住注意力
[3-8s]  定位：這是什麼？解決什麼問題？
[8-20s] 核心價值：2-3 個重點，每個 4-6 秒
[20-27s] 展示：實際使用畫面（錄影 > 截圖 > 模擬）
[27-30s] CTA：記憶點 + 行動呼籲
```

**資訊密度**：30 秒最多 5 個重點，每個重點需要視覺錨點

---

## 下次製作前的 Checklist

- [ ] 盤點可用素材（錄影、截圖、設計稿）
- [ ] 決定技術策略（保守 vs 展示）
- [ ] 識別「動態特性」場景 → 優先使用錄影/GIF
- [ ] 識別「記憶點」場景 → 考慮 3D/粒子/Lottie
- [ ] 避免連續 3 個以上相同動畫模式
