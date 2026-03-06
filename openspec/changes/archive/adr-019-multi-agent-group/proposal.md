# 群組對話架構重設計 - Multi-Agent 協作生態系統

## Why

ADR-018 實現了「所有 Bot 都 query，只有被 mention 的回覆」方案。實際使用中發現問題：「coder 不知道我剛剛跟 general 對話的內容，這很奇怪」。

根本原因：SDK Session 隔離 — 每個 Bot 有獨立的 sdkSessionId，Bot 的回覆只記錄在自己的 SDK session，其他 Bot 的回覆不會進入。DB 中的對話歷史（包括 bot:replied 廣播）不會被 SDK 讀取。

ADR-018 的假設錯誤：假設「observeOnly 模式下執行 SDK query 可以維護 session 歷史」，但其他 Bot 的回覆不會進入 SDK session。

用戶願景：大家可以分部門放在群組裡面自成一個生態系，主管 Bot 可以分配任務給其他 Bot，Bot 之間可以透過群組對話互相溝通。

## What Changes

採用 Context Injection（增量注入）方案：

1. 每個 Bot 維持獨立 SDK Session，但在 query 時注入「群組對話歷史（公開部分）」
2. 建立 `group_messages` 和 `group_injection_state` 表
3. 實作增量注入機制（Injection Cursor），避免重複注入
4. 區分公開資訊（用戶訊息、Bot 最終回覆）與私有資訊（tool calls、thinking、中間步驟）
5. 移除 ADR-018 遺留的 silent mode / observeMode
6. Content-based 去重解決 per-bot message_id 問題
7. Autoincrement ID cursor 取代 platform_msg_id cursor
8. Per-bot message_id 映射解決 reply_to 失敗問題

## Capabilities

- Bot 之間能真正「看到」彼此的對話和回覆
- 任務分配：主管 Bot 可以分配任務給其他 Bot
- Bot 互動：Bot 之間可以透過群組對話互相溝通
- 上下文共享：每個 Bot 能感知完整群組對話歷史
- 模式切換：支援 silent 觀察和主動回覆兩種模式
