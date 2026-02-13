# ClaudeCab Live 產品研究計畫

> 建立時間：2026-02-14
> 目的：全面蒐集可優化 ClaudeCab Live 體驗的設計參考、技術方案、功能靈感

## 技術約束

- 高度綁定 **Claude Agent SDK**（Claude Code CLI），不考慮其他 AI 框架
- 前端為純 HTML/CSS/JS + EJS 模板 + SSE 即時更新
- Agent 系統：目錄即代理、每個 agent 有獨立人格/記憶/技能

---

## 研究任務清單

### 1. 現況全面審查 `current-state.md`
- [ ] Playwright 截圖記錄 Live 頁面所有功能狀態
- [ ] 盤點現有 UI 元素、互動流程、功能列表
- [ ] 深入掃描 codebase：mood/phase 系統、SSE 事件流、記憶系統、scheduling、activity feed
- [ ] 找出被低度利用的機制、可擴展的架構點、潛在的組合可能

### 2. 視覺/互動設計研究 `visual-interaction.md`
- [ ] RPG 遊戲 UI pattern（血條、狀態面板、裝備欄、技能樹）
- [ ] Galgame UI 設計（對話框樣式、選項呈現、背景切換、立繪動態）
- [ ] 辦公室模擬遊戲介面（Game Dev Tycoon、Project Hospital、Two Point Hospital）
- [ ] 動畫/過場/微互動的設計手法
- [ ] 角色立繪的進階運用（表情差分、Live2D 式動態、呼吸動畫）
- [ ] 音效/配樂的氛圍營造可行性

### 3. 功能/機制研究 `features-mechanics.md`
- [ ] **SillyTavern** — 角色卡格式、世界書、記憶注入、群組聊天、擴展插件系統
- [ ] **Character.AI** — 對話引擎設計、角色一致性維持、多角色互動
- [ ] **Galgame 核心機制** — 選擇分支、好感度系統、CG 收集、結局分歧、日常/事件切換
- [ ] **模擬經營** — 資源管理、升級解鎖、員工技能樹、隨機事件
- [ ] **成就/收集系統** — 圖鑑、里程碑、隱藏成就、streak 機制
- [ ] **進度可視化** — 經驗值、等級、排行榜、統計儀表板

### 4. 內容/敘事設計研究 `narrative-content.md`
- [ ] Prompt engineering 人設塑造最佳實踐（SillyTavern 角色卡結構深入分析）
- [ ] 情感表達的語言設計（動作描述、內心獨白、語氣變化、表情標記）
- [ ] 角色關係系統設計（好感度、默契值、信任層級）
- [ ] 長期記憶的敘事價值（回憶、成長弧線、共同經歷）
- [ ] 世界觀/情境構建（辦公室日常、突發事件、季節/節日）
- [ ] 對話品質提升：如何讓 agent 回覆不只是「完成任務」而是有溫度的互動

### 5. 心理/體驗設計研究 `psychology-experience.md`
- [ ] 遊戲化激勵理論（Self-Determination Theory、Flow Theory、Octalysis 框架）
- [ ] 「有溫度」互動的關鍵要素分析
- [ ] 進度感/成就感/探索感的節奏設計
- [ ] 沉浸感的維持與破壞因素
- [ ] 長期留存的心理機制（習慣迴路、社交連結、沉沒成本）
- [ ] 工作場景 vs 娛樂場景的遊戲化差異

### 6. 技術實現可行性 `technical-feasibility.md`
- [ ] Claude Agent SDK 框架下的能力邊界與擴展點
- [ ] 現有 codebase 架構分析 — 每個模組的擴展潛力
- [ ] SSE 事件流能承載的新互動類型
- [ ] Agent 記憶/人格系統的深度利用方案
- [ ] Scheduling + mood + phase 組合出的行為模式可能性
- [ ] 前端技術可行性（CSS 動畫、Canvas、WebGL、Web Audio）
- [ ] 開源專案/library 可直接使用的資源
- [ ] 效能考量與快取策略

### 7. 競品/參考案例彙整 `references-catalog.md`
- [ ] SillyTavern — 功能截圖 + 架構分析
- [ ] Character.AI — 互動設計分析
- [ ] Galgame 代表作 UI 截圖（CLANNAD、Fate/stay night、星空列車等）
- [ ] 辦公室模擬遊戲 UI（Game Dev Tycoon、Kairosoft 系列）
- [ ] Habitica / Forest 等工作遊戲化產品
- [ ] 動森/星露谷的 NPC 互動設計
- [ ] 其他 AI agent 可視化產品

---

## 研究原則

1. **不輕易停止** — 每個類別都要深入，反覆檢查有無遺漏
2. **具體可落地** — 每個靈感都要思考「在 ClaudeCab 怎麼實現」
3. **考量技術約束** — 所有方案都在 Claude Agent SDK + 現有前端架構下可行
4. **分層優先級** — 標記 quick win / 中期 / 長期願景
