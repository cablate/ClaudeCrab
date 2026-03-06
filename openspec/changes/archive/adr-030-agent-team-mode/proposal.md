# Agent Team Mode — 多 Agent 並行協作

## Why

ClaudeCab 已是多 agent 協作框架，Telegram 群組就是 team。現有協作機制包括 GroupBroadcaster（訊息路由）、Delegation（ADR-021/022）、Initiative（ADR-023），但存在四個局限：Delegation 是串行的（不支援同時請多個 bot 各做一部分）、缺少結構化任務追蹤、缺少結果綜合機制、協作是被動的（bot 只在被 @mention 或 delegation 時參與）。

參照 2026-02-05 隨 Opus 4.6 發布的 Claude Code Agent Teams 架構，ClaudeCab 的核心差距是：群組收到複雜請求時，目前只有一個 bot 在跑，其他 bot 閒著。差三層：並行觸發、任務感知、收斂機制。

## What Changes

### Tier 1：最小可行 Team Mode
- **並行委派**：DelegationHandler 從 `for...await`（串行）改為 `Promise.allSettled()`（並行），1 個 target 維持原邏輯，2+ targets 並行
- **結果收斂**：並行委派完成後，協調者收集結果 → 注入 synthesis prompt → 產出綜合回覆
- **isSynthesis 安全旗標**：仿照 `isInitiative` 模式，防止 synthesis 回覆觸發二次委派
- **協調者選擇**：沿用 `getRespondingBot()` 機制，bot 的 LLM 判斷分工後自動成為協調者

### Tier 1.1~1.3：協作失控防護（基於實測發現）
- **委派意圖判斷（1.1）**：isDelegationResponse flag + 啟發式規則，防止禮貌性 @mention 觸發非預期委派
- **Delegation 期間靜默 Initiative（1.2）**：GroupBroadcaster 追蹤 delegation-in-progress 狀態
- **群組噪音控制（1.3）**：ContextInjector 群組行為指示，群組中不回報記憶操作結果

### 未來 Tier
- Tier 1.5：協調者自動選擇（Centralized Responder Selection，O(1) query 取代 Initiative 的 O(N) query）
- Tier 2：結構化任務感知（team_tasks 表 + dependency + 認領）
- Tier 3：進階協作（plan approval + delegate mode + quality hooks）

## Capabilities

- 一個訊息進來可拆成子任務，同時啟動多個 bot 的 SDK session 並行處理
- 協調者自動收集並行結果並產出綜合回覆
- 防止禮貌性 @mention 和回報性 @mention 觸發意外委派鏈
- Delegation 進行中時 Initiative 不會產生噪音
- 群組中不會出現記憶寫入通知等無關訊息
