# grammy message handler 必須 fire-and-forget

## Why

TelegramAdapter 的 message handler 中呼叫 MessageProcessor 處理使用者訊息，SDK query 可能觸發 canUseTool → 發送 InlineKeyboard → 等待使用者按下按鈕（callback_query）。若 message handler `await` 整個 SDK query 流程，grammy 的 polling loop 被阻塞，無法收到後續的 `callback_query` 事件，造成死鎖（SDK 等按鈕 → grammy 等 handler 完成 → 永遠卡住）。

## What Changes

message handler 改為 fire-and-forget（不 await processMessage），讓 grammy polling loop 立即釋放以接收後續事件。

## Capabilities

- 解決 canUseTool 按鈕互動的死鎖問題
- grammy polling loop 保持暢通

## Trade-offs

- handler 內的錯誤需要額外 `.catch()` 處理，不會自動冒泡
- grammy 的 `bot.catch()` 無法攔截非同步錯誤
