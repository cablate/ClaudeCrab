# ADR-022: 委派機制增強（多重委派 + 可配置）

**狀態**：📋 proposed
**日期**：2026-02-04
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

## 提議

### 1. 多重委派

修改 `detectDelegationTarget()` 回傳陣列而非單一 agentId：

```typescript
private detectDelegationTargets(
  response: string,
  chatId: string,
  senderAgentId: string,
  delegationChain: string[]
): string[]
```

- 每個被 @mention 的 Bot 獨立觸發（各自的 delegation depth 共用）
- 安全限制不變：depth limit、cycle detection 對每個 target 獨立檢查

### 2. 委派可配置

在 `agent.json` 中新增設定：

```json
{
  "settings": {
    "delegation": {
      "enabled": true,
      "acceptDelegation": true,
      "canDelegate": true
    }
  }
}
```

- `acceptDelegation: false` → 此 Bot 不會被其他 Bot 自動觸發
- `canDelegate: false` → 此 Bot 的回覆不會觸發委派偵測
- 預設全部 `true`（向後相容）

---

## 替代方案

### 方案 A：維持單一委派
- 優點：簡單、可預測
- 缺點：限制主管 Bot 同時分配多任務的能力

### 方案 B：在群組設定中配置（非 agent 層級）
- 優點：每個群組可以有不同設定
- 缺點：增加管理複雜度

---

## 影響

- `src/core/GroupBroadcaster.ts` — detectDelegationTarget 改為回傳陣列
- `src/core/AgentLoader.ts` — 解析新的 delegation 設定
- `src/types/agent.ts` — AgentConfig 新增 delegation 設定

## 待討論

- [ ] 多重委派是否需要？還是單一委派已足夠？
- [ ] 可配置的粒度：agent 層級 vs 群組層級？
- [ ] 多重委派的 depth 計算：共用還是獨立？
