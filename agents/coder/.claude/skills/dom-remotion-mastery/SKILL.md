---
name: dom-remotion-mastery
description: Remotion 影片製作全方位能力。觸發時機：需要製作影片、分析影片需求、設計分鏡腳本、實作動畫元件時。能力範圍：技術實作（Remotion + 生態系整合）、行銷手法（Hook、節奏、情緒曲線）、需求收集（提問引導）、元件複用。
metadata:
  tags: remotion, video, animation, marketing, react
---

# Remotion 影片製作 Mastery

## 定位

這是公司「任意素材/文本 → 高品質行銷影片」的核心能力。

**成功標準**：做出來的影片能帶來流量。技術再好，沒人看就是失敗。

---

## 觸發條件

以下情況載入此 Skill：

1. **製作影片**：用戶要製作宣傳/教學/說明/故事型影片
2. **分析需求**：用戶描述了影片想法，需要細化需求
3. **設計分鏡**：需要規劃影片結構、時間軸、場景
4. **實作動畫**：需要寫 Remotion 元件、動畫邏輯
5. **技術視覺化**：流程圖、架構圖、操作演示等

---

## 能力架構

### 技術層

| 資源 | 說明 | 何時載入 |
|------|------|----------|
| [core-patterns.md](references/core-patterns.md) | Remotion 核心 API 模式 | 實作動畫時 |
| [ecosystem-integration.md](references/ecosystem-integration.md) | 生態系整合（D3/Three/Lottie/Rive/Skia/GIF/Anime.js） | 需要特定視覺化時 |
| [visual-catalog.md](references/visual-catalog.md) | 視覺效果目錄與實作指引 | 設計分鏡/選擇效果時 |
| `dom-remotion-best-practices` | 官方技術參考 | 查閱具體 API 細節時 |

### 行銷層

| 資源 | 說明 | 何時載入 |
|------|------|----------|
| [marketing-principles.md](references/marketing-principles.md) | 行銷手法、人性觀看規律 | 設計 Hook、規劃節奏時 |

### 互動層

| 資源 | 說明 | 何時載入 |
|------|------|----------|
| [inquiry-framework.md](references/inquiry-framework.md) | 提問引導框架 | 收集用戶需求時 |

---

## 工作流程

### 1. 需求收集階段

載入 `inquiry-framework.md`，引導用戶回答：
- 影片目的與目標受眾
- 風格偏好與時長限制
- 素材類型與核心訊息

### 2. 分鏡設計階段

載入 `marketing-principles.md` + `visual-catalog.md`：
- 根據目的選擇敘事結構
- 設計 Hook（前 3 秒）
- 規劃情緒曲線與視覺節奏
- 產出分鏡腳本

### 3. 技術實作階段

載入 `core-patterns.md` + 需要的整合指南：
- 選擇合適的動畫模式
- 實作可複用元件
- 組裝完整影片

---

## 應用場景速查

| 場景 | 關鍵元素 | 參考模板 |
|------|----------|----------|
| 產品宣傳 | Hook → 痛點 → 解法 → CTA | AgentSkillPromo |
| 技術教學 | 問題 → 原理 → 解決方案 | YJPayBugDesc |
| 功能 Demo | 傳統方式 → 新方式對比 | GPTTypeless |
| 流程視覺化 | 節點動畫 → 連線 → 整體呈現 | IronTriangle |
| 資料視覺化 | 數據動畫 → 強調重點 → 結論 | — |

---

## 關鍵數據（2026）

### 注意力統計
- 平均注意力：8.25 秒
- 前 3 秒決定是否繼續看
- 65% 觀眾在 3 秒內決定離開或停留

### 留存率基準
- 30 秒留存：約 37%
- 60 秒留存：約 20%
- YouTube 平均留存：23.7%
- TikTok < 15 秒完播率：80%

### 算法影響
- 前 30 秒維持 72% 以上留存 → 獲得更多推薦
- TikTok 需要 75% 完播率才獲得分發
- 強 Hook 可提升 58% 平均觀看時長

---

## 與其他 Skill 的關係

- **dom-remotion-best-practices**：技術細節參考，本 Skill 專注應用層
- **proj-claudecab**：影片功能可整合到 ClaudeCab Agent
- **method-building-knowledge-skill**：本 Skill 的建設方法論來源

---

## 版本與維護

- **建立日期**：2026-02-22
- **Remotion 版本**：4.0.409+
- **維護者**：Coder

### 更新時機
- Remotion 大版本更新時更新 core-patterns
- 發現新的行銷手法時更新 marketing-principles
- 實作新元件模式時更新 visual-catalog
