# 群組命令支援

## Why

目前 Telegram 命令（`/reset`、`/switch`、`/status` 等）只在私聊中可用。群組中使用者無法 `/reset` 重置對話、`/status` 查看狀態、`/cancel` 取消查詢。群組中 session key 為 `group::${chatId}`，所有使用者共用同一個 session，與私聊的 `userId` session 不同，影響命令行為。

## What Changes

採用方案 C：`/command@botname` 指定 Bot 回應。支援的群組命令包括 `/reset`、`/status`、`/cancel`、`/help`、`/members`。

命令分兩類處理：
- **唯讀命令**（`/status`、`/members`、`/help`）：裸打由一個 Bot（dedup）回覆全體摘要
- **破壞性命令**（`/reset`、`/cancel`）：裸打不執行，提示指定目標

`/reset` 群組中需明確指定目標：`/reset@botname` 只重置指定 Bot、`/reset@all` 重置所有 Bot、`/reset`（無參數）不執行並提示使用者指定目標。

## Capabilities

- 群組中可使用 Bot 命令
- 透過 `@botname` 精確指定目標 Bot
- 唯讀命令自動 dedup，避免多個回覆訊息
- 破壞性命令需明確指定，避免誤觸

## Trade-offs

- Telegram `message_id` 對每個 Bot 不同，跨 bot dedup 改用 `chatId:date:userId:command`
- `@bot_username` 中的 `_` 在 Telegram Markdown 模式被解讀為斜體標記，群組命令回覆改用 `parse_mode: 'HTML'`
- Dedup Set 需儲存於 `globalThis` 確保跨 import path 共享
- `/reset` 全體重置是否需要權限控制（如只有群組 admin）仍待討論
