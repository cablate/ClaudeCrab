# ClaudeCab 產品定位

> **核心理念**：輕量級多代理框架，讓 Claude Code 成為可被遠端操控的專業助手。

---

## 產品定位聲明

ClaudeCab 是一個**輕量級多代理 Telegram Bot 框架**，專注於：

1. **目錄即代理** - 每個 `agents/{id}/` 目錄是獨立的 Claude Code 工作區
2. **通訊介面** - Telegram 等通訊軟體作為使用者操作介面
3. **智慧記憶** - Agent 具備學習與記憶能力
4. **任務理解** - 支援主動與被動任務處理
5. **排程監控** - Cron 等定時任務支援

---

## 我們是什麼

| 特性 | 說明 |
|------|------|
| 輕量部署 | 一個 `npm start` 即可運行 |
| 工作區隔離 | 每個 Agent 有獨立的 MCP、Skills、Memory |
| 遠端控制 | 透過 Telegram 隨時隨地操控 Claude Code |
| 專注任務 | 每個 Agent 可專門化處理特定領域 |

## 我們不是什麼

| 不做 | 原因 |
|------|------|
| 全能 AI 平台 | 專注核心價值，不追求功能全包 |
| 瀏覽器自動化平台 | 交給專門工具（Moltbot、Playwright），透過 MCP 整合即可 |
| 即時通訊替代品 | Telegram 是介面，不是我們要重造的輪子 |
| 複雜基礎設施 | 保持簡單，降低部署與維護成本 |

---

## 核心架構

```
ClaudeCab
├── 🤖 多代理系統
│   └── agents/{id}/          # 目錄即代理
│       ├── agent.json        # 代理配置
│       ├── CLAUDE.md         # 工作區指令
│       ├── .mcp.json         # MCP servers（SDK 自動載入）
│       └── .claude/
│           ├── settings.local.json
│           └── skills/       # Skills（SDK 自動載入）
│
├── 📡 Activity Event Layer（v2.0 新增）
│   ├── 結構化事件流（所有 bot 行為 → 事件）
│   ├── 人格化反應（任務吐槽、工作嘀咕、閒置碎念）
│   └── SSE/WebSocket 串流（前端即時訂閱）
│
├── 💬 通訊層（事件消費者之一）
│   ├── Telegram Bot（主要）
│   └── 未來擴展（Discord、Slack...）
│
├── 🧠 智慧層
│   ├── Memory System（記憶與學習）
│   ├── 任務理解（主動/被動）
│   └── Cron 排程（定時任務）
│
└── 🌐 展示層（事件消費者之二）
    ├── Virtual Office 前端（agent 即時狀態 + 活動流）
    └── Agent 管理介面
```

---

## 核心概念

### 目錄即代理

每個 `agents/{id}/` 是獨立的 Claude Code 專案，擁有：
- `.claude/settings.local.json` — 權限配置
- `.claude/skills/` — Agent Skills（協議、人格）
- `CLAUDE.md` — 系統提示詞
- `agent.json` — ClaudeCab 元資料
- Workspace 檔案（USER.md, MEMORY.md, memory/）

### SDKQueryManager 可獨立抽離

SDK 整合層只接收 `systemPrompt` + `cwd`，不注入任何業務邏輯。設計目標是可以從 ClaudeCab 整個帶走到其他專案使用。

### Agent 自主管理

記憶系統完全由 Agent 透過 CLAUDE.md 指令自行操作，引擎層（`src/`）零感知。不建立「組裝層」注入記憶內容到 systemPrompt。

---

## 功能開發原則

> 詳見 [principle.md](principle.md)

---

## 發展路線圖

### Phase 1：核心穩固 ✅
- [x] 目錄即代理架構
- [x] Telegram Bot 整合
- [x] Claude Agent SDK 整合
- [x] MCP + Skills 支援
- [x] Memory System
- [x] WebUI 管理介面

### Phase 2：智慧任務 ✅
- [x] Cron 排程系統（v1.10）
- [x] 主動通知（Agent → User）（v1.10）
- [x] Agent Skill 系統（v1.11）
- [ ] 任務 Queue 管理
- [ ] 事件驅動喚醒

### Phase 3：角色活起來（Demo Day 衝刺）🔥 當前
- [ ] Activity Event Layer（所有 bot 行為變成結構化事件）
- [ ] 人格化反應（接到任務吐槽、工作中嘀咕、完成後感想）
- [ ] 前端展示層（Web UI 渲染 agent 即時狀態與活動）
- [ ] Idle 生命感（閒置時三不五時冒出碎碎念）

### Phase 3.5：虛擬辦公室（概念確認）
- [ ] Isometric 像素風辦公室背景（AI 生圖）
- [ ] Agent 小人 sprite（每個 agent 2-3 姿勢：idle/working/talking）
- [ ] 座位定位系統（背景圖上 absolute positioning）
- [ ] 即時狀態 overlay（狀態燈、氣泡、當前動作）
- [ ] 點擊小人 → 展開完整立繪面板（大圖 + 名字 + 人格描述 + 最近活動）
- [ ] Agent 立繪（每個 agent 一張，AI 生圖）

設計概念：兩層結構
- **全景層**：像素小人在辦公室座位上，一眼看全局狀態
- **個體層**：點擊角色彈出立繪面板，深入看個體資訊

美術資源：全部 AI 生圖（Banana Pro），風格已錨定
程式基礎：現有 WebUI live page + SSE + activity data 已可支撐

#### 美術風格規範

**整體風格**：精緻光影動漫風——有環境光源、空氣感、柔和光影渲染的 semi-realistic anime

**風格偏好備註（2026-02-12）**：
比較了所有立繪後，確認偏好的風格是 Coder（紫髮）和 Cozy（粉髮）那種：
- 有明確**光源方向**（側光/頂光），而非均勻平塗
- 髮絲有**高光層次和透光感**
- 膚色有**暖色漸層**，不是單一色塊
- 衣服材質有**陰影體積感**
- 整體有「畫面在發光」的精緻氛圍感
- 參考風格：Makoto Shinkai 電影角色質感、京アニ光影處理

不喜歡的方向：純平塗 cel-shaded（如 Leader、Analyst），光影層次少，像設定集而非場景中的角色。

**立繪 style 錨定 prompt（共用前綴）**：
```
anime illustration, semi-realistic anime style,
soft detailed lineart with varying line weight,
warm natural lighting from upper left, visible light source direction,
soft ambient occlusion, subtle rim lighting on hair and shoulders,
hair with translucent highlights and volumetric shading,
skin with warm gradient tones and gentle blush,
fabric with soft shadow folds showing volume and material texture,
atmospheric glow, slight depth of field feel,
studio Kyoto Animation / Makoto Shinkai aesthetic,
rich but soft color palette with warm undertones,
pure solid white background, sharp clean character outline,
no glow no blur on edges, high contrast with background,
no background elements, no objects, no monitor, no screen, no furniture,
upper body portrait
```

**生成品質要求**：
- **必須使用 2K 以上解析度**（`imageSize: "2K"`），低解析度會導致光影細節丟失、退化成平塗風格
- **角色描述要具體化光影互動**：不只寫「silver hair」，要寫「delicate silver hair catching warm light with translucent glow」
- **衣服材質要明確**：不只寫「blue jacket」，要寫「navy blue cable-knit cardigan with visible texture weave」
- **膚色要描述漸層**：加上「soft blush on cheeks」「warm skin tones with subtle shadow under chin」
- 避免籠統描述（如 "friendly expression"），改用具體五官狀態（如 "bright amber eyes, slight upward curve of lips, relaxed eyebrows"）

**品質檢查清單**（生成後對照）：
- [ ] 髮絲是否有高光層次和透光感？（不是單色色塊）
- [ ] 膚色是否有暖色漸層？（不是均勻單色）
- [ ] 衣服是否有陰影體積感？（不是平塗填色）
- [ ] 是否能看出光源方向？（左上方打光）
- [ ] 整體是否有「畫面在發光」的氛圍感？
- 未通過 → 重新生成，不要妥協

**辦公室背景 prompt**：
```
Isometric pixel art office space, top-down 45-degree view,
spacious modern startup office with distinct zones:
- open workspace area with 6-8 desk stations with monitors and ergonomic chairs,
- cozy lounge corner with sofa and bean bags,
- meeting room with glass walls and round table,
- kitchen area with coffee machine, snack bar, mini fridge,
- whiteboard wall covered in sticky notes and diagrams,
- bookshelf filled with books and figurines,
- server rack corner with blinking LEDs,
- entrance area with shoe rack and coat hooks,
scattered details: potted plants, desk toys, mugs, headphones on desks,
cat sleeping on sofa, pizza box on meeting table,
warm ambient lighting with desk lamps,
16-bit retro pixel art aesthetic, soft pastel colors,
no characters, all seats empty,
game asset style, high detail environment
```

**小人 sprite prompt 模板**：
```
Single pixel art character sprite, isometric view,
[POSE: sitting pose with hands forward / sitting leaning back relaxed / standing gesturing with one hand],
no furniture, no desk, no chair, no objects, character only, isolated sprite,
[CHARACTER DESC],
chibi proportions, 64x64 pixel style,
clean edges, PURE SOLID WHITE BACKGROUND,
no transparency, no checkered pattern, no gradient background,
consistent art style, game asset, 16-bit aesthetic
```
注意：小人生成時用對應立繪做 inputImagePath 以鎖定角色特徵。
最終尺寸用工具（sharp/imagemagick）統一縮放，不靠 prompt 控制比例。

**去背要點**：所有素材統一純白背景 + 銳利輪廓 → sharp threshold 去背（RGB > 240 → 透明）或 remove.bg。立繪去背後保留原圖（*-nobg.png 命名）。小人不帶家具，家具由背景圖提供。

**角色生成流程**（每個 agent 依序執行）：
1. 生立繪 → 調整到滿意為止（錨定角色設計、配色、氣質）
2. 用立繪做 image reference → 生小人 idle 姿勢（錨定像素風比例和配色）
3. 用小人 idle 做 reference → 生其他姿勢變體（working / talking）

原則：風格一致性由上往下鎖定，每步都用前一步的成品做 reference

**角色表情包生成**：
用立繪做 reference，生成每個 agent 專屬的表情圖集——取代通用 emoji。
類似 Discord 自訂表情 / LINE 貼圖概念，每個 reaction 都是角色自己的臉。

生成流程：立繪（錨定角色）→ 用立繪 reference + emoji 描述 → 生成對應表情小圖

常用表情清單（依實際 reaction 使用頻率決定優先級）：
😀😂🤔😤👍❤️😱🫠💤🔥 等

效果：activity feed 的 reaction 從通用 emoji 變成角色專屬表情，生動感大幅提升

### Phase 4：生態整合
- [ ] 更多通訊平台支援
- [ ] MCP Server 市集整合
- [ ] Skills 安裝簡化
- [ ] 多使用者支援

---

## 實測洞察：使用場景定位（2026-02-08）

經過群組多 bot 協作實測後，產出以下產品定位洞察。

### ClaudeCab 的甜蜜點

| 場景 | 適合度 | 說明 |
|------|--------|------|
| 手機遠端指揮 | ★★★★★ | 不在電腦前，透過 Telegram 叫 bot 做事 |
| 快速排程 | ★★★★★ | 「幫我每天早上跑一次 X」馬上生效 |
| 被動小任務 | ★★★★☆ | 「幫我查一下 X」「記住這個決定」 |
| 知識累積 | ★★★★☆ | 記憶系統讓 bot 持續學習，下次對話接得上 |
| 大型工作的前置準備（備料） | ★★★☆☆ | 多角色分頭研究、整理需求，但最終執行回歸 Claude Code |
| 密集開發任務 | ★★☆☆☆ | Telegram 介面 + 多 agent 協調成本太高，Claude Code 直接做更好 |

### 備料 vs 做菜

ClaudeCab 群組協作的價值在「分頭處理不同類型任務後彙報」（備料），而不是「一起寫同一個功能」（做菜）。大型工作的最佳流程：

```
ClaudeCab（備料）                    Claude Code（做菜）
├─ 秘書研究市場資料                  ├─ 拿著研究結果直接實作
├─ 工程師做技術可行性分析            ├─ 基於分析結果寫完整功能
├─ 大總管整理需求、拆分任務          ├─ 一個 agent 端到端完成
└─ 結果都存在記憶/知識庫裡           └─ 讀取知識庫，站在備料上做菜
```

### Skill 培養皿概念

ClaudeCab 的另一個核心價值：**每個 bot 都是 skill 的訓練器**。

- Bot 在日常使用中透過記憶系統累積領域知識
- 透過反覆執行同類任務，磨出最佳實踐
- 透過 persona + protocol 穩定行為品質
- 最終產出的是**一套可攜帶的 skill 檔案**（純 markdown，零依賴）

Skill 的可移植性：
- 直接複製到其他 Claude Code 專案
- 匯入到別人的 ClaudeCab 實例
- 適用於任何支援 system prompt 的 AI 系統

**定位重構**：ClaudeCab 不只是 bot 框架，也是 skill 培養皿 — bot 不是最終產品，bot 養出的 skill 才是。

### 待探索方向（概念階段）

以下為概念性記錄，尚未排入開發優先級：

- **Skill 品質追蹤**：哪些 skill 被用最多、效果如何
- **Skill 匯出/匯入工具**：一鍵打包可攜帶的 skill 集合
- **Skill 版本管理**：追蹤 skill 的演化過程
- **Skill 市集**：分享與發現社群養出的 skill

---

## 競品定位

| 項目 | 定位 | ClaudeCab 差異 |
|------|------|---------------|
| **Moltbot** | 全功能 AI Agent 平台 | 我們更輕量、專注 |
| **Claude Code** | 本地開發助手 | 我們讓它可被遠端操控 |
| **AutoGPT** | 自主 AI Agent | 我們更可控、更實用 |
| **n8n/Zapier** | 自動化工作流 | 我們以 AI 為核心 |

---

## 版本歷程

- **v1.0** - 基礎架構：目錄即代理、Telegram 整合
- **v1.5** - SDK 整合：Claude Agent SDK、Memory System
- **v1.8** - WebUI：Agent 管理介面
- **v1.9** - 專門化：MCP + Skills 支援
- **v1.10** - 排程系統：Agent-Driven Scheduling
- **v1.11** - Skill 系統：協議與人格模組化
- **v1.22** - 群組協作基礎設施（ADR-026）
- **v1.26** - 並行委派 + 協作失控防護（ADR-030）
- **v1.27** - Social Mode + 噪音過濾
- **v2.0** - 角色活起來：Activity Event Layer + 展示層前端（當前衝刺）
- **v3.0** - 生態整合（規劃中）

---

*最後更新：2026-02-09*
