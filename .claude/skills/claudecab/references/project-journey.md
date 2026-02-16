# ClaudeCab 專案演化之旅

> 從一個 Telegram Bot 到多代理 RPG 辦公室 — 21 天的架構演化紀錄

---

## 專案一覽

| 指標 | 數值 |
|------|------|
| **開發期間** | 2026-01-27 ~ 2026-02-16（21 天） |
| **版本數** | v1.0 → v1.32+（34 個 ADR） |
| **核心模組** | 25+ TypeScript 模組 |
| **測試** | 396 tests |
| **Agent 數量** | 5（general、admin、leader、coder、nitterbot） |
| **技術棧** | Claude Agent SDK + grammy + SQLite + Express |

---

## 第一章：起源 — 「讓 Claude Code 可以被遠端操控」

**Day 1-2（01/27 ~ 01/28）· v1.0 → v1.7**

ClaudeCab 的起點是一個簡單需求：透過 Telegram 操控 Claude Code。第一天就做出了關鍵架構決策 —— **目錄即代理**（Directory-as-Agent）。每個 `agents/{id}/` 是一個獨立的 Claude Code 工作區，引擎層透過 `SDKQueryManager` 呼叫 SDK，零業務邏輯。

前兩天的開發節奏極其密集。在 48 小時內完成了：

- **多 Bot 架構**（ADR-007）：一個 Agent 對應一個 Telegram Bot
- **記憶系統**（ADR-008）：Agent 自主管理記憶，引擎零感知
- **串流輸出**（v1.6）：中間思考過程即時推送到 Telegram
- **權限核准 UI**（v1.7）：Telegram inline keyboard 核准工具使用

這段時期最重要的洞察是 **settingSources 隔離**（ADR-002）。SDK 的 `settingSources: ['project', 'local']` 搭配獨立 `systemPrompt`，讓每個 Agent 既能載入自己的 Skills，又不會互相污染。這個看似微小的設定，奠定了後續所有多代理架構的基礎。

> 📄 相關歸檔：[Moltbot 差距分析](_archive/research/moltbot-gap.md) — 記錄了從參考產品 Moltbot 學到的記憶系統設計

---

## 第二章：技能覺醒 — 「Bot 不只是工具，是有能力的角色」

**Day 3-6（01/29 ~ 02/01）· v1.8 → v1.11**

WebUI 管理介面和 Agent Skill 系統是這階段的雙主線。

**Skill-First 架構**（ADR-012）是一個轉折點。過去 Agent 的行為靠 system prompt 硬編，現在改為 **Description-Driven Triggering** — 每個 Skill 的 `description` 欄位就是觸發條件，Claude 自行判斷何時載入哪個 Skill。這讓 Agent 的能力可以像模組一樣插拔。

排程系統（v1.10）讓 Bot 從「被動回應者」變成「主動執行者」。Agent 可以設定 cron 任務，在指定時間自動執行查詢 — 每次執行建立獨立 session，不影響對話流。

> 📄 相關歸檔：[長期記憶研究](_archive/research/long-term-memory-research.md) — 評估了 QMD、向量 DB 等記憶方案

---

## 第三章：群聚 — 「一群 Bot 在同一個房間裡」

**Day 6-9（02/02 ~ 02/04）· v1.14 → v1.22**

群組對話是 ClaudeCab 最大的架構飛躍。

從單一 Bot 私聊到多 Bot 群組，每一步都需要新的設計決策：

1. **群組基礎**（ADR-017）：辨識群組訊息、避免自問自答
2. **多 Bot 協作**（ADR-018）：訊息去重（`chatId:date:userId:command`）、`ContextInjector` 注入其他 Bot 的回覆作為上下文
3. **Multi-Agent 生態系統**（ADR-019）：重新設計群組架構 — `GroupBroadcaster` 收到事件後觸發 `DelegationHandler`，決定誰接手任務
4. **自動委派**（ADR-021/022）：Bot 可以把任務丟給其他 Bot，支援並行多重委派和合成回覆

最關鍵的架構模式是 **EventBus 驅動**。所有群組互動都透過型別化事件傳遞（`group:message`、`bot:replied`、`activity`、`interaction`），模組間零耦合。`GroupBroadcaster` 監聽事件決定是否觸發委派、主動互動、或社交反應。

> 📄 相關歸檔：[人格設計研究](_archive/research/personality-design-report.md) — 研究了如何讓多個 Bot 有不同但協調的人格

---

## 第四章：辦公室 — 「如果 Bot 有自己的空間會怎樣」

**Day 9-12（02/04 ~ 02/08）· v1.18 → v1.25**

虛擬辦公室（ADR-020）是一個「為什麼不」的實驗。

把 Bot 的活動狀態視覺化：每個 Agent 有一個 pixel art sprite，在 isometric 辦公室場景中移動。情緒、互動、委派任務全部用即時動畫呈現。技術上是 SSE（Server-Sent Events）推送 `ActivityService` 收集的狀態變更到前端。

同期完成的功能讓辦公室從「好看」變成「有用」：

- **Bot 主動互動**（ADR-023）：Initiative Pipeline 讓 Bot 主動發言，而不是只回應
- **Social Handler**：Bot 之間自發社交互動（energyThreshold、cooldown 機制）
- **Dashboard 設定管理**（ADR-027）：WebUI 可以即時調整 Agent 參數
- **Agent Team Mode**（ADR-030）：多 Agent 並行協作處理複雜任務

> 📄 相關歸檔：[策略分析](_archive/analysis/strategy-analysis.md) — 分析了 ClaudeCab 的市場定位和差異化

---

## 第五章：角色扮演 — 「Bot 是角色，不是功能」

**Day 12-15（02/08 ~ 02/11）· Skill-Based Character System**

MMORPG 化的概念重新定義了 Bot 管理方式：

- **三層 Skill 分類**：system（基礎能力）、persona（人格特質）、domain（專業技能）
- **裝備欄**：Agent 可以「裝備」不同的 Skill 和 MCP Server
- **熟練度追蹤**：使用頻率決定等級（★☆☆☆☆ → ★★★★★）
- **資料配置策略**（ADR-034）：「換使用者還在嗎？」— Bot 狀態 vs 關係資料的分離原則

這套系統最深層的洞察：**Bot 狀態永遠是檔案**（量小、結構化、可攜）；**關係資料可以演化到 RAG**（量大、非結構化、可遷移）。兩者解耦後，各自的存儲後端可以獨立演化。

Hook 系統解耦（ADR-031）同步進行 — 將 PathValidator 從引擎硬編遷移到 Claude Code 原生 Hooks，讓每個 Agent 可以有獨立的 hook 配置。

> 📄 相關歸檔：[遷移指南](_archive/operations/migration-guide-skill-system.md) — Skill System 遷移的完整 step-by-step

---

## 第六章：Galgame 化 — 「使用者體驗就是遊戲體驗」

**Day 16-21（02/12 ~ 02/16）· Live Page 大改造**

Live Page 的 Data-Driven 重構（ADR-032）消除了前端 hardcode，所有視覺資源由 `agent.json` 驅動。這為後續的快速迭代奠定基礎。

接下來的五天是密集的 UX 演化：

- **Galgame 對話框**：粉色主題、打字機效果、立繪彈出動畫
- **日夜循環**：四個時段（dawn/day/dusk/night）的場景氛圍切換
- **RPG Party Roster**：鑽石形立繪、情緒條、Agent 專屬色彩光暈
- **互動式 Hooks**（ADR-033）：從 Live Page 直接向 Agent 發送訊息，Galgame 風格選擇肢
- **Sprite 微動畫**：根據 phase 轉換觸發不同動畫效果

整個 Live Page 從「監控 Dashboard」蛻變為「Galgame 風格虛擬辦公室」—— 使用者不是在管理 Bot，而是在經營一個 AI 角色團隊。

---

## 架構演化總覽

```
Week 1: Foundation
┌─ 目錄即代理 ─→ 多 Bot 架構 ─→ 記憶系統 ─→ Skill 系統 ─→ 排程 ─┐
│                                                                      │
Week 2: Social                                                         │
├─ 群組對話 ─→ 多 Bot 群組 ─→ 委派系統 ─→ 主動互動 ─→ 社交反應 ─────┤
│                                                                      │
Week 3: Experience                                                     │
├─ 虛擬辦公室 ─→ RPG 化 ─→ Live Page ─→ Galgame UI ─→ 互動式 Hooks ─┘
```

---

## 關鍵設計決策回顧

| 決策 | 為什麼這很重要 |
|------|----------------|
| **目錄即代理** | 引擎零業務邏輯，Agent 完全自治 — 可以無限水平擴展 |
| **settingSources 隔離** | 一個微小的 SDK 配置，讓多 Agent 共存不衝突 |
| **EventBus 驅動** | 模組間零耦合，新增行為只需訂閱事件 |
| **Description-Driven Triggering** | Skill 不用 if-else 判斷載入，由 AI 自己決定 |
| **Bot 狀態 vs 關係資料分離** | 兩條獨立演化路徑，不被存儲實作鎖死 |
| **Data-Driven UI** | `agent.json` 為唯一事實來源，前端零 hardcode |

---

## 數字說故事

| 里程碑 | 日期 | 距開始 |
|--------|------|--------|
| 第一條 Telegram 訊息 | 01/27 | Day 1 |
| 記憶系統 + 串流 | 01/28 | Day 2 |
| Agent Skill 系統 | 01/30 | Day 4 |
| 群組多 Bot 協作 | 02/03 | Day 8 |
| 虛擬辦公室上線 | 02/05 | Day 10 |
| MMORPG 角色系統 | 02/08 | Day 13 |
| Galgame UI 完成 | 02/16 | Day 21 |

---

*本文件基於 34 個 ADR、150+ commits、8 份策展歸檔文件撰寫。完整決策紀錄見 [decisions/_index.md](decisions/_index.md)，歸檔材料見 [_archive/_index.md](_archive/_index.md)。*
