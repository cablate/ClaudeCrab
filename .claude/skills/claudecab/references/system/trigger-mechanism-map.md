# 觸發機制全覽（Trigger Mechanism Map）

> 最後更新：2026-02-10
> 版本：v1.27.0（Activity System v2.0 重構後）

本文件記錄 ClaudeCab 系統中**所有事件、觸發路徑、保護機制**，
用於規畫 swarm 流程、避免 cascade 問題、設計新功能時參考。

---

## 快速總覽：群組訊息回覆優先級

```
群組訊息進入
    │
    ├─ 1st: @mention / reply-to → 指定 bot 直接回覆
    │       └─ bot 回覆 → DelegationHandler 掃描 @mention → 委派鏈
    │
    ├─ 2nd: Initiative（工作導向）
    │       └─ N 個 bot 獨立評估、獨立回覆（不觸發委派）
    │
    └─ 3rd: Social（社交導向）— 只在 Initiative 沒回覆時觸發
            └─ 只有 1 個 energy 最高的 bot 回覆（不觸發委派）
                └─ Bot-to-bot chaining（energy decay 自然終止）
```

### 觸發模式對照

| | @mention/reply | Delegation | Initiative | Social |
|--|---|---|---|---|
| **觸發條件** | 使用者指名 | Bot 回覆含 @mention | 無指名，工作相關 | 無指名，Initiative 沒回 |
| **回覆數量** | 1 bot | 1-N bot（串/並行） | N bot（各自獨立） | 1 bot（最高 energy） |
| **觸發委派** | ✅ | 看 depth | ❌ | ❌ |
| **LLM 評估** | 不需要 | 不需要 | Haiku per bot | Haiku per bot |
| **Rate limit** | 無 | depth ≤ 3 | cooldown + maxPerHour | cooldown + maxPerHour + energy |
| **Bot-to-bot** | 透過委派鏈 | 透過深度遞增 | ❌ | ✅（energy decay） |

---

## 一、EventBus 事件

| 事件 | 發射者 | 監聽者 | 效果 |
|------|--------|--------|------|
| **`group:message`** | TelegramAdapter.handleTextMessage | GroupBroadcaster.handleGroupMessage | 去重 → 判斷回覆者 → 處理訊息或走 Initiative |
| **`bot:replied`** | MessageProcessor.emitBotRepliedEvent | GroupBroadcaster.handleBotReplied | 記錄訊息到 DB + 委派檢查 + energy decay + bot-to-bot social |
| **`message:received`** | BaseAdapter.emitMessage | *無明確監聯者* | 目前未使用 |
| **`message:sent`** | BaseAdapter.emitMessageSent | AppBootstrap（排程同步）、WebUIServer（監控） | 排程 auto-sync + dashboard 監控 |
| **`agent:loaded`** | AgentLoader.loadAgent | WebUIServer（監控） | dashboard 更新 |
| **`agent:reloaded`** | AgentLoader.reloadAgent | WebUIServer（監控） | dashboard 更新 |
| **`session:created`** | SessionManager | WebUIServer（監控） | dashboard 更新 |
| **`session:closed`** | SessionManager | WebUIServer（監控） | dashboard 更新 |
| **`session:stateChanged`** | SessionManager | WebUIServer（監控） | dashboard 更新 |
| **`session:switched`** | SessionManager | WebUIServer（監控） | Agent 切換通知 |
| **`activity`** | ActivityService | SSEBroadcaster（Live page 即時更新） | Live page activity event 推送 |
| **`interaction`** | InteractionHandler | WebUIServer（ADR-033 互動 UI） | 權限請求/問答事件推送到 Web UI |
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
    │   → socialHandler.resetEnergy(chatId)  ← 每條人類訊息都重置
    │   → getRespondingBot()
    │       ├─ Case 1（@mention）→ 對應 bot processMessage
    │       ├─ Case 2（reply-to）→ sourceAgentId processMessage
    │       └─ Case 3（null）→ 依序嘗試：
    │           ├─ 1st: InitiativeHandler.evaluateInitiatives()（工作優先）
    │           └─ 2nd: SocialHandler.evaluateSocial()（Initiative 沒回才跑）
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
| SocialHandler.executeSocial | Social 社交回覆 | `isSocial: true` |
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
        ├─ isSocial === true → 🚫 跳過（ADR-030 Social）
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

## 五之二、Social 評估流程（ADR-030 Phase D）

Social 讓 bot 像朋友一樣自然插話，與 Initiative（工作導向）互補。

```
Initiative 沒有 bot 回覆
    └─ SocialHandler.evaluateSocial()
        │
        ├─ Gate: socialEvaluator 存在
        ├─ Gate: groupEnergy > 0（energy 耗盡 → 全部停）
        ├─ Gate: social.enabled === true（opt-in）
        ├─ Gate: consecutiveBotTurns < maxConsecutiveBotTurns（預設 3）
        ├─ Gate: agent 有 description
        ├─ Throttle: cooldown（預設 120s）
        ├─ Throttle: maxPerHour（預設 30）
        │
        └─ 通過 Gate+Throttle 的 eligible bots
            → evaluator.shouldRespondSocially()（N 次 AI query，Haiku，並行）
            → 篩選：respond === true && energy >= energyThreshold
            → 多 bot 都想說 → 選 energy 最高的（只有一個贏家）
            → executeSocial() → processMessage({ isSocial: true })
            → bot:replied 事件（isSocial 傳遞）→ 委派被阻擋
```

### Energy Decay 機制

```
                         ┌─ 人類訊息 → energy = 5, consecutiveBotTurns = 0
                         │
groupEnergy 初始值 = 5   │  Bot 回覆（任何模式）→ energy -= 2, consecutiveBotTurns++
                         │
                         └─ energy ≤ 0 → 所有 bot 停止社交回覆
```

- `resetEnergy(chatId)`：在 `handleGroupMessage` 開頭，每條人類訊息都呼叫
- `decayEnergy(chatId)`：在 `handleBotReplied` 中呼叫

### Bot-to-bot 社交鏈

```
bot:replied 事件
    → handleBotReplied()
    → decayEnergy(chatId)
    → delegationActive 檢查（委派中不觸發）
    → 用 bot 的回覆建立 syntheticMessage
    → evaluateSocial(syntheticMessage, chatId, botLabel)
    → 如果有 bot 通過評估 → 再回覆 → 再觸發 bot:replied → 再 decay...
    → 自然終止條件：energy ≤ 0 或 consecutiveBotTurns ≥ max 或 cooldown
```

### 關鍵特性

- **單一贏家**：與 Initiative 不同，Social 只選 energy 最高的一個 bot 回覆
- **Initiative 優先**：Initiative 先跑，有回覆就不跑 Social
- **Anti-cascade**：isSocial=true 阻擋 delegation；energy decay + cooldown + maxConsecutiveBotTurns 三重保護
- **Bot-to-bot**：bot 回覆後其他 bot 可以接話，但 energy 會持續衰減
- **30 秒 Timeout**（v1.27.0）：`LLMSocialEvaluator` 使用 `Promise.race` 包裝 SDK 呼叫，超時自動放棄（`evaluation_error`），防止 API hang 卡住系統
- **JSON 容錯**（v1.27.0）：Haiku 回傳的 JSON 用 regex `match(/\{[\s\S]*?\}/)` 提取，容忍 JSON 前後的額外文字

### agent.json 配置

```json
{
  "settings": {
    "social": {
      "enabled": true,
      "energyThreshold": 3,    // 1-5，LLM 回傳的 energy 需 >= 此值
      "cooldown": 600,          // 秒，每個 bot 在每個群組的冷卻時間
      "maxPerHour": 10,         // 每小時上限         // 每小時上限
      "maxConsecutiveBotTurns": 3  // 連續 bot 回覆上限
    }
  }
}
```

---

## 五．五、Activity System + IdleMutterScheduler 觸發鏈

### Activity 事件產生路徑

```
MessageProcessor.processMessage()
    │
    ├─ task_received → ActivityService.emitWorkflow('task_received')
    ├─ working       → ActivityService.emitWorkflow('working')
    ├─ tool_use      → ActivityService.emitWorkflow('tool_use')
    ├─ completed     → ActivityService.emitWorkflow('completed')
    │                    └─ 5 秒後自動推 idle
    └─ error         → ActivityService.emitWorkflow('error')
                         └─ 5 秒後自動推 idle

ActivityService.emitWorkflow()
    │
    ├─ 更新 agentState（phase, mood）
    ├─ 寫入 write queue → batch flush 到 ActivityRepository（2 秒/20 筆）
    ├─ SSEBroadcaster.broadcast() → Live page 即時更新
    └─ ReactionGenerator.generateReaction() → 產生 personality 事件
        └─ ActivityService.emitPersonality() → 同上路徑
```

### IdleMutterScheduler 觸發鏈

```
setInterval(5 分鐘)
    │
    ├─ hasActiveViewers() === false → skip（無人看時零成本）
    │
    └─ 遍歷 trackedAgents
        ├─ idleDuration < 2 分鐘 → skip
        ├─ isHourlyCapped(3 次/小時) → skip
        ├─ Math.random() > 0.3 → skip
        └─ ReactionGenerator.generateMutter()
            └─ ActivityService.emitMutter() → SSE broadcast + DB persist
```

**成本控制**：5 min interval × 30% chance × 3/hr cap × viewers-only gate ≈ $0.10/天（2 agents）

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
| `isSocial: true` | SocialHandler.executeSocial | processMessage options → emitBotRepliedEvent → bot:replied payload | 阻擋 DelegationHandler |
| `isSynthesis: true` | DelegationHandler.executeParallelDelegation | processMessage options → emitBotRepliedEvent → bot:replied payload | 阻擋 DelegationHandler |
| `isDelegation: true` | DelegationHandler.executeDelegation | UnifiedMessage.metadata（僅標記） | 目前僅標記，未阻擋任何流程 |
| `delegationDepth` | DelegationHandler 遞增傳入 | processMessage options → emitBotRepliedEvent → bot:replied payload | >= MAX_DELEGATION_DEPTH(3) 時阻擋 |
| `delegationChain` | DelegationHandler 追蹤 | processMessage options → emitBotRepliedEvent → bot:replied payload | 防止環形委派（chain 中已有的 bot 不再委派） |
| `delegation.outbound: false` | agent.json 設定 | DelegationHandler 查詢 | 該 bot 的回覆不觸發向外委派 |
| `delegation.inbound: false` | agent.json 設定 | DelegationHandler 檢查 | 該 bot 不接受被委派 |
| `initiative.enabled: false` | agent.json 設定 | InitiativeHandler 檢查 | 該 bot 不參與 Initiative 評估 |
| `social.enabled: false` | agent.json 設定 | SocialHandler 檢查 | 該 bot 不參與 Social 評估 |

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
| Social → bot 回覆 → delegation 檢查 | `isSocial=true` 阻擋 delegation | ✅ 安全 | |
| Social bot-to-bot 無限迴圈 | energy decay（每次 -2）+ cooldown + maxConsecutiveBotTurns | ✅ 安全 | 最多 2-3 輪後 energy 歸零 |
| SDK/Stop-hook 噪音訊息洩漏到群組 | `isNoiseResponse()` 統一過濾器 | ✅ 已修復 | 攔截 onIntermediateMessage + sendFinalResponse |

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

### 典型 Social 場景

```
使用者在群組隨口說：「今天好累喔」

1. Telegram → emit group:message
   → GroupBroadcaster.handleGroupMessage()
   → socialHandler.resetEnergy(chatId) → energy = 5

2. getRespondingBot() === null（無 @mention、非 reply-to）

3. InitiativeHandler.evaluateInitiatives()
   → 非工作相關 → 無 bot 回覆 → return false

4. SocialHandler.evaluateSocial()
   → eligible bots: [general, coder, leader]
   → LLM 評估（Haiku，並行）
   → general: respond=true, energy=4
   → coder: respond=true, energy=2（< threshold? 看設定）
   → leader: respond=false
   → 贏家 = general（energy 最高）

5. executeSocial('general', ...)
   → processMessage({ isSocial: true })
   → general 回覆「辛苦啦！做什麼做到這麼累」
   → emitBotRepliedEvent({ isSocial: true })

6. handleBotReplied()
   → decayEnergy(chatId) → energy = 5 - 2 = 3
   → DelegationHandler: isSocial=true → 跳過
   → Bot-to-bot social chaining:
     → evaluateSocial(general 的回覆, chatId, @general_bot)
     → coder: respond=true, energy=3 → 通過！
     → executeSocial('coder', ...)
     → coder 回覆「+1 我也是」

7. handleBotReplied()（coder 的回覆）
   → decayEnergy → energy = 3 - 2 = 1
   → Bot-to-bot social chaining:
     → energy(1) > 0，但所有 bot 的 energyThreshold=2
     → 沒有 bot 通過 threshold → 停止

最終群組看到：
  - general：「辛苦啦！做什麼做到這麼累」
  - coder：「+1 我也是」
  （自然結束，沒有無限迴圈）
```

---

## 十、噪音過濾機制

### 問題

SDK / Stop-hook 會產出不應送給使用者的回應文字，例如：
- `"No response requested."` — SDK 佔位符（bot 判斷不需回覆時）
- `"No significant events to record..."` — Stop-hook 記憶檢查的輸出

### 解法

`MessageProcessor.ts` 中的 `isNoiseResponse()` 統一過濾器，套用到兩條輸出路徑：

```
SDK 回應
    ├─ onIntermediateMessage(text)
    │   └─ isNoiseResponse(text) → true → 丟棄，不送出
    │
    └─ sendFinalResponse(response)
        └─ isNoiseResponse(response) → true → return undefined
```

### 匹配的 Pattern

| Pattern | 攔截目標 |
|---------|----------|
| `/^No response requested\.?$/i` | SDK placeholder |
| `/^No significant events?\b/i` | Stop-hook 記憶檢查「沒事」回應 |
| `/^Nothing (significant\|notable\|important) to (record\|note\|report)\b/i` | 同上英文變體 |
| `/^沒有(重要\|顯著\|值得).*(記錄\|紀錄\|回報)/` | 同上中文變體 |
| 空字串 / 純空白 | 空回應 |
