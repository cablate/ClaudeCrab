# Remotion 核心模式

## 基礎原則

### 1. 一切由 Frame 驅動

```tsx
// ✅ 正確：使用 useCurrentFrame 驅動動畫
const frame = useCurrentFrame();
const opacity = interpolate(frame, [0, 30], [0, 1]);

// ❌ 錯誤：使用 CSS 動畫或 transition
// CSS animations/transitions 在渲染時無法保證幀準確性
```

### 2. 用秒數思考，用幀數實作

```tsx
const { fps } = useVideoConfig();

// 「1 秒後開始，持續 2 秒」
const startFrame = 1 * fps;  // 30 幀
const duration = 2 * fps;     // 60 幀

<Sequence from={startFrame} durationInFrames={duration}>
  <MyComponent />
</Sequence>
```

### 3. 禁止事項

| 禁止 | 原因 | 替代方案 |
|------|------|----------|
| CSS `transition` | 渲染不同步 | `interpolate` |
| CSS `animation` | 渲染不同步 | `interpolate` + `spring` |
| Tailwind 動畫類 | 渲染不同步 | 手動計算樣式 |
| `setTimeout/setInterval` | 無法控制幀 | `Sequence` + `from` |
| `useFrame` (R3F) | 與 Remotion 衝突 | `useCurrentFrame` |

---

## 數值變化：interpolate

### 基本用法

```tsx
import { interpolate } from "remotion";

// frame 從 0 到 30 時，opacity 從 0 到 1
const opacity = interpolate(frame, [0, 30], [0, 1]);
```

### Clamp 防止溢出

```tsx
const opacity = interpolate(frame, [0, 30], [0, 1], {
  extrapolateLeft: "clamp",   // frame < 0 時，返回 0
  extrapolateRight: "clamp",  // frame > 30 時，返回 1
});
```

### 多段映射

```tsx
// frame 0-30: 0→1, frame 30-60: 1→1, frame 60-90: 1→0
const opacity = interpolate(frame, [0, 30, 60, 90], [0, 1, 1, 0], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
```

### Easing 曲線

```tsx
import { Easing } from "remotion";

// 常用曲線
const smooth = interpolate(frame, [0, 30], [0, 1], {
  easing: Easing.out(Easing.quad),  // 快進慢出
});

const energetic = interpolate(frame, [0, 30], [0, 1], {
  easing: Easing.out(Easing.back(1.7)),  // 過沖回彈
});

// 自訂貝茲曲線
const custom = interpolate(frame, [0, 30], [0, 1], {
  easing: Easing.bezier(0.8, 0.22, 0.96, 0.65),
});
```

---

## 物理動畫：spring

### 基本用法

```tsx
import { spring } from "remotion";

const scale = spring({
  frame,
  fps,
  // 0 → 1，帶有自然回彈
});
```

### 常用配置

```tsx
// 平滑無彈跳（適合：淡入、滑動）
const smooth = spring({
  frame,
  fps,
  config: { damping: 200 },
});

// 輕微彈跳（適合：UI 元素進場）
const snappy = spring({
  frame,
  fps,
  config: { damping: 20, stiffness: 200 },
});

// 明顯彈跳（適合：活潑、俏皮）
const bouncy = spring({
  frame,
  fps,
  config: { damping: 8 },
});

// 厚重感（適合：大型元素）
const heavy = spring({
  frame,
  fps,
  config: { damping: 15, stiffness: 80, mass: 2 },
});
```

### 延遲啟動

```tsx
const delayed = spring({
  frame: frame - 30,  // 延遲 30 幀
  fps,
  config: { damping: 200 },
});
```

### 指定持續時間

```tsx
const fixed = spring({
  frame,
  fps,
  durationInFrames: 60,  // 強制 2 秒（30fps）
});
```

### 結合 interpolate

```tsx
const progress = spring({ frame, fps });

// 將 0-1 映射到其他範圍
const rotation = interpolate(progress, [0, 1], [0, 360]);
const translateX = interpolate(progress, [0, 1], [-100, 0]);
```

### 進出動畫

```tsx
const { durationInFrames } = useVideoConfig();

const inAnimation = spring({ frame, fps });
const outAnimation = spring({
  frame,
  fps,
  delay: durationInFrames - 30,  // 結束前 30 幀開始
});

const scale = inAnimation - outAnimation;  // 進來然後出去
```

---

## 時間軸：Sequence

### 基本用法

```tsx
import { Sequence } from "remotion";

<Sequence from={0} durationInFrames={60}>
  <Intro />
</Sequence>
<Sequence from={60} durationInFrames={120}>
  <MainContent />
</Sequence>
```

### 局部時間

```tsx
// 重要：Sequence 內部的 useCurrentFrame() 從 0 開始
<Sequence from={60} durationInFrames={30}>
  <MyComponent />
  {/* 內部 frame 是 0-29，不是 60-89 */}
</Sequence>
```

### Premounting（預載入）

```tsx
// 始終加上 premountFor，避免載入延遲
<Sequence from={60} durationInFrames={90} premountFor={30}>
  <HeavyComponent />
</Sequence>
```

### 嵌套 Sequence

```tsx
<Sequence from={0} durationInFrames={120}>
  <Background />
  <Sequence from={15} durationInFrames={90} layout="none">
    <Title />
  </Sequence>
  <Sequence from={45} durationInFrames={60} layout="none">
    <Subtitle />
  </Sequence>
</Sequence>
```

### Series（連續播放）

```tsx
import { Series } from "remotion";

<Series>
  <Series.Sequence durationInFrames={45}>
    <Intro />
  </Series.Sequence>
  <Series.Sequence durationInFrames={60}>
    <MainContent />
  </Series.Sequence>
  <Series.Sequence durationInFrames={30}>
    <Outro />
  </Series.Sequence>
</Series>
```

---

## 轉場：TransitionSeries

### 安裝

```bash
npx remotion add @remotion/transitions
```

### 基本轉場

```tsx
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={fade()}
    timing={linearTiming({ durationInFrames: 15 })}
  />
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneB />
  </TransitionSeries.Sequence>
</TransitionSeries>
```

### 可用轉場

```tsx
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { flip } from "@remotion/transitions/flip";
import { clockWipe } from "@remotion/transitions/clock-wipe";

// slide 方向
slide({ direction: "from-left" })  // from-right, from-top, from-bottom
```

### 時長計算

轉場會縮短總時長：
```
兩個 60 幀場景 + 15 幀轉場 = 105 幀（不是 120 幀）
```

---

## 路徑動畫：@remotion/paths

### 安裝

```bash
npx remotion add @remotion/paths
```

### 線條生長

```tsx
import { evolvePath } from "@remotion/paths";

const path = "M 100 200 L 200 150 L 300 180";
const progress = interpolate(frame, [0, 60], [0, 1], {
  extrapolateRight: "clamp",
});

const { strokeDasharray, strokeDashoffset } = evolvePath(progress, path);

<svg>
  <path
    d={path}
    fill="none"
    stroke="#FF3232"
    strokeWidth={4}
    strokeDasharray={strokeDasharray}
    strokeDashoffset={strokeDashoffset}
  />
</svg>
```

### 沿路徑移動物件

```tsx
import { getLength, getPointAtLength, getTangentAtLength } from "@remotion/paths";

const pathLength = getLength(path);
const point = getPointAtLength(path, progress * pathLength);
const tangent = getTangentAtLength(path, progress * pathLength);
const angle = Math.atan2(tangent.y, tangent.x);

<g style={{
  transform: `translate(${point.x}px, ${point.y}px) rotate(${angle}rad)`,
}}>
  <polygon points="0,0 -20,-10 -20,10" fill="#FF3232" />
</g>
```

---

## 常用模式

### Counter 動畫

```tsx
const counterRaw = interpolate(frame, [0, 60], [0, 100], {
  extrapolateRight: "clamp",
  easing: Easing.out(Easing.cubic),
});
const counterValue = Math.round(counterRaw);

<span>{counterValue}</span>
```

### Staggered 進場

```tsx
const STAGGER_DELAY = 5;

const items = data.map((item, i) => {
  const progress = spring({
    frame: frame - i * STAGGER_DELAY,
    fps,
    config: { damping: 200 },
  });
  
  return (
    <div style={{ 
      opacity: progress,
      transform: `translateY(${interpolate(progress, [0, 1], [20, 0])}px)`,
    }}>
      {item.text}
    </div>
  );
});
```

### FadeIn + SlideUp

```tsx
const opacity = interpolate(frame, [0, 15], [0, 1], {
  extrapolateRight: "clamp",
});
const translateY = interpolate(frame, [0, 15], [20, 0], {
  extrapolateRight: "clamp",
  easing: Easing.out(Easing.poly(4)),
});

<div style={{ opacity, transform: `translateY(${translateY}px)` }}>
  Content
</div>
```

### FadeOut + Blur

```tsx
const fadeOut = interpolate(frame, [90, 120], [1, 0], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
const blur = interpolate(frame, [90, 120], [0, 10], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});

<div style={{ opacity: fadeOut, filter: `blur(${blur}px)` }}>
  Content
</div>
```

### Glow Pulse

```tsx
const pulse = Math.sin(frame * 0.1) * 0.5 + 0.5;  // 0-1 循環
const glowSize = interpolate(pulse, [0, 1], [5, 15]);

<button style={{
  boxShadow: `0 0 ${glowSize}px #6366f1`,
}}>
  CTA
</button>
```

---

## 效能考量

### 避免重複計算

```tsx
// ❌ 每次渲染都建立新物件
const style = { transform: `translateX(${x}px)` };

// ✅ 使用 useMemo 或直接內聯
<div style={{ transform: `translateX(${x}px)` }} />
```

### 延遲渲染

```tsx
import { delayRender, continueRender } from "remotion";

const [handle] = useState(() => delayRender("Loading..."));

useEffect(() => {
  loadAsset().then(() => continueRender(handle));
}, []);
```

### 使用 OffthreadVideo

```tsx
// 比 <Video> 更高效，推薦用於嵌入影片
import { OffthreadVideo } from "remotion";

<OffthreadVideo src={staticFile("video.mp4")} />
```
