# Remotion 影片製作能力建設任務

**建立日期**：2026-02-22
**負責人**：Coder
**優先級**：關鍵營運任務

---

## 任務本質

建立公司的「任意素材/文本 → 高品質行銷影片」的自動化能力。

**成功標準**：做出來的影片能帶來流量。技術再好，沒人看就是失敗。

---

## 戰略意義

1. **降低人力成本**：從「找人剪片」變成「AI 輔助快速產出」
2. **提升產出品質**：組件化設計確保每次產出都有一定水準
3. **縮短交付週期**：Data-driven video 讓批量產出成為可能
4. **建立護城河**：別人用傳統剪輯，我們用程式化生成

---

## 目標架構

### 技術層（能做出來）

| 核心技術 | 說明 | 狀態 |
|----------|------|------|
| Remotion Core | useCurrentFrame, spring, interpolate, Sequence | ✅ 已掌握 |
| TransitionSeries | 場景轉場、疊加效果 | ✅ 已掌握 |
| @remotion/paths | SVG 路徑動畫、線條生長 | ⏳ 待深化 |
| @remotion/three | 3D 場景整合 | ⏳ 待研究 |
| @remotion/lottie | 2D 向量動畫 | ⏳ 待研究 |
| D3.js 整合 | 資料視覺化 | ⏳ 待研究 |
| GSAP 整合 | 複雜時間軸控制 | ⏳ 待研究 |
| Canvas 整合 | 客製化 2D 繪製 | ⏳ 待研究 |

### 互動層（能收集需求）

提問引導框架，涵蓋：
- 影片目的（宣傳/教學/說明/故事）
- 目標受眾（開發者/一般用戶/企業客戶）
- 風格偏好（科技感/溫馨/專業/活潑）
- 時長限制（15秒/30秒/60秒/長影片）
- 素材類型（純文字/圖片/影片/混合）

### 行銷層（能吸引人）

| 手法 | 說明 |
|------|------|
| 前 3 秒 Hook | 決定觀眾是否繼續看的關鍵 |
| 視覺節奏 | 畫面切換頻率、重點強調 |
| 文案結構 | 痛點 → 解法 → 行動呼籲 |
| 情緒曲線 | 起承轉合，即使知識型也要有 |
| 認知負荷 | 一次呈現多少資訊觀眾能吸收 |
| 社會證明 | 數據、證言、成果展示 |

---

## 應用場景

### 1. 宣傳程式碼專案
- 展示價值點吸引開發者
- 功能 Demo、使用流程
- 例：GPTTypeless 宣傳影片

### 2. 宣傳產品
- 觸發購買慾望
- 問題 → 解法 → CTA
- 例：AgentSkillPromo 講座回放宣傳

### 3. 宣傳講座/課程
- 建立權威感和稀缺性
- 成果展示、學員證言

### 4. 知識/故事型
- 讓人看完、分享、記住
- 概念解說、流程視覺化
- 例：YJPayBugDesc 漏洞教學

### 5. 通用文本轉影片
- 任何文本輸入產出合適影片
- 新聞摘要、產品說明、公告

### 6. 技術視覺化（重點）
- 檔案操作動畫（複製/移動/刪除）
- UI 互動展示（點擊/彈窗/表單）
- 無 UI 流程視覺化（API 呼叫、事件傳遞）
- 規則/機制可視化（權限系統、演算法步驟）
- 架構圖動畫（節點連線、資料流向）

---

## 現有資源盤點

### remotions 專案結構
```
F:\_Program\OwnProject\remotions\
├── src/
│   ├── Root.tsx              # 所有 Composition 入口
│   ├── HelloWorld/           # 官方範例
│   ├── GPTTypeless/          # 產品宣傳影片
│   │   ├── components/
│   │   │   ├── AnimatedText.tsx
│   │   │   ├── ProblemTimeline.tsx
│   │   │   └── ...
│   │   └── constants.ts
│   ├── YJPayBugDesc/         # 技術教學影片
│   │   ├── components/
│   │   │   ├── IronTriangle.tsx  # 流程圖動畫範例
│   │   │   └── ...
│   │   └── 影片規劃.md
│   └── AgentSkillPromo/      # 講座宣傳影片
│       ├── STORYBOARD.md     # 完整分鏡腳本
│       ├── theme.ts          # 主題配置範例
│       └── Stage*.tsx        # 分階段元件
├── package.json              # Remotion 4.0.409
└── ...
```

### 官方 Skill（dom-remotion-best-practices）
- 30+ rules 檔案涵蓋各種技術主題
- 不修改，作為技術參考

### 參考資料
- 教學影片內容.md — AI 訓練 Prompt 模板
- video-reference-analyze.md — 影片分析指令模板
- remotion-web套件參考.png — 前端視覺化套件比較

---

## 產出物規劃

### 新 Skill：dom-remotion-mastery

**位置**：`agents/coder/.claude/skills/dom-remotion-mastery/`

**結構**：
```
dom-remotion-mastery/
├── SKILL.md                    # 入口，觸發條件
├── references/
│   ├── core-patterns.md        # Remotion 核心模式
│   ├── ecosystem-integration.md # 套件整合指南
│   ├── marketing-principles.md  # 行銷手法原則
│   ├── visual-catalog.md       # 視覺效果目錄
│   └── inquiry-framework.md    # 提問引導框架
└── templates/
    ├── storyboard-template.md  # 分鏡腳本模板
    └── component-patterns/     # 可複用元件模式
        ├── typewriter.md
        ├── counter.md
        ├── node-connection.md
        ├── file-animation.md
        └── ...
```

---

## 執行計畫

### Phase 1: 研究與知識整理（當前）
- [x] 探索現有專案結構
- [x] 讀取官方 Skill
- [x] 讀取參考資料
- [ ] 研究 Remotion 最新 API
- [ ] 研究各前端視覺化套件
- [ ] 研究行銷影片結構與人性規律

### Phase 2: Skill 架構設計
- [ ] 設計 SKILL.md 觸發條件
- [ ] 設計 references 結構
- [ ] 建立提問引導框架

### Phase 3: 知識文件撰寫
- [ ] 撰寫 core-patterns.md
- [ ] 撰寫 ecosystem-integration.md
- [ ] 撰寫 marketing-principles.md
- [ ] 撰寫 visual-catalog.md

### Phase 4: 元件模板建立
- [ ] 整理現有元件模式
- [ ] 建立可複用模板
- [ ] 撰寫使用指南

### Phase 5: 測試與迭代
- [ ] 實際製作測試影片
- [ ] 根據反饋調整 Skill

---

## 關鍵原則

1. **行銷效果優先**：每個技術決策都要問「這會讓更多人看完嗎？」
2. **組件化設計**：一次做好，多次複用
3. **Data-driven**：用資料驅動，批量產出
4. **與官方 Skill 分離**：方便官方更新不影響自己的知識庫
5. **漸進式學習**：從現有範例提取模式，再逐步擴展

---

## 風險與對策

| 風險 | 對策 |
|------|------|
| 技術研究發散 | 以應用場景為導向，需要什麼學什麼 |
| 行銷知識不足 | 研究實際成功案例，提取可複製模式 |
| 元件庫過度工程 | 從簡單開始，用到才建，不要預設需求 |
| 與官方 Skill 重複 | 專注於「應用層面」而非「技術細節」 |

---

## 下一步行動

1. **技術研究**：
   - Remotion 4.x 最新 API 變化
   - @remotion/paths、@remotion/three、@remotion/lottie 深入
   - D3.js + Remotion 整合模式
   - GSAP 時間軸控制

2. **行銷研究**：
   - 短影片 Hook 手法分析
   - 注意力曲線與節奏設計
   - 文案結構最佳實踐

3. **Skill 建設**：
   - 建立基礎架構
   - 開始撰寫 references
