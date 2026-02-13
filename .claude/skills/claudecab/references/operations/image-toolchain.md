# 圖片生成內部工具鏈 (Internal Toolchain)

> 這是我們自己的圖片生成 know-how，不是通用規格。
> 外部使用者只要交付符合 [image-asset-spec](../product/image-asset-spec.md) 的圖片即可。

---

## 工具

| 工具 | 用途 |
|------|------|
| `mcp-image` (Gemini) | AI 圖片生成 |
| `sharp` (npm) | 後處理：去背、縮放、格式轉換 |
| `validate-image-assets.cjs` | 驗證是否符合規格 |

---

## mcp-image 參數對應表

### Emoji（1:1 正方形）

```json
{
  "prompt": "[角色描述] face closeup, [表情], slightly deformed chibi-like proportions with larger head, big detailed expressive anime eyes with reflections, soft colored outlines not harsh black lines, hair with translucent highlights and volumetric shading, skin with warm gradient tones, delicate semi-realistic anime style, Head and shoulders only, square format, 1:1 aspect ratio, solid pure white #FFFFFF background, no gradients, no circles, no vignettes, no decorative elements behind the character, clean sharp edges, simple composition",
  "aspectRatio": "1:1",
  "inputImagePath": "[角色立繪的絕對路徑]",
  "maintainCharacterConsistency": true
}
```

### Portrait（半身像）

> **構圖規範**：所有角色 portrait 必須遵守以下構圖約束，確保裁切成大頭貼時一致：
> - **取景**：頭頂到胸口中段（bust shot），不露手
> - **居中**：角色水平置中，臉部在畫布中心線上
> - **留白**：頭頂上方留小段空間，不裁切頭髮；左右負空間對稱
> - **比例**：4:3（比 16:9 更緊湊，減少水平偏移）

```json
{
  "prompt": "(masterpiece, top quality, highly detailed anime illustration:1.2), delicate semi-realistic anime style, sense of transparency (透明感), studio Kyoto Animation / Makoto Shinkai aesthetic, highly detailed expressive eyes, complex iris layers with soft reflections, watery and jewel-like eye texture, delicate eyelashes with soft edges, softly defined facial features, delicate tracing lineart with varying weight, slightly colored soft outlines (avoid harsh black lines), soft diffused natural lighting from upper left, (avoid harsh shadows:1.3), (avoid hard specular highlights:1.3), soft ambient occlusion, subtle soft rim lighting on hair, hair with translucent highlights and soft volumetric shading, matte fabric texture with soft folds showing volume, (no shiny plastic texture:1.3), skin with warm gradient tones and delicate blush, atmospheric glow, rich but soft color palette with warm undertones, pure solid white background, sharp clean character outline, no glow no blur on edges, high contrast with background, (simple background:1.5), no background elements, no objects, no monitor, bust shot from head to mid-chest, no hands visible, character centered in frame, face on horizontal midpoint, small margin above head, no cropped hair, symmetrical empty space on both sides, [角色描述]",
  "aspectRatio": "4:3",
  "inputImagePath": "[前一版立繪或 sprite 的絕對路徑，首次可省略]",
  "maintainCharacterConsistency": true
}
```

### Sprite（像素風小人）

```json
{
  "prompt": "Single pixel art character sprite, isometric view, sitting pose with hands forward, no furniture, no desk, no chair, no objects, character only, isolated sprite, [角色描述], chibi proportions, 64x64 pixel style, clean edges, PURE SOLID WHITE BACKGROUND, no transparency, no checkered pattern, no gradient background, consistent art style, game asset, 16-bit aesthetic",
  "aspectRatio": "3:4",
  "inputImagePath": "[角色立繪的絕對路徑]",
  "maintainCharacterConsistency": true
}
```

### Background（辦公室背景）

```json
{
  "prompt": "Isometric pixel art office space, top-down 45-degree view, spacious modern startup office with distinct zones: open workspace area with desk stations with monitors, cozy lounge corner with sofa, meeting room with glass walls, kitchen area with coffee machine, whiteboard wall with sticky notes, bookshelf, server rack corner with blinking LEDs, scattered details: potted plants, desk toys, mugs, warm ambient lighting with desk lamps, 16-bit retro pixel art aesthetic, soft pastel colors, no characters, all seats empty, game asset style, high detail environment",
  "aspectRatio": "16:9"
}
```

---

## sharp 後處理指令

### 去背（白底 → 透明）

```bash
# threshold 去背：白色區域（RGB > 240）→ 透明
node -e "
const sharp = require('sharp');
const path = process.argv[1];
(async () => {
  const { data, info } = await sharp(path).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 240 && data[i+1] > 240 && data[i+2] > 240) {
      data[i+3] = 0; // 設為透明
    }
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png().toFile(path.replace('.png', '-nobg.png'));
  console.log('Done:', path.replace('.png', '-nobg.png'));
})();
" input.png
```

### 統一縮放

```bash
# Emoji → 512x512
node -e "require('sharp')(process.argv[1]).resize(512,512,{fit:'cover'}).png().toFile(process.argv[2]).then(()=>console.log('Done'))" input.png output.png

# Sprite → 120x160
node -e "require('sharp')(process.argv[1]).resize(120,160,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile(process.argv[2]).then(()=>console.log('Done'))" input.png output.png

# Portrait → 1024x768 (4:3)
node -e "require('sharp')(process.argv[1]).resize(1024,768,{fit:'cover'}).png().toFile(process.argv[2]).then(()=>console.log('Done'))" input.png output.png
```

### 壓縮（減少檔案大小）

```bash
# PNG 壓縮（quality 越低檔案越小，建議 60-80）
node -e "require('sharp')(process.argv[1]).png({quality:70,compressionLevel:9}).toFile(process.argv[2]).then(i=>console.log((i.size/1024).toFixed(0)+'KB'))" input.png output.png
```

---

## 完整流程範例：生成一個新 agent 的全套圖片

```bash
# 假設 agentId = "helper", 立繪已生成為 raw-portrait.png

# 1. Portrait 去背 + 縮放
node -e "..." raw-portrait.png  # 去背
node -e "..." portrait-nobg.png  # 縮放到 1408x768

# 2. 用立繪生 sprite（mcp-image，用 inputImagePath 指向立繪）
# 3. Sprite 去背 + 縮放到 120x160

# 4. 用立繪生 6 個 emoji（mcp-image，aspectRatio=1:1）
# 5. 每個 emoji 去背 + 縮放到 512x512

# 6. 放到正確位置
mkdir public/images/agents/helper/
cp portrait.png sprite.png emoji-*.png public/images/agents/helper/

# 7. 驗證
node scripts/validate-image-assets.cjs helper

# 8. 更新 agent.json 的 display 欄位
```

---

## 注意事項

- **生成順序很重要**：portrait → sprite → emoji，每步用前一步做 reference 鎖定風格
- **永遠不要在 prompt 中說 "transparent background"**：Gemini 會生成假透明
- **去背後一定跑驗證**：`validate-image-assets.cjs` 會檢測假透明
- **保留原圖**：去背/縮放前的原圖另存備份，以便日後重新處理
