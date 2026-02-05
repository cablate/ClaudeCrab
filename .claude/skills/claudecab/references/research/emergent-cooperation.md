# 湧現式協作行為（Emergent Cooperation）

**發現日期**：2026-02-05
**相關**：ADR-019, ADR-020, ContextInjector

---

## 現象

Coder bot 在群組對話中嘗試寫入群組記憶失敗後，**主動建議用戶找 General bot 幫忙**：

> 記憶寫入結果：
> - ✅ 更新 CLAUDE.md：記錄了寫入權限限制的教訓
> - ❌ 群組記憶無法寫入（權限不足）
>
> 老闆，以後群組的技術討論記錄可能要請 @fun_random_res_bot 秘書幫忙寫入群組記憶喔！🙏

**關鍵：沒有任何程式碼或提示詞明確教 coder bot 這個行為。**

---

## 最小提示鏈

系統只注入了三個元素，bot 自行推導出協作策略：

| 元素 | 來源 | 內容 |
|------|------|------|
| 成員清單 | `ContextInjector.formatMemberList()` | `[群組成員]` + 每個 bot 的 name / @username / description |
| 協作提示 | 成員清單末行 | 「如需其他成員協助，可在回覆中建議用戶 @mention 對應的成員。」|
| 失敗經驗 | bot 自己的工具呼叫結果 | 寫入群組記憶 → 權限不足 → 失敗 |

### Bot 的推理鏈（推測）

```
寫入群組記憶失敗（權限不足）
  → 我做不到這件事
  → 成員清單裡有另一個 bot
  → 提示說「如需協助可建議 @mention」
  → 建議用戶找那個 bot 幫忙
```

---

## 設計洞察

### 1. 湧現 vs 程式化協作

| 類型 | 機制 | 範例 |
|------|------|------|
| **程式化協作** | ADR-021/022 的 delegation — bot 回覆中 @mention 另一個 bot → 系統自動觸發 `processMessage` | Bot A 回覆 `@bot_b 幫忙看一下` → DelegationHandler 自動執行 |
| **湧現式協作** | 本案例 — bot 基於上下文自行判斷該找誰幫忙，用自然語言建議用戶操作 | Coder bot 建議「請 @fun_random_res_bot 幫忙寫入」 |

兩者互補：
- 程式化協作處理 bot-to-bot 的自動鏈路
- 湧現式協作處理 bot 無法直接解決、需要人類介入的情境

### 2. 最小提示原則

不需要寫長篇大論的 system prompt 教 bot 如何協作。只需要：
- **告訴它環境**（誰在群裡、各自的角色）
- **給一個輕推**（一句話的協作提示）
- **讓它自己經歷**（工具呼叫成功或失敗的結果）

Bot 會自行推理出合理的社交行為。過度指示反而可能限制 LLM 的靈活判斷。

### 3. Description 的隱性作用

`agent.json` 的 `description` 欄位原本只是標示用途，但在群組注入後成為 bot 判斷「誰能幫忙」的依據。即使 description 只是泛泛的「A helpful general-purpose AI assistant」，coder 仍然能推導出「另一個 bot 可能有我沒有的權限」。

**設計啟示**：未來如果要讓湧現式協作更精準，可以讓 description 更具體描述各 bot 的能力邊界（例如「擁有群組記憶讀寫權限」），但目前的泛泛描述已經足夠觸發基本的協作推理。

---

## 與 ADR-023 Initiative 的關係

Initiative（主動回應）是另一種湧現式行為的系統化版本：
- Initiative 用 LLM（Haiku）判斷「我該不該回」→ 系統化為 pipeline
- 本案例的「找人幫忙」是 LLM 在對話中自然做出的 → 尚未系統化

如果未來「找人幫忙」的模式頻繁出現且有價值，可以考慮將其系統化為新的 pipeline（例如 "Assistance Request Pipeline"），但目前作為湧現行為已經足夠好用。

---

## 觀察方法

要重現此行為：
1. 群組中至少有 2 個 bot，其中一個有寫入限制
2. 在群組中發出涉及需要寫入操作的訊息
3. 受限 bot 嘗試操作 → 失敗 → 觀察它是否建議找其他成員

`ContextInjector.formatMemberList()` 的注入是觸發此行為的前提條件。如果沒有成員清單注入，bot 不知道群裡有誰，就無法建議找人幫忙。
