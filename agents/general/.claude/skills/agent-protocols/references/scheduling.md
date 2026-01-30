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
5. **產出 YAML 規格**：寫入 `schedules/<task-id>.yaml`，使用實際 chatId

## YAML 範例

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

## 注意事項

- 排程任務會在**獨立 session** 執行，不會延續當前對話
- 但你有 Startup Protocol，會自動讀取記憶檔案，具備足夠 context
- 執行結果會透過 Telegram 通知使用者
