# 競品/參考案例彙整

> 建立時間：2026-02-14
> 目的：彙整可參考的產品設計、UI 範例、技術實現

---

## SillyTavern

### 功能特色

**核心價值**：讓 AI 角色對話更真實、更有深度

| 功能 | 說明 | 可應用於 ClaudeCab |
|------|------|-------------------|
| **Character Card** | PNG 嵌入 JSON metadata | → Agent soul.md 優化 |
| **World Info (Lorebooks)** | 動態注入背景資訊 | → knowledge/ 關鍵字觸發 |
| **Memory Books** | 自動儲存重要記憶 | → memory/ 結構化 + 場景標記 |
| **Group Chat** | 多角色互動 | → Agent 之間對話系統 |
| **Expression Sprites** | 32 種表情圖片 | → Portrait 表情差分 |

**參考資源**：

- [Character Design | docs.ST.app](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)
- [World Info | docs.ST.app](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)
- [GitHub - SillyTavern-MemoryBooks](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)

### UI 設計要點

- 半透明對話框不遮擋角色立繪
- 角色名字框 + 頭像
- Typewriter 效果
- Expression selector（表情選擇器）

---

## Character.AI

### 對話引擎設計

**2026 改進亮點**：

| 特性 | 2023 問題 | 2026 改進 |
|------|-----------|-----------|
| **角色一致性** | 20-30 條後混亂 | PipSqueak 模型更長一致性 |
| **輸出品質** | Runaway text 段落堆疊 | 更緊湊清晰的句子 |
| **Group Chat** | 角色忽略彼此 | 角色間真正互動（英雄 vs 反派會爭執） |
| **Voice** | 無 | 即時語音通話（2026 新功能） |
| **Personality Evolution** | 固定 | 根據互動歷史調整（親密度） |

**參考資源**：

- [Character.AI in 2026: Features, Usage Guide](https://autoppt.com/blog/character-ai-evolution-complete-guide/)
- [Character.ai: A Deep Dive](https://opinly.ai/blog/cai)

### 可應用元素

- **Drift Detection**：每 10-20 條對話檢查角色是否偏移
- **Affinity Evolution**：長期互動影響對話語氣
- **Multi-Character Logic**：根據關係決定互動內容

---

## Galgame 代表作 UI

### CLANNAD

**UI 特色**：

- 清晰的對話框（半透明白底 + 細邊框）
- 角色名字 + 立繪表情差分
- 選項以卡片形式浮現
- 背景隨劇情切換（教室、街道、家中）

### Fate/stay night

**UI 特色**：

- 暗色系對話框
- 文字描邊（確保可讀性）
- CG 收集系統（Tiger Dojo）
- 多路線分支（Fate/UBW/HF）

### 視覺風格統一性

**Galgame UI 共同特徵**：

- ✅ 對話框不完全遮擋立繪
- ✅ 字體清晰（描邊/陰影）
- ✅ Typewriter 效果標準配備
- ✅ 選項卡片化呈現
- ✅ 背景/音樂隨場景變化

**參考資源**：

- [Visual Novel UI - concepts](https://www.therookies.co/projects/35318)
- [Graphical User Interface - VNDev Wiki](https://vndev.wiki/Graphical_User_Interface)

---

## 辦公室模擬遊戲 UI

### Two Point Hospital

**UI 設計亮點**（來自評論）：

- **「Seriously impressive」** — 把管理複雜度都吸收掉了
- **資訊密度平衡** — 大量資訊但不令人壓迫
- **直覺拖放操作** — 建造、移動、刪除流暢

**可應用元素**：

- Agent 拖放到不同座位
- 資源儀表板（預算、時間、士氣、品質）
- 浮動數字反饋（+XP, +Morale）

**參考資源**：

- [Two Point Hospital - Wikipedia](https://en.wikipedia.org/wiki/Two_Point_Hospital)

### Game Dev Tycoon

**核心機制**：

- **數值化一切**：Fun +5, Creativity +3
- **浮動 icon**：員工工作時小 icon 飄向統計池
- **時間流逝**：週/月/年滾動
- **升級解鎖**：研發新技術、訓練員工

**可應用元素**：

- 任務完成時 XP icon 飄向 header
- 時間軸標記重要事件
- 技能樹解鎖系統

**參考資源**：

- [Game Dev Tycoon - Wikipedia](https://en.wikipedia.org/wiki/Game_Dev_Tycoon)

### Kairosoft 系列

**設計哲學**：

- **極簡像素風**：清晰易讀
- **數值即時反饋**：每個動作都有數字變化
- **收集/升級迴圈**：員工、設備、技能

**參考資源**：

- [Game Dev Story | Kairosoft Wiki](https://kairosoft.fandom.com/wiki/Game_Dev_Story)

---

## 工作遊戲化產品

### Habitica

**核心機制**：

- 將 To-Do List 變成 RPG
- 完成任務 → 獲得 XP、金幣
- 升級角色、購買裝備
- 組隊系統（社交壓力）

**可應用元素**：

- Agent = RPG 角色（HP/MP/XP）
- 任務完成 → 升級
- 裝備系統（Tools/Skills）

**參考資源**：

- [How Streaks Leverages Gamification](https://trophy.so/blog/streaks-gamification-case-study)

### Forest

**核心機制**：

- 專注時種樹，分心則枯萎
- 累積森林（視覺化成就）
- Streak 機制

**可應用元素**：

- Agent 專注工作時「種樹」視覺化
- 累積「辦公室綠化」成就
- Streak 視覺化（連續工作天數）

---

## 動森/星露谷 NPC 互動設計

### 動物森友會

**NPC 互動特色**：

- **個性化對話**：每個村民有獨特性格
- **好感度系統**：送禮、對話增加好感
- **時間感知**：早上/晚上對話不同
- **隨機事件**：村民突然拜訪、送禮物

**可應用元素**：

- Agent 個性化對話（基於 soul.md）
- 時間感知（早/午/晚/夜對話調整）
- 隨機事件（agent 突然分享想法）

### 星露谷物語

**關係系統**：

- **好感度 0-10 心**：視覺化愛心
- **特殊事件**：達到特定心數解鎖
- **禮物偏好**：每個 NPC 有喜好
- **結婚系統**：最高好感度解鎖

**可應用元素**：

- Agent 好感度愛心視覺化
- 特殊事件解鎖（高好感度對話）
- Agent 偏好系統（喜歡被讚美 vs 喜歡獨立工作）

---

## 其他 AI Agent 可視化產品

### AI Character Engine

**特色**（來自 Showcase）：

- **Perfect NPC Consistency** — 完美的 NPC 一致性
- **Local Processing** — 本地處理（隱私）
- **Multi-character Models** — 多角色訓練

**參考資源**：

- [AI Character Engine - Perfect NPC Consistency](https://forums.unrealengine.com/t/showcase-ai-character-engine-perfect-npc-consistency-with-local-processing/2661835)

### Spicy Chat

**設計重點**：

- 角色扮演重新定義數位互動
- 持久記憶（Persistent Memory）
- 個性化體驗

**參考資源**：

- [Spicy Chat in AI – How Character Roleplay Is Redefining Digital Interaction](https://aijourn.net/spicy-chat-in-ai-how-character-roleplay-is-redefining-digital-interaction/)

---

## UI 設計資源庫

### Game UI Database

**用途**：瀏覽 1,300+ 遊戲、55,000+ UI 截圖

**分類**：

- Inventory（背包）
- Skill Tree（技能樹）
- HUD（抬頭顯示）
- Dialogue（對話框）

**網址**：[https://www.gameuidatabase.com/](https://www.gameuidatabase.com/)

### RPG UI Assets

**CraftPix.net**：

- Health/Mana Bars
- Inventory Screens
- Character Profiles
- Quest Logs

**網址**：[https://craftpix.net/categorys/rpg-game-ui/](https://craftpix.net/categorys/rpg-game-ui/)

---

## 技術實現參考

### CSS 動畫範例

**推薦資源**：

- [Animate.css](https://animate.style/) — 即用 CSS 動畫庫
- [42 Stunning CSS Animation Examples](https://wpdean.com/css-animation/)
- [CSS Animated Backgrounds](https://freefrontend.com/css-animated-backgrounds/)

### Web Audio API 範例

- [Web Audio Samples (Google Chrome Labs)](https://googlechromelabs.github.io/web-audio-samples/)
- [Pizzicato.js](http://alemangui.github.io/pizzicato/) — Web Audio 簡化庫
- [Web Audio Demos](https://webaudiodemos.appspot.com/)

### Canvas/WebGL 遊戲引擎

- [PixiJS](https://pixijs.com/) — 最快的 2D WebGL 渲染器
- [Phaser](https://phaser.io/) — HTML5 遊戲框架
- [PlayCanvas](https://playcanvas.com/) — WebGL 遊戲引擎

---

## 參考資料索引

### 遊戲化理論

- [Octalysis Framework](https://yukaichou.com/gamification-examples/octalysis-complete-gamification-framework/)
- [Gamification Market 2026](https://yukaichou.com/gamification-examples/what-is-gamification/)

### AI 角色設計

- [SillyTavern Docs](https://docs.sillytavern.app/)
- [AI Character Prompts Guide](https://www.jenova.ai/en/resources/ai-character-prompts)

### 視覺小說 UI

- [VNDev Wiki](https://vndev.wiki/)
- [Visual Novel UI Tumblr](https://visual-novel-interfaces.tumblr.com/)

### 遊戲 UI 設計

- [Game UI Database](https://www.gameuidatabase.com/)
- [UX and UI in game design](https://medium.com/@brdelfino.work/ux-and-ui-in-game-design-exploring-hud-inventory-and-menus-5d8c189deb65)

---

## 總結：參考案例應用優先級

### 高價值參考（立即可用）

1. **SillyTavern Character Card 格式** → 優化 soul.md 結構
2. **Galgame 對話框設計** → Live 頁面 UI 精緻化
3. **Game Dev Tycoon 浮動 icon** → 任務完成反饋
4. **Habitica RPG 化** → Agent XP/Level 系統

### 中期借鑒

1. **Character.AI Group Chat** → Agent 之間互動
2. **Two Point Hospital 資訊密度** → 儀表板設計
3. **動森好感度系統** → Agent 關係系統
4. **Streaks 機制** → 每日簽到與留存

### 長期靈感

1. **星露谷特殊事件** → 高好感度解鎖內容
2. **Galgame 多結局** → 里程碑/True Ending
3. **SillyTavern World Info** → 動態知識注入
4. **Live2D 動態** → Portrait 進階動畫
