# 圖片生成最佳實踐

## Prompt 技巧

### 風格描述
- **遊戲 UI**：明確說明遊戲類型（RPG, Visual Novel, etc.）、美術風格（pixel art, anime, etc.）
- **Sprite Sheet**：說明需要的狀態（normal/hover/pressed/disabled）、排列方式
- **背景**：預設會生成透明背景（checkered pattern），適合直接使用

### 實證案例

| 需求 | 有效 Prompt 結構 | 效果 |
|------|-----------------|------|
| RPG 按鈕 | "Game UI button sprite sheet, pixel art style, contains multiple states: normal, hover, pressed, disabled. Fantasy RPG style with wooden texture and metal borders." | 成功生成 3 種形狀 × 4 種狀態 |
| Galgame 按鈕 | "Game UI button sprite sheet, visual novel / galgame style, anime aesthetic. Soft gradient backgrounds, pastel colors (pink, lavender, cream)." | 成功生成對話按鈕 + 功能按鈕 |

### Prompt 結構建議

```
[內容類型] + [風格] + [具體要求] + [排列/背景說明]

範例：
Game UI button sprite sheet, pixel art style, contains 4 states (normal/hover/pressed/disabled),
wooden texture with metal borders, clean layout on transparent background
```

## 參數選擇

### aspectRatio 決策

- **16:9**：Sprite sheet、橫向排列的 UI 元素
- **1:1**：單一圖示、社群貼文
- **9:16**：手機介面、直向排列
- **4:5**：Instagram 貼文

### imageSize 使用時機

- **預設（不指定）**：一般使用，生成速度快
- **2K**：需要較高解析度，文字清晰度要求較高
- **4K**：印刷品、高畫質素材

## 常見問題

### 生成結果不如預期

1. **風格不對**：增加風格關鍵字（pixel art, anime, realistic, etc.）
2. **細節不足**：在 prompt 中明確描述需要的細節
3. **排列混亂**：加上 "clean layout" "organized grid" 等描述

### 效能考量

- 單次生成約 10-20 秒
- 建議一次生成包含多個狀態/變體，而非多次生成單一圖片

---

## 更新記錄

- 2026-02-17：初版，收錄 RPG 按鈕和 Galgame 按鈕的生成經驗
