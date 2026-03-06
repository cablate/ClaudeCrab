## Context

ScheduleManager 目前在 `initialize()` 時載入所有 YAML，之後依賴 `message:sent` 事件觸發 `syncSchedulesForAgent`。這表示如果一個 agent 的排程 YAML 被外部修改（Claude Code session、手動編輯），但該 agent 沒有收到任何訊息，變更永遠不會被載入。

ScheduleManager 已有完善的 `syncSchedulesForAgent` 方法，能處理新增、更新、刪除——只缺一個觸發來源。

## Goals / Non-Goals

**Goals:**

- YAML 檔案變更後數秒內自動觸發排程同步
- 不破壞現有 message:sent sync 機制（保留作為 fallback）
- watcher 生命週期正確管理（啟動、關閉）

**Non-Goals:**

- 不改動 `syncSchedulesForAgent` 的同步邏輯（已經夠好）
- 不做跨 OS 相容性測試（chokidar 已處理）
- 不監聽 schedules/ 以外的檔案

## Decisions

### 使用 chokidar 而非 Node.js 原生 fs.watch

**選擇：** chokidar  
**理由：** `fs.watch` 在 Windows 上行為不穩定（重複事件、路徑不一致）。chokidar 是 Node.js 生態事實標準，已被 Vite、webpack 等廣泛使用，跨平台穩定。  
**替代方案：** `fs.watch` — 零依賴但需要自己處理 debounce、平台差異、recursive watching。不值得。

### Watcher 放在 ScheduleManager 而非 AppBootstrap

**選擇：** 在 ScheduleManager 內部管理 watcher 生命週期  
**理由：** ScheduleManager 已擁有 `loader`（知道 agentsDir 路徑）和 `syncSchedulesForAgent`。watcher 是同步機制的一部分，不是 bootstrap 邏輯。dispose() 時一併關閉。  
**替代方案：** 在 AppBootstrap 建立 watcher 再注入 — 增加耦合，ScheduleManager 的 dispose 無法自主清理。

### 以 agentId 為粒度 debounce

**選擇：** 每個 agentId 獨立的 debounce timer（300ms）  
**理由：** 批量修改同一 agent 的多個 YAML 時合併為單次 sync，但不同 agent 的變更互不影響。300ms 足以合併 IDE 連續存檔，又不會讓使用者感覺延遲。  
**替代方案：** 全域單一 debounce — 改 agent A 的檔案會延遲 agent B 的同步。不合理。

### Watcher 在 initialize() 中啟動

**選擇：** `startFileWatcher()` 在 `initialize()` 末尾呼叫  
**理由：** 確保 loader 和 scheduler 都已就緒後才開始監聽。避免 watcher 在系統未初始化時觸發 sync。  
**替代方案：** constructor 中啟動 — 可能在依賴未就緒時收到事件。

## Risks / Trade-offs

- **[Risk] chokidar 新增依賴** → 影響極小，chokidar 是輕量且穩定的套件，無 native addon
- **[Risk] Watcher 在高頻寫入時觸發過多 sync** → debounce 300ms per agent 緩解
- **[Risk] Watcher 初始化失敗** → catch 錯誤、log warning、不影響系統啟動（graceful degradation）
- **[Risk] 檔案系統事件遺漏（極少見）** → message:sent sync 作為 fallback 保底
