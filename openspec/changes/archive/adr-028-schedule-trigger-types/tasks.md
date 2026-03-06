# Tasks

- [x] 在 `CronScheduler` 新增 `resolveCronExpression()` 處理 once/interval 轉換
- [x] 實作 `once` trigger type：解析 `at` datetime → cron 表達式
- [x] 實作 `interval` trigger type：ms → 分鐘 → `*/N * * * *`
- [x] Once 執行後自動 unregister
- [x] Once 目標時間已過則不註冊（log warning 並跳過）
- [x] Interval 最低 60 秒檢查（< 60000ms 拒絕並 log warning）
- [x] 在 `TelegramCommands` 新增 `replyWithMarkdown()` helper
- [x] 替換 5 處動態內容的 `ctx.reply()` 為 `replyWithMarkdown()` fallback
