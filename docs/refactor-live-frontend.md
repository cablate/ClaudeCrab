# Live 前端重構規劃

> 狀態：規劃中（僅分析，尚未動程式碼）
> 建立日期：2026-02-18
> 更新：2026-02-19（補完功能清單）

---

## 一、現況盤點

### 檔案規模

| 檔案 | 行數 | 大小 | 備註 |
|------|------|------|------|
| `public/js/live.js` | 2,631 行 | ~99 KB | 單一 monolith，所有邏輯 |
| `public/css/live.css` | 3,307 行 | ~79 KB | 扁平結構，有區段但單一檔案 |
| `src/webui/views/live/index.ejs` | 386 行 | ~20 KB | HTML 模板，相對合理 |

### live.js 現有區段（依程式碼中的 comment 區塊）

| 行數範圍 | 內容 |
|----------|------|
| 1–826 | State、常數、SSE 連線、feed 管理、roster、活動事件處理 |
| 827–1461 | Office Scene — Sprites、Portrait Modal、Dialogue Panel、Backlog、Stats Panel |
| 1462–2390 | Game Menu — 使用量、Sessions、系統狀態、Agents 管理 |
| 2391–2583 | Sprite Edit Mode — 拖曳重新定位 |
| 2584–2631 | Title Screen |

### live.css 現有區段

已有合理的 comment 區分，共 20 個 section：
Header / Main Layout / Feed Items / Filter Buttons / Empty State / Scrollbar / Responsive /
Office Scene / RPG Dialogue Panel / Dialogue Input / Backlog Modal / Party Roster /
Game Menu（Usage / Sessions / System / Agents / Shared） / Title Screen / Edit Mode Toolbar

---

## 二、功能清單（重構前基準）

> 這份清單是重構後的驗收依據。每次改動後，逐項手動確認功能是否正常。

### F01 — 標題畫面（Title Screen）
- [ ] 開啟頁面時顯示 Galgame 風格標題畫面
- [ ] 點擊「START」或按 Enter/Space/Escape 關閉標題畫面
- [ ] 標題畫面有粒子動效（25 個浮動粒子）
- [ ] 標題畫面有燈籠 emoji 裝飾

### F02 — 辦公室場景（Office Scene）
- [ ] 顯示等距視角辦公室背景圖
- [ ] 背景圖依 localStorage 記住上次選擇（default / cny）
- [ ] 天空背景依時間段自動切換（黎明 5~8h / 白天 8~17h / 黃昏 17~19h / 夜晚）
- [ ] 天空背景每 60 秒重新檢查一次

### F03 — Agent Sprite
- [ ] 每位 agent 在辦公室場景中有對應的 sprite（圖片或 emoji fallback）
- [ ] Sprite 顯示 agent 名稱標籤
- [ ] Sprite 顯示目前心情 emoji
- [ ] Sprite 顯示對話氣泡（最新的獨白/回應訊息，截斷 40 字）
- [ ] Idle/completed 狀態：sprite 播放「呼吸」動畫
- [ ] Working 狀態：sprite 播放「工作脈動」動畫
- [ ] Phase 轉換觸發一次性動畫：task_received → 跳躍、completed → 慶祝、error → 錯誤晃動
- [ ] 心情氣泡樣式：inner thought（獨白）顯示 mutter 樣式
- [ ] 點擊 sprite 開啟 Portrait Modal
- [ ] 右鍵點擊 sprite 顯示 Context Menu

### F04 — Seat 座位系統
- [ ] Agent 依 localStorage 記住座位分配（最多 5 個預設座位）
- [ ] 座位在 reload 後保持不變
- [ ] Agent 數量超過 5 個時，額外 agent 使用 overflow 格線座位

### F05 — Party Roster（角色列表）
- [ ] 左側顯示所有 agent 的 roster 卡片
- [ ] 卡片顯示：頭像（或 emoji fallback）、角色 emoji、心情 emoji、心情條
- [ ] 心情條顏色與寬度反映當前心情（excited 綠 100% ～ tired 紅 15%）
- [ ] 卡片狀態文字：工作中顯示工作狀態，否則顯示休息時長
- [ ] 有新的個性事件時，roster 卡片出現未讀通知點
- [ ] 點擊 roster 卡片開啟 Portrait Modal，同時清除通知點
- [ ] 右鍵點擊 roster 卡片顯示 Context Menu

### F06 — Activity Feed（辦公室動態側欄）
- [ ] 右側側欄顯示即時活動串流
- [ ] 頁面載入時從 API 拉取最近 50 筆歷史事件
- [ ] 側欄可折疊/展開（按鈕切換）
- [ ] Feed 項目類型：
  - workflow（工作狀態：task_received / working / tool_use / completed / error）
  - reply（agent 回覆訊息）
  - personality（mutter 獨白 / reaction 心聲）
- [ ] workflow idle 事件不顯示在 feed
- [ ] status_change 事件不顯示在 feed
- [ ] 顯示相對時間（「剛剛」/「N 秒前」/「N 分鐘前」...），每 10 秒更新
- [ ] 最多保留 50 筆 DOM，超過自動移除最舊的
- [ ] 新事件進入有滑入動畫
- [ ] Feed 空白時顯示「暫無動態」

### F07 — Feed 篩選器
- [ ] 篩選按鈕：全部 / 工作 / 心聲
- [ ] 每位 agent 有獨立的篩選按鈕（動態產生，agent 顏色標示）
- [ ] 切換篩選即時更新 feed 顯示/隱藏

### F08 — SSE 即時連線
- [ ] 透過 `/api/activity/stream` 接收即時事件
- [ ] 連線成功：header 顯示綠色連線點
- [ ] 連線中斷：紅色連線點，自動重連（指數退避，最長 30 秒）
- [ ] 重連成功後退避時間重置為 1 秒

### F09 — Header 統計數字（HUD）
- [ ] 顯示：花費（$）、查詢次數、訊息數、完成任務數、獨白次數、uptime
- [ ] 花費 / 查詢 / uptime 每 60 秒從 API 更新
- [ ] 訊息 / 完成 / 獨白每收到事件後 debounce 1 秒更新
- [ ] 點擊「花費」或「查詢」直接開啟 Game Menu 的 Usage 頁
- [ ] 點擊「uptime」直接開啟 Game Menu 的 System 頁
- [ ] 頁面標題動態更新：有 agent 工作中時顯示工作數，否則顯示總員工數

### F10 — 時鐘
- [ ] Header 顯示即時時鐘（週N HH:MM）
- [ ] 每 60 秒更新一次

### F11 — Portrait Modal（角色對話視窗）
- [ ] 點擊 sprite 或 roster 卡片開啟
- [ ] 顯示 agent 頭像、名稱、狀態標籤
- [ ] 顯示心情 emoji（有設定圖片時顯示圖片，否則顯示文字 emoji）
- [ ] 主對話框顯示最新的 reply / mutter / reaction，typewriter 動畫效果
  - reply：20ms/字，支援 markdown 渲染
  - mutter/reaction：35ms/字（較慢，inner thought 感）
  - workflow 事件：15ms/字
- [ ] 若無事件，顯示時間感知的預設台詞
- [ ] 有新事件時自動更新對話框內容（不重複更新相同事件）
- [ ] 顯示工作中的任務 context（task_received 時）
- [ ] 點擊 backdrop 或 × 關閉，ESC 也可關閉
- [ ] 關閉時同時關閉 Backlog 和 Stats Panel

### F12 — Quick Reply 按鈕
- [ ] 對話視窗底部有快速回覆按鈕（「最近怎麼樣？」等）
- [ ] 點擊快速回覆直接發送訊息給 agent

### F13 — Dialogue Input（對話輸入框）
- [ ] 輸入框可輸入自訂訊息
- [ ] 點擊「送出」或按 Enter（Shift+Enter 換行）發送訊息
- [ ] 發送中：按鈕 disabled，顯示「傳送中...」
- [ ] 發送成功後顯示「思考中...」動畫，等待 SSE 回應
- [ ] 發送失敗顯示 Toast 錯誤通知

### F14 — Permission Prompt（工具授權互動）
- [ ] 收到 permission_request 事件時，自動開啟對應 agent 的 Portrait
- [ ] Quick Reply 區域替換為授權選項：允許 / 永遠允許 / 拒絕
- [ ] 點擊後送出決策，顯示結果，2 秒後恢復 Quick Reply

### F15 — Question Prompt（問題選擇互動）
- [ ] 收到 question_request 事件時，自動開啟對應 agent 的 Portrait
- [ ] Quick Reply 區域替換為問題選項（動態 options）+ 取消
- [ ] 點擊後送出答案，顯示結果，2 秒後恢復 Quick Reply

### F16 — Backlog Modal（劇情回顧）
- [ ] 在 Portrait 內點擊「📜 紀錄」開啟
- [ ] 顯示該 agent 所有有意義的歷史事件（user 訊息、獨白、回覆）
- [ ] 依時間正序排列（最舊在上，最新在下）
- [ ] 自動捲到最底（最新）
- [ ] 支援 markdown 渲染（reply 類型）
- [ ] 點擊 backdrop 或 × 關閉，ESC 關閉

### F17 — Stats Panel（角色屬性面板）
- [ ] 在 Portrait 內點擊「📊 屬性」開啟
- [ ] 5 個分頁：角色 / 裝備 / 排程 / 記憶 / 設定
- [ ] 分頁 lazy load（切換時才載入，不重複載入）
- **角色分頁**：
  - [ ] 顯示 agent 名稱、頭像、模型、版本、描述
  - [ ] Bot 狀態（運行中/停止），可啟動/停止
  - [ ] 24h 資源消耗條（花費 / 查詢 / IN / OUT tokens）
- **裝備分頁**：
  - [ ] 列出已安裝的 Skills
  - [ ] 可查看 Skill 內容（viewer）
  - [ ] 可移除 Skill（confirm 確認）
- **排程分頁**：
  - [ ] 列出所有排程任務（cron/interval、上次執行、下次執行）
  - [ ] 可立即執行 / 暫停 / 恢復 / 刪除排程
- **記憶分頁**：
  - [ ] 列出核心記憶檔案 + 每日日誌
  - [ ] 可查看記憶檔案內容（viewer，可返回列表）
- **設定分頁**：
  - [ ] 可修改：模型、回覆上限 token、最大回合數、權限模式
  - [ ] 可修改：委派設定（接收/發起）
  - [ ] 可修改：自主行動（啟用、模式、冷卻、上限）
  - [ ] 可修改：閒置獨白（啟用、機率、每小時上限）
  - [ ] 儲存後自動 reload agent

### F18 — Context Menu（右鍵選單）
- [ ] 右鍵點擊 sprite 或 roster 卡片出現
- [ ] 選項：💬 對話 / ✉️ 傳送訊息 / 📜 歷史紀錄 / 🔍 篩選動態
- [ ] 點擊選項執行對應動作
- [ ] 點擊選單外或按 ESC 關閉

### F19 — Game Menu（☰ 主選單）
- [ ] 點擊 Header 的 ☰ 開啟，或點擊 HUD 可點選項目跳轉
- [ ] 需要驗證，未登入顯示「需要登入」gate
- **Usage 分頁**：
  - [ ] 顯示指定期間（24h / 7d / 30d）的花費、查詢、IN / OUT tokens 匯總
  - [ ] Canvas 長條圖顯示每日花費趨勢
  - [ ] 每位 agent 的用量表格（依花費排序）
  - [ ] 切換時間期間後自動重新載入
- **Sessions 分頁**：
  - [ ] 列出所有進行中的 sessions（agent / userId / 訊息數 / 最後活躍）
  - [ ] 可手動關閉單一 session
  - [ ] 可批次清理過期 sessions
- **System 分頁**：
  - [ ] 顯示 uptime / memory 用量 / 活躍 sessions 數
  - [ ] Heap 使用量進度條
  - [ ] 列出所有 bot 狀態，可啟動/停止
- **Agents 分頁**：
  - [ ] 列出所有 agent（頭像、名稱、描述、模型、bot 狀態點）
  - [ ] 點擊 agent 開啟 Portrait Modal
  - [ ] 可 reload agent

### F20 — Sprite Edit Mode（拖曳編輯模式）
- [ ] 點擊 🔧 編輯按鈕進入編輯模式
- [ ] 進入時快照當前位置和背景（供取消還原）
- [ ] 編輯模式中可拖曳 sprite 到任意位置（pointer events，支援觸控）
- [ ] 拖曳時 sprite 有 dragging 樣式
- [ ] 工具列：可切換辦公室背景圖（預設 / CNY）
- [ ] 點擊 ✓ 儲存：位置寫入 localStorage
- [ ] 點擊 ✕ 取消：還原快照中的位置和背景

### F21 — Toast 通知
- [ ] 操作成功/失敗時顯示 Toast（3 秒後自動消失）
- [ ] 同一時間只顯示一個 Toast（新的取代舊的）

---

## 三、問題診斷

### 問題 1：JS monolith — 改壞了不知道（最高優先）

**現象：** Cab 反映「改完才發現壞掉，你沒發現」。

**根本原因：**
- 純 vanilla JS，無編譯步驟，語法錯誤只在 runtime 才爆
- 全域函式/變數約 90+ 個，全部掛在 `window`，改名或誤刪不會報錯
- DOM 查詢全部是 `document.getElementById(...)` 字串，element id 改了不會提示
- 函式互相呼叫關係隱式（無型別標注），影響範圍難以追蹤

**例子：** `updateSpriteStatus()` 呼叫 `agentCards[id]`（全域 object），
若 `agentCards` 某次更新改了 key 結構，靜默 undefined 不報錯。

### 問題 2：JS 功能職責混雜

826 行以前混雜了至少 5 個不同職責：
- SSE 連線管理（`connectSSE`、retry logic）
- Activity feed 渲染（`addToFeed`、`loadRecentFeed`、`matchesFilter`）
- Roster 管理（`createRoster`、`updateRosterCard`）
- 活動事件路由（`handleActivityEvent` → 分派到各 UI）
- 統計更新（`updateStats`、`fetchHudStats`）

**後果：** 修改 feed 渲染邏輯時，需要在 826 行混雜的上下文中找到正確位置，
容易誤改相鄰邏輯。

### 問題 3：CSS 單一檔案 3,307 行

雖然有 comment 區段，但：
- 無法獨立測試某一元件的樣式
- 修改某 component 需要在 3307 行中手動搜尋
- 選擇器的 specificity 衝突難以追蹤（例如 `.dialogue-*` 有多處散落）

### 問題 4：EJS 模板相對健康但耦合 JS ID

`index.ejs` 現況 386 行，HTML 結構清楚，但：
- 大量 `id="..."` 與 `live.js` 耦合（修改 id 需同步兩邊）
- 所有 modal 都在同一個 EJS 檔案中平鋪（title screen、dialogue、stats、backlog、game menu、edit toolbar），不容易找到某個 modal 在哪

---

## 四、重構目標

1. **改完能立刻知道有沒有壞掉**（最高優先）
2. **降低每次修改的影響範圍**（中優先）
3. **讓檔案大小可管理**（中優先）
4. **減少 CSS 衝突的可能性**（低優先）

---

## 五、重構方案

### Phase 1：加 ESLint（最小成本，立刻改善錯誤發現率）

**做什麼：** 在 `public/js/live.js` 加上 ESLint 靜態分析。

**效果：**
- 未宣告變數使用 → 報錯
- 語法錯誤 → 立刻報錯
- 常見 bad patterns（`==` vs `===`、未使用變數）→ 警告

**實作：**
- 在 `package.json` 的 `lint` 指令加入 `public/js/` 路徑
- 加 `/* eslint-disable */` 豁免舊有 pattern（逐步清理）
- 可在 `dev` workflow 中加入 `npm run lint:js` 步驟

**限制：** 只能抓靜態問題，DOM 查詢失敗、runtime 邏輯錯誤仍無法偵測。

---

### Phase 2：JS 拆模組（ES Modules，不需要 bundler）

**做什麼：** 把 `live.js` 依功能職責拆成多個 `.js` 模組。

**建議檔案結構：**

```
public/js/live/
├── live.js              ← 入口點，負責 init() 和串接各模組
├── state.js             ← 全域 state（agentCards、activityFeed 等）
├── sse.js               ← SSE 連線管理（connectSSE、retry）
├── feed.js              ← Activity feed 渲染（addToFeed、applyFilter）
├── roster.js            ← Party roster 管理（createRoster、updateRosterCard）
├── sprite.js            ← Office scene sprites（createAgentSprite、updateSpriteStatus）
├── portrait.js          ← Portrait / Dialogue Panel（openPortrait、showSpriteBubble）
├── backlog.js           ← Backlog modal（openBacklog、buildBacklogHTML）
├── stats.js             ← Stats Panel（openStatsPanel、loadStatsTab、fetchStats）
├── game-menu.js         ← Game Menu（initGameMenu、loadMenuSessions 等）
├── edit-mode.js         ← Sprite drag edit mode（initSpriteEditMode）
├── title-screen.js      ← Title screen（initTitleScreen、spawnParticles）
└── utils.js             ← 共用工具（escapeHtml、relativeTime、renderSimpleMarkdown）
```

**技術方式：** 用原生 ES Modules（`<script type="module">`），不需要 webpack/vite。

**index.ejs 改動：**
```html
<!-- 從 -->
<script src="/static/js/live.js"></script>

<!-- 改成 -->
<script type="module" src="/static/js/live/live.js"></script>
```

**效果：**
- 每個模組只負責一件事，修改影響範圍明確
- 模組之間透過 import/export，IDE 可以追蹤引用
- 沒有 import 的東西不會意外被使用
- 「改了 feed 邏輯」= 只需要看 `feed.js`（~100 行），不需要在 2631 行中找

**注意事項：**
- 全域 state（`agentCards` 等）需要集中到 `state.js` 並 export，是主要的重構工作
- `handleActivityEvent` 目前是 dispatcher，拆模組後需要小心 circular import
- 建議從最獨立的模組開始拆（`utils.js`、`title-screen.js`、`edit-mode.js`）

---

### Phase 3：CSS 拆模組（選做）

**做什麼：** 把 `live.css` 依 component 拆成多個 CSS 檔案，在 EJS 用 `<link>` 各自引入。

**建議結構：**

```
public/css/live/
├── base.css          ← CSS variables、reset、全域 typography（~36 行）
├── header.css        ← Header（~87 行）
├── layout.css        ← Main layout、sidebar（~150 行）
├── feed.css          ← Feed items、filters、empty state（~190 行）
├── office-scene.css  ← Office scene、sprites（~350 行）
├── dialogue.css      ← RPG Dialogue Panel + input（~1137 行，最大）
├── backlog.css       ← Backlog modal（~200 行）
├── roster.css        ← Party roster（~250 行）
├── game-menu.css     ← Game menu 及所有 sub-tabs（~450 行）
├── title-screen.css  ← Title screen（~230 行）
├── edit-mode.css     ← Edit mode toolbar（~100 行）
└── responsive.css    ← 所有 media queries 集中（~50 行）
```

**效果：** 修改 dialogue 樣式只需要看 `dialogue.css`，不需要在 3307 行中搜尋。

**trade-off：** EJS 需要引入 12 個 CSS 檔案，但 HTTP/2 下這不是問題。

---

### Phase 4：EJS 模板拆 partials（選做）

**做什麼：** 把 `index.ejs` 中各個大型 modal 拆成 EJS partial。

**建議結構：**

```
src/webui/views/live/
├── index.ejs                    ← 入口，只有 layout 骨架
└── partials/
    ├── title-screen.ejs         ← Title screen
    ├── dialogue-panel.ejs       ← RPG Dialogue Panel
    ├── stats-modal.ejs          ← Stats / Character Sheet
    ├── backlog-modal.ejs        ← Backlog
    └── game-menu.ejs            ← Game Menu
```

**EJS include 語法：**
```ejs
<%- include('./partials/dialogue-panel') %>
```

**效果：** 修改 Dialogue Panel HTML 時只需要看一個 ~80 行的 partial，不需要在 386 行中定位。

---

## 六、建議執行順序

| Phase | 工作 | 難度 | 改善最多的問題 |
|-------|------|------|----------------|
| Phase 1 | 加 ESLint | ★☆☆ | 改壞立刻知道（靜態層） |
| Phase 2a | 拆 utils.js、title-screen.js、edit-mode.js | ★★☆ | 降低改壞風險，最獨立好拆 |
| Phase 2b | 拆 sse.js、feed.js、roster.js | ★★★ | 核心邏輯拆分，需要 state.js |
| Phase 2c | 拆 sprite.js、portrait.js、backlog.js、stats.js | ★★★ | 最複雜 modal 邏輯 |
| Phase 2d | 拆 game-menu.js | ★★☆ | 相對獨立 |
| Phase 3 | CSS 拆模組 | ★★☆ | 降低 CSS 修改難度 |
| Phase 4 | EJS 拆 partials | ★☆☆ | 降低 HTML 修改難度 |

**最小可行改善（不做 Phase 3、4 也有顯著效果）：** Phase 1 + Phase 2

---

## 七、風險與注意事項

### ES Modules 的 CORS/Static Serving 限制

- `type="module"` 要求透過 HTTP server 提供（不能用 `file://`）
- ClaudeCab 本來就有 Express static serving，這不是問題
- 但需要確認 `public/` 的 static 路由是否支援 `.js` 的 MIME type（通常都支援）

### 全域函式暴露問題

目前 `live.js` 有部分函式可能被 inline HTML event handler 或其他地方呼叫（例如 EJS 裡的 `onclick`）。
拆模組後這些呼叫會失效，需要事先 audit：

```bash
# 找出 EJS 中直接呼叫 JS 函式的地方
grep -n "onclick" src/webui/views/live/index.ejs
```

經初步檢查，`index.ejs` 沒有 inline onclick，但需要在動工前確認。

### 測試策略

ClaudeCab 目前無前端自動化測試。重構時：
- 每拆完一個模組就要手動測試對應功能
- 保留舊的 `live.js` 作為 backup 直到全部驗證完成
- 建議逐模組進行，不要一次全拆

---

## 八、不在本次重構範圍內

- **TypeScript 遷移** — 效益高但工程量大，且需要設計 build pipeline（tsc/vite）
- **框架引入（React/Vue）** — 過度工程，目前規模不需要
- **CSS-in-JS / CSS Modules** — 需要 bundler，超出範圍
- **前端自動化測試** — 值得投資但獨立於重構

---

## 九、後續決策點

重構前需要 Cab 決定：

1. **Phase 1（ESLint）先做嗎？** — 幾乎零風險，建議先做
2. **Phase 2 要全做還是只做部分？** — 可以只拆最常修改的部分（portrait、game-menu）
3. **要不要順便做 Phase 4（EJS partials）？** — 低風險，改善 HTML 可讀性
