# Claude Code Cache Creation Token 爆量問題：完整逆向分析

> 分析日期：2026-05-06
> 分析版本：Claude Code v2.1.109（cli.js）
> 適用範圍：v2.1.98 ~ v2.1.121+

---

## 一、問題現象

- Cache creation tokens 即使只打 "ok" 也大量消耗
- 相比 2026 年 3 月，100 Max 5x 續航力大幅下降
- 幾個小訊息就 1%，做事 5% 起跳
- v119、v109、v98 都有同樣問題

---

## 二、根因分析（多重因素疊加）

### 根因 #1：Cache TTL 無聲降級（最大元兇）

**[Issue #46829](https://github.com/anthropics/claude-code/issues/46829)**

Anthropic 在 2026 年 3 月初將 cache TTL 從 **1 小時降為 5 分鐘**。

- 3 月 5 日前：`ephemeral_1h`
- 3 月 8 日後：`ephemeral_5m`
- 日均快取失效從 39 次增到 **199 次**
- 有用戶計算多花 $719–$1,198（浪費 25.9%）
- 狀態：**已關閉為「不計劃修復」** — 這是刻意的降級

### 根因 #2：v2.1.100+ 伺服器端膨脹 +20K tokens

**[Issue #46917](https://github.com/anthropics/claude-code/issues/46917)**

v2.1.100 及之後版本，每次請求比 v2.1.98 多約 20,000 個 cache creation tokens。
這是 User-Agent 路由導致的**伺服器端膨脹**，不是客戶端問題。

### 根因 #3：todo_reminder / task_reminder 注入炸 cache

每 10 個 assistant turn，系統注入 `<system-reminder>` 到 transcript，改變 prompt prefix → cache 全毀。
**這是本文重點逆向分析的機制。**

### 根因 #4：2026/3/23 大規模配額異常耗盡

**[Issue #41930](https://github.com/anthropics/claude-code/issues/41930)**（330+ 評論）

四個重疊問題：
1. 尖峰時段限流（PT 5am–11am）
2. Bun fork 字串替換 bug（對話提到計費術語觸發 cache 重建）
3. `--resume`/`--continue` 快取失效
4. 2x 離峰優惠過期（3/13–28 促銷結束）

### 根因 #5：CLAUDE.md 架構問題

**[Issue #24147](https://github.com/anthropics/claude-code/issues/24147)**

每條訊息都重新發送完整系統提示 + 所有 CLAUDE.md。
15K token 的 CLAUDE.md × 100 條訊息 = 150 萬 cache read tokens。

### 影響對比表

| 因素 | 3月前 | 現在 |
|------|-------|------|
| Cache TTL | 1 小時 | 5 分鐘 |
| v100+ 膨脹 | 無 | 每次 +20K tokens |
| 離峰 2x 優惠 | 有 | 已過期 |
| 尖峰限流 | 無 | 有 |

---

## 三、todo_reminder 注入機制逆向分析

### 3.1 路由決策：GJ() 函數

原始碼位置：`cli.js:2627`

```javascript
function GJ() {
  // R6() = truthy 檢查 ("1", "true", "yes", "on")
  if (R6(process.env.CLAUDE_CODE_ENABLE_TASKS)) return true;
  return !m7();  // m7() = !isInteractive
}

// 等價邏輯：
// 互動模式 → GJ() = true  → 走 _0Y()（task_reminder）
// 非互動模式 → GJ() = false → 走 q0Y()（todo_reminder）
// CLAUDE_CODE_ENABLE_TASKS=1 → 強制走 _0Y()
```

### 3.2 isInteractive 判斷

```javascript
// cli.js:13417338
let K = args.includes("-p") || args.includes("--print");
let _ = args.includes("--init-only");
let z = args.some($ => $.startsWith("--sdk-url"));
let Y = K || _ || z || !process.stdout.isTTY;

H61(!Y);  // setIsInteractive(!Y)
```

**SDK 呼叫 CLI** → `--sdk-url` 或 `!isTTY` → `isInteractive = false` → 走 todo_reminder 路徑

### 3.3 主調度器 WDY()

```javascript
async function WDY(q, K, _, z, Y, A, O) {
  // 入口守門 — DISABLE_ATTACHMENTS 或 SIMPLE 直接跳過
  if (R6(process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS) ||
      R6(process.env.CLAUDE_CODE_SIMPLE))
    return pc8(z, w);  // 只處理 queued commands

  // ... 收集所有 attachments ...

  // 關鍵行：根據 GJ() 決定走哪條路
  LA("todo_reminders", () => GJ() ? _0Y(Y, K) : q0Y(Y, K))
}
```

### 3.4 todo_reminder 路徑 — q0Y()（SDK 非互動模式走這條）

```javascript
async function q0Y(q, K) {
  // 門檻 1：session 裡有沒有 TodoWrite 工具？
  if (!K.options.tools.some(Y => Q3(Y, ky))) return [];

  // 門檻 2：有沒有 BRIEF 工具？（mc8 = BRIEF_TOOL_NAME）
  if (mc8 && K.options.tools.some(Y => Q3(Y, mc8))) return [];

  if (!q || q.length === 0) return [];

  // 門檻 3：計數
  let { turnsSinceLastTodoWrite, turnsSinceLastReminder } = eDY(q);
  if (turnsSinceLastTodoWrite >= Bc8.TURNS_SINCE_WRITE &&      // >= 10
      turnsSinceLastReminder >= Bc8.TURNS_BETWEEN_REMINDERS) {  // >= 10
    let Y = K.agentId ?? L8();
    let O = K.getAppState().todos[Y] ?? [];
    return [{ type: "todo_reminder", content: O, itemCount: O.length }];
  }
  return [];
}
```

### 3.5 task_reminder 路徑 — _0Y()（互動模式走這條）

```javascript
async function _0Y(q, K) {
  if (!GJ()) return [];  // 非互動模式直接 return

  // 門檻同上：BRIEF 工具抑制、需要 TaskUpdate 工具
  if (mc8 && K.options.tools.some(Y => Q3(Y, mc8))) return [];
  if (!K.options.tools.some(Y => Q3(Y, IV))) return [];

  if (!q || q.length === 0) return [];

  let { turnsSinceLastTaskManagement, turnsSinceLastReminder } = K0Y(q);
  if (turnsSinceLastTaskManagement >= Bc8.TURNS_SINCE_WRITE &&
      turnsSinceLastReminder >= Bc8.TURNS_BETWEEN_REMINDERS) {
    let Y = await tf(WT());
    return [{ type: "task_reminder", content: Y, itemCount: Y.length }];
  }
  return [];
}
```

### 3.6 Turn 計數邏輯 — eDY()（todo）/ K0Y()（task）

兩者結構相同，以 eDY 為例：

```javascript
function eDY(q) {
  let turnsSinceLastTodoWrite = 0;
  let turnsSinceLastReminder = 0;
  let foundTodoWrite = false;
  let foundReminder = false;

  for (let A = q.length - 1; A >= 0; A--) {
    let O = q[A];
    if (O?.type === "assistant") {
      if (z_7(O)) continue;  // 跳過純 thinking 回覆
      if (!foundTodoWrite) {
        if (O.message.content.some(w =>
          w.type === "tool_use" && w.name === "TodoWrite"))
          foundTodoWrite = true;
        else
          turnsSinceLastTodoWrite++;
      }
      if (!foundReminder)
        turnsSinceLastReminder++;
    } else if (!foundReminder &&
               O?.type === "attachment" &&
               O.attachment.type === "todo_reminder") {
      foundReminder = true;
    }
    if (foundTodoWrite && foundReminder) break;
  }

  return { turnsSinceLastTodoWrite, turnsSinceLastReminder };
}
```

### 3.7 z_7() — 哪些 turn 不算

```javascript
function z_7(q) {
  if (q.type !== "assistant") return false;
  if (!Array.isArray(q.message.content)) return false;
  return q.message.content.every(K =>
    K.type === "thinking" || K.type === "redacted_thinking"
  );
}
```

**只有純 thinking block 的回覆被跳過。**
任何包含文字輸出或 tool_use 的 assistant 回覆都算 turn — 包括 "ok" keepalive。

### 3.8 常量定義

```javascript
Bc8 = {
  TURNS_SINCE_WRITE: 10,        // 上次寫 todo/task 後 10 turns
  TURNS_BETWEEN_REMINDERS: 10   // 兩次 reminder 間隔 10 turns
}
```

### 3.9 注入的內容

todo_reminder 注入的文字（~200–400 tokens）：

```
The TodoWrite tool hasn't been used recently. If you're working on tasks
that would benefit from tracking progress, consider using the TodoWrite
tool to track progress. Also consider cleaning up the todo list if has
become stale and no longer matches what you are working on. Only use it
if it's relevant to the current work. This is just a gentle reminder -
ignore if not applicable. Make sure that you NEVER mention this reminder
to the user

Here are the existing contents of your todo list:

[1. [in_progress] xxx
2. [completed] yyy]
```

task_reminder 注入的文字類似，但引用 TaskCreate/TaskUpdate。

### 3.10 為什麼注入會炸 cache

Prompt cache 基於**精確前綴匹配**：

1. Turn 32 的 API request：`[system prompt][history 1-32]` → cache hit
2. Turn 33 觸發 reminder：
   `[system prompt][history 1-32][REMINDER ATTACHMENT][user msg]`
3. REMINDER ATTACHMENT 改變了前綴結構 → 整個 cache prefix 失效
4. 全部 token 以 cache_write 費率重建

假設 200K tokens 上下文：
- cache_read：便宜 10x
- cache_write（5m TTL）：基礎價格 1.25x
- **每 10 turns 一次全量重建 = 大量額度消耗**

---

## 四、修復狀態（截至 v2.1.121+，2026 年 5 月）

| 問題 | Issue | 狀態 |
|------|-------|------|
| TTL 1h → 5m | #46829 | **官方關閉「不計劃修復」** |
| Reminder 注入炸 cache | — | **未修** |
| Resume/Continue cache 失效 | #43657 | **開放，未分配** |
| `ENABLE_PROMPT_CACHING_1H` 無效 | #49139 | **開放** |
| v2.1.100+ 的 +20K 膨脹 | #46917 | **未確認修復** |
| Malware reminder 迴歸 | #49363 | **已知迴歸** |

---

## 五、緩解方案

### 方案 A：`CLAUDE_CODE_SIMPLE=1`

最激進的一刀切。關掉：MCP 工具、所有 Attachments、Hooks、CLAUDE.md 載入、
Skills、Session memory、Custom agents、File watching、Diagnostics。

適用：SDK 跑單純任務，不需要任何進階功能。

### 方案 B：`CLAUDE_CODE_DISABLE_ATTACHMENTS=1`

關掉所有 attachment 注入，但保留 MCP 工具、初始 CLAUDE.md 載入、工具執行。

被關掉的（完整列表來自 WDY()）：

| 類別 | Attachment 類型 | 影響 |
|------|----------------|------|
| 用戶輸入處理 | at_mentioned_files | @file 引用不自動讀取 |
| | mcp_resources | @server:uri 引用不自動載入 |
| | agent_mentions | @agent-name 引用不觸發 |
| 系統注入 | date_change | 不通知日期變更 |
| | ultrathink_effort | 不自動升級思考深度 |
| | deferred_tools_delta | 延遲工具 schema 不自動推送 |
| | agent_listing_delta | 可用 agent 列表不更新 |
| | mcp_instructions_delta | MCP server instructions 不注入 |
| 檔案監控 | changed_files | 不偵測已開啟檔案的外部修改 |
| | nested_memory | 動態 CLAUDE.md 不自動載入 |
| 功能提醒 | skill_listing | Skill 列表不注入 |
| | plan_mode / auto_mode | 計畫模式提醒不觸發 |
| | **todo_reminders** | **問題根源被關掉** |
| | critical_system_reminder | 關鍵系統提醒不注入 |
| 子代理通訊 | agent_pending_messages | 子代理完成通知不推送 |
| IDE 整合 | ide_selection / ide_opened_file | IDE context 不注入 |
| | diagnostics / lsp_diagnostics | LSP 診斷不推送 |
| 資源追蹤 | token_usage / budget_usd | Token/預算資訊不注入 |
| | unified_tasks | 背景 task 狀態不推送 |
| Hooks | async_hook_responses | Hook 非同步回應不推送 |

保留的：queued_commands（用戶輸入）、MCP 工具定義與呼叫、初始系統提示、
初始 CLAUDE.md 載入、所有工具執行。

適用：SDK 需要 MCP 但不需要 task tracking 和動態注入功能。
注意：子代理完成通知會斷掉。

### 方案 C：從 SDK tools 列表移除 TodoWrite

最精準的方案。`q0Y()` 第一行就 return。不影響任何其他功能。

適用：SDK 可控制 tools 參數且不需要 todo tracking。
注意：需確認 SDK 預設是否自動帶入 TodoWrite。

### 方案 D：每 9 turns 主動寫一次 TodoWrite/TaskUpdate

重設計數器，永遠不觸發閾值。但本身也會稍微改 transcript。

### 方案 E：通用緩解（不需改環境變數）

- 降級到 v2.1.98：避開 +20K 膨脹（`npx @anthropic-ai/claude-code@2.1.98`）
- 避免 `--resume` / `--continue`：會觸發完整 cache 失效
- 頻繁 `/clear`：別讓對話累積太長
- 回覆間隔控制在 5 分鐘內：超過就全部 cache miss
- 離峰時段工作：避開 PT 5am–11am（台灣約 20:00–02:00）
- 精簡 CLAUDE.md：減少系統提示 token 數量
- `CLAUDE_CODE_DISABLE_1M_CONTEXT`：社群回報可減少 50–70% cache read

---

## 六、社群工具

| 工具 | 用途 |
|------|------|
| [cnighswonger/claude-code-cache-fix](https://github.com/cnighswonger/claude-code-cache-fix) | 代理層修復 resume cache 迴歸，測試達 95.5% cache hit |
| [yujiachen-y/claude-code-cache-keepalive](https://github.com/yujiachen-y/claude-code-cache-keepalive) | Stop hook 注入 keepalive 保持 5 分鐘 cache warm |
| [ArkNill/claude-code-hidden-problem-analysis](https://github.com/ArkNill/claude-code-hidden-problem-analysis) | Cache bug 造成 Max 方案 10–20x token 膨脹的量測分析 |
| [phuryn/claude-usage](https://github.com/phuryn/claude-usage) | 本地儀表板追蹤 token 使用、成本和 session 歷史 |

---

## 七、關鍵 GitHub Issues

| Issue | 標題 | 狀態 |
|-------|------|------|
| [#46829](https://github.com/anthropics/claude-code/issues/46829) | Cache TTL silently regressed from 1h to 5m | 關閉（不修） |
| [#46917](https://github.com/anthropics/claude-code/issues/46917) | CC v2.1.100+ inflates cache_creation by ~20K tokens | 開放 |
| [#41930](https://github.com/anthropics/claude-code/issues/41930) | Critical: Widespread abnormal usage limit drain since March 23 | 開放 |
| [#24147](https://github.com/anthropics/claude-code/issues/24147) | Cache read tokens consume 99.93% of usage quota | 開放 |
| [#43657](https://github.com/anthropics/claude-code/issues/43657) | Resume/continue cache invalidation (2 root causes) | 開放 |
| [#49139](https://github.com/anthropics/claude-code/issues/49139) | ENABLE_PROMPT_CACHING_1H is not working | 開放 |
| [#49363](https://github.com/anthropics/claude-code/issues/49363) | Malware reminder regression in v2.1.111+ | 開放 |
| [#26038](https://github.com/anthropics/claude-code/issues/26038) | Allow disabling periodic task tool reminders | 開放 |
| [#50213](https://github.com/anthropics/claude-code/issues/50213) | Subagent requests cache control issue | 開放 |

---

## 八、媒體報導

- [XDA：Anthropic 悄悄削減了 Claude Code 的 1 小時快取](https://www.xda-developers.com/anthropic-quietly-nerfed-claude-code-hour-cache-token-budget/)
- [The Register：Anthropic 承認 Claude Code 配額耗盡過快](https://www.theregister.com/2026/03/31/anthropic_claude_code_limits/)
- [The New Stack：Claude Code 用戶稱使用限制耗盡速度超常](https://thenewstack.io/claude-code-usage-limits/)
