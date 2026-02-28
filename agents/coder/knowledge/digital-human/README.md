# 數字人（Digital Human）知識庫

> 最後更新：2026-02-24

本知識庫涵蓋數字人（AI Avatar）的完整技術生態，從基礎概念到實作部署。

## 📚 目錄

| 文件 | 內容 | 適合對象 |
|------|------|----------|
| [01-概念與技術原理](./01-概念與技術原理.md) | 數字人分類、技術棧、核心原理 | 所有人 |
| [02-開源專案](./02-開源專案.md) | GitHub 開源專案整理與比較 | 開發者 |
| [03-平台與服務](./03-平台與服務.md) | 商業 SaaS 平台定價與功能 | 決策者、快速驗證 |
| [04-實作指南](./04-實作指南.md) | 從零開始搭建數字人系統 | 開發者 |
| [05-直播技術架構](./05-直播技術架構.md) | 推流、WebRTC、彈幕系統 | 技術架構師 |

---

## 🚀 快速開始

### 想要快速驗證想法？
→ 使用 [HeyGen](https://www.heygen.com) 或 [D-ID](https://www.d-id.com)，5 分鐘內產出數字人視頻。

### 想要自建系統？
→ 從 [Fay](https://github.com/xszyou/Fay) 開始，一站式框架，僅需 CPU 即可運行。

### 想要直播帶貨？
→ 參考 [實作指南](./04-實作指南.md) 的直播架構和 [直播技術架構](./05-直播技術架構.md)。

---

## 🔧 核心技術棧

```
用戶輸入 → ASR（語音識別）→ LLM（理解+生成）→ TTS（語音合成）→ THG（數字人驅動）→ 視頻輸出
```

| 模組 | 開源推薦 | 商業推薦 |
|------|----------|----------|
| ASR | Whisper、FunASR | Azure Speech |
| LLM | DeepSeek、Qwen | GPT-4、Claude |
| TTS | CosyVoice、GPT-SoVITS | Azure TTS |
| THG | MuseTalk、SadTalker | HeyGen、D-ID |

---

## 💰 成本概覽

| 方案 | 月成本 | 適合 |
|------|--------|------|
| 純商業 API | $100-500 | 快速驗證、非技術團隊 |
| 混合方案 | $300-800 | 平衡成本與品質 |
| 全自建 | $800-2000 | 技術團隊、長期專案 |

---

## ⚠️ 注意事項

1. **平台政策**：抖音要求數字人直播必須由真人驅動進行即時互動
2. **延遲要求**：電商直播建議端到端延遲 < 2 秒
3. **合規風險**：各平台對 AI 數字人的政策持續更新，需關注最新規定

---

## 📖 參考資源

### 主要開源專案
- [Fay](https://github.com/xszyou/Fay) - 數字人 MCP 框架
- [Linly-Talker](https://github.com/Kedreamix/Linly-Talker) - 數字人對話系統
- [MuseTalk](https://github.com/TMElyralab/MuseTalk) - 即時唇形同步
- [CosyVoice](https://github.com/FunAudioLLM/CosyVoice) - 多語言 TTS
- [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) - 聲音克隆

### 商業平台
- [HeyGen](https://www.heygen.com) - AI 視頻生成
- [D-ID](https://www.d-id.com) - 即時數字人 API
- [Synthesia](https://www.synthesia.io) - 企業級視頻平台

---

## 更新紀錄

- **2026-02-24**：初始版本，涵蓋基礎概念、開源專案、商業平台、實作指南、直播架構
