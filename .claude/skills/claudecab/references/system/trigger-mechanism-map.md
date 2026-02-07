# 觸發機制全覽（Trigger Mechanism Map）

> 最後更新：2026-02-06
> 版本：v1.26.0（ADR-030 Tier 1 實作後）

本文件記錄 ClaudeCab 系統中**所有事件、觸發路徑、保護機制**，
用於規畫 swarm 流程、避免 cascade 問題、設計新功能時參考。

---

## 一、EventBus 事件

| 事件 | 發射者 | 監聽者 | 效果 |
|------|--------|--------|------|
| **`group:message`** | TelegramAdapter.handleTextMessage | GroupBroadcaster.handleGroupMessage | 去重 → 判斷回覆者 → 處理訊息或走 Initiative |
| **`bot:replied`** | MessageProcessor.emitBotRepliedEvent | GroupBroadcaster.handleBotReplied | 記錄訊息到 DB + 委派檢查 |
| **`message:received`** | BaseAdapter.emitMessage | *無明確監聯者* | 目前未使用 |
| **`message:sent`** | BaseAdapter.emitMessageSent | AppBootstrap（排程同步）、WebUIServer（監控） | 排程 auto-sync + dashboard 監控 |
| **`agent:loaded`** | AgentLoader.loadAgent | WebUIServer（監控） | dashboard 更新 |
| **`agent:reloaded`** | AgentLoader.reloadAgent | WebUIServer（監控） | dashboard 更新 |
| **`session:created`** | SessionManager | WebUIServer（監控） | dashboard 更新 |
| **`session:closed`** | SessionManager | WebUIServer（監控） | dashboard 更新 |
| **`session:stateChanged`** | SessionManager | WebUIServer（監控） | dashboard 更新 |
| **`error`** | 各處 | WebUIServer（監控） | 錯誤記錄 |

---

## 二、訊息進入路徑（Telegram → 系統）

```
Telegram 訊息進入
    │
    ├─ from.is_bot === true → 🚫 忽略（防 bot-to-bot 迴圈）
    │
    ├─ /command → setupCommandHandlers
    │   ├─ 群組：ADR-024 路由
    │   │   ├─ @other_bot → skip
    │   │   ├─ bare read-only → 去重，第一個 bot 回
    │   │   ├─ bare destructive → 提示指定目標
    │   │   └─ @all destructive → 全部執行，第一個 bot 發合併回覆
    │   └─ 私聊：直接執行 handler
    │
    ├─ 群組文字訊息 → emit group:message
    │   → GroupBroadcaster.handleGroupMessage()
    │   → getRespondingBot()
    │       ├─ Case 1（@mention）→ 對應 bot processMessage
    │       ├─ Case 2（reply-to）→ sourceAgentId processMessage
    │       └─ Case 3（null）→ InitiativeHandler.evaluateInitiatives()
    │
    └─ 私聊文字訊息 → emitMessage() → messageHandlers → processMessage
```

### 支援的 Telegram 命令（ADR-024）

| 命令 | 功能 | 類型 |
|------|------|------|
| `/start` | 歡迎訊息 | read-only |
| `/help` | 說明 | read-only |
| `/reset` | 清除對話 | destructive |
| `/stop` | 停止執行 | destructive |
| `/schedule` | 排程管理 | read-only |
| `/members` | 群組成員 | read-only |
| `/status` | 系統狀態 | read-only |

---

## 三、核心處理中樞：MessageProcessor.processMessage()

所有訊息最終都流入 `processMessage()`，這是 bot 回覆的唯一出口。

### 所有呼叫入口

| 呼叫者 | 場景 | 特殊 flag |
|--------|------|-----------|
| GroupBroadcaster.handleGroupMessage | @mention / reply-to 的 bot | `isGroupChat: true` |
| InitiativeHandler.executeInitiative | Initiative 主動回覆 | `isInitiative: true` |
| DelegationHandler.executeDelegation | 串行委派 | `delegationDepth`, `delegationChain` |
| DelegationHandler.executeParallelDelegation | 並行委派後綜合注入 coordinator | `isSynthesis: true` |
| ScheduleExecutor.execute | 排程觸發 | 無特殊 flag |
| BaseAdapter messageHandlers | 私聊 | 無 |

### 處理後行為

- 如果 `isGroupChat`，emit `bot:replied` 事件 → 觸發委派檢查 + 訊息記錄
- 如果私聊，不 emit `bot:replied`

---

## 四、委派鏈（Delegation Chain）

```
bot:replied 事件
    → GroupBroadcaster.handleBotReplied()
    → recordBotReplyToGroupMessages()（寫入 group_messages DB）
    → delegationActive.add(chatId)（ADR-030 Tier 1.2：標記委派進行中）
    → DelegationHandler.processDelegation()
    → delegationActive.delete(chatId)（finally：清除標記）
        │
        ├─ isInitiative === true → 🚫 跳過（ADR-023）
        ├─ isSynthesis === true → 🚫 跳過（ADR-030）
        ├─ depth > 0 → 🚫 跳過（ADR-030 Tier 1.1：被委派 bot 不觸發新委派）
        ├─ depth >= 3 → 🚫 跳過（MAX_DELEGATION_DEPTH，depth 0 才走到這）
        ├─ outbound === false → 🚫 跳過（ADR-022）
        │
        └─ detectDelegationTargets() 掃描回覆中的 @mention
            ├─ 0 targets → 結束
            ├─ 1 target → 串行 executeDelegation()
            └─ 2+ targets → 並行 executeParallelDelegation()（ADR-030）
                → Promise.allSettled 等待全部完成
                → buildSynthesisPrompt() 整合結果
                → 注入 synthesis 給 coordinator（isSynthesis: true）
```

### executeDelegation 細節

- 建立 synthetic UnifiedMessage（`delegation-{timestamp}-{targetAgentId}`）
- 帶 `isDelegation: true` metadata
- 呼叫 `processMessage(syntheticMessage, targetAgentId)`
- 回傳 `{ agentId, response?, success }`
- 失敗時 catch 並回傳 `{ agentId, success: false }`

### executeParallelDelegation 細節（ADR-030）

1. 對所有 targets 同時呼叫 `executeDelegation()`
2. `Promise.allSettled` 等待全部完成
3. 收集結果：成功的帶 response、失敗的標記
4. 全部失敗 → 跳過 synthesis
5. 部分/全部成功 → `buildSynthesisPrompt()` 整合
6. 建立 synthesis synthetic message → 注入給 coordinator
7. Coordinator 的 processMessage 回覆 → emit bot:replied → `isSynthesis: true` 阻擋再次委派

---

## 五、Initiative 評估流程（ADR-023）

```
getRespondingBot() === null（無 @mention、非 reply-to）
    ├─ delegationActive.has(chatId) → 🚫 跳過（ADR-030 Tier 1.2：委派進行中不觸發）
    └─ InitiativeHandler.evaluateInitiatives()
        │
        ├─ Gate: initiative.enabled === true（opt-in）
        ├─ Gate: mode === 'work'（v1 限制）
        ├─ Gate: agent 有 description
        ├─ Throttle: cooldown（預設 300s）
        ├─ Throttle: maxPerHour（預設 5）
        │
        └─ 通過 Gate+Throttle 的 eligible bots
            → evaluator.shouldRespond()（N 次 AI query，並行）
            → 通過的 bot 各自 executeInitiative()
            → processMessage({ isInitiative: true })
            → bot:replied 事件（isInitiative 傳遞）→ 委派被阻擋
```

### 關鍵特性

- **N 次獨立 query**：每個 eligible bot 各自判斷是否回覆
- **無協調**：多個 bot 可能同時通過、各自獨立回覆
- **Anti-cascade**：isInitiative=true 通過 emitBotRepliedEvent 傳遞到 bot:replied payload，DelegationHandler 偵測到後跳過

---

## 六、排程觸發（ADR-028）

```
CronScheduler（支援 cron / once / interval）
    → executeSchedule(scheduleId)
    → ScheduleExecutor.execute(agentId, spec)
    → 建立 synthetic message → processMessage()
    → 回覆透過 adapter 送出
    → emitMessageSent → AppBootstrap 排程同步
```

### 特性

- 支援 cron 表達式、一次性定時、固定間隔
- 連續失敗自動暫停
- Once 類型執行後自動刪除

---

## 七、Flag 防護矩陣

| Flag | 設定位置 | 傳遞方式 | 效果 |
|------|----------|----------|------|
| `isInitiative: true` | InitiativeHandler.executeInitiative | processMessage options → emitBotRepliedEvent → bot:replied payload | 阻擋 DelegationHandler |
| `isSynthesis: true` | DelegationHandler.executeParallelDelegation | processMessage options → emitBotRepliedEvent → bot:replied payload | 阻擋 DelegationHandler |
| `isDelegation: true` | DelegationHandler.executeDelegation | UnifiedMessage.metadata（僅標記） | 目前僅標記，未阻擋任何流程 |
| `delegationDepth` | DelegationHandler 遞增傳入 | processMessage options → emitBotRepliedEvent → bot:replied payload | >= MAX_DELEGATION_DEPTH(3) 時阻擋 |
| `delegationChain` | DelegationHandler 追蹤 | processMessage options → emitBotRepliedEvent → bot:replied payload | 防止環形委派（chain 中已有的 bot 不再委派） |
| `delegation.outbound: false` | agent.json 設定 | DelegationHandler 查詢 | 該 bot 的回覆不觸發向外委派 |
| `delegation.inbound: false` | agent.json 設定 | DelegationHandler 檢查 | 該 bot 不接受被委派 |
| `initiative.enabled: false` | agent.json 設定 | InitiativeHandler 檢查 | 該 bot 不參與 Initiative 評估 |

---

## 八、Cascade 風險分析

| 路徑 | 保護機制 | 風險等級 | 說明 |
|------|----------|----------|------|
| @mention → delegation → depth 遞增 | `MAX_DELEGATION_DEPTH = 3` + chain 防環 | ✅ 安全 | |
| Initiative → bot 回覆 → delegation 檢查 | `isInitiative=true` 阻擋 delegation | ✅ 安全 | |
| Synthesis → coordinator 回覆 → delegation 檢查 | `isSynthesis=true` 阻擋 delegation | ✅ 安全 | |
| ~~Bot 回覆含「禮貌性 @mention」→ 新委派~~ | `delegationDepth > 0` 跳過委派掃描（Tier 1.1） | ✅ 已修復 | 被委派 bot 的回覆是「交作業」不是「指派工作」 |
| **Sub-delegation 未完成，synthesis 已執行** | **Tier 1 設計限制** | ⚠️ 已知限制 | synthesis 只等直接 delegatee 的 processMessage 回傳，不等其子委派 |
| ~~多 bot 同時通過 Initiative → 在委派中插嘴~~ | `delegationActive` Set 抑制 Initiative（Tier 1.2） | ✅ 已修復 | 委派進行中新訊息不觸發 Initiative |
| **多 bot 同時通過 Initiative → 各自回覆（非委派期間）** | 無協調機制 | ⚠️ 噪音源 | N 個 bot 獨立決策、獨立回覆（Tier 1.5 解決） |
| ~~Bot 記憶寫入通知出現在群組~~ | ContextInjector 群組行為規範 prompt（Tier 1.3） | ✅ 已修復 | prompt 層指示 bot 不回報內部操作 |

### 改進路線（對應 ADR-030 修訂路線圖）

| 優先級 | Tier | 問題 | 狀態 |
|--------|------|------|------|
| ~~🔴 高~~ | ~~1.1~~ | ~~禮貌性 @mention 觸發非預期委派~~ | ✅ 已實作：`depth > 0` guard |
| ~~🟡 中~~ | ~~1.2~~ | ~~Delegation 進行中 Initiative 仍觸發~~ | ✅ 已實作：`delegationActive` Set |
| ~~🟢 低~~ | ~~1.3~~ | ~~Bot 記憶寫入通知等群組噪音~~ | ✅ 已實作：群組行為規範 prompt |
| 🟡 中 | 1.5 | Initiative N 查詢 → 多 bot 各自回覆 | 📋 待實作：Centralized Responder Selection |
| 🟡 中 | 2 | Sub-delegation 未完成 synthesis 已跑 | 📋 待實作：Shared task list + dependency tracking |

> 詳見 [ADR-030](../decisions/adr/adr-030-agent-team-mode.md) 「實測發現的缺口」章節。

---

## 九、完整事件流程圖（典型 Swarm 場景）

```
使用者在群組發送：「@leader 請工程師和秘書報告狀況」

1. Telegram → TelegramAdapter.handleTextMessage()
   ├─ 每個 bot adapter 各自收到 → emit group:message（×3）
   └─ GroupBroadcaster 去重，只處理一次

2. GroupBroadcaster.handleGroupMessage()
   → getRespondingBot() = 'leader'（Case 1: @mention）
   → processMessage(message, 'leader')

3. MessageProcessor.processMessage() for leader
   → SDK query → leader 回覆「[@coder_bot]: 報告 [@secretary_bot]: 報告」
   → emitBotRepliedEvent → emit bot:replied

4. GroupBroadcaster.handleBotReplied()
   → recordBotReplyToGroupMessages()（寫 DB）
   → DelegationHandler.processDelegation()
   → detectDelegationTargets() → ['coder', 'secretary']（2+ targets）

5. DelegationHandler.executeParallelDelegation()
   → Promise.allSettled([
       executeDelegation('coder', ...),     // → processMessage for coder
       executeDelegation('secretary', ...),  // → processMessage for secretary
     ])
   → 各自的 processMessage 完成、各自 emit bot:replied
   → 各自的 bot:replied 走 DelegationHandler（深度遞增，通常無新 @mention → 結束）

6. Promise.allSettled 完成 → 收集結果
   → buildSynthesisPrompt()
   → processMessage(synthesisMessage, 'leader', { isSynthesis: true })
   → leader 綜合回覆 → emit bot:replied
   → DelegationHandler 偵測 isSynthesis=true → 跳過（不再委派）

最終群組看到：
  - leader 初始回覆（含 @mention）
  - coder 回覆
  - secretary 回覆
  - leader 綜合回覆
```
