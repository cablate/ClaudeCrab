# 設計：Agent Team Mode — 多 Agent 並行協作

## Decisions

### 並行委派（Tier 1a）

現有 DelegationHandler 使用 `for...await` 串行處理。改為：1 個 target 維持原邏輯，2+ targets 使用 `Promise.allSettled()` 並行。新增 `executeParallelDelegation()` 方法。

### 結果收斂（Tier 1b）

並行委派全部完成後，協調者收集各 bot 的回覆結果（從 `ProcessingResult.response`），建立 synthesis prompt，注入給協調者產出綜合回覆。

### isSynthesis 安全旗標（Tier 1c）

仿照 `isInitiative` 模式，新增 `isSynthesis` flag 到 BotRepliedPayload。DelegationHandler 對帶 isSynthesis 的回覆不再掃描 @mention，防止 synthesis 回覆觸發二次委派。傳遞路徑：MessageProcessor options → emitBotRepliedEvent → bot:replied payload。

### 協調者（Lead）選擇（Tier 1d）

沿用現有機制，不新增邏輯。`getRespondingBot()` 選出回應的 bot → bot 的 LLM 判斷是否分工 → @mention 其他 bot → 自動成為協調者。

### 委派意圖判斷（Tier 1.1 — G1/G6 修復）

`detectDelegationTargets()` 只看「回覆裡有沒有 @mention」，無法區分委派意圖和禮貌性提及。採用混合方案：isDelegationResponse flag（系統層阻擋回報性 @mention）+ 啟發式規則（過濾禮貌性 @mention）。

### Delegation 期間靜默 Initiative（Tier 1.2 — G3/G4 修復）

GroupBroadcaster 追蹤「chatId 有進行中的 delegation」狀態，期間 Initiative 不觸發。

### 群組噪音控制（Tier 1.3 — G5 修復）

在 ContextInjector 的群組 context 中加入行為指示（「群組中不要回報記憶操作結果」），靠 prompt 解決，零程式碼改動。

### Synthesis 不等子委派（設計取捨）

`executeParallelDelegation` 的 `Promise.allSettled()` 只等直接被委派 bot 的 `processMessage()` return。不追蹤子委派樹（bot:replied 觸發的後續委派是 fire-and-forget）。bot-x 的子委派回覆會獨立出現在群組中，但不在 leader 的綜合裡。此問題留待 Tier 2 shared task list + dependency tracking 解決。

## Risks / Trade-offs

- 並行 agent 的 token 消耗需要管控
- Synthesis 不等子委派，可能導致綜合回覆缺少子委派結果
- delegation-in-progress 狀態的生命週期（何時開始、何時結束）需要明確定義
- Centralized Responder Selection 的 evaluator 設計（成本與 prompt 設計）待定
- `claude-agent-sdk` 是否暴露 team API 待確認

## Affected Components

| 元件 | 修改內容 |
|------|----------|
| DelegationHandler | 並行化 + executeParallelDelegation() + 結果收集 + synthesis 注入 + isDelegationResponse flag + 啟發式規則 |
| MessageProcessor | options + emitBotRepliedEvent 傳遞 isSynthesis |
| BotRepliedPayload | 新增 isSynthesis?: boolean |
| GroupBroadcaster | delegation-in-progress 狀態追蹤 |
| ContextInjector | 群組行為指示（噪音控制） |
| SDKQueryManager | 不需修改 — 已支援並行 session |
