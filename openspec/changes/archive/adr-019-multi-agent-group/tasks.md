# Tasks

- [x] 建立 `group_messages` 和 `group_injection_state` 表（SCHEMA_VERSION 5）
- [x] 實作 `GroupMessageRepository` — 記錄群組訊息
- [x] 實作 `InjectionStateRepository` — 管理注入狀態
- [x] 實作 `ContextInjector` — 撈取待注入訊息並格式化
- [x] 修改 SDK query 流程，注入群組歷史
- [x] Cursor 更新邏輯（成功後更新）
- [x] 注入格式設計與實作
- [x] 移除 ADR-018 遺留的 silent mode / observeMode
- [x] Content-based 去重（解決 per-bot message_id 問題）
- [x] Autoincrement ID cursor（取代 platform_msg_id cursor）
- [x] Per-bot message_id 映射（解決 reply_to 失敗問題）
- [x] 注入格式改進（LLM 可理解的中文 framing）
