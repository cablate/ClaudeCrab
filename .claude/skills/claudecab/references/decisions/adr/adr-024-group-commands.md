# ADR-024: 群組命令支援

**狀態**：📋 proposed
**日期**：2026-02-04
**相關**：ADR-017, ADR-019

---

## 背景

目前 Telegram 命令（`/reset`、`/switch`、`/status` 等）只在私聊中可用。群組中使用者無法：

- `/reset` 重置與特定 Bot 的對話
- `/status` 查看 Bot 狀態
- `/cancel` 取消正在處理的查詢

### 問題

群組中 session key 為 `group::${chatId}`，所有使用者共用同一個 session。這與私聊的 `userId` session 不同，影響命令行為。

---

## 提議

### 支援的群組命令

| 命令 | 群組行為 | 說明 |
|------|----------|------|
| `/reset` | 重置群組 session | 需確認，因為影響所有人 |
| `/status` | 顯示群組中所有 Bot 狀態 | 包含各 Bot 的 session 資訊 |
| `/cancel` | 取消正在處理的查詢 | 需指定哪個 Bot（或取消全部） |
| `/help` | 顯示群組可用命令 | 簡化版 help |
| `/members` | 顯示群組 Bot 成員列表 | 含 @username 和描述 |

### 命令路由

群組中每個 Bot 都收到命令事件，需要決定哪個 Bot 處理：

#### 方案 A：所有 Bot 都回應（各自處理自己的部分）
- `/status` → 每個 Bot 回報自己的狀態
- 問題：多個回覆訊息，體驗混亂

#### 方案 B：只有第一個收到的 Bot 回應（dedup）
- 利用現有 GroupBroadcaster 的 dedup 機制
- 由第一個 Bot 統一回報所有 Bot 資訊

#### 方案 C：指定 Bot 回應（`/reset@coder_bot`）
- Telegram 原生支援 `/command@botname` 格式
- 只有被指定的 Bot 處理命令
- 無指定時使用 dedup（第一個回應）

---

## 實作要點

### TelegramAdapter 群組命令解析

目前 `TelegramCommands` 在群組訊息到達之前已經處理了命令。需要讓群組命令也能正確路由。

### Session 操作的特殊處理

- `/reset` 在群組中重置 `group::${chatId}` session → 影響所有人
- 是否需要 admin 權限才能在群組中 `/reset`？

---

## 影響

- `src/adapters/commands/TelegramCommands.ts` — 群組命令解析
- `src/adapters/TelegramAdapter.ts` — 群組命令路由
- `src/core/GroupBroadcaster.ts` — 命令 dedup

## 已決定

- [x] `/reset` 群組中需明確指定目標，避免誤觸：
  - `/reset@botname` → 只重置指定 Bot
  - `/reset@all` → 重置所有 Bot（需明確意圖）
  - `/reset`（無參數）→ 不執行，提示使用者指定目標
- [x] 需要群組專屬命令（`/members`）

## 待討論

- [ ] 方案 A/B/C 哪個最合適？（命令路由策略）
- [ ] `/reset` 全體重置是否需要權限控制（如只有群組 admin）？
- [ ] 命令 dedup 是否使用現有 GroupBroadcaster 機制？
