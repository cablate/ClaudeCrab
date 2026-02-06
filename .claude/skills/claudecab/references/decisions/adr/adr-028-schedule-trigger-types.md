# ADR-028: 排程 Trigger 類型支援策略

**日期**：2026-02-06
**狀態**：已接受
**關聯**：Schedule 系統、CronScheduler、TelegramCommands

## 背景

排程系統 Schema（`schemas.ts`）定義了三種 trigger type：`cron`、`once`、`interval`。但 `CronScheduler.register()` 只處理 `type: 'cron'`，其餘靜默跳過。這導致：

- Agent 依照 scheduling.md 建立 `type: once` 排程 → 通過驗證但永遠不執行
- `doctor-reminder.yaml` 修正為 `type: once` 後依然是死代碼

同時發現 `TelegramCommands.ts` 的 8+ 處 `ctx.reply(text, { parse_mode: 'Markdown' })` 沒有 fallback，動態內容（agent name、schedule ID、error message）可能含有 Markdown 特殊字元導致 Telegram API 拒絕。

## 決策

### D1: Once/Interval 轉換為 Cron 表達式

**不使用** `setTimeout`/`setInterval`，而是將 `once` 和 `interval` 轉換為 cron 表達式，沿用現有 `node-cron` 機制。

| Trigger Type | 轉換邏輯 | 範例 |
|-------------|----------|------|
| `cron` | 不變 | `0 22 * * *` |
| `once` | 解析 `at` datetime → `分 時 日 月 *` | `2026-02-06T11:30` → `30 11 6 2 *` |
| `interval` | ms → 分鐘 → `*/N * * * *`（≥60s） | `300000` → `*/5 * * * *` |

**放棄的方案**：改 `ScheduledJob` interface 為 `stop()/start()` 抽象，支援 setTimeout/setInterval。

**放棄原因**：
- `setTimeout` 有 Node.js 最大延遲限制（~24.8 天）
- Server 重啟後 timer 消失，需要重新排程邏輯
- 改 interface 影響所有 `pause`/`resume`/`stopAll`
- 轉換為 cron 零 interface 變動，零新依賴

### D2: Once 執行後自動 Unregister

`executeSchedule()` 完成後，若 `spec.trigger.type === 'once'`，自動呼叫 `unregister()` 移除 job。避免 cron 在下一年同月同日再次觸發。

### D3: Once 目標時間已過則不註冊

若 `at` 指定的時間已過，log warning 並跳過，不會嘗試立即執行。

### D4: Interval 最低 60 秒

Cron 的最小粒度是分鐘，sub-minute interval 無法表達。`interval < 60000ms` 拒絕並 log warning。

### D5: TelegramCommands Markdown Fallback 只加在動態內容

純靜態字串的 Markdown 如果壞了，應該修字串而不是加 fallback 蓋住 bug。只對含動態內容（`${agentName}`、`${scheduleId}`、`${errorMessage}` 等）的回應加 `replyWithMarkdown()` fallback。

**有 fallback**：handleStart、handleHelp（私聊）、handleScheduleList、handleScheduleInfo、handleScheduleHistory
**無 fallback**：handleHelp（群組）、handleScheduleHelp、各種固定提示訊息

## 限制

- `once` 轉換的 cron（`分 時 日 月 *`）不含年份，理論上每年同日會再觸發 — 但 D2 的自動 unregister 解決了這個問題
- `interval` 只能表達整分鐘倍數（1分、5分、1小時等），不支援任意毫秒精度
- `replyWithMarkdown` 的 fallback 是 plain text（無 MarkdownV2），因為 command 回應內容簡單，不需要 telegramify-markdown 轉換

## 影響

### 修改檔案
- `src/schedule/CronScheduler.ts` — 新增 `resolveCronExpression()`，修改 `register()` 和 `executeSchedule()`
- `src/adapters/commands/TelegramCommands.ts` — 新增 `replyWithMarkdown()` helper，替換 5 處動態 `ctx.reply()`

### 不影響
- `ScheduledJob` interface 不變
- `ScheduleManager`、`AppBootstrap`、外部 API 不變
- 排程建立 UI（目前只支援 cron 表單，once/interval 需手動寫 YAML）

## 附帶評估：Bot 建置流程與 WebUI UX

同次討論中也對整體建置流程做了審視，結論是**目前不需要大改**：

- Create → Edit 斷層存在但可接受（建立頻率低）
- Config 三層分散（agent.json + settings.local.json + CLAUDE.md）是 Claude Code SDK 的本質限制
- Detail 頁 Memory tab 已可編輯 CLAUDE.md，不缺編輯入口
- `_example` 模板膨脹可後續加「輕量/完整」選項，但不急
