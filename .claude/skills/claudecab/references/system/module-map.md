# ClaudeCab 模組地圖與耦合分析

> 更新：2026-02-28 | 總計 107 個 TypeScript 檔案 · 24,703 行

---

## 目錄

1. [分層總覽](#分層總覽)
2. [模組群聚圖](#模組群聚圖)
3. [各層詳細分析](#各層詳細分析)
4. [跨層依賴矩陣](#跨層依賴矩陣)
5. [耦合風險評估](#耦合風險評估)
6. [檔案尺寸一覽](#檔案尺寸一覽)

---

## 分層總覽

```
┌──────────────────────────────────────────────────────────┐
│                    AppBootstrap (676行)                   │
│              應用入口 · 生命週期協調 · 依賴組裝            │
└───────┬──────────┬──────────┬──────────┬─────────────────┘
        │          │          │          │
   ┌────▼────┐ ┌──▼───┐ ┌───▼───┐ ┌───▼────┐ ┌─────────┐
   │ Core 層 │ │適配器│ │ 持久層│ │ WebUI │ │ 排程層  │
   │26 模組  │ │9 模組│ │11 模組│ │24 模組 │ │ 8 模組  │
   │ ~8200行 │ │~4500行│ │~2800行│ │~3700行│ │~1900行 │
   └────┬────┘ └──┬───┘ └───┬───┘ └───┬────┘ └────┬────┘
        │         │         │         │            │
   ┌────▼─────────▼─────────▼─────────▼────────────▼────┐
   │          共享基礎：types/ (7) · utils/ (13)         │
   │              ~2500行 · 純工具 · 零業務邏輯           │
   └────────────────────────────────────────────────────┘
```

**依賴方向規則**（實際遵守情況）：

| 規則 | 狀態 | 說明 |
|------|------|------|
| Core ← WebUI | ✅ | WebUI 讀取 Core 狀態，Core 不知 WebUI 存在 |
| Core ← Adapters | ✅ | Adapters 實作 Core 介面 |
| Core → Persistence | ✅ | Core 透過 Repository 介面存取 DB |
| WebUI → Persistence | ✅ | WebUI API 直接查詢 Repository |
| Adapters → Core (EventBus) | ⚠️ | 僅 2 處 `getEventBus()` 發佈事件，低風險 |
| Core ↛ WebUI | ✅ | 0 處反向引用 |

---

## 模組群聚圖

### 群聚 A — 訊息處理管道（核心管道）

> 從使用者訊息到 AI 回應的完整路徑

```
TelegramAdapter (1295)
       │ UnifiedMessage
       ▼
MessageProcessor (1092) ──────────────────────┐
  ├─→ SessionManager (650)     會話狀態       │
  ├─→ SDKQueryManager (514)    LLM 呼叫      │
  ├─→ InteractionHandler (468) 權限+問答橋接   │
  │     ├─→ PermissionBridge (190)            │
  │     ├─→ QuestionBridge (158)              │
  │     └─→ ExitPlanModeBridge (155)          │
  ├─→ ResponseSender (237)    回應投遞 ◄ NEW  │
  ├─→ McpToolSetup (53)       MCP 組裝 ◄ NEW  │
  ├─→ StatusMessageManager (212)              │
  ├─→ ContextInjector (271)   群組上下文注入   │
  └─→ ConfigTransformer (175) 配置轉換        │
                                              │
  AgentLoader (689) ◄─────────────────────────┘
    提供 Agent 配置 + systemPrompt
```

**耦合特徵**：MessageProcessor 是 fan-out 最高的模組（13 個依賴），但都是單向的。

### 群聚 B — 群組協調系統

> 多 Agent 群組對話的決策與執行

```
GroupBroadcaster (566) ─────── 群組訊息路由
  ├─→ DelegationHandler (386)  Agent 間委派
  ├─→ InitiativeHandler (228)  主動發言評估
  │     └─→ InitiativeEvaluator (140)
  ├─→ SocialHandler (311)      社交互動
  │     └─→ SocialEvaluator (130)
  └─→ MessageProcessor         執行實際 query
```

**耦合特徵**：GroupBroadcaster 是協調器，合理的高 fan-out。子模組之間無互相引用。

### 群聚 C — 平台適配器

> Telegram Bot 封裝與指令處理

```
BaseAdapter (430) ◄──── 抽象介面
  └── TelegramAdapter (1295)
        ├─→ RateLimiter (129)              ◄ NEW
        ├─→ TelegramCallbackHandler (329)  ◄ NEW
        └─→ TelegramCommands (589)
              └─→ ScheduleCommands (278)   ◄ NEW
```

**耦合特徵**：單一繼承鏈，新提取的模組各自獨立。

### 群聚 D — 持久化

> SQLite 資料存取層

```
DatabaseManager (190)
  └─→ migrations (465)     ◄ NEW · Schema + Migration SQL

Repository 群（全部獨立，互不引用）：
  SessionRepository (190)
  ConversationRepository (168)
  ScheduleRepository (297)
  QueryMetricsRepository (266)
  ActivityRepository (193)
  GroupMessageRepository (148)
  GroupMemberRepository (140)
  InjectionStateRepository (77)
```

**耦合特徵**：零交叉依賴。每個 Repository 只依賴 `types.ts` 和 `DatabaseManager`。

### 群聚 E — 排程系統

> Cron 定時任務執行

```
ScheduleManager (356) ◄── 唯一對外入口
  ├─→ ScheduleLoader (203)
  ├─→ CronScheduler (303)
  ├─→ ScheduleExecutor (229)
  └─→ ScheduleNotifier (175)
```

**耦合特徵**：良好封裝。外部只依賴 ScheduleManager，內部實作隱藏。

### 群聚 F — WebUI

> Express + EJS 管理介面

```
WebUIServer (217)
  ├─ Routes (7)   ── 頁面渲染
  ├─ API (8)      ── REST 端點
  │   ├─ agents.api (812)
  │   ├─ agents-skills.api (380)    ◄ NEW
  │   ├─ agents-schedules.api (425) ◄ NEW
  │   ├─ sessions.api (182)
  │   ├─ messages.api (116)
  │   ├─ usage.api (105)
  │   ├─ activity.api (80)
  │   └─ system.api (162)
  └─ Services (3) ── 業務邏輯
      ├─ MonitoringService (238)
      ├─ SSEBroadcaster (113)
      └─ StatsService (97)
```

**耦合特徵**：依賴 Core 層讀取狀態（AgentLoader×6、SessionManager×4），不被其他層依賴。

### 群聚 G — 活動追蹤（Live Page）

```
ActivityService (334)
  ├─→ ReactionGenerator (273)  AI 反應生成
  └─→ IdleMutterScheduler (148) 閒置獨白排程

EventBus (200) ◄── 全系統事件中樞（31 個使用點）
```

### 群聚 H — 服務 + MCP 工具

```
AgentCallService (169)      跨 Agent 呼叫
  └─ notifyAgentTool (119)  MCP 工具封裝

TTSService (197)            語音合成
  └─ ttsTool (114)          MCP 工具封裝
```

---

## 各層詳細分析

### Core 層 — Fan-In / Fan-Out

| 模組 | 行數 | Fan-In | Fan-Out | 角色 |
|------|------|--------|---------|------|
| AgentLoader | 689 | 9 | 5 | **中樞**：幾乎所有模組需要 agent 配置 |
| SessionManager | 650 | 5 | 4 | **中樞**：會話狀態管理 |
| EventBus | 200 | 31 | 1 | **中樞**：pub-sub，單向低耦合 |
| MessageProcessor | 1092 | 4 | 13 | **管道**：最高 fan-out |
| PlatformOrchestrator | 526 | 3 | 8 | **協調器**：Adapter 生命週期 |
| GroupBroadcaster | 566 | 3 | 5 | **協調器**：群組路由 |
| SDKQueryManager | 514 | 3 | 3 | **工具**：LLM 查詢封裝 |
| InteractionHandler | 468 | 1 | 5 | **橋接**：權限+問答 |
| ResponseSender | 237 | 1 | 0 | **工具**：獨立無依賴 |
| StatusMessageManager | 212 | 1 | 0 | **工具**：獨立無依賴 |
| ConfigTransformer | 175 | 2 | 0 | **工具**：純轉換 |
| PathValidator | 269 | 1 | 0 | **工具**：純驗證 |

### 持久層 — Repository Fan-In

| Repository | Fan-In | 主要使用者 |
|-----------|--------|-----------|
| ScheduleRepository | 3 | Schedule 模組 |
| ActivityRepository | 2 | ActivityService, WebUI |
| QueryMetricsRepository | 2 | MessageProcessor, WebUI |
| SessionRepository | 2 | SessionManager, WebUI |
| ConversationRepository | 2 | MessageProcessor, WebUI |
| GroupMessageRepository | 1 | ContextInjector |
| GroupMemberRepository | 1 | GroupBroadcaster |
| InjectionStateRepository | 1 | ContextInjector |

---

## 跨層依賴矩陣

```
被依賴 →    Core  Adapters  Persist  WebUI  Schedule  Services  Tools  Types  Utils
依賴者 ↓
Core          ●      -        ●       -       -         ●        ●      ●      ●
Adapters      ●²     ●        -       -       -         -        -      ●      ●
Persist       -      -        ●       -       -         -        -      ●      -
WebUI         ●      -        ●       ●       ●         -        -      ●      ●
Schedule      ●      ●        ●       -       ●         -        -      ●      ●
Services      ●      -        -       -       -         ●        -      ●      ●
Tools         -      -        -       -       -         ●        ●      -      -
Types         -      -        -       -       -         -        -      ●      -
Utils         -      -        -       -       -         -        -      ●      ●

● = 有依賴   ●² = 僅 2 處 EventBus 發佈   - = 無依賴
```

**關鍵觀察**：
- **Types 和 Utils 是純粹的底層**，不依賴任何業務層
- **WebUI 是純消費者**，不被任何其他層依賴
- **Adapters → Core 僅 2 處**，且都是 EventBus 事件發佈（可接受的最小反向耦合）

---

## 耦合風險評估

### 🟢 健康（無需動作）

| 項目 | 說明 |
|------|------|
| 無循環依賴 | 整個 codebase 無 A→B→A 循環 |
| Repository 隔離 | 8 個 Repository 互不引用 |
| Types 純粹性 | `src/types/` 只有型別定義，零 runtime 邏輯 |
| Schedule 封裝 | 對外僅 ScheduleManager，內部 4 模組隱藏 |
| EventBus 模式 | 31 個使用點但全為 pub-sub，無反向控制流 |
| 新提取模組獨立 | RateLimiter、ResponseSender、McpToolSetup 等 fan-out=0 |

### 🟡 留意（可監控，暫不需動作）

| 項目 | 說明 | 數據 |
|------|------|------|
| MessageProcessor fan-out | 依賴 13 個模組，未來新增功能易繼續膨脹 | 1092 行 |
| AgentLoader fan-in | 9 個模組依賴它，任何 API 變更影響面大 | 689 行 |
| TelegramAdapter 尺寸 | 重構後仍為最大檔案 | 1295 行 |
| GroupBroadcaster 多責任 | 同時處理路由、成員管理、回應追蹤 | 566 行 |

### 已完成的改善（本次重構）

| 提取 | 來源 | 新模組 | 效果 |
|------|------|--------|------|
| RateLimiter | TelegramAdapter | `adapters/RateLimiter.ts` (129) | -23% |
| TelegramCallbackHandler | TelegramAdapter | `adapters/TelegramCallbackHandler.ts` (329) | callback 獨立 |
| ResponseSender | MessageProcessor | `core/ResponseSender.ts` (237) | -21% |
| McpToolSetup | MessageProcessor | `core/McpToolSetup.ts` (53) | MCP 設定獨立 |
| migrations | DatabaseManager | `persistence/migrations.ts` (465) | -70% |
| ScheduleCommands | TelegramCommands | `commands/ScheduleCommands.ts` (278) | -31% |
| agents-skills.api | agents.api | `api/agents-skills.api.ts` (380) | -48% |
| agents-schedules.api | agents.api | `api/agents-schedules.api.ts` (425) | 路由拆分 |

---

## 檔案尺寸一覽

### > 500 行（協調器層，合理偏大）

| 檔案 | 行數 | 性質 | 是否需拆分 |
|------|------|------|-----------|
| TelegramAdapter.ts | 1295 | Telegram 全功能封裝 | 已拆 3 模組，剩餘為核心收發 |
| MessageProcessor.ts | 1092 | 訊息處理全流程 | 已拆 2 模組，剩餘為 SDK 編排 |
| agents.api.ts | 812 | Agent CRUD + Bot Control | 已拆 2 子路由，剩餘為核心 API |
| AgentLoader.ts | 689 | Agent 載入管線 | **內聚**，不拆 |
| AppBootstrap.ts | 676 | 啟動協調器 | **預期廣泛 fan-out**，不拆 |
| SessionManager.ts | 650 | 會話狀態機 | **無自然接縫**，不拆 |
| TelegramCommands.ts | 589 | 指令分派 | 已拆排程指令 |
| GroupBroadcaster.ts | 566 | 群組路由協調 | **協調器模式**，不拆 |
| PlatformOrchestrator.ts | 526 | Adapter 生命週期 | **協調器模式**，不拆 |
| SDKQueryManager.ts | 514 | SDK 查詢封裝 | **內聚**，不拆 |

### 200-500 行（中型模組，良好範圍）

InteractionHandler (468), migrations (465), BaseAdapter (430), agents-schedules.api (425), persistence/types (414), DelegationHandler (386), agents-skills.api (380), audit (365), ScheduleManager (356), adapters/types (338), ActivityService (334), TelegramCallbackHandler (329), SocialHandler (311), CronScheduler (303), webui/types (302), ScheduleRepository (297), ScheduleCommands (278), ReactionGenerator (273), retry (272), ContextInjector (271), PathValidator (269), QueryMetricsRepository (266), sessions route (253), agents route (252), MonitoringService (238), ResponseSender (237), errors types (230), ScheduleExecutor (229), security (228), InitiativeHandler (228), WebUIServer (217), StatusMessageManager (212), agent types (209), ScheduleLoader (203), EventBus (200)

### < 200 行（小型模組，理想大小）

TTSService (197), ActivityRepository (193), events types (192), SessionRepository (190), PermissionBridge (190), DatabaseManager (190), messages.api (182), ConfigTransformer (175), ScheduleNotifier (175), AgentCallService (169), ConversationRepository (168), system.api (162), QuestionBridge (158), sdk types (155), ExitPlanModeBridge (155), IdleMutterScheduler (148), telegramMarkdown (145), InitiativeEvaluator (140), GroupMemberRepository (140), SocialEvaluator (130), RateLimiter (129), notifyAgentTool (119), hooks types (116), ttsTool (114), SSEBroadcaster (113), usage.api (105), 以及其餘小型模組...
