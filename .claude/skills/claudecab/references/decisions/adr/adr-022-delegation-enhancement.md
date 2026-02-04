# ADR-022: 委派機制增強（多重委派 + 可配置）

**狀態**：✅ accepted → implemented
**日期**：2026-02-04
**實作日期**：2026-02-05
**相關**：ADR-021

---

## 背景

ADR-021 實現了基礎自動委派，但有兩個限制：

1. **單一委派**：每次回覆只觸發第一個匹配的 Bot，無法同時分配任務給多個 Bot
2. **無法關閉**：所有 Bot 都會被自動觸發，沒有 opt-out 機制

### 使用情境

- 主管 Bot 回覆：「@coder 處理程式碼，@designer 處理畫面」→ 應該兩個都觸發
- 某些 Bot（如純記錄用途）不應被其他 Bot 委派觸發

---

## 已決定

- [x] 多重委派：**需要**，主管分配多人的場景實際存在
- [x] 可配置粒度：**Agent 層級**，在 `agent.json` 設定，全域生效。群組層級暫不做，但架構保持彈性可擴展
- [x] 多重委派 depth 計算：**共用**，同一次回覆觸發的所有 target 共享相同 depth，防止鏈路指數爆炸

---

## 實作

### 1. 多重委派

`detectDelegationTarget()` → `detectDelegationTargets()`，回傳 `string[]`。
所有被 @mention 的 Bot 獨立觸發，共用同一個 delegation depth。

### 2. 委派可配置

在 `agent.json` 的 `settings.delegation` 新增兩個方向性設定：

```json
{
  "settings": {
    "delegation": {
      "inbound": true,
      "outbound": true
    }
  }
}
```

#### 設定說明（方向性命名）

| 設定 | 方向 | 意義 | 預設 |
|------|------|------|------|
| `inbound` | 入站（被動） | 其他 Bot @mention 我時，是否觸發委派 | `true` |
| `outbound` | 出站（主動） | 我的回覆 @mention 其他 Bot 時，是否觸發委派 | `true` |

**白話對照**：
- `inbound: false` → 「別人不能派工作給我」（我不接客）
- `outbound: false` → 「我不會派工作給別人」（我不外包）
- 預設都是 `true`（向後相容，不設定 = 完全開放）

> **命名決策**：初版使用 `acceptDelegation` / `canDelegate`，但兩者語意相近容易混淆。
> 改為 `inbound` / `outbound` 方向性命名，更直觀。

---

## 影響

### 修改檔案

- `src/types/agent.ts` — 新增 `DelegationSettingsSchema`（`inbound`、`outbound`）
- `src/core/GroupBroadcaster.ts` — `detectDelegationTargets` 多重回傳 + `getDelegationSettings` callback + inbound/outbound 檢查
- `src/core/PlatformOrchestrator.ts` — 提供 `getDelegationSettings` callback

### 未來擴展

- 群組層級設定（同一 Bot 在不同群組不同行為）
- 委派白名單（只接受特定 Bot 的委派）