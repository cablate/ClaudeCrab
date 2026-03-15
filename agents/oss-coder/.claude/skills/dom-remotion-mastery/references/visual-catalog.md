# 視覺效果目錄

本目錄整理常見的視覺效果類型、適用場景、以及實作思路。

---

## 文字效果

### Typewriter（打字機）

**效果**：文字逐字出現，模擬打字過程

**適用**：重要訊息、標語、程式碼展示

**實作思路**：
```tsx
const frame = useCurrentFrame();
const text = "Hello World";
const charsToShow = Math.floor(frame / 2);  // 每 2 幀顯示一字
const displayText = text.slice(0, charsToShow);

<span>{displayText}</span>
<span className="cursor">|</span>  // 閃爍游標
```

**變化**：
- 加入打字聲效
- 游標閃爍
- 刪除再重打
- 多行逐行出現

---

### Counter（數字滾動）

**效果**：數字從 0 滾動到目標值

**適用**：統計數據、成果展示、強調數量

**實作思路**：
```tsx
const frame = useCurrentFrame();
const targetValue = 1000;
const progress = interpolate(frame, [0, 60], [0, 1], {
  extrapolateRight: "clamp",
  easing: Easing.out(Easing.cubic),
});
const displayValue = Math.round(targetValue * progress);

<span>{displayValue.toLocaleString()}</span>
```

**變化**：
- 帶單位（$、%、+）
- 小數點
- 配合 scale pulse 強調

**參考**：`AgentSkillPromo/Stage1Hook.tsx`

---

### Word Highlight（螢光筆）

**效果**：像螢光筆一樣在文字下方畫出高亮

**適用**：強調關鍵詞

**實作思路**：
```tsx
// 用 linear-gradient 模擬螢光筆效果
const highlightWidth = interpolate(frame, [0, 20], [0, 100]);

<span style={{
  background: `linear-gradient(to right, #ffff00 ${highlightWidth}%, transparent ${highlightWidth}%)`,
  backgroundPosition: "0 90%",
  backgroundSize: "100% 30%",
  backgroundRepeat: "no-repeat",
}}>
  重要文字
</span>
```

---

### Text Reveal（遮罩揭露）

**效果**：文字從遮罩後方滑出

**適用**：標題進場、品牌名稱

**實作思路**：
```tsx
const clipPath = interpolate(frame, [0, 30], [0, 100]);

<div style={{ overflow: "hidden" }}>
  <span style={{
    transform: `translateY(${100 - clipPath}%)`,
  }}>
    BRAND NAME
  </span>
</div>
```

---

## 元素進場

### Fade + Slide（淡入滑動）

**效果**：元素淡入並向上/向下滑動

**適用**：幾乎所有內容進場

**實作思路**：
```tsx
const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
const translateY = interpolate(frame, [0, 15], [30, 0], {
  extrapolateRight: "clamp",
  easing: Easing.out(Easing.poly(4)),
});

<div style={{ opacity, transform: `translateY(${translateY}px)` }}>
  內容
</div>
```

**參考**：`AgentSkillPromo/Stage1Hook.tsx`

---

### Spring Pop（彈出）

**效果**：元素從小到大彈出，帶有 overshoot

**適用**：按鈕、重點元素、驚喜元素

**實作思路**：
```tsx
const scale = spring({
  frame,
  fps,
  config: { damping: 10, stiffness: 150 },
});

<div style={{ transform: `scale(${scale})` }}>
  🎉
</div>
```

---

### Staggered Enter（交錯進場）

**效果**：多個元素依序進場

**適用**：列表、卡片組、步驟說明

**實作思路**：
```tsx
const STAGGER_DELAY = 5;

{items.map((item, i) => {
  const progress = spring({
    frame: frame - i * STAGGER_DELAY,
    fps,
    config: { damping: 200 },
  });
  
  return (
    <div style={{ opacity: progress, transform: `translateX(${(1 - progress) * 50}px)` }}>
      {item}
    </div>
  );
})}
```

**參考**：`GPTTypeless/ProblemTimeline.tsx`

---

## 圖形動畫

### Line Draw（線條繪製）

**效果**：線條沿著路徑「生長」

**適用**：流程圖連線、地圖軌跡、簽名

**實作思路**：
```tsx
import { evolvePath } from "@remotion/paths";

const path = "M 0 0 L 100 50 L 200 0";
const progress = interpolate(frame, [0, 60], [0, 1]);
const { strokeDasharray, strokeDashoffset } = evolvePath(progress, path);

<svg>
  <path
    d={path}
    stroke="#6366f1"
    strokeWidth={3}
    fill="none"
    strokeDasharray={strokeDasharray}
    strokeDashoffset={strokeDashoffset}
  />
</svg>
```

---

### Node Connection（節點連線）

**效果**：節點出現，然後連線連接它們

**適用**：架構圖、流程圖、關係圖

**實作思路**：
1. 節點先 spring 彈出
2. 連線 line draw 連接
3. 可加箭頭跟隨線條末端

**參考**：`YJPayBugDesc/IronTriangle.tsx`

---

### Circle Progress（圓形進度）

**效果**：圓形進度條從 0 到目標值

**適用**：比例展示、完成度、技能圖表

**實作思路**：
```tsx
const radius = 50;
const circumference = 2 * Math.PI * radius;
const progress = interpolate(frame, [0, 60], [0, 0.75]);  // 75%

<svg>
  <circle
    cx={60}
    cy={60}
    r={radius}
    fill="none"
    stroke="#6366f1"
    strokeWidth={10}
    strokeDasharray={circumference}
    strokeDashoffset={circumference * (1 - progress)}
    transform="rotate(-90 60 60)"  // 從 12 點鐘方向開始
  />
</svg>
```

---

### Bar Growth（長條生長）

**效果**：長條圖的長條從 0 生長到目標值

**適用**：數據對比、排名展示

**實作思路**：
```tsx
const height = spring({
  frame: frame - index * 5,  // stagger
  fps,
  config: { damping: 200 },
});

<div style={{ height: `${targetHeight * height}px` }} />
```

---

## UI 模擬

### Cursor Movement（游標移動）

**效果**：模擬滑鼠游標移動到特定位置

**適用**：操作教學、功能 Demo

**實作思路**：
```tsx
const progress = spring({
  frame,
  fps,
  config: { damping: 15, stiffness: 80 },
});

const x = interpolate(progress, [0, 1], [startX, endX]);
const y = interpolate(progress, [0, 1], [startY, endY]);

// 使用貝茲曲線讓路徑更自然
// 可以加入微小的抖動模擬真實手感

<div style={{ position: "absolute", left: x, top: y }}>
  <CursorIcon />
</div>
```

---

### Click Effect（點擊效果）

**效果**：游標點擊時的視覺回饋

**適用**：操作演示

**實作思路**：
```tsx
// 游標縮小 + 按鈕縮小
const clickProgress = spring({
  frame: frame - clickFrame,
  fps,
  config: { damping: 20, stiffness: 300 },
});

const cursorScale = interpolate(clickProgress, [0, 0.5, 1], [1, 0.9, 1]);
const buttonScale = interpolate(clickProgress, [0, 0.5, 1], [1, 0.95, 1]);
```

---

### Window Open（視窗開啟）

**效果**：模擬應用程式視窗開啟

**適用**：軟體 Demo、功能展示

**實作思路**：
```tsx
const scale = spring({
  frame,
  fps,
  config: { damping: 15, stiffness: 150 },
});
const opacity = interpolate(frame, [0, 10], [0, 1]);

<div style={{
  transform: `scale(${scale * 0.2 + 0.8})`,  // 從 0.8 到 1
  opacity,
  boxShadow: `0 ${20 * scale}px ${40 * scale}px rgba(0,0,0,0.2)`,
}}>
  視窗內容
</div>
```

---

## 轉場效果

### Fade（淡入淡出）

最基本的轉場，適合大部分情況。

```tsx
import { fade } from "@remotion/transitions/fade";

<TransitionSeries.Transition
  presentation={fade()}
  timing={linearTiming({ durationInFrames: 15 })}
/>
```

---

### Slide（滑動）

新場景從一側滑入。

```tsx
import { slide } from "@remotion/transitions/slide";

<TransitionSeries.Transition
  presentation={slide({ direction: "from-right" })}
  timing={linearTiming({ durationInFrames: 20 })}
/>
```

---

### Wipe（擦除）

像擦拭一樣顯示新場景。

```tsx
import { wipe } from "@remotion/transitions/wipe";

<TransitionSeries.Transition
  presentation={wipe({ direction: "from-left" })}
  timing={linearTiming({ durationInFrames: 20 })}
/>
```

---

### Blur + Fade（模糊淡出）

離場時帶有模糊效果，更有「消失」感。

```tsx
const fadeOut = interpolate(frame, [90, 120], [1, 0]);
const blur = interpolate(frame, [90, 120], [0, 10]);

<div style={{ opacity: fadeOut, filter: `blur(${blur}px)` }}>
  內容
</div>
```

**參考**：`AgentSkillPromo/Stage1Hook.tsx`

---

## 強調效果

### Glow Pulse（發光脈動）

**效果**：元素持續發出柔和的光暈

**適用**：CTA 按鈕、重要提示

**實作思路**：
```tsx
const pulse = Math.sin(frame * 0.15) * 0.5 + 0.5;  // 0-1 循環
const glowSize = interpolate(pulse, [0, 1], [5, 20]);

<button style={{
  boxShadow: `0 0 ${glowSize}px #6366f1`,
}}>
  立即購買
</button>
```

---

### Scale Pulse（縮放脈動）

**效果**：元素輕微縮放，吸引注意

**適用**：重要數字、新功能標記

**實作思路**：
```tsx
const pulse = Math.sin(frame * 0.1) * 0.03 + 1;  // 0.97-1.03

<span style={{ transform: `scale(${pulse})` }}>
  NEW
</span>
```

---

### Color Flash（顏色閃爍）

**效果**：元素顏色在兩色之間交替

**適用**：警告、限時提示

**實作思路**：
```tsx
const flash = Math.floor(frame / 15) % 2;  // 每 15 幀切換
const color = flash ? "#FF0000" : "#FFFFFF";

<span style={{ color }}>⚠️ 限時優惠</span>
```

---

## 視覺化效果

### Data Morph（數據變形）

**效果**：圖表從一種形態平滑過渡到另一種

**適用**：數據變化展示、趨勢對比

---

### Particle System（粒子系統）

**效果**：大量小元素形成的動態效果

**適用**：慶祝、科技感、背景氛圍

**建議**：使用 Canvas 實現以獲得更好效能

---

### Parallax（視差）

**效果**：不同層次以不同速度移動

**適用**：背景、深度感、場景介紹

**實作思路**：
```tsx
const bg = frame * 0.5;   // 背景移動慢
const mid = frame * 1;    // 中景正常
const fg = frame * 1.5;   // 前景移動快

<div style={{ transform: `translateX(${bg}px)` }}>背景</div>
<div style={{ transform: `translateX(${mid}px)` }}>中景</div>
<div style={{ transform: `translateX(${fg}px)` }}>前景</div>
```

---

## 效果選擇指南

| 目的 | 推薦效果 |
|------|----------|
| 標題進場 | Fade + Slide / Text Reveal |
| 數據強調 | Counter + Scale Pulse |
| 功能演示 | Cursor Movement + Click Effect |
| 列表展示 | Staggered Enter |
| 流程說明 | Node Connection + Line Draw |
| CTA 吸引 | Glow Pulse |
| 場景切換 | Fade / Blur + Fade |
| 背景氛圍 | Parallax / Particle System |

---

## 組合技巧

### 進場三件套

```
Fade + Slide + Scale
```

同時進行：淡入 + 向上滑動 + 從 95% 放大到 100%

### Hook 組合

```
Counter + Stagger + Scale Pulse
```

數字滾動 → 後續元素交錯進場 → 關鍵數字脈動

### 轉場組合

```
Blur + Fade Out (舊場景) → Fade In + Slide (新場景)
```

舊場景模糊淡出，新場景滑入淡入
