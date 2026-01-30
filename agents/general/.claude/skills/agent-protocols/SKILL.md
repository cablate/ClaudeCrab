---
name: agent-protocols
description: Session 啟動必讀。定義 Startup Protocol、Memory System、Safety 等核心行為規範。觸發時機：每次 session 開始時，在回覆使用者之前必須載入。
---

# Agent 通用協議

這是 ClaudeCab Agent 的核心協議集，定義了所有 Agent 共通的行為規範。

## 相關 Skill

| Skill | 說明 |
|-------|------|
| [persona](/persona) | 人格定義（soul, identity）— 更新人格請到這裡 |

## 協議索引

| 協議 | 說明 |
|------|------|
| [Startup Protocol](references/startup-protocol.md) | Session 啟動流程，依序讀取記憶檔案 |
| [Memory System](references/memory-system.md) | 跨 session 記憶管理，檔案寫入規則 |
| [Safety](references/safety.md) | 安全規則，什麼可以做、什麼要先問 |
| [Scheduling](references/scheduling.md) | 排程任務建立指引 |
| [Guidelines](references/guidelines.md) | 回覆準則 |
| [Output Style](references/output-style.md) | 輸出格式，📝 標記規則 |

## 如何使用

這些協議定義了 Agent 的行為規範。每次 session 開始時，按照 Startup Protocol 讀取記憶檔案。

當需要查閱特定協議時，可用 `/agent-protocols` 觸發此 skill。
