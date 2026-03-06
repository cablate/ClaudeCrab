# Tasks

- [x] 在 `GroupBroadcaster` 實作 Initiative Pipeline 主邏輯（Gate → Evaluator → Throttle → Execute）
- [x] 新建 `InitiativeEvaluator.ts`，定義 Strategy 介面
- [x] 實作 `LLMEvaluator`（Haiku 輕量模型評估）
- [x] 實作 `AlwaysRespondEvaluator`（測試/debug 用）
- [x] 在 `agent.ts` 新增 `InitiativeSettingsSchema`（enabled、mode、cooldown、maxPerHour）
- [x] 實作 Throttle 機制（cooldown + maxPerHour）
- [x] 主動回覆標記 `triggerType: 'initiative'`，v1 不觸發委派鏈
