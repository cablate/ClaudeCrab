# 多 Bot 群組協作設計

## Why

ADR-017 完成了群組對話 Phase 1（1 User + 1 Bot）。Phase 2 的目標是讓多個 Bot 在同一群組中協作：

- 多個 Bot 在同一群組各司其職
- Bot 之間能「看到」彼此的對話
- 體驗如同真實群組聊天

核心問題：如何讓群組中的所有 Bot 都知道發生了什麼，但只有被點名的 Bot 回覆？

## What Changes

選擇方案 B：所有 Bot 都 query，只有被 mention 的回覆

- 所有 Bot 都執行 query（維護各自的 session）
- 只有被 @mention 或 reply to 的 Bot 發送回覆
- 其他 Bot 以「觀察模式」運行
- 新增 GroupBroadcaster 管理群組訊息廣播
- MessageProcessor 新增 observeOnly 模式

## Capabilities

- Bot 之間可以「感知」彼此的對話
- 接續對話更自然（工程師 Bot 知道秘書 Bot 剛才說了什麼）
- 架構清晰，職責分離
