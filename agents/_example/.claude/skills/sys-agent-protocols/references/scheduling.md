# Scheduling System

你可以幫使用者建立排程任務。當偵測到以下意圖時，主動引導：

## 觸發詞

- 「每天/每週/每月...幫我...」
- 「定時執行...」
- 「排程...」
- 「自動化...」
- 「提醒我...」（非簡單提醒，而是需要執行動作的）

## 建立流程

1. **確認任務內容**：要做什麼？
2. **確認執行時機**：什麼時候執行？多久一次？
3. **確認通知設定**：完成/失敗時要通知嗎？
4. **取得 chatId**：從【當前對話】context 中讀取 chatId（系統會自動注入）
5. **產出 YAML 規格**：寫入 `agents/{agentId}/schedules/<task-id>.yaml`，使用實際 chatId

## Trigger 類型

| type | 用途 | 必填欄位 |
|------|------|----------|
| `cron` | 週期性排程 | `cron`（cron 表達式） |
| `once` | 一次性定時 | `at`（ISO 8601 datetime） |
| `interval` | 固定間隔（ms） | `interval`（毫秒數） |

所有 trigger 都可加 `timezone`（預設 `Asia/Taipei`）。

## YAML 範例

### 週期性排程（cron）

```yaml
id: daily-summary
name: 每日摘要
trigger:
  type: cron
  cron: "0 22 * * *"  # 每天晚上 10 點
  timezone: Asia/Taipei
execution:
  agent: general
  prompt: |
    回顧今天的對話，整理重點到 memory/今天日期.md
notification:
  onComplete: true
  onError: true
  platform: telegram
  chatId: "123456789"  # ← 從【當前對話】取得的實際 chatId
metadata:
  createdAt: 2026-01-30T22:00:00+08:00
  createdBy: conversation
  enabled: true
```

### 一次性提醒（once）

```yaml
id: doctor-reminder-20260206
name: 看醫生提醒
trigger:
  type: once
  at: "2026-02-06T11:30:00+08:00"
  timezone: Asia/Taipei
execution:
  agent: general
  prompt: |
    提醒 Cab：該去看醫生了
notification:
  onComplete: true
  onError: false
  platform: telegram
  chatId: "123456789"
metadata:
  createdAt: 2026-02-06T09:20:00+08:00
  createdBy: conversation
  enabled: true
```

## 重要：欄位名稱必須正確

- 一次性排程用 `type: once` + `at`（**不是** `type: at`，**不是** `datetime`）
- 週期性排程用 `type: cron` + `cron`

## 建立檔案的正確方式

**使用 Write 工具**，不要用 Bash 的 cat 或 echo：

```
Write tool:
  file_path: F:\_Program\OwnProject\ClaudeCab\agents\{agentId}\schedules\<task-id>.yaml
  content: <YAML 內容>
```

**路徑說明**：
- 完整路徑：`F:\_Program\OwnProject\ClaudeCab\agents\{agentId}\schedules/`
- 相對於工作目錄：`schedules/`
- **不要**放在工作目錄直接底下，要放在 `schedules/` 子目錄內

## 注意事項

- 排程任務會在**獨立 session** 執行，不會延續當前對話
- 但你有 Startup Protocol，會自動讀取記憶檔案，具備足夠 context
- 執行結果會透過 Telegram 通知使用者（支援 Markdown 格式渲染）
