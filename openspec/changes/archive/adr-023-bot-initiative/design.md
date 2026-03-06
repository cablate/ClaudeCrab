# 設計：Bot 主動互動模式

## Decisions

### Initiative Pipeline 架構

收斂方案 A/B/C 的討論後，採用 Pipeline 架構：

```
訊息進入 GroupBroadcaster（非 @mention 的訊息）
  ↓
① Gate        agent.initiative.enabled + mode 檢查
  ↓
② Evaluator   判斷「要不要回？」— 可抽換實作
  ↓
③ Throttle    cooldown / maxPerHour / cost cap
  ↓
④ Execute     合成訊息 → processMessage（複用 delegation 模式）
```

### 評估方案選擇

| 方案 | 說明 | 結論 |
|------|------|------|
| A. 定時輪詢 | Cron 每 N 分鐘檢查 | 棄用 — 本質是 B 的低頻版 |
| B. 事件驅動 + 規則預篩 | 引擎收到訊息 → 關鍵字 match → 送 AI | 預篩部分棄用 |
| C. System Prompt 驅動 | 所有 Bot 都收到 → AI 自己判斷 | 成本不可控（N Bot × 每條訊息） |
| **採用：事件驅動 + 輕量模型評估** | 引擎收到訊息 → Haiku 判斷相關性 → 通過才送主模型回覆 | ✅ |

關鍵字預篩棄用原因：維護成本高、語意理解為零、漏判多。Haiku 單次判斷約 $0.001，直接用便宜模型做語意判斷更實際。

### Evaluator 介面（Strategy Pattern）

```typescript
interface InitiativeEvaluator {
  shouldRespond(
    message: UnifiedMessage,
    agent: AgentConfig,
    recentHistory: GroupMessage[]
  ): Promise<{ respond: boolean; reason?: string }>;
}
```

v1 預設使用 `LLMEvaluator`（Haiku），另有 `AlwaysRespondEvaluator` 供測試用。

### Initiative Mode 配置

| Mode | Evaluator prompt 傾向 | 典型觸發場景 |
|------|----------------------|------------|
| `work` | 只回應與專業相關的工作事項 | 「伺服器掛了」→ 工程師回 |
| `social` | 可參與閒聊，展現個性 | 「週末去哪玩」→ 偶爾插話 |
| `full` | 工作主動 + 閒聊偶爾 | 兩者皆有 |

### 與委派的交互

主動回覆標記 `triggerType: 'initiative'`。v1 不觸發委派鏈，避免主動回覆 → 委派 → 無限循環。

## Risks / Trade-offs

| 風險 | 緩解 |
|------|------|
| Bot 過度活躍，瘋狂回覆 | Throttle 層：cooldown + maxPerHour |
| 多個 Bot 同時主動回覆 | 機率控制 + 回應延遲（隨機 delay） |
| Token 成本暴增 | Haiku 評估（$0.001/次）+ 每小時 cost cap |
| 對話品質下降 | Evaluator prompt 可按 mode 調校 |
| 主動回覆觸發無限委派 | v1 initiative 不觸發委派鏈 |

## Affected Components

- `src/core/GroupBroadcaster.ts` — Initiative Pipeline 主邏輯
- `src/core/InitiativeEvaluator.ts` — **新建**，Strategy 介面 + LLMEvaluator 實作
- `src/types/agent.ts` — `InitiativeSettingsSchema`
- Agent system prompt — 主動回應的指引（按 mode 不同）
