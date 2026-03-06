# 排程 Trigger 類型支援策略

## Why

排程系統 Schema（`schemas.ts`）定義了三種 trigger type：`cron`、`once`、`interval`。但 `CronScheduler.register()` 只處理 `type: cron`，其餘靜默跳過。這導致：

- Agent 依照 scheduling.md 建立 `type: once` 排程 → 通過驗證但永遠不執行
- `doctor-reminder.yaml` 修正為 `type: once` 後依然是死代碼

同時發現 `TelegramCommands.ts` 的 8+ 處 `ctx.reply(text, { parse_mode: 'Markdown' })` 沒有 fallback，動態內容可能含有 Markdown 特殊字元導致 Telegram API 拒絕。

## What Changes

### Once/Interval 轉換為 Cron 表達式

不使用 `setTimeout`/`setInterval`，而是將 `once` 和 `interval` 轉換為 cron 表達式，沿用現有 `node-cron` 機制。

| Trigger Type | 轉換邏輯 | 範例 |
|-------------|----------|------|
| `cron` | 不變 | `0 22 * * *` |
| `once` | 解析 `at` datetime → `分 時 日 月 *` | `2026-02-06T11:30` → `30 11 6 2 *` |
| `interval` | ms → 分鐘 → `*/N * * * *`（≥60s） | `300000` → `*/5 * * * *` |

Once 執行後自動 unregister。Once 目標時間已過則不註冊。Interval 最低 60 秒。

### TelegramCommands Markdown Fallback

只對含動態內容的回應加 `replyWithMarkdown()` fallback，純靜態字串不加。

## Capabilities

- `once` 和 `interval` trigger type 正常運作，不再是死代碼
- 零 interface 變動、零新依賴，沿用現有 node-cron 機制
- TelegramCommands 動態內容不會因 Markdown 特殊字元導致 API 拒絕
