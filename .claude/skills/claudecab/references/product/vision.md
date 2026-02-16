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

### Phase 2：智慧任務 🔶
- [x] Cron 排程系統（v1.10）
- [x] 主動通知（Agent → User）（v1.10）
- [x] Agent Skill 系統（v1.11）
- [ ] 任務 Queue 管理
- [ ] 事件驅動喚醒

### Phase 3：角色活起來 ✅
- [x] Activity Event Layer（所有 bot 行為變成結構化事件）
- [x] 人格化反應（接到任務吐槽、工作中嘀咕、完成後感想）
- [x] 前端展示層（Web UI 渲染 agent 即時狀態與活動）
- [x] Idle 生命感（閒置時三不五時冒出碎碎念）

### Phase 3.5：虛擬辦公室 ✅
- [x] Isometric 像素風辦公室背景（AI 生圖）
- [x] Agent 小人 sprite（idle/working 動畫）
- [x] 座位定位系統（動態分配 + localStorage 持久化）
- [x] 即時狀態 overlay（mood emoji、氣泡、工作光環）
- [x] 點擊小人 → 展開完整立繪面板（Galgame 風格演出）
- [x] Agent 立繪 + 表情差分 emoji（AI 生圖，Q 版精緻風）
- [x] 打字機效果（氣泡 + 對話框）
- [x] Mutter 思考泡泡視覺區分
- [x] Portrait 開關動畫（立繪滑入 + 對話框升起）

### Phase 3.7：Galgame 延伸（規劃中）

以 Galgame/Visual Novel 互動模式為方向，逐步深化 Live 頁面體驗。

#### 高優先
- [x] **互動選項（選択肢）** — ✅ v1.33 完成。Quick Reply + 自由輸入框，Web/Telegram 共享 session，即時 SSE 回應。
- [x] **對話紀錄（Backlog）** — ✅ v1.32 完成。Backlog modal，標記類型/時間/mood，oldest-first 排序。

#### 中優先
- [x] **日夜場景氛圍** — 根據實際時間改變 office 背景色調（晨光/日間/黃昏/夜晚 CSS filter overlay）；低成本高氛圍感。
- [x] **立繪微演出** — 收到任務時立繪輕微跳起；完成任務時閃光/星星粒子；出錯時震動+微紅閃；純 CSS 動畫。

#### 低優先
- [ ] **音效層（SE/BGM）** — 收到訊息提示音、工作中鍵盤聲、完成成就音效、氣泡出現音效、背景 lofi（可選開關）
- [ ] **角色間互動（群像劇）** — 委派任務時 sprite 間顯示連線/箭頭；多角色同框 portrait 面板
- [ ] **事件 CG** — 里程碑事件（第 100 個任務、新 agent 加入）顯示特殊全螢幕慶祝圖（AI 即時生成）