## Purpose

ClaudeCab 是一個輕量級多智能體 Telegram 機器人框架。它讓 Claude Code 能夠作為可遠端控制的專業助理運行。每個 agent 是一個獨立的目錄型工作區，通訊層（Telegram）純粹作為面向使用者的介面。

## Requirements

### Requirement: 目錄即 Agent 架構

系統應（SHALL）將每個 `agents/{id}/` 目錄視為獨立、自包含的 Claude Code 工作區（agent）。

每個 agent 目錄必須（MUST）包含以下標準檔案：
- `agent.json` — ClaudeCab 元資料與 agent 配置
- `CLAUDE.md` — 系統提示詞與工作區指令
- `.mcp.json` — 由 SDK 自動載入的 MCP server 宣告
- `.claude/settings.local.json` — 權限配置
- `.claude/skills/` — 由 SDK 自動載入的 agent 專屬 skill

#### Scenario: 透過建立目錄來註冊新 agent

- **WHEN** 建立了含有 `agent.json` 與 `CLAUDE.md` 的新 `agents/{id}/` 目錄
- **THEN** 系統應（SHALL）將其識別為有效的 agent，並使其可用於任務執行，無需對引擎層（`src/`）進行任何修改

#### Scenario: 強制執行 agent 工作區隔離

- **WHEN** `agents/alpha/` 與 `agents/beta/` 下存在兩個 agent
- **THEN** 它們的 MCP server、skill、記憶體與 CLAUDE.md 指令應（SHALL）保持完全獨立，且不得（MUST NOT）共享執行期狀態

---

### Requirement: SDK 整合層可抽取性

SDK 整合層應（SHALL）僅接受 `systemPrompt` 與 `cwd` 作為輸入，且不得（MUST NOT）注入任何業務邏輯。

整合層必須（MUST）設計為可從 ClaudeCab 中抽取，並在其他專案中不經修改地重複使用。

#### Scenario: 以最小輸入呼叫 SDK 層

- **WHEN** 以 `systemPrompt` 字串與 `cwd` 路徑呼叫 SDK 整合層
- **THEN** 它應（SHALL）執行範疇限定於該工作目錄的 Claude agent session，且引擎不注入任何額外上下文

#### Scenario: 在外部專案中使用 SDK 層

- **WHEN** 將 SDK 整合模組複製到不同的專案，並提供有效的 `systemPrompt` 與 `cwd`
- **THEN** 它應（SHALL）正確運作，且不依賴任何 ClaudeCab 特定的模組或配置

---

### Requirement: Agent 自管理記憶體

記憶體系統應（SHALL）完全由 agent 自身透過 `CLAUDE.md` 中定義的指令來操作。引擎層（`src/`）不得（MUST NOT）對 agent 記憶體內容有任何感知。

系統不得（MUST NOT）實作在 SDK 呼叫前將記憶體內容注入 `systemPrompt` 的組裝層。

#### Scenario: Agent 在 session 期間更新自身記憶體

- **WHEN** agent session 處於活躍狀態，且 agent 決定持久化資訊
- **THEN** agent 應（SHALL）使用其工作區中可用的工具寫入自身記憶體檔案（例如 `memory/`、`MEMORY.md`），無需任何引擎層的編排

#### Scenario: 引擎對記憶體內容保持無感知

- **WHEN** 引擎呼叫 agent session
- **THEN** 引擎應（SHALL）僅將 `systemPrompt`（來自 `CLAUDE.md`）與 `cwd`（agent 目錄）傳遞給 SDK，且不得（SHALL NOT）讀取或注入記憶體檔案內容

---

### Requirement: 透過 Telegram 介面通訊

系統應（SHALL）透過 Telegram 作為主要使用者介面來對外提供 agent 能力。Telegram 必須（MUST）僅作為通訊管道，且不得（SHALL NOT）被視為需要重建或替換的平台。

系統必須（MUST）支援未來擴展至其他訊息平台（例如 Discord、Slack），且無需對 agent 層或 SDK 層進行修改。

#### Scenario: 使用者透過 Telegram 發送任務

- **WHEN** 使用者向 Telegram 機器人發送訊息
- **THEN** 系統應（SHALL）將訊息路由至適當的 agent，透過 SDK 執行任務，並透過 Telegram 將 agent 的回應返回給使用者

#### Scenario: Agent 發送主動通知

- **WHEN** agent 完成排程或自主任務
- **THEN** 系統應（SHALL）允許 agent 透過 Telegram 向使用者推送訊息，無需等待使用者先行發送訊息

---

### Requirement: 結構化活動事件層

系統應（SHALL）為所有機器人行為發出結構化事件。每個 agent 動作（接收任務、執行任務、完成任務、閒置狀態）必須（MUST）產生對應的事件。

事件應（SHALL）可同時被多個下游消費者消費（例如 Telegram 通訊層、Web 前端）。

#### Scenario: 發出任務接收事件

- **WHEN** agent 接收到新任務
- **THEN** 系統應（SHALL）發出包含至少以下內容的結構化活動事件：事件類型、agent ID 與時間戳記

#### Scenario: 多個消費者接收相同事件

- **WHEN** 發出活動事件
- **THEN** Telegram 通訊層與 Web 前端應（SHALL）透過 SSE 或 WebSocket 各自獨立地接收並處理該事件

---

### Requirement: 自主任務的 Cron 排程

系統應（SHALL）支援基於 cron 的排程，使 agent 能夠在定義的時間間隔內自動執行任務，無需使用者輸入。

#### Scenario: 排程任務在配置時間觸發

- **WHEN** 為 agent 配置了 cron 排程且觸發時間到達
- **THEN** 系統應（SHALL）以配置的任務參數自動呼叫 agent session

#### Scenario: Agent 向使用者發送排程任務結果

- **WHEN** 排程任務完成
- **THEN** agent 應（SHALL）主動將結果發送至配置的使用者頻道（例如 Telegram），無需等待使用者發起請求

---

### Requirement: 輕量化部署

系統應（SHALL）可使用單一啟動指令（`npm start`）在標準 Node.js 環境中運行。

系統不得（MUST NOT）要求複雜的基礎設施（例如 Kubernetes、受管資料庫、雲端特定服務）來進行基本操作。

#### Scenario: 系統從乾淨環境啟動

- **WHEN** 在正確配置的環境中執行 `npm start`
- **THEN** 所有 agent、Telegram 機器人、cron 排程器與 Web UI 應（SHALL）在無需額外手動設定步驟的情況下開始運作

#### Scenario: 系統範疇保持有界

- **WHEN** 評估是否新增新功能
- **THEN** 系統應（SHALL）拒絕能複製由專用工具更佳處理之功能的特性（例如透過 MCP 存取的 Playwright 瀏覽器自動化），以保持部署簡潔性

---

### Requirement: 具備 Agent 在場感的即時 Web 前端

系統應（SHALL）提供基於 Web 的前端，顯示即時的 agent 狀態與活動。

前端必須（MUST）消費活動事件層，並應（SHALL）在不需要重新整理頁面的情況下反映 agent 狀態變化（閒置、工作中、任務完成）。

#### Scenario: Agent 狀態更新即時顯示

- **WHEN** agent 從閒置狀態切換至工作狀態
- **THEN** Web 前端應（SHALL）在當前 SSE/WebSocket 連線中反映更新後的狀態，無需重新載入頁面

#### Scenario: Agent 個性事件被渲染

- **WHEN** agent 發出個性事件（例如自言自語或任務評述）
- **THEN** Web 前端應（SHALL）在 agent 的活動串流中以適當的視覺處理方式（例如對話泡泡、思考泡泡）顯示該事件
