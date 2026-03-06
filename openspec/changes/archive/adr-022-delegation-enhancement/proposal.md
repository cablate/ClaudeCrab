# 委派機制增強（多重委派 + 可配置）

## Why

ADR-021 實現了基礎自動委派，但有兩個限制：

1. **單一委派**：每次回覆只觸發第一個匹配的 Bot，無法同時分配任務給多個 Bot
2. **無法關閉**：所有 Bot 都會被自動觸發，沒有 opt-out 機制

使用情境：
- 主管 Bot 回覆：「@coder 處理程式碼，@designer 處理畫面」→ 應該兩個都觸發
- 某些 Bot（如純記錄用途）不應被其他 Bot 委派觸發

## What Changes

1. **多重委派**：`detectDelegationTarget()` 改為 `detectDelegationTargets()`，回傳 `string[]`。所有被 @mention 的 Bot 獨立觸發，共用同一個 delegation depth，防止鏈路指數爆炸。

2. **委派可配置**：在 `agent.json` 的 `settings.delegation` 新增 `inbound` 和 `outbound` 兩個方向性設定，預設都為 `true`（向後相容）。

## Capabilities

- 主管可同時分配任務給多個 Bot
- Agent 可選擇不接受委派（`inbound: false`）或不發起委派（`outbound: false`）
- 方向性命名（`inbound`/`outbound`）比初版的 `acceptDelegation`/`canDelegate` 更直觀
- 架構保持彈性可擴展至群組層級設定
