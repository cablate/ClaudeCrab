# 跨 Agent 協調：上下文傳遞與 Handoff 設計

> 整合自：knowledge/agent-coordination-context-handoff-completeness.md (2026-03-16)
> 和 knowledge/multi-agent-context-propagation-patterns.md (2026-03-05)
> 整合日期：2026-03-19

---

## 核心問題：Context Drift

每次 handoff 都有丟失資訊的風險：
- 多步驟任務（前段細節隨時間淡出）
- 中介傳遞（General → Admin，摘要中損失脈絡）
- Fire-and-forget（無回饋循環確認理解是否正確）

**數據支持**：36.9% 的 multi-agent 系統失敗來自 interagent misalignment——agent 對共享狀態理解不一致。

---

## Handoff Schema（跨 Agent 任務傳遞最小必要結構）

每次跨 agent 傳遞任務時，必須包含：

```
任務名稱：
發起者：[誰 via 誰]
背景：[為什麼做這件事，上游決策脈絡]
預期產出：[完成後應該有什麼，成功的樣子]
限制條件：[不能做什麼，邊界在哪]
已知依賴：[MCP/token/外部服務]
```

這是「完整執行藍圖」（execution blueprint），不只是「任務指令」。

---

## Admin 接收任務的 5 秒 Checklist

接收「Via X」任務時，先確認：
- [ ] 任務的背景脈絡是否完整？
- [ ] 是否有隱性依賴（MCP、token、外部服務）？
- [ ] 預期產出是否清楚？

任何一個不清楚 → 在任務 memory 開頭記錄「⚠️ 資訊不完整：[哪裡不確定]」，不猜，繼續執行並在回報中說明。

---

## Context Propagation Patterns（適用 ClaudeCab）

### 1. Shared External Memory
- `knowledge/` 目錄 = 跨 Agent 可讀的 external memory store
- 重要決策記錄到 knowledge/，不只留在個人 memory/

### 2. 明確 Handoff（不依賴推測）
- 呼叫其他 Agent 時，在 message 中明確包含當前任務狀態、相關決策、上下文
- 不依賴 Agent 自行「猜測」前因後果

### 3. Programmatic vs LLM 提取
- 穩定的上下文 → 明確寫在 message 中（確定性高）
- 不依賴 Agent 從訊息中自行推斷上下文（有幻覺風險）

---

## 指派任務給其他 Agent 時

用 `call_agent` 工具時，message 應包含：
- 任務本體（做什麼）
- 背景脈絡（為什麼，上游決策）
- 已知依賴（可能遇到什麼）
- 預期回報格式（希望看到什麼）

---

## weekly review 時

對「Via General」任務，主動標記「資訊完整性」：
- 傳遞給其他 agent 的內容是否足夠？
- 是否有因資訊不完整導致需要二次補充？

這是合作健康度的一個指標維度。
