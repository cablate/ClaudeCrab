## 1. Dependencies

- [x] 1.1 安裝 chokidar dependency（使用 chokidar 而非 Node.js 原生 fs.watch）

## 2. Core Implementation

- [x] 2.1 在 ScheduleManager 新增 `startFileWatcher()` 方法（watcher 放在 ScheduleManager 而非 AppBootstrap），實作 automatic schedule sync on YAML file changes：使用 chokidar 監聯 `agents/*/schedules/*.yaml`，檔案 add/change/unlink 時從路徑解析 agentId 並呼叫 `syncSchedulesForAgent`
- [x] 2.2 實作以 agentId 為粒度 debounce 機制（300ms per agent），處理 multiple files changed rapidly for same agent 場景
- [x] 2.3 在 ScheduleManager 新增 `watcher` property 和 `stopFileWatcher()` 方法，實作 file watcher lifecycle management
- [x] 2.4 在 `initialize()` 末尾呼叫 `startFileWatcher()`（watcher 在 initialize() 中啟動）
- [x] 2.5 在 `dispose()` 中呼叫 `stopFileWatcher()`（watcher stops on dispose）
- [x] 2.6 實作 file watcher graceful degradation：startFileWatcher 用 try-catch 包裝，失敗時 log warning 不阻止系統啟動

## 3. Integration

- [x] 3.1 確認 AppBootstrap 的 message:sent sync 保留不動（既有 fallback 機制）

## 4. Verification

- [x] 4.1 [P] 啟動系統，確認 log 出現 watcher registered 訊息
- [x] 4.2 [P] 新增一個測試 YAML → 確認排程自動註冊（無需 message:sent）
- [x] 4.3 修改該 YAML 的 cron → 確認排程自動更新
- [x] 4.4 刪除該 YAML → 確認排程自動取消註冊
- [x] 4.5 清理測試 YAML
