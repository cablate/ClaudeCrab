# 生態系整合指南

Remotion 的強大在於它可以整合整個前端生態系。本文檔說明如何將各種套件與 Remotion 結合使用。

---

## 通用原則

### 1. 禁用套件內建動畫

所有套件的內建動畫都會造成渲染問題，必須禁用：

```tsx
// ❌ 錯誤：使用套件內建動畫
<SomeLibraryComponent animated={true} />

// ✅ 正確：禁用內建動畫，用 Remotion 驅動
<SomeLibraryComponent animated={false} progress={myProgress} />
```

### 2. 用 useCurrentFrame 驅動一切

```tsx
const frame = useCurrentFrame();
const { fps } = useVideoConfig();

// 將 frame 轉換為套件需要的 progress (0-1)
const progress = interpolate(frame, [0, 60], [0, 1], {
  extrapolateRight: "clamp",
});
```

### 3. 資料計算 vs 渲染分離

許多套件同時負責「計算」和「渲染」，在 Remotion 中應該：
- 用套件做**計算**（數學、路徑、佈局）
- 用 React 做**渲染**（帶上 Remotion 動畫）

---

## D3.js 整合

### 安裝

```bash
npm install d3
```

### 核心思想

D3 在 Remotion 中只用於**數學計算**，不用於 DOM 操作：

```tsx
// ❌ 錯誤：讓 D3 操作 DOM
d3.select("svg").append("rect")...

// ✅ 正確：用 D3 計算，用 React 渲染
const xScale = d3.scaleLinear().domain([0, 100]).range([0, width]);
<rect x={xScale(value)} ... />
```

### 長條圖

```tsx
import * as d3 from "d3";

const BarChart: React.FC<{ data: number[] }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const maxValue = Math.max(...data);
  const yScale = d3.scaleLinear().domain([0, maxValue]).range([0, 300]);
  
  return (
    <svg width={500} height={400}>
      {data.map((value, i) => {
        const height = spring({
          frame: frame - i * 5,  // stagger
          fps,
          config: { damping: 200 },
        });
        
        return (
          <rect
            key={i}
            x={i * 60 + 50}
            y={400 - yScale(value) * height}
            width={40}
            height={yScale(value) * height}
            fill="#6366f1"
          />
        );
      })}
    </svg>
  );
};
```

### Bar Chart Race

```tsx
// 每幀根據數據排序，計算位置過渡
const BarChartRace: React.FC = () => {
  const frame = useCurrentFrame();
  
  // 假設 getDataAtFrame 返回該時間點的數據
  const currentData = getDataAtFrame(frame);
  const sorted = [...currentData].sort((a, b) => b.value - a.value);
  
  return (
    <div>
      {sorted.map((item, newIndex) => {
        // 計算從舊位置到新位置的動畫
        const targetY = newIndex * 50;
        
        return (
          <div
            key={item.id}
            style={{
              position: "absolute",
              top: targetY,  // 實際應用中要用 spring 過渡
              width: item.value * 5,
              transition: "none",  // 禁用 CSS transition
            }}
          >
            {item.name}: {item.value}
          </div>
        );
      })}
    </div>
  );
};
```

### 地圖 + 路徑

```tsx
import * as d3 from "d3";
import { evolvePath } from "@remotion/paths";

const MapWithPath: React.FC = () => {
  const frame = useCurrentFrame();
  
  // 使用 D3 的地理投影
  const projection = d3.geoMercator()
    .center([121.5, 25.0])  // 台北
    .scale(50000);
  
  // 路徑點
  const points = [
    [121.5, 25.0],
    [121.6, 25.1],
    [121.7, 25.05],
  ];
  
  // 轉換為 SVG path
  const pathData = points
    .map((p, i) => {
      const [x, y] = projection(p) || [0, 0];
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  
  const progress = interpolate(frame, [0, 90], [0, 1], {
    extrapolateRight: "clamp",
  });
  
  const { strokeDasharray, strokeDashoffset } = evolvePath(progress, pathData);
  
  return (
    <svg>
      <path
        d={pathData}
        fill="none"
        stroke="#FF3232"
        strokeWidth={3}
        strokeDasharray={strokeDasharray}
        strokeDashoffset={strokeDashoffset}
      />
    </svg>
  );
};
```

### 官方範例

- GitHub: https://github.com/remotion-dev/d3-example

---

## Three.js / React Three Fiber 整合

### 安裝

```bash
npx remotion add @remotion/three
npm install three @react-three/fiber @react-three/drei
```

### 基本用法

```tsx
import { ThreeCanvas } from "@remotion/three";
import { useVideoConfig, useCurrentFrame } from "remotion";

const My3DScene: React.FC = () => {
  const { width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  
  const rotationY = frame * 0.02;
  
  return (
    <ThreeCanvas width={width} height={height}>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <mesh rotation={[0, rotationY, 0]}>
        <boxGeometry args={[2, 2, 2]} />
        <meshStandardMaterial color="#4a9eff" />
      </mesh>
    </ThreeCanvas>
  );
};
```

### 重要限制

1. **禁止使用 useFrame**
   ```tsx
   // ❌ R3F 的 useFrame 會造成渲染問題
   useFrame(() => { ... });
   
   // ✅ 用 Remotion 的 useCurrentFrame
   const frame = useCurrentFrame();
   ```

2. **Sequence 需要 layout="none"**
   ```tsx
   <ThreeCanvas>
     <Sequence layout="none">  {/* 必須加 layout="none" */}
       <MyMesh />
     </Sequence>
   </ThreeCanvas>
   ```

### 載入 3D 模型

```tsx
import { useGLTF } from "@react-three/drei";

const Model: React.FC = () => {
  const { scene } = useGLTF("/model.glb");
  const frame = useCurrentFrame();
  
  return (
    <primitive
      object={scene}
      rotation={[0, frame * 0.01, 0]}
      scale={1}
    />
  );
};
```

### 影片作為 3D 貼圖

```tsx
import { useVideoTexture } from "@remotion/three";

const VideoOnBox: React.FC = () => {
  const videoTexture = useVideoTexture(staticFile("video.mp4"));
  
  return (
    <mesh>
      <boxGeometry args={[4, 3, 0.1]} />
      <meshBasicMaterial map={videoTexture} />
    </mesh>
  );
};
```

### 官方模板

- GitHub: https://github.com/remotion-dev/template-three

---

## Lottie 整合

### 安裝

```bash
npx remotion add @remotion/lottie
npm install lottie-web
```

### 基本用法

```tsx
import { Lottie, LottieAnimationData } from "@remotion/lottie";
import { useState, useEffect } from "react";
import { delayRender, continueRender, cancelRender } from "remotion";

const MyLottie: React.FC = () => {
  const [handle] = useState(() => delayRender("Loading Lottie"));
  const [animationData, setAnimationData] = useState<LottieAnimationData | null>(null);
  
  useEffect(() => {
    fetch(staticFile("animation.json"))
      .then((res) => res.json())
      .then((json) => {
        setAnimationData(json);
        continueRender(handle);
      })
      .catch((err) => cancelRender(err));
  }, [handle]);
  
  if (!animationData) return null;
  
  return <Lottie animationData={animationData} />;
};
```

### 控制播放進度

Lottie 會自動與 Remotion 時間軸同步。可以調整：

```tsx
<Lottie
  animationData={animationData}
  direction={1}      // 1=正向, -1=反向
  loop={false}       // 是否循環
  playbackRate={1.5} // 播放速度
/>
```

### 注意事項

- 某些 Lottie 表達式可能不支援，會造成閃爍
- 建議測試後再使用
- LottieFiles.com 可以找到大量免費動畫

---

## GSAP 整合

### 安裝

```bash
npm install gsap
```

### 核心思想

GSAP 在 Remotion 中的用法與傳統不同。不使用 GSAP 的 tween 功能，而是用它的**數學計算**和**時間軸編排**：

```tsx
// ❌ 錯誤：讓 GSAP 控制動畫
gsap.to(element, { x: 100, duration: 1 });

// ✅ 正確：用 GSAP 計算，用 Remotion 渲染
// 實際上，大部分情況下直接用 Remotion 的 interpolate 即可
```

### 複雜時間軸（概念）

GSAP 主要用於**設計階段**規劃複雜的時間軸邏輯，實際實作時轉換為 Remotion 的 Sequence：

```tsx
// GSAP Timeline 概念（設計階段）
// tl.add(logoFadeIn, 0)
// tl.add(textSlideIn, 0.5)
// tl.add(buttonAppear, 1)

// 轉換為 Remotion（實作階段）
<Sequence from={0} durationInFrames={30}>
  <LogoFadeIn />
</Sequence>
<Sequence from={15} durationInFrames={45}>
  <TextSlideIn />
</Sequence>
<Sequence from={30} durationInFrames={30}>
  <ButtonAppear />
</Sequence>
```

### 結論

在 Remotion 中，GSAP 的大部分功能都可以用原生 API 取代。除非有非常複雜的時間軸需求，否則建議直接使用 Remotion 的 `interpolate`、`spring` 和 `Sequence`。

---

## Canvas 2D 整合

### 基本用法

```tsx
import { useCurrentFrame } from "remotion";
import { useRef, useEffect } from "react";

const CanvasAnimation: React.FC = () => {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // 清除畫布
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 根據 frame 繪製
    const x = frame * 2;
    ctx.fillStyle = "#6366f1";
    ctx.beginPath();
    ctx.arc(x, 100, 20, 0, Math.PI * 2);
    ctx.fill();
  }, [frame]);
  
  return <canvas ref={canvasRef} width={1920} height={1080} />;
};
```

### 適用場景

- 粒子系統
- 自定義圖表
- 像素級控制
- 需要高效能的大量元素

### 注意事項

- 每幀都要重新繪製整個畫布
- 使用 `useEffect` 確保在 frame 變化時更新

---

## Rive 整合

### 安裝

```bash
npx remotion add @remotion/rive
```

### 與 Lottie 的差異

| 特性 | Lottie | Rive |
|------|--------|------|
| 來源 | After Effects 匯出 | Rive 專用編輯器 |
| 互動性 | 無 | 支援狀態機、輸入參數 |
| 多畫板 | 不支援 | 支援 |
| 檔案格式 | JSON | .riv |
| 複雜度 | 簡單 | 功能更強大 |

### 基本用法

```tsx
import { RemotionRiveCanvas } from "@remotion/rive";

const MyRive: React.FC = () => {
  return (
    <RemotionRiveCanvas
      src={staticFile("animation.riv")}
      artboard="Main"  // 如果有多個畫板
    />
  );
};
```

### 控制狀態機

```tsx
<RemotionRiveCanvas
  src={staticFile("interactive.riv")}
  stateMachines={["StateMachine1"]}
  // Rive 動畫會自動與 Remotion 時間軸同步
/>
```

### 適用場景

- 需要互動式動畫的影片
- 複雜的角色動畫
- 需要多個狀態切換的 UI 動畫

---

## React Native Skia 整合

### 安裝

```bash
npx remotion add @remotion/skia
npm install @shopify/react-native-skia
```

### 核心用法

```tsx
import { SkiaCanvas } from "@remotion/skia";
import { Circle, Group } from "@shopify/react-native-skia";

const SkiaAnimation: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SkiaCanvas height={1080} width={1920}>
      <Group transform={[{ translateX: frame * 2 }]}>
        <Circle cx={100} cy={100} r={50} color="#6366f1" />
      </Group>
    </SkiaCanvas>
  );
};
```

### 適用場景

- 高效能 2D 圖形
- 複雜的漸層、陰影、模糊效果
- 跨平台動畫（可與 React Native 共用）

---

## GIF 整合

### 安裝

```bash
npx remotion add @remotion/gif
```

### 基本用法

```tsx
import { Gif } from "@remotion/gif";

const MyGif: React.FC = () => {
  return (
    <Gif
      src={staticFile("animation.gif")}
      width={300}
      height={200}
      fit="contain"
    />
  );
};
```

### 注意事項

- GIF 會自動與 Remotion 時間軸同步
- 支援 `playbackRate` 調整速度
- 適合嵌入小型動畫元素

---

## Anime.js 整合（進階）

### 安裝

```bash
npm install animejs
```

### 為何考慮 Anime.js

Remotion 原生 API 足以應付大多數情況，但 Anime.js 在以下場景有優勢：

- 複雜的交錯動畫（stagger）
- 基於 CSS selector 的批量動畫
- 需要精細控制大量元素時

### 整合方式（概念）

```tsx
import anime from "animejs";
import { useCurrentFrame } from "remotion";
import { useEffect, useRef } from "react";

const AnimeIntegration: React.FC = () => {
  const frame = useCurrentFrame();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 創建 timeline，但不讓它自動播放
    const tl = anime.timeline({
      autoplay: false,
      easing: "easeOutExpo",
    });

    tl.add({
      targets: ".box",
      translateX: 250,
      duration: 1000,
    });

    // 根據 Remotion frame 設定 timeline 進度
    // 假設 30fps，frame 0-30 對應 0-1000ms
    tl.seek(frame * (1000 / 30));
  }, [frame]);

  return (
    <div ref={containerRef}>
      <div className="box" />
    </div>
  );
};
```

### 注意

- 這不是官方支援的整合方式
- 需要小心處理 DOM 同步問題
- 大多數情況下 Remotion 原生 API 更可靠

---

## Motion Canvas 比較

Motion Canvas 是另一個程式化影片製作工具，與 Remotion 的差異：

| 特性 | Remotion | Motion Canvas |
|------|----------|---------------|
| 語言 | TypeScript + React | TypeScript（自有語法） |
| 生態系 | 整個 React 生態 | 專屬套件 |
| 學習曲線 | React 開發者友善 | 需學習新語法 |
| 即時預覽 | 支援 | 支援 |
| 商業授權 | 需付費 | 開源 |

如果團隊已熟悉 React，選擇 Remotion。

---

## 不相容的套件

以下套件與 Remotion 不直接相容：

| 套件 | 原因 | 替代方案 |
|------|------|----------|
| Framer Motion | 依賴瀏覽器動畫 API | Remotion 原生 spring |
| react-spring | 依賴 requestAnimationFrame | Remotion 原生 spring |
| Reanimated | React Native 專用 | @remotion/skia |
| Matter.js | 物理引擎需「烘焙」 | 預計算物理後手動處理 |

### 物理引擎處理方式

如需物理模擬，可以：

1. 預先運行物理模擬
2. 將每幀結果儲存為數據
3. 在 Remotion 中讀取數據渲染

```tsx
// 預計算的物理數據
const physicsData = [
  { frame: 0, x: 0, y: 0 },
  { frame: 1, x: 2, y: 1 },
  { frame: 2, x: 5, y: 4 },
  // ...
];

const PhysicsObject: React.FC = () => {
  const frame = useCurrentFrame();
  const data = physicsData[frame] || physicsData[physicsData.length - 1];

  return (
    <div style={{ transform: `translate(${data.x}px, ${data.y}px)` }}>
      🔵
    </div>
  );
};
```

---

## 選擇指南

| 需求 | 推薦方案 |
|------|----------|
| 基本動畫 | Remotion 原生 (interpolate, spring) |
| 資料視覺化 | D3.js（計算）+ SVG/Canvas（渲染） |
| 3D 場景 | @remotion/three + React Three Fiber |
| AE 設計師動畫 | @remotion/lottie |
| Rive 設計師動畫 | @remotion/rive |
| 路徑動畫 | @remotion/paths |
| 高效能 2D | @remotion/skia |
| 複雜粒子/像素 | Canvas 2D |
| 地圖 | D3-geo 或 @remotion/maps |
| 轉場效果 | @remotion/transitions |
| 嵌入 GIF | @remotion/gif |
| 複雜交錯動畫 | Anime.js（進階，非官方） |

---

## 效能考量

### 套件大小

| 套件 | 大小 | 影響 |
|------|------|------|
| D3.js (全部) | ~250KB | 建議只 import 需要的模組 |
| Three.js | ~600KB | 3D 必需，無法縮小 |
| Lottie | ~300KB | 有 light 版本 |
| GSAP | ~60KB | 相對輕量 |

### 建議

1. **按需 import D3 模組**
   ```tsx
   // ❌ 全部 import
   import * as d3 from "d3";
   
   // ✅ 只 import 需要的
   import { scaleLinear } from "d3-scale";
   import { line } from "d3-shape";
   ```

2. **3D 場景盡量簡化**
   - 減少多邊形數量
   - 使用 LOD（Level of Detail）
   - 避免過多光源

3. **Lottie 檔案優化**
   - 使用 LottieFiles 的優化器
   - 移除不需要的圖層
