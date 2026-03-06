## Problem

排程 YAML 檔案修改後，系統不會自動偵測變更。目前排程同步（`syncSchedulesForAgent`）僅在 `message:sent` 事件觸發時執行——也就是只有「有人跟 agent 說話」或「排程執行完通知」時才會重新掃描 YAML。

實際案例：2026-03-03 凌晨，三個 agent 的 `daily-reflection.yaml` 同時被更新，但 coder agent 因為沒有任何訊息事件，新排程從未被載入，03:00 的排程直接跳過。

## Root Cause

`AppBootstrap.initializeScheduleSystem()` 中，排程同步綁定在 `message:sent` 事件上：

```ts
getEventBus().on('message:sent', (payload) => {
  if (payload.agentId) {
    void scheduleManager.syncSchedulesForAgent(payload.agentId);
  }
});
```

沒有檔案系統監聽機制。YAML 檔案的新增、修改、刪除都不會被偵測到，除非該 agent 剛好有其他事件觸發 sync。

## Proposed Solution

在 `ScheduleManager` 中加入 chokidar file watcher，監聽 `agents/*/schedules/*.yaml` 的檔案變更（add/change/unlink），變更時自動從路徑解析 agentId 並呼叫 `syncSchedulesForAgent`。

加入 debounce 機制避免短時間內多次檔案寫入造成重複 sync（例如 IDE 自動存檔或批量修改）。

## Success Criteria

- YAML 檔案新增後，排程在數秒內自動註冊，無需等待 message:sent
- YAML 檔案修改後，排程自動更新 cron 表達式、prompt 等設定
- YAML 檔案刪除後，排程自動取消註冊
- 多個 YAML 同時修改時，debounce 合併為單次 sync per agent
- 既有的 message:sent sync 機制保留作為 fallback
- watcher 錯誤不影響系統其他功能（graceful degradation）

## Impact

- Affected code:
  - `src/schedule/ScheduleManager.ts` — 新增 file watcher 邏輯
  - `src/AppBootstrap.ts` — 初始化 watcher、dispose 時清理
  - `package.json` — 新增 chokidar dependency（如尚未存在）
