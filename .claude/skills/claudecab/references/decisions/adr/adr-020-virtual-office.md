# ADR-020: 虛擬辦公室模式可行性評估與改進路線圖

**狀態**：📋 proposed（評估完成，待實作）
**日期**：2026-02-03
**相關**：ADR-017, ADR-018, ADR-019

---

## 背景

### 動機

OpenClaw 等產品展示了「虛擬辦公室」模式 — 多個 AI Agent 各有專長和人格，在同一個群組中像真實團隊一樣協作。每個 Agent 扮演不同角色（秘書、工程師、研究員、文案、資安等），用戶像老闆一樣下達指令，Agent 之間能看到彼此的回覆、知道彼此的存在、各司其職。

**用戶期望**：
> 「把它打造成偷懶辦公室——自己構建員工、給他們技能、給他們 OS。像老闆在外面工作，一句話馬上有員工幫忙。」

### 核心問題

ClaudeCab 架構是否能支撐這種「虛擬辦公室」模式？基於 ADR-019 的 Context Injection 機制，多 Bot 群組協作的基礎已經建立，但距離「流暢的團隊協作」還有多遠？

---

## 現有架構誠實評估

### 已具備的能力

| 能力 | 實作狀態 | 機制 |
|------|---------|------|
| 多 Bot 同群 | ✅ 運作中 | PlatformOrchestrator 為每個 Agent 啟動獨立 TelegramAdapter |
| @mention 路由 | ✅ 運作中 | GroupBroadcaster 解析 @username，只有被提及的 Bot 回應 |
| Bot 看到彼此回覆 | ✅ 運作中 | ContextInjector 從 group_messages 表注入歷史訊息 |
| 增量注入避免重複 | ✅ 運作中 | per-bot cursor（autoincrement ID），排除自己的回覆 |
| 內容去重 | ✅ 運作中 | content-based hash + 300ms 時間窗口 |
| Per-bot message ID | ✅ 運作中 | perBotMessageIds 映射解決 Telegram 群組 reply_to 問題 |
| 私聊 / 群聊隔離 | ✅ 運作中 | effectiveUserId: `group::chatId` vs `userId` |
| 群組訊息持久化 | ✅ 運作中 | group_messages + group_injection_state 表 |

### 實際運作流程（已驗證）

```
T0: 用戶 @kevin 查天氣
    → GroupBroadcaster 路由給 kevin
    → kevin 的 SDK query 執行
    → kevin 回覆「今天晴天 25°C」
    → bot:replied 事件 → 記錄到 group_messages

T1: 用戶 @alex 根據天氣寫程式
    → GroupBroadcaster 路由給 alex
    → ContextInjector 撈出 kevin 的回覆注入
    → alex 看到「[14:30] [@kevin_bot]: 今天晴天 25°C」
    → alex 能基於 kevin 的資訊回答

T2: 用戶 @manager 統整意見
    → ContextInjector 撈出 kevin + alex 的回覆
    → manager 能看到完整對話脈絡
```

**結論：基本的「@mention 誰誰回答，其他人能看到」已經可以運作。**

---

## 三個核心缺失

### 缺失 #1：群組記憶隔離（影響：大）

**問題描述**：

Agent 的記憶系統（MEMORY.md、daily logs、memory/ 目錄）是 **agent-global** 的。不管是私聊、工作群、還是生活群，所有記憶混在同一份檔案中。

**場景問題**：
- Kevin（秘書）同時在「工作群」和「生活群」
- 工作群討論的機密計畫不應出現在生活群的回覆中
- 但目前 Kevin 的 MEMORY.md 是同一份，記憶無法按群組隔離
- 更嚴重：Kevin 在私聊時的記憶也會影響群組行為

**現有狀態**：
- `group_messages` 表 — 記錄群組公開訊息，用於 Context Injection（✅ 已有）
- `group_injection_state` 表 — 追蹤每個 Bot 的注入 cursor（✅ 已有）
- Agent workspace 的 MEMORY.md、memory/ — 全局記憶，無群組區分（❌ 缺失）

**影響範圍**：
- Agent 無法區分「這是在哪個群組學到的」
- 群組間的資訊可能交叉汙染
- 無法針對特定群組累積專屬知識

**建議方案：群組記憶目錄**

```
agents/kevin/
├── MEMORY.md                    # 全局記憶（跨群組通用的事實）
├── memory/                      # 全局每日日誌
│   └── 2026-02-03.md
└── groups/                      # 群組專屬記憶（新增）
    ├── {chatId_hash}/           # 用 chatId 的 hash 作為目錄名
    │   ├── GROUP_MEMORY.md      # 該群組的長期記憶
    │   ├── GROUP_CONTEXT.md     # 群組成員、角色定位、群組目的
    │   └── memory/
    │       └── 2026-02-03.md    # 群組每日日誌
    └── {another_chatId_hash}/
        └── ...
```

**實作原則**：
- **維持「Agent 自主管理」設計**（ADR-008）— 引擎層只負責告訴 Agent 群組記憶路徑在哪，Agent 自行決定讀寫
- `buildPromptContext()` 新增 `groupId` 參數，注入群組記憶路徑
- Agent 的 memory-system skill 擴展「群組記憶規則」
- **不在引擎層解析或注入記憶內容**

**影響檔案**：
- `src/core/constants.ts` — `buildPromptContext()` 加入群組路徑提示
- `agents/_example/` — 新增群組記憶目錄模板
- Agent skills（memory-system.md）— 群組記憶讀寫規則

---

### 缺失 #2：Agent 互相認識（影響：中）

**問題描述**：

Bot 不知道群組裡有哪些其他 Bot 存在，也不知道各自的角色和擅長領域。

**場景問題**：
- 用戶問 Kevin「誰可以幫我寫 code？」→ Kevin 無法回答
- 用戶問 Manager「Alex 在忙什麼？」→ Manager 不知道 Alex 的存在
- Bot 無法在回覆中建議「你可以 @alex 來處理這件事」

**現有狀態**：
- `GroupBroadcaster.groupMemberships: Map<chatId, Set<agentId>>` — 記憶體中維護群組成員（✅ 已有）
- **但重啟後遺失**，且沒有暴露給 Agent 的機制（❌ 缺失）
- `AgentLoader` 有每個 Agent 的 name 和 description（✅ 已有），但未傳遞到群組 context

**建議方案：群組成員持久化 + 注入**

1. **DB 持久化**：新增 `group_members` 表

```sql
CREATE TABLE group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  UNIQUE(platform, chat_id, agent_id)
);
```

2. **GroupBroadcaster 寫入**：`registerBotInGroup()` 同步寫入 DB
3. **啟動恢復**：重啟時從 DB 恢復 `groupMemberships`
4. **ContextInjector 注入成員清單**：

```
[群組成員]
- @kevin_bot (Kevin小幫手) — 秘書/總指揮
- @alex_bot (Alex) — AI工程師，擅長寫程式、debug
- @lena_bot (Lena) — 研究員，擅長資料收集與分析
如需其他成員協助，可在回覆中建議用戶 @mention 對應的成員。
```

**影響檔案**：
- `src/persistence/DatabaseManager.ts` — Schema v6 新增 group_members 表
- `src/core/GroupBroadcaster.ts` — 持久化成員關係、啟動恢復
- `src/core/ContextInjector.ts` — 注入成員清單
- 新增 `src/persistence/GroupMemberRepository.ts`（或擴展現有 repository）

---

### 缺失 #3：被動觀察與記憶寫入（影響：中）

**問題描述**：

ADR-019 移除了 silent/observe mode（正確決策，避免 token 浪費）。但結果是 Bot 不被 @mention 時完全不知道群組裡發生了什麼 — 不是「看不到」（Context Injection 解決了），而是「不會記住」。

**場景問題**：
- 群組裡用戶和 Alex 花了 30 分鐘討論一個 bug
- 一小時後用戶 @Kevin 說「幫我整理剛剛的 bug 討論」
- Kevin 透過 Context Injection **能看到** Alex 的回覆 ✅
- 但 Kevin **不會主動把這些記錄到群組記憶** ❌
- 如果注入的歷史超過 50 條限制，早期的討論就會遺失

**建議方案：群組記憶寫入提示**

不需要重新引入 silent mode。Context Injection 已解決「看到」的問題，缺少的是「記住」。

當 Bot 被 @mention 且有 injection context（有其他 Bot 或用戶的歷史訊息）時，在注入文本尾部加入提示：

```
[SYSTEM: 以上群組歷史中如果有與你職責相關的重要資訊，
請在回覆後將關鍵摘要記錄到群組記憶（groups/{chatId_hash}/GROUP_MEMORY.md）。]
```

這讓 Bot 在被喚醒時順便整理之前錯過的群組動態，不需要額外的 SDK query。

**影響檔案**：
- `src/core/ContextInjector.ts` — formatHistory() 加入記憶提示
- Agent skills（memory-system.md）— 群組記憶觸發規則

---

## 次要缺失（可選，不影響核心可用性）

### 4. Agent 委派機制

Bot A 無法直接叫 Bot B 做事。目前可透過 **約定** 繞過：Agent 在回覆中寫 `建議你 @alex_bot 來處理這個程式問題`，由用戶手動轉發。

未來可考慮「自動 @mention 檢測轉發」— Bot 回覆中含有 @other_bot 時自動觸發對方的 query。但這涉及自動循環風險，需要謹慎設計（深度限制、避免無限對話等）。

**建議**：Phase 1 不做，先驗證手動轉發是否足夠。

### 5. Token / 成本追蹤

SDK `query()` 的結果有 usage 資訊（input/output tokens），但目前沒有持久化。

**方案**：
- 新增 `query_usage` 表記錄每次查詢的 token 用量
- `MessageProcessor` 在 post-query 階段記錄 `result.usage` 到 DB
- WebUI Dashboard 顯示 per-agent token 統計和成本估算

**影響檔案**：
- `src/persistence/DatabaseManager.ts` — 新增 query_usage 表
- `src/core/MessageProcessor.ts` — 記錄 usage
- `src/webui/` — Dashboard 統計 UI

### 6. Agent 卡片 Dashboard

類似 OpenClaw 的「員工心聲」卡片 UI，每個 Agent 顯示：
- 人格頭像、名稱、角色
- 對話數、任務完成數、Token 消耗
- Agent 自撰心聲（可從 GROUP_CONTEXT.md 或 MEMORY.md 中讀取一行）

**實作方式**：
- WebUI 新增 `/dashboard/team` 路由
- 從 `conversations` 表統計 per-agent 指標
- 從 `query_usage` 表統計 token
- Agent 心聲從 workspace 檔案讀取

---

## 決策

### 已決定

1. **群組記憶採用目錄隔離方案**（方案 A）— 符合 ADR-008「Agent 自主管理」原則
2. **不重新引入 silent mode** — 透過記憶寫入提示解決「記住」問題
3. **Agent 認識彼此** — 透過 DB 持久化 + Context 注入實現
4. **委派暫不自動化** — 先靠約定式的 @mention 建議

### 未決定（待驗證需求後再議）

1. 自動 @mention 轉發機制的循環安全設計
2. Token 追蹤的具體粒度（per-query vs per-session vs per-day）
3. Agent 卡片 Dashboard 的資料來源和更新頻率

---

## 實作路線圖

### Phase 1：群組協作基礎（讓虛擬辦公室可用）

| 步驟 | 內容 | 影響檔案 |
|------|------|---------|
| 1.1 | 群組成員持久化（DB Schema v6 + group_members 表） | DatabaseManager, GroupBroadcaster, 新增 GroupMemberRepository |
| 1.2 | 群組成員注入（Agent name/description 注入群組 context） | ContextInjector |
| 1.3 | 群組記憶目錄規範（buildPromptContext + 模板 + skill 規則） | constants.ts, agents/_example, memory-system skill |
| 1.4 | 群組記憶寫入提示（Context Injection 加入記憶提示） | ContextInjector |

### Phase 2：Dashboard 增強（數據可視化）

| 步驟 | 內容 | 影響檔案 |
|------|------|---------|
| 2.1 | Token 用量追蹤（query_usage 表 + MessageProcessor 記錄） | DatabaseManager, MessageProcessor |
| 2.2 | Agent 卡片 Dashboard（員工心聲卡片 UI） | WebUI routes/views |

---

## 與 OpenClaw 的對照

| OpenClaw 功能 | Phase 1 後 | Phase 2 後 | 備註 |
|---|---|---|---|
| 多 Agent 各有人格 | ✅ 已有 | ✅ | persona skill |
| 群組內 @mention 協作 | ✅ 已有 | ✅ | ADR-019 |
| Agent 看到彼此回覆 | ✅ 已有 | ✅ | Context Injection |
| Agent 知道群裡有誰 | ✅ Phase 1.2 | ✅ | 成員注入 |
| 群組專屬記憶 | ✅ Phase 1.3 | ✅ | 群組記憶目錄 |
| Agent 建議找其他人 | ✅ Phase 1.2 | ✅ | 成員清單+約定 |
| Token 統計 | ❌ | ✅ Phase 2.1 | query_usage 表 |
| 員工心聲 Dashboard | ❌ | ✅ Phase 2.2 | Agent 卡片 UI |
| 自動委派（A 叫 B 做事） | ❌ | ❌ | 待未來評估 |
