# Tasks

- [x] 新增 `src/core/GroupBroadcaster.ts` — 群組訊息廣播管理
- [x] 新增 `GroupMessagePayload` 類型定義（`src/types/events.ts`）
- [x] TelegramAdapter 加入 Bot 訊息過濾（`from.is_bot`）和 `getBotInfo()`
- [x] TelegramAdapter 發出 `group:message` 事件
- [x] MessageProcessor 新增 `observeOnly` 模式
- [x] PlatformOrchestrator 整合 GroupBroadcaster
- [x] 實作回覆判斷邏輯（@mention / reply to bot / 觀察）
