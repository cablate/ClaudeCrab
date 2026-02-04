# ADR-023: Bot 主動互動模式

**狀態**：📋 proposed
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

### 核心機制：「觀察 + 觸發條件」

1. **觀察模式**：Bot 透過 Context Injection 已經能「看到」群組對話歷史
2. **主動觸發**：在 system prompt 中定義觸發條件，由 SDK 判斷是否回應

### 實作方式

#### 方案 A：定時輪詢（Polling-based）

```
CronScheduler → 每 N 分鐘檢查群組活動
  → 有新訊息且符合條件 → 建立合成訊息觸發 Bot
```

- 優點：利用現有排程系統
- 缺點：延遲高、不夠即時

#### 方案 B：事件驅動（Event-based）

```
group:message 事件 → 所有群組 Bot 收到通知
  → 根據設定決定是否「主動回應」
  → 主動回應的 Bot 建立 query（不需 @mention）
```

- 在 `GroupBroadcaster.handleGroupMessage()` 中，除了處理被 @mention 的 Bot，額外檢查其他 Bot 是否符合「主動回應」條件
- 條件可配置：`agent.json` 中設定 `initiative.enabled: true`、`initiative.probability: 0.1` 等

#### 方案 C：System Prompt 驅動

- 不改引擎層程式碼
- 在 Context Injection 的歷史中加入提示：「如果你認為需要主動回應，請回覆」
- 依賴 Bot 自己判斷是否回應

---

## 風險

| 風險 | 緩解 |
|------|------|
| Bot 過度活躍，瘋狂回覆 | 冷卻時間（cooldown）機制 |
| 多個 Bot 同時主動回覆 | 機率控制 + 回應延遲（隨機 delay） |
| Token 成本暴增 | 每小時 cost cap / 主動回覆次數上限 |
| 對話品質下降 | 主動回覆用較便宜的模型先判斷是否值得回應 |

---

## 影響

- `src/core/GroupBroadcaster.ts` — 主動觸發邏輯
- `src/types/agent.ts` — initiative 設定
- Agent system prompt — 主動回應的指引

## 待討論

- [ ] 哪個方案最適合？Event-based vs Polling vs System Prompt？
- [ ] 主動互動的頻率如何控制？
- [ ] 成本控制策略：cost cap vs 次數上限？
- [ ] 是否需要「靜音時段」（如深夜不主動）？
