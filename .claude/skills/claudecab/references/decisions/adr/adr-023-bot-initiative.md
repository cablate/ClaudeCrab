# ADR-023: Bot 主動互動模式

**狀態**：✅ implemented (v1 work mode)
**日期**：2026-02-04
**相關**：ADR-019, ADR-020, ADR-021

---

## 背景

目前所有 Bot 互動都是「被動」的——需要使用者 @mention 或透過 ADR-021 委派觸發。ADR-019 用戶願景提到：

> 「娛樂性高一點也可以讓部門每個人之間有主動聊天互動回訊息的模式。」

Bot 主動互動的典型場景：
- 工程師 Bot 完成任務後，主動跟秘書 Bot 回報
- 看到群組討論涉及自己專長，主動加入對話
- 定期問候或狀態更新

---

## 提議

### 架構：Initiative Pipeline（事件驅動 + 可抽換判斷）

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

每一層獨立、可抽換。未來換判斷方法 = 換 ② 的實作，其他層不動。

### 評估方案比較（2026-02-05 討論紀錄）

原始提案包含三種方案，經討論後收斂：

| 方案 | 說明 | 結論 |
|------|------|------|
| A. 定時輪詢 | Cron 每 N 分鐘檢查 | 棄用 — 本質是 B 的低頻版 |
| B. 事件驅動 + 規則預篩 | 引擎收到訊息 → 關鍵字 match → 送 AI | 預篩部分棄用（見下方） |
| C. System Prompt 驅動 | 所有 Bot 都收到 → AI 自己判斷 | 成本不可控（N Bot × 每條訊息） |
| **採用：事件驅動 + 輕量模型評估** | 引擎收到訊息 → Haiku 判斷相關性 → 通過才送主模型回覆 | ✅ |

**關鍵字預篩為何棄用**：維護成本高、語意理解為零、漏判多。Haiku 單次判斷約 $0.001，5 Bot 判斷一輪 $0.005，直接用便宜模型做語意判斷更實際。

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

| Evaluator 實作 | 用途 | 成本 |
|---|---|---|
| `LLMEvaluator`（Haiku） | v1 預設，語意判斷 | ~$0.001/次 |
| `AlwaysRespondEvaluator` | 測試/debug 用 | 0 |
| 未來：`EmbeddingEvaluator` | 向量相似度 | 更低 |

**v1 不做 keyword filter，直接用 LLMEvaluator。** 未來如果 Haiku 成本仍嫌高，可加回規則預篩作為 Pipeline 的額外前置層。

### Initiative Mode 配置

Mode 決定 Evaluator 的 prompt 和 Throttle 參數：

```jsonc
// agent.json
{
  "settings": {
    "initiative": {
      "enabled": true,
      "mode": "work",        // "work" | "social" | "full"
      "cooldown": 300,       // 秒，同群組冷卻
      "maxPerHour": 5        // 每小時上限
    }
  }
}
```

| Mode | Evaluator prompt 傾向 | 典型觸發場景 |
|------|----------------------|------------|
| `work` | 只回應與專業相關的工作事項 | 「伺服器掛了」→ 工程師回 |
| `social` | 可參與閒聊，展現個性 | 「週末去哪玩」→ 偶爾插話 |
| `full` | 工作主動 + 閒聊偶爾 | 兩者皆有 |

加新 mode = 加一組 evaluator prompt + throttle 參數，不改 Pipeline。

### 與委派的交互

- 主動回覆標記 `triggerType: 'initiative'`
- **v1 不觸發委派鏈**，避免主動回覆 → 委派 → 無限循環
- 未來可配置

---

## 風險

| 風險 | 緩解 |
|------|------|
| Bot 過度活躍，瘋狂回覆 | Throttle 層：cooldown + maxPerHour |
| 多個 Bot 同時主動回覆 | 機率控制 + 回應延遲（隨機 delay） |
| Token 成本暴增 | Haiku 評估（$0.001/次）+ 每小時 cost cap |
| 對話品質下降 | Evaluator prompt 可按 mode 調校 |
| 主動回覆觸發無限委派 | v1 initiative 不觸發委派鏈 |

---

## 影響

- `src/core/GroupBroadcaster.ts` — Initiative Pipeline 主邏輯
- `src/core/InitiativeEvaluator.ts` — **新建**，Strategy 介面 + LLMEvaluator 實作
- `src/types/agent.ts` — `InitiativeSettingsSchema`
- Agent system prompt — 主動回應的指引（按 mode 不同）

## 待討論

- [x] 哪個方案最適合？→ **事件驅動 + Haiku 評估**（2026-02-05 決定）
- [x] 關鍵字預篩 vs AI 評估？→ **棄用關鍵字，直接 Haiku**（成本可接受）
- [x] 主動回覆是否觸發委派？→ **v1 不觸發**
- [ ] 主動互動的頻率如何控制？（cooldown + maxPerHour 方向已定，具體數值待測試）
- [ ] 成本控制策略：cost cap vs 次數上限？（可並行）
- [ ] 是否需要「靜音時段」（如深夜不主動）？
- [ ] Haiku evaluator 的 prompt 如何設計？（每個 mode 一組）
- [ ] social mode 的機率/頻率參數如何調校？