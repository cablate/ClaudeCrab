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
  model: opus  # 可選：opus, sonnet, haiku（不寫則用 agent 預設）
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

## 模型指定

```yaml
execution:
  agent: general
  model: opus  # 可選：opus, sonnet, haiku
  prompt: "你的任務指令"
```

- 不寫 `model`：用該 agent 的 `.claude/settings.local.json` 裡的 model，或 SDK 預設值
- 例如 coder 的 settings.local.json 有 `"model": "opus"`，所以 coder 的 schedule 沒指定就會用 opus

## Prompt 設計原則（重要）

排程在**獨立 session** 執行，沒有對話上下文。Prompt 必須對「無上下文的新人」足夠明確：

### 必須明確指定的項目

1. **檔案位置**：給完整路徑或明確說「根目錄」「memory/ 目錄」
   - ✗ 「更新 USER.md」（會不知道在哪）
   - ✓ 「更新根目錄的 USER.md（與 CLAUDE.md 同層）」

2. **操作類型**：是「新建」還是「更新既有檔案」
   - ✗ 「建立 MEMORY.md」（可能重複建立）
   - ✓ 「USER.md 已存在，你是更新，不是新建」

3. **格式參照**：如果有既有格式，要求先讀取
   - ✓ 「先讀取現有檔案，理解既有結構，再追加/修改」

4. **輸出行為**：期望 AI 做什麼回傳什麼
   - ✗ 「整理摘要」（可能只回「已完成」）
   - ✓ 「整理摘要後，直接輸出摘要內容」

### 常見錯誤

| 錯誤 | 後果 | 正確寫法 |
|-----|-----|---------|
| 「更新 USER.md」 | 在錯誤位置建新檔 | 「更新根目錄的 USER.md」 |
| 「讀取昨天日誌」 | 不知道日期怎麼算 | 「讀取 memory/2026-02-25.md」或提供日期計算邏輯 |
| 「整理並回報」 | 只回「沒什麼好記的」 | 「整理後直接輸出完整內容」 |

### Prompt 自檢清單

建立排程前，檢查 prompt 是否回答了：
- [ ] 要操作的檔案在哪裡？（完整路徑）
- [ ] 是新建還是更新？
- [ ] 格式有沒有參照標準？
- [ ] 執行完要輸出什麼？

## 其他注意事項

- 排程任務會在**獨立 session** 執行，不會延續當前對話
- 但你有 Startup Protocol，會自動讀取記憶檔案，具備足夠 context
- 執行結果會透過 Telegram 通知使用者（支援 Markdown 格式渲染）
