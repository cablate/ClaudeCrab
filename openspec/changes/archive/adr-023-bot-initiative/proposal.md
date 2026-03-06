# Bot 主動互動模式

## Why

目前所有 Bot 互動都是「被動」的——需要使用者 @mention 或透過 ADR-021 委派觸發。ADR-019 用戶願景提到：

> 「娛樂性高一點也可以讓部門每個人之間有主動聊天互動回訊息的模式。」

Bot 主動互動的典型場景：
- 工程師 Bot 完成任務後，主動跟秘書 Bot 回報
- 看到群組討論涉及自己專長，主動加入對話
- 定期問候或狀態更新

## What Changes

採用 Initiative Pipeline 架構（事件驅動 + 可抽換判斷）：

1. **Gate** — `agent.initiative.enabled` + mode 檢查
2. **Evaluator** — 判斷「要不要回？」（v1 使用 Haiku 輕量模型評估，~$0.001/次）
3. **Throttle** — cooldown / maxPerHour / cost cap
4. **Execute** — 合成訊息 → processMessage（複用 delegation 模式）

每一層獨立、可抽換。支援三種 mode：`work`（只回應工作相關）、`social`（可參與閒聊）、`full`（兩者皆有）。

v1 主動回覆不觸發委派鏈，避免無限循環。

## Capabilities

- Bot 可主動參與與自身專長相關的群組對話
- Pipeline 每一層獨立可抽換，未來換判斷方法只需換 Evaluator 實作
- 多種 mode 支援不同程度的主動性
- Haiku 評估成本低（5 Bot 判斷一輪約 $0.005）
- Throttle 機制控制活躍度，防止 Bot 過度回覆
