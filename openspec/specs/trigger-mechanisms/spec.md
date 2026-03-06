## Purpose

本規格定義 ClaudeCab 在群組訊息路由、主動發言與社交評估觸發、委派鏈管理，以及防止級聯失敗等方面的行為契約。這些規則適用於系統所處理的所有群組對話互動。

## Requirements

### Requirement: 訊息路由優先順序

系統應（SHALL）依據嚴格的優先順序，對每則群組訊息解析出唯一一條路由路徑：先檢查 @mention / reply-to，再進行 Initiative 評估，最後進行 Social 評估。

#### Scenario: 直接 @mention 路由至指定 Agent

- **WHEN** 群組訊息中包含針對特定 bot 的 @mention
- **THEN** 該 bot 的 `processMessage` 應（SHALL）被直接呼叫
- **AND** 該訊息不得（MUST NOT）觸發 Initiative 或 Social 評估

#### Scenario: Reply-to 路由至原始回應的 Agent

- **WHEN** 群組訊息是對某則 bot 訊息的回覆
- **THEN** 原訊息的來源 Agent 應（SHALL）透過 `processMessage` 被呼叫
- **AND** 該訊息不得（MUST NOT）觸發 Initiative 或 Social 評估

#### Scenario: Initiative 有回應時跳過 Social 評估

- **WHEN** 群組訊息中不存在 @mention 或 reply-to
- **AND** 至少有一個 bot 透過 Initiative 評估做出回應
- **THEN** 同一則訊息不得（MUST NOT）觸發 Social 評估

#### Scenario: Initiative 無回應時才觸發 Social

- **WHEN** 訊息中不存在 @mention 或 reply-to
- **AND** Initiative 評估產生零個 bot 回應
- **THEN** `SocialHandler.evaluateSocial()` 應（SHALL）被呼叫

---

### Requirement: Bot 發出的訊息在接收時即被忽略

系統應（SHALL）在套用任何路由邏輯之前，丟棄所有 `from.is_bot === true` 的 Telegram 訊息，以防止在接收層發生 bot 對 bot 的輸入迴圈。

#### Scenario: Bot 來源訊息在 Adapter 層被丟棄

- **WHEN** Telegram adapter 收到一則訊息
- **AND** 發送者的 `from.is_bot === true`
- **THEN** 該訊息應（SHALL）被靜默丟棄
- **AND** 不得（MUST NOT）為該訊息發出 `group:message` 事件

---

### Requirement: 委派鏈執行與深度限制

當 bot 的回覆中包含 @mention 時，系統應（SHALL）觸發委派鏈。鏈深度必須（MUST）不超過 `MAX_DELEGATION_DEPTH = 3`。接收到委派的 bot（depth > 0）不得（MUST NOT）從自身回覆中再次發起委派。

#### Scenario: 單一目標觸發串行委派

- **WHEN** bot 回覆中包含對另一個 Agent 的唯一 @mention
- **AND** 目前委派深度為 0
- **AND** 所有委派阻斷旗標均不存在
- **THEN** `DelegationHandler.executeDelegation()` 應（SHALL）對該目標被呼叫
- **AND** 產生的回覆應（SHALL）帶著遞增 1 的 `delegationDepth` 發出 `bot:replied`

#### Scenario: 多個目標觸發並行委派

- **WHEN** bot 回覆中包含對兩個或以上 Agent 的 @mention
- **AND** 目前委派深度為 0
- **THEN** `DelegationHandler.executeParallelDelegation()` 應（SHALL）被呼叫
- **AND** 所有目標 Agent 應（SHALL）透過 `Promise.allSettled` 並行呼叫
- **AND** 在部分或全部成功時，應（SHALL）建立合成提示（synthesis prompt）並以 `isSynthesis: true` 注入協調者

#### Scenario: 深度限制阻止委派遞迴

- **WHEN** 正在處理委派
- **AND** 目前 `delegationDepth >= MAX_DELEGATION_DEPTH (3)`
- **THEN** 該委派應（SHALL）被跳過
- **AND** 不得（MUST NOT）為該路徑再次呼叫 `processMessage`

#### Scenario: 被委派的 Bot 不再觸發委派

- **WHEN** 某個 bot 接收並處理了委派（depth > 0）
- **AND** 該 bot 的回覆中包含 @mention
- **THEN** 系統應（SHALL）跳過對該回覆的委派處理
- **AND** 不得（MUST NOT）對其呼叫 `detectDelegationTargets`

---

### Requirement: 委派鏈追蹤防止循環

系統應（SHALL）以 Agent ID 的有序列表（`delegationChain`）追蹤委派鏈。已出現在鏈中的 Agent 不得（MUST NOT）在同一條鏈中再次被委派。

#### Scenario: 已在鏈中的 Agent 被排除在再次委派之外

- **WHEN** `detectDelegationTargets()` 識別到一個目標 Agent
- **AND** 該 Agent 的 ID 已存在於目前的 `delegationChain` 中
- **THEN** 該 Agent 應（SHALL）被排除在委派目標之外
- **AND** 不得（MUST NOT）收到合成委派訊息

---

### Requirement: Initiative 評估的門檻與節流

Initiative 評估應（SHALL）僅對通過所有選擇性門檻與節流檢查的 Agent 執行。多個 Agent 可以各自獨立地對同一則訊息做出回應，彼此不需協調。

#### Scenario: 已停用 Initiative 的 Agent 被排除

- **WHEN** `InitiativeHandler.evaluateInitiatives()` 執行
- **AND** 某個 Agent 在 `agent.json` 中設定 `initiative.enabled === false`
- **THEN** 該 Agent 應（SHALL）被排除在 Initiative 評估之外

#### Scenario: 不在工作模式的 Agent 被排除

- **WHEN** `InitiativeHandler.evaluateInitiatives()` 執行
- **AND** 某個 Agent 目前的模式不是 `'work'`
- **THEN** 該 Agent 應（SHALL）被排除在 Initiative 評估之外

#### Scenario: 冷卻節流防止 Initiative 過於頻繁

- **WHEN** 某個 Agent 上次觸發 Initiative 距今不足 `cooldown` 秒（預設 300 秒）
- **THEN** 該 Agent 應（SHALL）在本次訊息的 Initiative 評估中被排除

#### Scenario: MaxPerHour 節流限制每小時 Initiative 回應次數

- **WHEN** 某個 Agent 在本小時內已觸發 Initiative `maxPerHour` 次（預設 5 次）
- **THEN** 該 Agent 應（SHALL）在本次訊息的 Initiative 評估中被排除

#### Scenario: 多個 Agent 各自通過並回應

- **WHEN** 兩個或以上的 Agent 通過所有門檻、節流與 AI 評估器檢查
- **THEN** 每個 Agent 應（SHALL）各自獨立呼叫 `processMessage({ isInitiative: true })`
- **AND** 系統不得（MUST NOT）協調或抑制任何這些獨立回應

---

### Requirement: Social 評估的門檻、節流與單一勝出者

Social 評估應（SHALL）只在 Initiative 無回應後執行。每次評估僅允許（MAY）一個 bot——即 LLM 回傳能量分數最高者——執行 Social 回覆。

#### Scenario: Social 受群組能量門檻約束

- **WHEN** `SocialHandler.evaluateSocial()` 被呼叫
- **AND** 目前 `groupEnergy <= 0`
- **THEN** 任何 bot 均不得（MUST NOT）進行社交回應
- **AND** 評估應（SHALL）立即終止

#### Scenario: 連續 Bot 輪次上限防止 Social 洪泛

- **WHEN** `consecutiveBotTurns >= maxConsecutiveBotTurns`（預設 3）
- **THEN** 在該評估輪次中，任何 bot 均不得（MUST NOT）進行社交回應

#### Scenario: 僅能量最高的 Bot 贏得 Social 回應

- **WHEN** 多個 bot 通過 Social 門檻與節流
- **AND** AI 評估器對超過一個 bot 回傳 `respond: true`
- **THEN** 系統應（SHALL）僅選擇回傳能量分數最高的 bot
- **AND** 僅有該 bot 應（SHALL）呼叫 `executeSocial()`

#### Scenario: 已停用 Social 的 Agent 被排除

- **WHEN** `SocialHandler.evaluateSocial()` 執行
- **AND** 某個 Agent 在 `agent.json` 中設定 `social.enabled === false`
- **THEN** 該 Agent 應（SHALL）被排除在 Social 評估之外

#### Scenario: LLM Social 評估逾時後優雅降級

- **WHEN** `LLMSocialEvaluator` 的 AI 呼叫在 30 秒內未回應
- **THEN** 該 bot 的評估應（SHALL）以 `evaluation_error` 結果放棄
- **AND** 系統不得（MUST NOT）阻塞等待該呼叫

---

### Requirement: Social 能量衰減與 Bot 對 Bot 鏈接

Social 的 bot 對 bot 鏈接應（SHALL）由能量衰減機制管控。人類訊息將群組能量重置為 5。每則 bot 回覆使能量遞減 2。當能量降至 0 或以下時，Social 鏈接應（SHALL）停止。

#### Scenario: 人類訊息重置群組能量

- **WHEN** 收到人類訊息且 `GroupBroadcaster.handleGroupMessage()` 執行
- **THEN** `socialHandler.resetEnergy(chatId)` 應（SHALL）被呼叫
- **AND** `groupEnergy` 應（SHALL）被設為 5
- **AND** `consecutiveBotTurns` 應（SHALL）被重置為 0

#### Scenario: Bot 回覆使群組能量衰減

- **WHEN** 任何 bot 回覆觸發 `handleBotReplied()`
- **THEN** `socialHandler.decayEnergy(chatId)` 應（SHALL）被呼叫
- **AND** `groupEnergy` 應（SHALL）遞減 2
- **AND** `consecutiveBotTurns` 應（SHALL）遞增 1

#### Scenario: 能量耗盡終止 Bot 對 Bot 鏈接

- **WHEN** 某則 bot 回覆使能量衰減至 0 或以下
- **THEN** 從 bot 對 bot 鏈接呼叫的 `evaluateSocial()` 應（SHALL）發現 `groupEnergy <= 0`
- **AND** 應（SHALL）立即返回，不允許任何 bot 回應

---

### Requirement: 旗標保護矩陣阻斷委派

`isInitiative`、`isSocial` 與 `isSynthesis` 旗標，當出現在 `bot:replied` 的 payload 中時，應（SHALL）使 `DelegationHandler.processDelegation()` 對該回覆跳過所有委派處理。

#### Scenario: isInitiative 旗標阻斷委派

- **WHEN** 收到 `bot:replied` 事件
- **AND** payload 中包含 `isInitiative: true`
- **THEN** `DelegationHandler.processDelegation()` 應（SHALL）立即返回
- **AND** 不得（MUST NOT）呼叫 `detectDelegationTargets()`

#### Scenario: isSocial 旗標阻斷委派

- **WHEN** 收到 `bot:replied` 事件
- **AND** payload 中包含 `isSocial: true`
- **THEN** `DelegationHandler.processDelegation()` 應（SHALL）立即返回
- **AND** 不得（MUST NOT）呼叫 `detectDelegationTargets()`

#### Scenario: isSynthesis 旗標阻斷合成協調者回覆的委派

- **WHEN** 協調者 bot 在處理合成訊息後發出 `bot:replied`
- **AND** payload 中包含 `isSynthesis: true`
- **THEN** `DelegationHandler.processDelegation()` 應（SHALL）立即返回
- **AND** 不得（MUST NOT）發起任何後續委派

#### Scenario: delegation.outbound false 防止 Bot 觸發外向委派

- **WHEN** bot 回覆觸發 `handleBotReplied()`
- **AND** 該 bot 在 `agent.json` 中設定 `delegation.outbound: false`
- **THEN** `DelegationHandler.processDelegation()` 應（SHALL）跳過該回覆的委派

#### Scenario: delegation.inbound false 防止 Bot 成為委派目標

- **WHEN** `detectDelegationTargets()` 將某個 Agent 識別為委派候選者
- **AND** 該 Agent 在 `agent.json` 中設定 `delegation.inbound: false`
- **THEN** 該 Agent 應（SHALL）被排除在委派目標列表之外

---

### Requirement: 雜訊回應過濾

系統應（SHALL）在任何 bot 回應送達使用者之前，抑制符合已知雜訊模式的回應。雜訊過濾應（SHALL）同時適用於中間訊息與最終回應。

#### Scenario: SDK 佔位回應被丟棄

- **WHEN** `MessageProcessor` 收到符合 `/^No response requested\.?$/i` 的回應
- **THEN** `isNoiseResponse()` 應（SHALL）回傳 true
- **AND** 該回應不得（MUST NOT）傳遞給任何使用者或群組對話

#### Scenario: Stop-hook 記憶體檢查的非事件回應被丟棄

- **WHEN** `MessageProcessor` 收到符合 `/^No significant events?\b/i` 的回應
- **AND** 或符合 `/^Nothing (significant|notable|important) to (record|note|report)\b/i`
- **AND** 或符合中文等同表達 `/^沒有(重要|顯著|值得).*(記錄|紀錄|回報)/`
- **THEN** `isNoiseResponse()` 應（SHALL）回傳 true
- **AND** 該回應應（SHALL）被靜默丟棄

#### Scenario: 空白或純空格回應被丟棄

- **WHEN** `MessageProcessor` 收到空白或僅包含空格字元的回應
- **THEN** `isNoiseResponse()` 應（SHALL）回傳 true
- **AND** 不得（MUST NOT）向對話發送任何訊息

---

### Requirement: 活動系統觸發鏈

`MessageProcessor.processMessage()` 應（SHALL）在每個處理階段發出工作流程活動事件。這些事件應（SHALL）由 `ActivityService` 消費，並傳播至 SSE broadcaster 以供即時 UI 更新。

#### Scenario: 處理階段發出對應的活動事件

- **WHEN** `processMessage()` 開始處理任務
- **THEN** 它應（SHALL）透過 `ActivityService.emitWorkflow()` 發出 `task_received`
- **AND** 隨後依處理進度發出 `working`、`tool_use`（當工具被呼叫時）以及 `completed` 或 `error`

#### Scenario: Completed 與 error 階段自動轉換至 idle

- **WHEN** `ActivityService.emitWorkflow('completed')` 或 `ActivityService.emitWorkflow('error')` 被呼叫
- **THEN** 系統應（SHALL）在 5 秒後自動推送 `idle` 活動事件

#### Scenario: 活動事件被持久化並廣播

- **WHEN** 任何活動事件被發出
- **THEN** `ActivityService` 應（SHALL）透過批次寫入佇列（每 2 秒或 20 筆刷新一次）將其寫入活動儲存庫
- **AND** 應（SHALL）呼叫 `SSEBroadcaster.broadcast()` 即時將事件推送至 Live 頁面客戶端

---

### Requirement: 委派進行中時抑制 Initiative

當群組對話中正在進行委派處理時，該對話中的新訊息不得（MUST NOT）觸發 Initiative 評估，直到委派完成。

#### Scenario: 委派進行中時跳過 Initiative

- **WHEN** 群組訊息抵達
- **AND** `delegationActive.has(chatId)` 回傳 true
- **THEN** `InitiativeHandler.evaluateInitiatives()` 不得（MUST NOT）被呼叫
- **AND** 該訊息應（SHALL）從 Initiative 處理中靜默丟棄

#### Scenario: delegationActive 在委派完成後必定被清除

- **WHEN** `DelegationHandler.processDelegation()` 結束
- **AND** 無論委派是否成功或拋出錯誤
- **THEN** `delegationActive.delete(chatId)` 應（SHALL）在 `finally` 區塊中被呼叫
