## Purpose

此規格定義 ClaudeCab 模組依賴圖的規範性架構規則，涵蓋層級邊界、耦合健康度、模組叢集隔離與檔案大小閾值。所有貢獻者與自動化檢查均應（SHALL）強制執行這些規則。

## Requirements

### Requirement: 層級依賴方向

程式碼庫依命名層級組織，每個層級應（SHALL）只依賴層級架構中位於其下方的層級。允許的依賴方向如下：

- `Core` ← `WebUI`（WebUI 讀取 Core 狀態；Core 不得（MUST NOT）引用 WebUI）
- `Core` ← `Adapters`（Adapters 實作 Core 介面）
- `Core` → `Persistence`（Core 只透過 Repository 介面存取儲存層）
- `WebUI` → `Persistence`（WebUI API 路由可（MAY）直接查詢 Repositories）
- `Types` 與 `Utils` 為共享基礎層；每個層級均可（MAY）依賴它們
- `Types` 不得（MUST NOT）依賴任何業務層
- `Utils` 不得（MUST NOT）依賴任何業務層

#### Scenario: WebUI 不得被 Core 匯入

- **WHEN** `src/core/` 內的模組被修改
- **THEN** 其中應（SHALL）不包含任何引用 `src/webui/` 路徑的 import 陳述

#### Scenario: Core 不得匯入 Adapters

- **WHEN** `src/core/` 內的模組被修改
- **THEN** 其中應（SHALL）不包含任何引用 `src/adapters/` 路徑的 import 陳述

#### Scenario: Types 層必須保持無依賴

- **WHEN** `src/types/` 內的模組被修改
- **THEN** 其中不得（SHALL NOT）從 `src/core/`、`src/adapters/`、`src/persistence/`、`src/webui/` 或 `src/schedule/` 匯入

---

### Requirement: Adapters 對 Core 的耦合上限

Adapters 可（MAY）向 Core `EventBus` 發布事件，但不得（SHALL NOT）持有對 Core 內部狀態的直接參照，也不得在 EventBus publish 介面以外直接呼叫 Core 方法。來自 Adapter 模組的 `getEventBus()` 呼叫點總數不得（MUST NOT）超過五（5）個。

#### Scenario: Adapter 發出事件

- **WHEN** 一個 Adapter 模組需要將平台事件傳遞給系統其他部分
- **THEN** 應（SHALL）僅透過呼叫 `EventBus.publish()`（或等效的 `getEventBus()` helper）來完成
- **AND** 不得（SHALL NOT）直接呼叫任何其他 Core 模組方法

#### Scenario: 檢查 Adapter 呼叫點數量

- **WHEN** 對程式碼庫進行審計
- **THEN** `src/adapters/` 內 `getEventBus()` 的使用次數應（SHALL）為兩（2）個或更少，反映當前基準；任何超過五（5）個的增加必須（MUST）經過審查並提供說明

---

### Requirement: 禁止循環依賴

模組依賴圖必須（MUST）為有向無環圖（DAG）。若模組 B 已經匯入模組 A，則模組 A 不得（SHALL NOT）直接或間接地匯入模組 B。

#### Scenario: 驗證無循環的依賴圖

- **WHEN** 任何 TypeScript 檔案中新增了 import 陳述
- **THEN** 必須（MUST）執行依賴循環分析
- **AND** 分析結果應（SHALL）回報零個循環

#### Scenario: 重構時引入中介模組

- **WHEN** 從兩個否則會產生循環的模組中提取共享邏輯
- **THEN** 共享邏輯應（SHALL）移至較低層（例如 `types/` 或 `utils/`）的新模組
- **AND** 兩個原始模組均不得（SHALL NOT）互相匯入

---

### Requirement: Repository 叢集隔離

`persistence/` 層中的每個 Repository 模組應（SHALL）相互獨立，任何 Repository 不得（SHALL NOT）匯入其他 Repository。所有 Repository 必須（MUST）僅依賴 `DatabaseManager` 與 `src/types/`。

#### Scenario: SessionRepository 被修改

- **WHEN** `SessionRepository.ts` 被修改
- **THEN** 其 import 清單應（SHALL）不包含對 `ConversationRepository`、`ScheduleRepository` 或任何其他 Repository 檔案的引用

#### Scenario: 新增 Repository

- **WHEN** `src/persistence/` 內建立新的 `*Repository.ts` 檔案
- **THEN** 其唯一允許的 import 應（SHALL）為 `DatabaseManager` 與 `src/types/` 內的模組

---

### Requirement: Schedule 叢集封裝

schedule 子系統必須（MUST）僅將 `ScheduleManager` 作為其公開介面。內部模組（`ScheduleLoader`、`CronScheduler`、`ScheduleExecutor`、`ScheduleNotifier`）不得（SHALL NOT）被 `src/schedule/` 目錄以外的任何模組匯入。

#### Scenario: 外部模組存取排程功能

- **WHEN** `src/schedule/` 以外的模組需要觸發或查詢排程任務
- **THEN** 應（SHALL）僅匯入 `ScheduleManager`
- **AND** 不得（SHALL NOT）直接匯入 `ScheduleLoader`、`CronScheduler`、`ScheduleExecutor` 或 `ScheduleNotifier`

#### Scenario: 新增排程功能

- **WHEN** `src/schedule/` 內建立新的內部排程模組
- **THEN** 應（SHALL）透過 `ScheduleManager` 匯入並協調
- **AND** 其匯出不得（SHALL NOT）從 `src/schedule/` 以外的任何檔案重新匯出

---

### Requirement: EventBus 使用模式

`EventBus` 實作發布-訂閱模式，作為全系統事件中樞。所有透過 `EventBus` 的事件通訊必須（MUST）為單向（發布者不等待或檢視訂閱者的回應）。`EventBus` 不得（MUST NOT）被用作從另一個模組同步取得狀態的機制。

#### Scenario: 模組發布事件

- **WHEN** 一個模組透過 `EventBus.publish()` 發出事件
- **THEN** 應（SHALL）不使用該呼叫的回傳值來改變自身的控制流程
- **AND** 不得（SHALL NOT）呼叫任何從訂閱者取回資料的回呼

#### Scenario: 模組訂閱事件

- **WHEN** 一個模組透過 `EventBus.subscribe()` 註冊處理器
- **THEN** 處理器應（SHALL）獨立執行其動作
- **AND** 不得（SHALL NOT）以會產生回饋迴路的方式向同一事件主題重新發布

---

### Requirement: 檔案大小與重構觸發條件

模組必須（MUST）保持專注且大小適當。以下閾值定義何時必須（REQUIRED）進行重構審查：

- 超過 **1300 行** 的模組必須（MUST）在下一個 sprint 排入提取或分解計畫。
- 介於 **1000–1299 行** 的模組應當（SHOULD）接受審查；若存在自然分割點，建議（RECOMMENDED）進行提取。
- 協調器模組（`AppBootstrap`、`GroupBroadcaster`、`PlatformOrchestrator`）可（MAY）超過 500 行，因為廣泛的扇出是其預期角色；這些模組免於 500 行審查閾值。
- 新提取的模組在建立時應當（SHOULD）目標為少於 500 行。

#### Scenario: 模組超過 1300 行

- **WHEN** 一個模組的行數在開發期間超過 1300
- **THEN** 應（SHALL）在下一個版本發布前開啟重構任務
- **AND** 至少一個自成一體的子職責應（SHALL）被提取至新模組，盡可能使 `fan-out = 0`

#### Scenario: 協調器模組體積增大

- **WHEN** `AppBootstrap.ts`、`GroupBroadcaster.ts` 或 `PlatformOrchestrator.ts` 超過 700 行
- **THEN** 團隊應（SHALL）評估新增的行數是否代表真正的協調邏輯或錯置的業務邏輯
- **AND** 任何錯置的邏輯應（SHALL）被移至適當的低層模組

---

### Requirement: WebUI 作為純消費者

WebUI 層必須（MUST）為系統狀態的純消費者，任何其他層不得（SHALL NOT）從 `src/webui/` 匯入。WebUI 可（MAY）依賴 Core、Persistence 與 Schedule 層以讀取狀態，但不得（SHALL NOT）直接變更 Core 狀態——必須（MUST）透過 Core 介面或 Adapter 發起的事件來委派變更。

#### Scenario: WebUI API 路由讀取 agent 狀態

- **WHEN** 一個 WebUI API 路由處理器需要當前的 agent 設定
- **THEN** 應（SHALL）從 `AgentLoader` 或其他 Core 模組匯入
- **AND** 應（SHALL）只呼叫以讀取為導向的方法（例如 `getAgent`、`listAgents`）

#### Scenario: 其他層嘗試匯入 WebUI

- **WHEN** `src/webui/` 以外的模組被修改
- **THEN** 其中應（SHALL）不包含任何引用 `src/webui/` 路徑的 import 陳述

---

*此規格衍生自 ClaudeCab 模組圖耦合分析（最後審計日期：2026-02-28，107 個 TypeScript 檔案，共 24,703 行）。*
