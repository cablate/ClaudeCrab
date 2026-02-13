# 視覺/互動設計研究

> 建立時間：2026-02-14
> 目的：蒐集 RPG、Galgame、辦公室模擬遊戲的 UI/UX 設計手法，應用於 Live 頁面優化

---

## RPG 遊戲 UI Pattern

### Party Roster（隊伍列表）

**核心元素**（已在 ClaudeCab 實現）：

- ✅ 角色頭像（圓形）
- ✅ 名字 + 職業 icon
- ✅ 狀態顯示（phase label）
- ✅ 心情 emoji

**可擴展元素**：

| 元素 | RPG 常見做法 | ClaudeCab 可應用 |
|------|--------------|------------------|
| **HP/MP Bar** | 血量、魔力條 | → **Energy Bar**（工作能量條，tired mood 時降低） |
| **Buff/Debuff Icons** | 增益/減益狀態 | → **Status Effects**（專注中、疲勞中、合作中） |
| **Level/XP** | 等級、經驗值 | → **Proficiency Level**（技能熟練度，完成任務累積 XP） |
| **裝備欄** | 武器、防具 | → **Tools Equipped**（當前使用的工具、Skill） |

**參考資源**：

- [RPG Game UI - CraftPix.net](https://craftpix.net/categorys/rpg-game-ui/)
- [Game UI Database - Inventory](https://www.gameuidatabase.com/index.php?scrn=71)
- [UX and UI in game design: HUD, inventory, and menus](https://medium.com/@brdelfino.work/ux-and-ui-in-game-design-exploring-hud-inventory-and-menus-5d8c189deb65)

### 血條/狀態面板設計原則

**關鍵設計洞察**（來自 RPG UI 最佳實踐）：

1. **直觀的顏色編碼**：
   - 綠色 = 健康/正常
   - 黃色 = 警告
   - 紅色 = 危險/錯誤
   - 藍色 = 魔力/專注

2. **動畫反饋**：
   - 血量下降時：紅色閃爍 + 震動
   - 血量恢復時：綠色光暈
   - 獲得 buff：向上飄浮的 icon + 粒子效果

3. **資訊層次**：
   - 最重要：當前值（大字體）
   - 次要：最大值、百分比（小字體）
   - 輔助：趨勢箭頭（↑ 恢復中 / ↓ 下降中）

**應用於 ClaudeCab**：

```css
/* Energy Bar 範例 */
.agent-energy-bar {
  height: 4px;
  background: linear-gradient(90deg, 
    var(--agent-color) 0%, 
    var(--agent-color) var(--energy-percent), 
    rgba(255,255,255,0.1) var(--energy-percent)
  );
  transition: all 0.3s ease;
}

/* Tired mood 時的警示色 */
.agent-energy-bar[data-mood="tired"] {
  background: linear-gradient(90deg, #ef4444 0%, #ef4444 var(--energy-percent), rgba(255,255,255,0.1) var(--energy-percent));
  animation: pulse-warning 2s infinite;
}
```

### 技能樹 UI

**設計原則**（來自 Game UI Database）：

- **節點狀態清晰**：locked（灰色） / unlockable（亮邊框） / unlocked（彩色） / active（發光）
- **路徑連線**：顯示技能之間的前置關係
- **Tooltip 說明**：Hover 時顯示技能描述、解鎖條件

**應用於 ClaudeCab**：

- **Skill Progress Tree**：
  - 每個 agent 有技能樹（研究工具、協作技巧、專業知識）
  - 完成相關任務 → 解鎖新技能
  - 視覺化顯示成長路徑

---

## Galgame UI 設計

### 對話框樣式

**經典 Galgame 對話框特徵**：

1. **半透明背景** + **細邊框** — 不完全遮擋背景角色立繪
2. **角色名字框** — 位於對話框左上角，含 icon 或頭像
3. **Typewriter 效果** — 逐字顯示，營造「對話感」（✅ 已實現）
4. **文字陰影/描邊** — 確保在任何背景下可讀

**參考資源**：

- [Visual Novel UI - concepts by deboraholiveira](https://www.therookies.co/projects/35318)
- [Graphical User Interface - VNDev Wiki](https://vndev.wiki/Graphical_User_Interface)
- [UI Design – An Anatomy Of Visual Novels](https://forums.fuwanovel.moe/blogs/entry/4226-ui-design-%E2%80%93-an-anatomy-of-visual-novels/)

### 選項呈現

**Galgame 選項設計手法**：

| 設計手法 | 效果 | ClaudeCab 應用 |
|----------|------|----------------|
| **懸浮選項卡** | 選項以卡片形式浮現 | → 使用者對 agent 的回應選項（讚美/鼓勵/安慰） |
| **時間限制選擇** | 選項有倒數計時 | → 緊急任務需要快速決策 |
| **選項顏色編碼** | 不同選項有不同色調 | → 情感類選項（藍=理性、紅=情緒、綠=中立） |
| **隱藏選項** | 滿足條件才出現的選項 | → 高好感度才能選的對話 |

### 立繪動態

**Live2D 式動態效果**（不需真 Live2D，純 CSS 可達成）：

1. **呼吸動畫**：
   ```css
   @keyframes breathing {
     0%, 100% { transform: translateY(0); }
     50% { transform: translateY(-2px); }
   }
   .portrait-img {
     animation: breathing 4s ease-in-out infinite;
   }
   ```

2. **眨眼效果**：
   - 用 PNG 序列幀切換（睜眼 → 半閉 → 閉眼 → 半閉 → 睜眼）
   - 隨機間隔 3-6 秒

3. **視線追蹤**（滑鼠跟隨）：
   - 眼睛 sprite 輕微朝滑鼠方向偏移
   - 限制旋轉角度（不超過 ±15°）

4. **情緒微動作**：
   - Happy：輕微彈跳
   - Sad：輕微下沉
   - Angry：輕微震動

**參考資源**：

- [Live2D Cubism — Ren'Py Documentation](https://www.renpy.org/doc/html/live2d.html)
- [Sprite - VNDev Wiki](https://vndev.wiki/Sprite)

### 背景切換

**Galgame 背景設計**：

- **時間變化**：同一場景有早上/中午/黃昏/夜晚版本
- **天氣變化**：晴天/陰天/下雨/下雪
- **氣氛濾鏡**：溫馨場景=暖色調、緊張場景=冷色調、回憶場景=黑白或褐色

**應用於 ClaudeCab**：

```javascript
// 辦公室場景變化
const OFFICE_SCENES = {
  morning: 'office-morning.png',    // 明亮、陽光
  afternoon: 'office-afternoon.png', // 柔和光線
  evening: 'office-evening.png',     // 黃昏、暖燈
  night: 'office-night.png'          // 深藍、桌燈
};

// 根據實際時間切換
const hour = new Date().getHours();
const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 20 ? 'evening' : 'night';
document.querySelector('.office-scene img').src = OFFICE_SCENES[timeOfDay];
```

---

## 辦公室模擬遊戲介面

### Two Point Hospital UI 特色

**關鍵設計洞察**（來自評論）：

- **「Seriously impressive」介面** — 評論者認為 UI 設計「把管理的複雜度都吸收掉了」
- **資訊密度平衡** — 同時顯示大量資訊但不令人壓迫
- **直覺的拖放操作** — 建造、移動、刪除都很流暢

**參考資源**：

- [Two Point Hospital - Wikipedia](https://en.wikipedia.org/wiki/Two_Point_Hospital)

### Game Dev Tycoon / Kairosoft 風格

**核心設計手法**：

1. **數值化一切**：
   - 每個行為都有數字反饋（Fun +5, Creativity +3）
   - 清晰的進度條（專案完成度、員工訓練進度）

2. **浮動 icon 反饋**：
   - 員工工作時有小 icon 飄向統計池（Game Dev Tycoon 特色）
   - 完成任務時跳出 +XP 數字

3. **時間流逝可視化**：
   - 時間條滾動（週/月/年）
   - 重要事件在時間軸上標記

**應用於 ClaudeCab**：

```javascript
// 浮動 icon 反饋
function showFloatingIcon(agentId, iconType, value) {
  const sprite = document.querySelector(`#sprite-${agentId}`);
  const icon = document.createElement('div');
  icon.className = 'floating-icon';
  icon.innerHTML = `<span class="icon">${iconType}</span><span class="value">+${value}</span>`;
  sprite.appendChild(icon);
  
  // CSS 動畫：從 sprite 飄向 header stats
  icon.style.animation = 'float-to-header 1.5s ease-out forwards';
  setTimeout(() => icon.remove(), 1500);
}

// 任務完成時觸發
activityService.on('workflow:completed', (event) => {
  showFloatingIcon(event.agentId, '✅', 10);
});
```

**參考資源**：

- [Game Dev Tycoon - Wikipedia](https://en.wikipedia.org/wiki/Game_Dev_Tycoon)
- [Game Dev Story | Kairosoft Wiki](https://kairosoft.fandom.com/wiki/Game_Dev_Story)

---

## 動畫/過場/微互動

### CSS 動畫最佳實踐（2026）

**關鍵原則**（來自 DevToolbox 完整指南）：

1. **優先使用 GPU 加速屬性**：
   - ✅ `transform`（translate, rotate, scale）
   - ✅ `opacity`
   - ✅ `filter`
   - ❌ 避免：`width`, `height`, `top`, `left`（觸發 layout）

2. **60fps 性能目標**：
   - 動畫幀率維持 60fps（16.67ms/frame）
   - 使用 `will-change` 提示瀏覽器優化
   - 避免同時動畫太多元素

3. **動畫類型選擇**：
   - **Transitions** — 簡單狀態變化（hover, focus）
   - **Keyframes** — 複雜動畫序列、循環動畫

**參考資源**：

- [CSS Animations: The Complete Guide for 2026 | DevToolbox](https://devtoolbox.dedyn.io/blog/css-animations-complete-guide)
- [Animate.css | A cross-browser library](https://animate.style/)
- [42 Stunning CSS Animation Examples](https://wpdean.com/css-animation/)

### 實用動畫範例

#### 1. 卡片進場動畫

```css
@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.roster-card {
  animation: slideInUp 0.4s ease-out;
  animation-fill-mode: backwards;
}

.roster-card:nth-child(1) { animation-delay: 0s; }
.roster-card:nth-child(2) { animation-delay: 0.1s; }
.roster-card:nth-child(3) { animation-delay: 0.2s; }
/* 依序進場 */
```

#### 2. 粒子慶祝效果

```javascript
// 使用 CSS + JS 實現簡單粒子效果（不需 Canvas）
function celebrateCompletion(x, y) {
  const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a8dadc'];
  
  for (let i = 0; i < 20; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    particle.style.setProperty('--tx', `${(Math.random() - 0.5) * 200}px`);
    particle.style.setProperty('--ty', `${(Math.random() - 0.5) * 200}px`);
    document.body.appendChild(particle);
    
    setTimeout(() => particle.remove(), 1000);
  }
}

/* CSS */
.particle {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  pointer-events: none;
  animation: particle-burst 1s ease-out forwards;
}

@keyframes particle-burst {
  to {
    transform: translate(var(--tx), var(--ty));
    opacity: 0;
  }
}
```

#### 3. 氣泡彈出動畫

```css
@keyframes bubble-pop {
  0% {
    transform: scale(0) translateY(10px);
    opacity: 0;
  }
  50% {
    transform: scale(1.1) translateY(0);
  }
  100% {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}

.sprite-bubble {
  animation: bubble-pop 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
```

### 粒子效果庫（2026）

**推薦工具**（來自 CSS Script）：

1. **particles.js** — 經典粒子背景庫
2. **tsParticles** — particles.js 的 TypeScript 重寫版（更現代）
3. **anime.js** — 強大的 JS 動畫引擎（支援 SVG、DOM、CSS）

**參考資源**：

- [10 Best Particles Animation JavaScript Libraries (2026 Update)](https://www.cssscript.com/best-particles-animation/)

---

## 音效/配樂的氛圍營造

### Web Audio API 能力（2026）

**核心特性**（來自 MDN）：

- ✅ 即時音效處理與混音
- ✅ 低延遲播放（適合遊戲）
- ✅ 空間音效（3D audio）
- ✅ 音效可視化（波形、頻譜）
- ✅ 多音源混合

**參考資源**：

- [Web Audio API - Web APIs | MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Audio for Web games - MDN](https://developer.mozilla.org/en-US/docs/Games/Techniques/Audio_for_Web_Games)
- [Pizzicato.js: A Javascript library for web audio](http://alemangui.github.io/pizzicato/)

### 音效設計方案

**環境音效層**（Ambient）：

| 場景 | 環境音 | 音量 |
|------|--------|------|
| 辦公室（日間） | 鍵盤聲、滑鼠點擊、翻頁聲 | 低（10-15%） |
| 辦公室（夜晚） | 空調聲、時鐘滴答聲 | 極低（5-10%） |
| 下雨天 | 雨聲、遠方雷聲 | 中（20-30%） |

**事件音效層**（SFX）：

| 事件 | 音效 | 觸發時機 |
|------|------|----------|
| 任務完成 | 叮咚聲（清脆） | `phase: completed` |
| 錯誤發生 | 警報聲（短促） | `phase: error` |
| 收到訊息 | 氣泡聲（輕柔） | `type: mutter` |
| 碎念 | 嘆氣聲 | `type: mutter` + `mood: tired` |
| 開啟 portrait | 翻頁聲 | `openPortrait()` |

**BGM 層**（背景音樂）：

- **Lofi Beats** — 適合專注工作場景
- **Ambient Piano** — 適合放鬆/休息場景
- **Upbeat Electronic** — 適合慶祝/完成場景

**音效控制**：

```javascript
// 簡單的音效管理器
const SoundManager = {
  context: new AudioContext(),
  sounds: {},
  
  async load(name, url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    this.sounds[name] = await this.context.decodeAudioData(arrayBuffer);
  },
  
  play(name, volume = 1.0) {
    const source = this.context.createBufferSource();
    const gainNode = this.context.createGain();
    
    source.buffer = this.sounds[name];
    gainNode.gain.value = volume;
    
    source.connect(gainNode);
    gainNode.connect(this.context.destination);
    source.start(0);
  }
};

// 使用範例
await SoundManager.load('complete', '/sounds/complete.mp3');
activityService.on('workflow:completed', () => {
  SoundManager.play('complete', 0.5);
});
```

**免費音效資源**：

- **Freesound.org** — CC 授權音效庫
- **Zapsplat** — 免費 SFX（需註冊）
- **Incompetech** — 免費 BGM（CC BY）

---

## 總結：視覺/互動設計要點

### Quick Wins（短期可實現）

1. ✅ **Roster 卡片動畫增強**：
   - 進場動畫（slideInUp + 延遲）
   - Hover 3D 傾斜效果
   - 點擊時的脈衝反饋

2. ✅ **氣泡動畫優化**：
   - bubble-pop 彈出動畫
   - 根據 mood 改變氣泡顏色

3. ✅ **完成慶祝效果**：
   - 純 CSS 粒子爆發
   - 浮動 +XP 數字

4. ✅ **呼吸動畫**：
   - Portrait 立繪微微上下浮動
   - Sprite 閒置時輕微搖擺

### 中期優化（需一定工作量）

1. ⚙️ **Energy Bar 系統**：
   - 顯示 agent 工作能量
   - Tired mood 時降低、休息時恢復

2. ⚙️ **環境音效**：
   - 辦公室環境音（鍵盤、滑鼠）
   - 事件音效（完成、錯誤、訊息）

3. ⚙️ **背景時間變化**：
   - 根據實際時間切換辦公室場景（早/午/晚/夜）
   - 天氣變化（晴/雨）

4. ⚙️ **對話選項系統**：
   - 使用者可選擇回應（讚美/鼓勵/安慰）
   - 影響 agent mood 和 affinity

### 長期願景（需架構調整）

1. 🎯 **技能樹可視化**：
   - 顯示每個 agent 的技能成長路徑
   - 解鎖條件、前置技能

2. 🎯 **表情差分系統**：
   - 根據 mood 切換不同表情的 portrait
   - 動態眨眼、視線追蹤

3. 🎯 **BGM 系統**：
   - 根據場景、時間、氛圍切換背景音樂
   - 音量淡入淡出

4. 🎯 **Canvas 粒子層**：
   - 辦公室漂浮灰塵
   - Agent 之間的協作連線
   - 慶祝時的五彩紙片

---

## 技術實現備註

### CSS 動畫性能優化

```css
/* 使用 will-change 提示優化 */
.roster-card {
  will-change: transform, opacity;
}

/* 動畫結束後移除 will-change */
.roster-card:hover {
  will-change: auto;
}
```

### 音效延遲加載

```javascript
// 只在使用者互動後才初始化 AudioContext（避免自動播放限制）
let audioInitialized = false;

document.addEventListener('click', () => {
  if (!audioInitialized) {
    SoundManager.context.resume();
    audioInitialized = true;
  }
}, { once: true });
```

### 粒子效果性能考量

- 單次粒子數量限制在 30 個以內
- 使用 CSS transform（GPU 加速）而非 left/top
- 動畫結束後立即移除 DOM 元素
- 避免在低性能裝置上啟用（可用 `navigator.hardwareConcurrency` 偵測）
