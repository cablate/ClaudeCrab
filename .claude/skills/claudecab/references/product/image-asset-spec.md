# 圖片資產規格標準 (Image Asset Specification)

> 定義 ClaudeCab Live 頁面所有圖片資產的規格、生成規範、驗證標準。
> 所有新圖片必須符合此規格才能上線。

---

## 資產類型總覽

| 類型 | 用途 | 位置 | 必要性 |
|------|------|------|--------|
| **Sprite** | 辦公室場景中的小人 | `public/images/agents/{id}/sprite.png` | 選填（fallback: avatar emoji） |
| **Portrait** | 對話面板的角色立繪 | `public/images/agents/{id}/portrait.png` | 選填（fallback: 大號 avatar emoji） |
| **Emoji** | 對話面板的表情反應圖 | `public/images/agents/{id}/emoji-{key}.png` | 選填（fallback: text emoji） |
| **Background** | 辦公室場景背景 | `public/images/office-background.png` | 選填（fallback: CSS 漸層背景） |

---

## 各類型詳細規格

### Sprite（像素風小人）

| 屬性 | 規格 |
|------|------|
| **最終尺寸** | 60×80 px（CSS 顯示尺寸） |
| **交付尺寸** | 120×160 px（2x retina） |
| **比例** | 3:4 |
| **格式** | PNG, RGBA |
| **背景** | 透明（alpha=0） |
| **最大檔案大小** | 50 KB |
| **風格** | 16-bit pixel art, chibi proportions, isometric view |
| **內容限制** | 僅角色本身，不含家具/桌椅/物件 |

**生成注意事項**：
- prompt 指定 `PURE SOLID WHITE BACKGROUND`（不要說 transparent）
- 生成後用工具去背（sharp threshold 或 remove.bg）
- 最終尺寸用 sharp 統一縮放，不靠 prompt 控制

### Portrait（角色立繪）

| 屬性 | 規格 |
|------|------|
| **交付尺寸** | 1408×768 px |
| **比例** | ~16:9（橫向） |
| **格式** | PNG, RGBA |
| **背景** | 透明（alpha=0） |
| **最大檔案大小** | 500 KB |
| **風格** | 半身像，anime/illustration 風格，與 sprite 角色設計一致 |

**生成注意事項**：
- prompt 指定 `solid white background, clean edges, no gradient`
- 用角色 sprite 或前一版立繪做 inputImagePath 鎖定角色特徵
- 去背後保留原圖備份（`portrait-original.png`）

### Emoji（表情反應圖）

| 屬性 | 規格 |
|------|------|
| **交付尺寸** | 512×512 px |
| **比例** | **1:1**（正方形） |
| **格式** | PNG, RGBA |
| **背景** | 透明（alpha=0） |
| **最大檔案大小** | 200 KB |
| **風格** | 角色臉部特寫 + 表情，類似 Discord 自訂表情 / LINE 貼圖 |

**標準 Emoji Key 清單**（對齊 `ActivityMood` enum）：

| Key | 表情描述 | 觸發條件 |
|-----|----------|----------|
| `neutral` | 平靜/普通 | mood=neutral, phase=idle |
| `excited` | 開心/興奮 | mood=excited, phase=completed |
| `annoyed` | 煩躁/不爽 | mood=annoyed, phase=error |
| `tired` | 疲倦/無力 | mood=tired |
| `focused` | 專注/認真 | mood=focused, phase=working/tool_use |
| `bored` | 無聊/呆滯 | mood=bored |
| `task_received` | 收到任務（可選） | phase=task_received（沒有則 fallback neutral） |

**生成注意事項**：
- prompt 必須指定 `1:1 aspect ratio, square format`
- prompt 指定 `solid white background`
- 一次生成一組（6 個必要 + 1 可選），用同一個角色立繪做 reference
- 去背後統一縮放至 512×512

### Background（辦公室背景）

| 屬性 | 規格 |
|------|------|
| **交付尺寸** | 1920×1080 px |
| **比例** | 16:9 |
| **格式** | PNG 或 JPEG |
| **背景** | 不透明（完整場景） |
| **最大檔案大小** | 1 MB |
| **風格** | Isometric pixel art, 45-degree top-down view |

---

## 假透明 (Fake Transparency) 防範

### 問題描述

AI 圖片生成器（特別是 Gemini）在被要求生成「透明背景」時，有時會生成一層**灰黑色棋盤格圖案**，視覺上模擬 Photoshop 的透明度指示器，但這些棋盤格是**實際渲染在像素中的不透明內容**，不是真正的 alpha=0。

檔案看起來是 RGBA PNG，但「透明區域」其實充滿了灰/黑/白交替的棋盤像素。

### 防範策略

1. **生成時 — Prompt 規範**：
   - **永遠不要在 prompt 中使用 "transparent background"**
   - 改用 `PURE SOLID WHITE BACKGROUND`
   - 額外加上 `no checkered pattern, no transparency grid, no gradient background`
   - 背景處理交給後處理工具，不依賴 AI 生成器

2. **後處理 — 去背流程**：
   ```
   生成（白底） → 去背工具（sharp threshold / remove.bg） → 驗證 → 交付
   ```
   - sharp threshold 去背：RGB 三通道 > 240 → alpha=0
   - 專業去背：remove.bg API 或類似服務
   - 去背後保留白底原圖備份

3. **驗證 — 自動化檢測**：
   ```bash
   node scripts/validate-image-assets.cjs          # 掃描所有 agent
   node scripts/validate-image-assets.cjs general   # 只掃描指定 agent
   ```
   檢查項目：尺寸範圍、比例、檔案大小、RGBA 通道、假透明偵測（棋盤格 pattern）。
   錯誤（❌）= 不符合規格，警告（⚠️）= 超過建議值但仍可使用。

---

## agent.json display 設定範例

```json
{
  "display": {
    "avatar": "📝",
    "color": "#F59E0B",
    "sprite": "sprite.png",
    "portrait": "portrait.png",
    "emoji": {
      "neutral": "emoji-neutral.png",
      "excited": "emoji-excited.png",
      "annoyed": "emoji-annoyed.png",
      "tired": "emoji-tired.png",
      "focused": "emoji-focused.png",
      "bored": "emoji-bored.png"
    }
  }
}
```

路徑相對於 `public/images/agents/{agentId}/`，API 自動組裝完整 URL。

---

## Fallback 行為

| 資產 | 缺失時的 Fallback | 實作位置 |
|------|-------------------|----------|
| Sprite 圖片 | 顯示 avatar emoji（2.5rem） | `live.js: createAgentSprite` |
| Sprite 圖片載入失敗 | onerror → 切換為 avatar emoji | `live.js: createAgentSprite` |
| Portrait 圖片 | `display: none`（隱藏圖片區域） | `live.js: openPortrait` |
| Emoji 圖片 | 顯示 MOOD_EMOJI text emoji（4rem） | `live.js: openPortrait` |
| Background 圖片 | CSS 漸層背景（需實作） | `live.css` |

### 待改善
- Portrait fallback 應該改為顯示大號 avatar emoji 而非完全隱藏
- Background 應有 CSS fallback 漸層色

---

## 新 Agent 圖片生成 Checklist

建立新 agent 時，按此順序生成圖片：

- [ ] **1. 立繪 (portrait)** — 先確定角色設計、配色、氣質
  - prompt: 白底、半身像、清晰輪廓
  - 驗證: 1408×768, 去背後有真透明, < 500KB
- [ ] **2. Sprite** — 用立繪做 reference 生成像素風小人
  - prompt: 白底、sitting pose、no furniture
  - 驗證: 120×160 (或統一縮放後), 去背後有真透明, < 50KB
- [ ] **3. Emoji 組** — 用立繪做 reference 生成 6 個表情
  - prompt: 白底、1:1 正方形、臉部特寫
  - 驗證: 每張 512×512, 去背後有真透明, < 200KB
- [ ] **4. 更新 agent.json** — 填入 display.sprite / portrait / emoji

不需要完整圖片也能運行 — fallback 會接管。但完整圖片 = 最佳 Live 體驗。

---

## Prompt Template 參考

### Sprite
```
Single pixel art character sprite, isometric view,
[POSE: sitting pose with hands forward],
no furniture, no desk, no chair, no objects, character only, isolated sprite,
[CHARACTER DESC],
chibi proportions, 64x64 pixel style,
clean edges, PURE SOLID WHITE BACKGROUND,
no transparency, no checkered pattern, no gradient background,
consistent art style, game asset, 16-bit aesthetic
```

### Portrait
```
[CHARACTER DESC], upper body portrait,
anime illustration style, detailed face and expression,
clean sharp edges, PURE SOLID WHITE BACKGROUND,
no transparency, no checkered pattern, no gradient,
high quality, professional character art
```

### Emoji
```
[CHARACTER DESC] face closeup, [EXPRESSION],
square format, 1:1 aspect ratio,
expressive emotion, Discord custom emoji style,
clean sharp edges, PURE SOLID WHITE BACKGROUND,
no transparency, no checkered pattern, no gradient,
simple composition, character face only
```

---

## 歷史 Key 映射（遷移參考）

舊的 emoji key 已全部遷移至新標準 key，以下為對照：

| 舊 Key | 新 Key | 說明 |
|--------|--------|------|
| `thinking` | `focused` | — |
| `surprised` | `task_received` | 可選 |
| `sleepy` | `tired` | — |
| `thumbsup` | `excited` | — |
| `frustrated` | `annoyed` | — |
| `happy` | `excited` | coder |
| `fired_up` | `focused` | coder |
| `weary` | `tired` | coder |
