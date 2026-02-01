# Edge TTS (Text-to-Speech)

> 使用 Microsoft Edge 的線上文字轉語音服務，完全免費，無需 Microsoft Edge、Windows 或 API key

## 簡介

**Edge TTS** 是一個 Python 模組，允許你使用 Microsoft Edge 的線上文字轉語音服務，基於 Edge 瀏覽器「朗讀」功能的相同技術，提供高品質且自然的語音輸出。

- **GitHub**：https://github.com/rany2/edge-tts
- **PyPI**：https://pypi.org/project/edge-tts/
- **線上工具**：https://edge-tts.com/
- **語音範例**：https://tts.travisvn.com/

## 核心特色

### 完全免費
- 使用 Microsoft Edge 的線上 TTS 服務
- 無需 API key
- 無需安裝 Microsoft Edge 或 Windows

### 高品質語音
- 自然的語音輸出
- 支援 **74 種語言、322 個語音**
- 包含多種中文語音（zh-CN、zh-HK、zh-TW）

### 自動字幕生成
- 自動生成 **VTT** 和 **SRT** 格式字幕
- 與大多數影片編輯軟體和線上平台相容
- 適合影片內容創作

### 客製化選項
- **語速調整**：0.5x 至 2x 速度
- **音調調整**：可調整音高
- **音量調整**：可控制音量大小

## 應用場景

### 1. 簡報自動唸稿 🎤
- **PowerPoint 旁白自動化**：將簡報文字轉換為語音，自動生成旁白
- **影片簡報製作**：搭配字幕生成功能，快速產出附帶旁白的影片簡報
- **線上課程**：為教學簡報加入專業旁白

#### 實作流程
1. 準備簡報文字稿
2. 使用 edge-tts 轉換為語音檔案
3. 自動生成字幕檔（VTT/SRT）
4. 匯入影片編輯軟體或簡報工具

### 2. 影片配音 🎬
- **YouTube 影片旁白**：為影片內容生成專業旁白
- **短影片配音**：快速為 TikTok、Reels 等短影片加入語音
- **教學影片**：教育內容、產品介紹影片配音

### 3. 有聲書與音訊內容 📚
- **有聲書製作**：將文字內容轉換為有聲書
- **Podcast 自動化**：快速生成 Podcast 音訊
- **新聞播報**：自動化新聞語音播報

### 4. 語言學習 🌍
- **多語言學習**：支援 74 種語言，適合語言學習
- **語速調整**：慢速播放適合初學者，快速播放適合複習
- **發音示範**：提供標準發音參考

### 5. 無障礙輔助 ♿
- **網頁朗讀**：透過瀏覽器擴充功能朗讀網頁內容
- **文件朗讀**：將文字文件轉為音訊，方便視障人士

### 6. 內容創作自動化 🤖
- **AI 內容配音**：為 AI 生成的文字內容自動配音
- **社群媒體**：為 Instagram、Facebook 貼文生成語音版本
- **數位藝術**：互動式敘事、數位藝術裝置

## 使用方式

### 1. Python 模組

#### 安裝
```bash
pip install edge-tts
```

#### 基本使用（指令列）
```bash
# 基本轉換
edge-tts --text "Hello, world!" --write-media hello.mp3

# 調整語速
edge-tts --rate=-50% --text "Hello, world!" --write-media hello_slow.mp3

# 調整音調
edge-tts --pitch=+20Hz --text "Hello, world!" --write-media hello_high.mp3

# 指定語音
edge-tts --voice zh-CN-XiaoxiaoNeural --text "你好，世界！" --write-media hello_cn.mp3

# 列出所有可用語音
edge-tts --list-voices
```

#### Python 程式碼範例
```python
import asyncio
import edge_tts

async def main():
    text = "Hello, world!"
    voice = "en-US-AriaNeural"
    output_file = "output.mp3"

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_file)

asyncio.run(main())
```

### 2. 線上工具
- 訪問 https://edge-tts.com/
- 在所有現代裝置（PC、平板、手機）和瀏覽器（Chrome、Firefox、Safari、Edge）上運作
- 無需安裝軟體，直接在瀏覽器中使用

### 3. 瀏覽器擴充功能
- **Read Aloud** - 朗讀網頁內容
- **Text to Speech Voice Reader** - 可自訂設定的朗讀工具

### 4. OpenAI 相容 API
- GitHub 專案提供本地 OpenAI 相容的 TTS API
- 模擬 OpenAI TTS endpoint (`/v1/audio/speech`)
- 支援多種語音選項與播放速度
- GitHub：https://github.com/travisvn/openai-edge-tts

## 中文語音支援

### 可用的中文語音區域
- **zh-CN**（中國大陸）
- **zh-HK**（香港）
- **zh-TW**（台灣）

### 範例中文語音
- **Xiaoxiao (zh-CN-XiaoxiaoNeural)**：中文神經語音，細膩的語音表達

### 使用範例
```bash
# 中國大陸語音
edge-tts --voice zh-CN-XiaoxiaoNeural --text "這是一個測試" --write-media test_cn.mp3

# 台灣語音
edge-tts --voice zh-TW-HsiaoChenNeural --text "這是一個測試" --write-media test_tw.mp3

# 香港語音
edge-tts --voice zh-HK-HiuGaaiNeural --text "這是一個測試" --write-media test_hk.mp3
```

## 與 PowerPoint 簡報整合

雖然 edge-tts 本身不直接整合 PowerPoint，但可透過以下流程實現簡報自動唸稿：

### 方法 1：手動流程
1. 從簡報備註或文字提取內容
2. 使用 edge-tts 生成語音檔案
3. 在 PowerPoint 中插入音訊（插入 > 音訊 > 來自我的電腦）

### 方法 2：自動化腳本
使用 Python 讀取簡報文字並批量生成旁白：

```python
from pptx import Presentation
import edge_tts
import asyncio

async def generate_narration(slide_text, output_file):
    voice = "zh-TW-HsiaoChenNeural"
    communicate = edge_tts.Communicate(slide_text, voice)
    await communicate.save(output_file)

# 讀取 PowerPoint 備註並生成語音
prs = Presentation('presentation.pptx')
for i, slide in enumerate(prs.slides):
    if slide.notes_slide.notes_text_frame.text:
        text = slide.notes_slide.notes_text_frame.text
        asyncio.run(generate_narration(text, f'slide_{i}.mp3'))
```

### 方法 3：使用第三方工具
- **SlideNarrator**：自動生成專業音訊旁白，將 PowerPoint 轉為附帶 AI 旁白的 MP4 影片
- **PowerTalk**：為簡報加入即時旁白
- **Murf**：PowerPoint 外掛程式，直接在 PowerPoint 中連接 Murf 語音

## 進階應用

### 整合至影片編輯工作流
1. 使用 edge-tts 生成語音和字幕
2. 匯入 Premiere Pro、Final Cut Pro、DaVinci Resolve 等編輯軟體
3. VTT/SRT 字幕檔可直接使用

### ComfyUI 整合
- **ComfyUI-EdgeTTS** 節點可整合至 ComfyUI 工作流
- 適合 AI 圖像生成與語音結合的創意專案

### 語音客製化
- **語速**：適合不同場景（慢速學習、快速複習）
- **音調**：調整角色感（高音、低音）
- **停頓與重音**：透過 SSML（Speech Synthesis Markup Language）進一步控制

## 優勢與限制

### 優勢 ✅
- 完全免費，無需 API key
- 高品質自然語音
- 支援多語言、多語音
- 自動生成字幕
- 跨平台（Python、網頁、瀏覽器擴充）
- 易於整合至自動化工作流

### 限制 ⚠️
- 需要網路連線（使用線上服務）
- 商業使用需遵守 Microsoft 服務條款
- 語音選項雖多但無法完全自訂聲音
- 不支援即時串流（需先生成完整音訊檔案）

## 適用對象

- **內容創作者**：YouTuber、Podcaster、短影片創作者
- **教育工作者**：教師、線上課程講師
- **簡報製作者**：需要快速生成旁白的商務人士
- **開發者**：需要整合 TTS 功能至應用程式
- **語言學習者**：需要多語言發音示範
- **無障礙需求者**：視障人士、閱讀障礙者

## 資料來源

### Edge TTS 官方資源
- [GitHub - rany2/edge-tts](https://github.com/rany2/edge-tts)
- [edge-tts · PyPI](https://pypi.org/project/edge-tts/)
- [Edge TTS Voices - Free Text-to-Speech API](https://tts.travisvn.com/)
- [Free Text to Speech Online - 74 Languages, 322 Voices](https://edge-tts.com/)
- [Edge TTS Text To Speech - Hugging Face](https://huggingface.co/spaces/innoai/Edge-TTS-Text-to-Speech)
- [GitHub - travisvn/openai-edge-tts](https://github.com/travisvn/openai-edge-tts)
- [Audio Samples of Microsoft Edge TTS Voices](https://geeksta.net/tools/tts-samples/)

### Edge TTS 教學與應用
- [How I Used Edge-TTS to Build a Free Online Text-to-Speech Site](https://dev.to/alixwang/how-i-used-edge-tts-to-build-a-free-online-text-to-speech-site-47n9)
- [Edge TTS: The Ultimate Guide for Developers](https://videosdk.live/developer-hub/ai/edge-tts)
- [ComfyUI-EdgeTTS detailed guide](https://www.runcomfy.com/comfyui-nodes/ComfyUI-EdgeTTS)

### PowerPoint 簡報旁白相關
- [Adding Voice Narration with PowerPoint Text to Speech](https://slidemodel.com/powerpoint-text-to-speech/)
- [Text to Speech for PowerPoint Presentations](https://voice.ai/hub/tts/powerpoint-presentations/)
- [SlideNarrator - PowerPoint to Video with AI Narration](https://www.slidenarrator.com/)
- [PowerTalk - automatic speech for PowerPoint presentations](https://fullmeasure.co.uk/powertalk/)
- [How to Add High-Quality Text to Speech to PowerPoint](https://murf.ai/blog/text-to-speech-powerpoint)
- [How to Add Text-to-Speech Audio to PowerPoint](https://www.allvoicelab.com/blog/how-to-insert-text-to-speech-in-powerpoint)
