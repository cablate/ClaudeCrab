---
name: dom-avatar-video
description: |
  Avatar 表情影片生成。觸發時機：需要製作「表情包影片」「說話影片」、有文字想轉成帶表情切換的影片、TTS + 圖片 + 字幕合成。
  流程：TTS 生成音檔 → STT 取得時間戳 → 語意分段配圖 → ffmpeg 合成。
  主動更新時機：新增表情圖、發現更好的 ffmpeg 參數、流程優化時更新對應章節。
---

# Avatar Video Generator

將文字轉換成表情包切換影片：白底 + 角色圖片 + 字幕，圖片隨語意切換。

## 核心原則

1. **表情跟著語意走**：不是機械式切換，而是根據內容情緒選擇對應表情
2. **簡單優先**：能用 ffmpeg 解決的不用複雜工具
3. **可重複使用**：scripts 封裝好，下次直接跑

## 完整流程

```
稿子
  ↓
[AI] 口語化 + 標題生成
  ↓
[腳本] TTS → 音檔
  ↓
[腳本] STT → 時間戳 JSON
  ↓
[AI] 語意分段 + 情緒判斷 + B-roll 時機標記
  ↓
[AI] 生成 concat.txt + ASS 字幕
  ↓
[腳本] ffmpeg 合成 → 影片
```

**分工**：
- **腳本**：機械性工作（TTS、STT、ffmpeg）
- **AI**：判斷性工作（口語化、情緒、配圖、B-roll）

### Step 0：稿件處理 + 標題生成

#### 0-1：稿件口語化

將貼文/文稿轉換成適合「唸出來」的版本：

**調整原則**：
- 句子短、斷句自然（一口氣能唸完）
- 書面語 → 口語（「分析」→「納悶」、「因素」→「別的」）
- 問句結尾比陳述句有力
- 轉折要明確（「後來我想通了」比「目前我認為」有力）
- **結尾要有記憶點**：問句、金句、行動呼籲，不能軟掉

**常見問題**：
- 結尾無力：「不如好好想...」→ 改成明確問句或結論
- 句子太長：拆成 2-3 句
- 連接詞堆疊：「所以」「然後」「但是」連用 → 精簡

#### 0-2：標題生成

根據稿子內容生成吸引人的標題（10-15 字）：

**分析角度**：
- 痛點：觀眾最想解決的問題
- 好奇心：讓人想點進去的懸念
- 價值點：能獲得什麼

**標題風格**：
- 口語化、有記憶點
- 避免標題黨，但要有吸引力
- 範例：「這個功能 90% 的人不知道」「經營一年，我發現模板根本沒用」

### Step 1：TTS 生成音檔

```bash
.claude/skills/dom-avatar-video/scripts/tts.bat "要說的文字" "output/audio.mp3"
```

- 使用 Replicate MiniMax Speech 2.8 HD
- 預設女聲 `female-shaonv`，中文

**標題 + 正文處理**：
- TTS 輸入：`{標題}。...{正文}`（「。...」產生自然停頓）
- 或分兩段生成後用 ffmpeg 合併，中間插入 0.5 秒靜音

### Step 2：STT 取得時間戳

```bash
.claude/skills/dom-avatar-video/scripts/stt.bat "agents/general/output/audio.mp3" "agents/general/output/transcript.json"
```

- 使用 Groq Whisper
- 輸出 JSON 包含 `segments`（句子級）和 `words`（字級）時間戳
- **注意**：路徑需從 ClaudeCab 根目錄算起

### Step 3：語意分段 + 配圖

#### 3-1：Segment 拆分（長段處理）

STT 輸出的 segments 是句子級，但有些句子太長（超過 5 秒），需要進一步拆分：

**拆分判斷**：
1. **時長 > 5 秒**：需要拆分
2. **情緒轉折**：同一句內有明顯情緒變化（困惑 → 陳述 → 懷疑）

**拆分方法**：
- 使用 `words` 陣列的時間戳定位斷點
- 依據標點（逗號、句號）或語意轉折切分
- 每個子段落 2-5 秒為佳

**範例**：
```
原始 segment（9.48s）：
「我也問過AI很多次，為什麼我的貼文好像怎麼發都有基礎互動，答案不是鐵粉笑音就是題材好，但我總覺得還有別的。」

拆分後（3 段）：
1.「我也問過AI很多次」→ 2.2s → 困惑/thinking
2.「為什麼我的貼文...題材好」→ 5.3s → 陳述/standard
3.「但我總覺得還有別的」→ 2.0s → 懷疑/thinking
```

**斷點定位**：從 words 陣列找到對應文字的 `end` 時間作為切點。

#### 3-2：情緒判斷 + 配圖

根據每個（拆分後的）segment 內容判斷情緒：

**情緒識別關鍵字**：
| 情緒 | 關鍵詞/句型 | 表情 |
|------|------------|------|
| 困惑 | 為什麼、納悶、不懂、怎麼會 | thinking |
| 懷疑 | 但、總覺得、真的嗎、不一定 | thinking |
| 發現 | 後來我想通了、原來、發現 | surprised |
| 強調 | 才是、真正的、關鍵、重點 | excited-celebrate |
| 否定 | 根本沒用、不止沒用、反而更差 | sad-pleading / embarrassed |
| 結論 | 所以、現在我只、這就是 | standard → happy-peace |
| 提問 | 想聽什麼、你覺得呢 | happy-peace / thinking |

**配圖原則**：
- 每個情緒段對應一張表情
- 避免連續 3+ 段用同一張圖（觸發自動生成新表情）
- 情緒過渡自然：excited → standard → thinking 比 excited → sad → excited 好

建立 concat 檔案：

```txt
# 標題段
file 'avatar-expressions/typeA-excited-celebrate.png'
duration 2.5

# 轉場（黑畫面淡入淡出用）
file 'black.png'
duration 0.3

# 正文段
file 'avatar-expressions/typeA-standard.png'
duration 3.52
file 'avatar-expressions/typeA-thinking.png'
duration 6.20
...
file 'avatar-expressions/typeA-happy-peace.png'
```

**規則**：
- 標題段：固定用 `excited-celebrate` 或 `happy-peace`
- 轉場：插入 0.3 秒黑畫面（需準備 `black.png`）
- 結尾段：最後一張表情多停 1 秒 → 淡出 → 結束畫面 `endcard.png` 停留 1.5 秒
- 最後一行不加 duration（ffmpeg concat 規則）

**結尾處理**：
```txt
# 正文最後一段（多停 1 秒）
file 'avatar-expressions/typeA-happy-peace.png'
duration 4.0  # 原本 3.0 + 額外 1.0

# 結束畫面
file 'avatar-expressions/endcard.png'
```

#### 3-3：內容驅動生成（核心原則）

**不是「湊合用現有的」，而是「內容需要什麼就生成什麼」。**

每一段都要問：
1. 這段內容需要什麼情境/表情/道具？
2. 現有素材庫有沒有？
3. 沒有 → **立刻生成**，不要將就

**三層視覺元素**：

| 層級 | 類型 | 範例 | 存放位置 |
|------|------|------|----------|
| L1 | 角色表情 | thinking, excited, sad | `avatar-expressions/` |
| L2 | 手持/旁邊物件 | 咖啡杯、筆電、書、手機 | `avatar-props/` |
| L3 | 概念圖示 | 模板 icon、AI 機器人、流量符號 | `concept-icons/` |

**L1 角色表情**：角色的情緒狀態（現有機制）

**L2 手持/旁邊物件**：增加情境感
- 講工作 → 旁邊有筆電
- 講日常 → 手持咖啡杯
- 講學習 → 桌上有書
- 生成時角色姿勢要配合物件

**L3 B-roll 概念視覺**：全畫面切換，不是角落小圖
- 講到某個概念時，**整個畫面切換**成相關視覺（1-3 秒）
- 然後切回表情圖繼續
- 這是短影片的標準做法——保持視覺變化，維持觀眾注意力

**生成決策流程**：
```
每段內容 → 分析需要的視覺元素
         ↓
    L1 表情：現有？→ 用 / 沒有？→ 生成
    L2 道具：這段需要情境物件？→ 查有無 / 沒有就生成
    L3 圖示：有提到具體名詞/概念？→ 查有無 / 沒有就生成或用 emoji
         ↓
    組合成該段的視覺呈現
```

**生成優先級**：
1. 先檢查概念素材庫（以後可複用）
2. 沒有才生成新的
3. 生成後加入素材庫 + 更新 index

**生成 Prompt 模板**：

L1 表情：
```
A cute anime-style girl avatar with [情緒描述],
same character as the reference image,
white background, upper body shot,
soft lighting, clean illustration style
```

L2 道具場景：
```
A cute anime-style girl avatar [姿勢/動作],
[道具描述：holding a coffee cup / with laptop on desk / reading a book],
same character as the reference image,
white background, upper body shot,
soft lighting, clean illustration style
```

L3 B-roll 概念視覺：
```
[概念] visualization, [風格：illustration / stock footage style / infographic],
clean composition, white or simple background,
full frame, suitable as cutaway shot
```

**生成執行流程**：

1. **使用工具**：`mcp__mcp-image__generate_image`

2. **參數設定**：
   ```
   prompt: [上面的 prompt 模板]
   aspectRatio: "3:4"  # 產出約 896x1200
   purpose: "avatar video expression/prop/broll"
   inputImagePath: "F:\\_Program\\OwnProject\\ClaudeCab\\agents\\general\\output\\avatar-expressions\\typeA-standard.png"  # L1/L2 必須用參考圖
   ```

3. **L1/L2 必須帶參考圖**：確保角色一致性
   - `inputImagePath` 指向 `typeA-standard.png`
   - `maintainCharacterConsistency: true`

4. **L3 不需參考圖**：B-roll 是獨立視覺，不是角色

5. **尺寸標準化**（生成後）：
   ```bash
   ffmpeg -y -i input.png -vf "scale=896:1200:force_original_aspect_ratio=decrease,pad=896:1200:(ow-iw)/2:(oh-ih)/2:white" output.png
   ```

6. **存放位置**：
   - L1 表情 → `output/avatar-expressions/typeA-{emotion}.png`
   - L2 道具 → `output/avatar-props/{prop-name}.png`
   - L3 B-roll → `output/broll/{concept}.png`

7. **更新索引**：生成後把新素材加到對應的 `index.md`

**素材庫索引**：
- 表情：`output/avatar-expressions/index.md`
- 道具：`output/avatar-props/index.md`（待建立）
- B-roll：`output/broll/index.md`（待建立）

### Step 3-4：B-roll 插入（短影片節奏）

**什麼是 B-roll**：
- A-roll = 說話的人（表情圖）
- B-roll = 講到概念時，**整個畫面切換**成視覺化內容

**短影片節奏原則**（TikTok/Reels）：
- 每 3-5 秒要有視覺變化
- B-roll 單段 1-3 秒（太長會無聊）
- 每 10-20 秒應該有一次 B-roll 插入
- 「show, don't tell」——讓觀眾看到你在說什麼

**B-roll 時機**：
- 提到抽象概念（模板、AI、流量）
- 提到具體事物（筆電、咖啡、書）
- 情緒轉折點（「後來我想通了」）
- 強調重點（「這才是關鍵」）

**在 concat.txt 中實現**：
```txt
# 表情圖（說到「模板」之前）
file 'avatar-expressions/typeA-thinking.png'
duration 2.5

# B-roll：講「模板」時切換（1.5秒）
file 'broll/template-visualization.png'
duration 1.5

# 切回表情圖繼續
file 'avatar-expressions/typeA-standard.png'
duration 3.0
```

**B-roll 素材生成**：
- 尺寸必須與表情圖一致（896x1200）
- 風格可以不同（插圖、infographic、抽象視覺）
- 白底或簡單背景，不要太複雜搶字幕

**常用 B-roll 類型**：
| 概念 | 視覺化方式 |
|------|-----------|
| 模板 | 文件/表格的插圖 |
| AI | 機器人/神經網路視覺 |
| 流量 | 上升曲線圖 |
| 時間 | 時鐘/日曆 |
| 金錢 | 錢幣/圖表 |
| 成長 | 階梯/向上箭頭 |

### Step 4：生成 ASS 字幕

根據 segments 時間戳生成，標題用特別樣式：

```ass
[Script Info]
Title: Avatar Video
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Noto Sans TC,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,0,8,50,50,80,1
Style: Default,Noto Sans TC,60,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,8,50,50,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.50,Title,,0,0,0,,標題文字
Dialogue: 0,0:00:02.80,0:00:06.32,Default,,0,0,0,,第一段正文
Dialogue: 0,0:00:06.84,0:00:13.04,Default,,0,0,0,,第二段正文（用 \N 換行）
```

### Step 5：ffmpeg 合成

**畫面規格**：1080x1350 (4:5，IG Feed 友善)

**佈局**：
- 上方 ~200px：字幕區
- 下方 ~1150px：圖片區（縮放後置中偏下）

**標準模板**（直接複製使用）：

```bash
# 取得音檔長度（這是主控時長）
AUDIO_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "audio.mp3")

# 合成指令
ffmpeg -y \
  -f concat -safe 0 -i concat.txt \
  -i audio.mp3 \
  -filter_complex "
    [0:v]fps=30,
    scale=-1:1100,
    pad=1080:1350:(1080-iw)/2:250:white,
    format=yuv420p[v];
    [v]ass=subtitle.ass[vout]
  " \
  -map "[vout]" -map 1:a \
  -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 128k \
  -t "$AUDIO_DURATION" \
  output.mp4
```

**核心原則**：
1. **音檔長度為主控**：用 `-t {音檔秒數}` 而非 `-shortest`（避免結尾被截斷）
2. **白底背景**：`pad=...:white`（配合白底圖片）
3. **圖片尺寸統一**：concat 裡所有圖片必須相同尺寸，否則會觸發 filter graph reconfigure

**轉場說明**：
- ⚠️ **不要用 fade 濾鏡做淡入淡出**：ffmpeg fade 會把畫面淡成黑色後無法恢復
- 轉場用 `black.png` 圖片在 concat.txt 中實現（見 Step 3）
- 如需真正的淡入淡出效果，需用 xfade 或分段處理再合併

**佈局說明**：
- `scale=-1:1100`：高度固定 1100，寬度按比例
- `pad=1080:1350:(1080-iw)/2:250:white`：白底、圖片水平置中、垂直偏下（y=250）
- 字幕在上方（ASS Alignment=8，MarginV=40，字體 52-64）

**ASS 字幕設定**（配合 4:5 畫面）：
```
PlayResX: 1080
PlayResY: 1350
Style: Title,...,Fontsize=64,...,MarginV=40
Style: Default,...,Fontsize=52,...,MarginV=40
```

**關鍵參數**：
- `fps=30`：避免幀率問題
- `yuv420p`：確保播放器相容性
- `-preset medium`：編碼速度與品質平衡

## 表情素材庫

位置：`output/avatar-expressions/`
索引：`output/avatar-expressions/index.md`（完整清單 + 情緒標籤）

**常用表情速查**：

| 表情 | 情緒標籤 | 適用情境 |
|------|----------|----------|
| standard | neutral | 陳述、說明、中性 |
| happy-peace | positive, greeting | 打招呼、結尾、正面情緒 |
| thinking | curious, confused | 疑問、思考、分析 |
| surprised | surprised | 驚訝、意外發現 |
| sad-pleading | sad, helpless | 困擾、求助 |
| excited-celebrate | excited, happy | 興奮、強調重點 |
| embarrassed | embarrassed, awkward | 尷尬、自嘲 |

預設使用 typeA。typeB/C 是不同風格的備用版本。

**基底參考圖**：`typeA-standard.png`（生成新表情時必須使用）

## Scripts

| 檔案 | 用途 |
|------|------|
| `scripts/tts.ts` | TTS 生成（Replicate MiniMax） |
| `scripts/stt.ts` | STT 轉錄（Groq Whisper） |
| `scripts/compose-video.sh` | **影片合成（標準模板）** |
| `scripts/validate-concat.ts` | 驗證 concat 檔案中的圖片是否存在 |
| `scripts/.env` | API keys（REPLICATE_API_TOKEN, GROQ_API_KEY） |

**執行方式**：從 ClaudeCab 根目錄執行（因 node_modules 在那）
```bash
cd F:\_Program\OwnProject\ClaudeCab

# TTS
npx tsx agents/general/.claude/skills/dom-avatar-video/scripts/tts.ts <text> <output.mp3>

# STT
npx tsx agents/general/.claude/skills/dom-avatar-video/scripts/stt.ts <audio.mp3> <output.json>

# 影片合成
bash agents/general/.claude/skills/dom-avatar-video/scripts/compose-video.sh <project_name>
```

## 範例產出

- `output/intro.mp3`：自我介紹音檔
- `output/intro_transcript.json`：時間戳
- `output/intro_video.mp4`：完成影片（15 秒）
