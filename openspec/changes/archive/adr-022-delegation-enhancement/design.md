# 設計：委派機制增強（多重委派 + 可配置）

## Decisions

### 多重委派

`detectDelegationTarget()` → `detectDelegationTargets()`，回傳 `string[]`。所有被 @mention 的 Bot 獨立觸發，共用同一個 delegation depth，防止鏈路指數爆炸。

### 可配置粒度：Agent 層級

在 `agent.json` 設定，全域生效。群組層級暫不做，但架構保持彈性可擴展。

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

| 設定 | 方向 | 意義 | 預設 |
|------|------|------|------|
| `inbound` | 入站（被動） | 其他 Bot @mention 我時，是否觸發委派 | `true` |
| `outbound` | 出站（主動） | 我的回覆 @mention 其他 Bot 時，是否觸發委派 | `true` |

### 命名決策

初版使用 `acceptDelegation` / `canDelegate`，但兩者語意相近容易混淆。改為 `inbound` / `outbound` 方向性命名，更直觀。

## Risks / Trade-offs

- 多重委派共用 depth，防止指數爆炸但也限制了巢狀委派的彈性
- Agent 層級設定無法針對不同群組差異化配置

## Affected Components

- `src/types/agent.ts` — 新增 `DelegationSettingsSchema`（`inbound`、`outbound`）
- `src/core/GroupBroadcaster.ts` — `detectDelegationTargets` 多重回傳 + `getDelegationSettings` callback + inbound/outbound 檢查
- `src/core/PlatformOrchestrator.ts` — 提供 `getDelegationSettings` callback
