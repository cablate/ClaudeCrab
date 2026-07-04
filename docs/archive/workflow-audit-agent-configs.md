# Codebase Audit — Workflow Agent 設定記錄

> 執行時間：2026-05-30
> Workflow: `codebase-audit`（9 sub-agents）
> 用途：記錄各 agent 的 prompt 設計與用途，供日後參考

---

## Phase 1：結構盤點（2 agents）

### Agent 1 — module-map（架構盤點）

- **label**: `module-map`
- **model**: 預設（繼承 main-loop）
- **prompt 設計意圖**：從高層次掃描 src/ 各子目錄的職責邊界與依賴方向。重點在 barrel export 的死 export 檢查 + 跨層依賴異常。
- **關鍵指令**：
  - 讀 adapters/ core/ persistence/ schedule/ services/ types/ utils/
  - 檢查 barrel（index.ts）是否有死 export
  - 確認 adapter / core / persistence / schedule 依賴是否單向
- **schema**: 無（純文字產出）

### Agent 2 — file-size-analysis（大檔案盤點）

- **label**: `file-size-analysis`
- **model**: 預設
- **prompt 設計意圖**：給定 top 14 最大檔案的具體行數排名，要求逐一判斷是否需拆分及拆分方向。避免 agent 自己去算行數浪費 token。
- **關鍵指令**：
  - 對 >400 行檔案判斷拆分必要性
  - 優先級 P0=急需拆分, P1=建議拆分, P2=可接受
- **schema**: 無（純文字產出）

---

## Phase 2：品質掃描（3 agents）

### Agent 3 — error-handling（錯誤處理）

- **label**: `error-handling`
- **model**: 預設
- **prompt 設計意圖**：掃描全部 try/catch，特別針對 7 個 `.catch(() => {})` 完全靜默模式。區分「log and swallow」（可接受）vs「完全吞掉」（危險）。
- **關鍵指令**：
  - 列出 7 個 `.catch(() => {})` 位置
  - 區分 catch 區塊品質：真正處理 vs 只 log vs 完全吞掉
  - 檢查缺少 try/catch 的風險點
- **schema**: 無（純文字產出）

### Agent 4 — type-safety（型別安全）

- **label**: `type-safety`
- **model**: 預設
- **prompt 設計意圖**：針對 SDKStreamProcessor.ts 已知的 eslint-disable any 問題，以及其他檔案的 `as any` / `as unknown as` 雙重轉型。
- **關鍵指令**：
  - 找到 13+ 個 eslint-disable 的位置與根本原因
  - 檢查全專案 as any、as unknown as、非 null 斷言
- **schema**: 無（純文字產出）

### Agent 5 — db-patterns（資料層模式）

- **label**: `db-patterns`
- **model**: 預設
- **prompt 設計意圖**：DB 層的 SELECT * 泛濫、JS 端過濾反模式、migration 管理問題。
- **關鍵指令**：
  - 盤點 SELECT * 位置與影響
  - /status 的 JS for...of 過濾 -> N+1 風險？
  - Migration 變數命名脫節
- **schema**: 無（純文字產出）

---

## Phase 3：效能診斷（3 agents）

### Agent 6 — timer-audit（Timer 管理）

- **label**: `timer-audit`
- **model**: 預設
- **prompt 設計意圖**：盤點 15+ 個 timer，檢查 cleanup path 與 leak 風險。
- **關鍵指令**：
  - 列出每個 timer 位置、類型、用途
  - SDKKeepaliveManager 的 setTimeout 鏈是否會 leak
  - 各常駐 interval 是否有對應 dispose/cleanup
- **schema**: 無（純文字產出）

### Agent 7 — eventbus-analysis（EventBus 效能）

- **label**: `eventbus-analysis`
- **model**: 預設
- **prompt 設計意圖**：分析 EventBus 的 emit/emitSync 效能問題與 EventType 常數使用狀態。
- **關鍵指令**：
  - emit() 每次建 array + Promise.allSettled 的開銷
  - emitSync 名實不符（內部還是 async）
  - EventType 是否有根本沒 emit 的殘留 key
- **schema**: 無（純文字產出）

### Agent 8 — memory-analysis（記憶體）

- **label**: `memory-analysis`
- **model**: 預設
- **prompt 設計意圖**：檢查 unbounded Map growth、closure retention、多 interval 對 event loop 的壓力。
- **關鍵指令**：
  - SessionManager.sessions 有 cleanup 嗎？
  - SDKSessionManager.managedSessions 管理方式
  - SDKKeepaliveManager 的 closure 是否持有大型物件
- **schema**: 無（純文字產出）

---

## Phase 4：彙整報告（1 agent）

### Agent 9 — synthesize-report（報告合成）

- **label**: `synthesize-report`
- **model**: 預設
- **prompt 設計意圖**：接收前 8 個 agent 的純文字產出，依規定格式合成最終報告。不加首頁廢話、不用模板句。
- **輸入資料量**：~8 份結構化純文字
- **產出格式**：markdown 報告，含 P0/P1/P2 分級 + 執行計畫
- **schema**: 無（純文字產出）

---

## 設計原則

1. **純文字產出，不用 JSON Schema** — 一開始嘗試用 schema 但 workflow parser 對巢狀 JSON Schema 有問題，改純文字後更靈活、agent 產出品質不降。
2. **每個 agent 單一職責** — 每個只做一個維度，避免跨維度混淆。
3. **平行執行** — Phase 1/2/3 內的 agents 用 Promise.all 平行 dispatch，總 wall-clock ~2 分鐘（含 9 agents）。
4. **先給數據再問分析** — 如 file-size-analysis 直接給行數排名，避免 agent 浪費 token 重新掃描。
