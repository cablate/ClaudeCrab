## Purpose

本規格定義 ClaudeCab 的規範性開發原則。這些原則指導功能評估、架構決策與設計取捨。所有新功能與變更在實作前，應（SHALL）依據這些原則進行評估。

## Requirements

### Requirement: Agent 隔離與專責化

ClaudeCab 中的每個 Agent 應（SHALL）保持獨立隔離並具備領域專責性。引擎層（`src/`）對於 Agent 層級的關注點（如記憶體、個性或提示注入）不得（MUST NOT）有任何感知。

#### Scenario: 引入新的 Agent 能力

- **WHEN** 為某個 Agent 新增一項能力
- **THEN** 該能力應（SHALL）透過 Agent 自管的 CLAUDE.md 指令或 Skills 實作，而非修改引擎層

#### Scenario: 要求記憶體或個性功能

- **WHEN** 設計記憶體或個性功能
- **THEN** 該功能應（SHALL）完全由 Agent 透過自身的設定檔控制，引擎不得（MUST NOT）組裝或注入內容至 system prompt

---

### Requirement: 透過 Telegram 的溝通體驗

ClaudeCab 應（SHALL）將 Telegram 視為多個事件消費者之一，而非唯一的輸出管道。Telegram 的互動體驗應（SHALL）流暢且即時。

#### Scenario: Agent 產生輸出

- **WHEN** Agent 完成某個行為或動作
- **THEN** 它應（SHALL）發出一個結構化事件，可由任何前端消費者渲染，包含但不限於 Telegram

#### Scenario: 考慮新的輸出管道

- **WHEN** 提案新的輸出管道
- **THEN** 它應（SHALL）消費 Telegram 已使用的相同結構化事件串流，無需修改 Agent 層

---

### Requirement: 展示優先評估原則

所有功能應（SHALL）以使用者在展示期間能否感知其效果作為評估標準。可見的 Agent 個性與回應性必須（MUST）優先於不可見的引擎正確性。

#### Scenario: 提案實作某項功能

- **WHEN** 某項功能正在評估中
- **THEN** 只有在使用者可於展示中體驗到時，它才應（SHALL）被接受並立即開發；否則應（SHALL）延後處理

#### Scenario: 提案引擎層優化

- **WHEN** 提案一項使用者不可見的內部引擎優化
- **THEN** 它應（SHALL）降低優先級，讓位給能產生可感知 Agent 行為的功能（反應、情緒、評論）

---

### Requirement: SDK 優先開發

ClaudeCab 應（SHALL）充分利用 Claude Agent SDK 的內建能力，不得（MUST NOT）重新實作 SDK 已提供的功能。

#### Scenario: 需要新的 Agent 協定或個性模組

- **WHEN** 設計協定或個性模組
- **THEN** 它應（SHALL）使用 SDK 的 Skills 機制實作

#### Scenario: 需要整合外部工具

- **WHEN** 需要與外部工具整合
- **THEN** 它應（SHALL）透過 MCP 支援實作，而非自訂實作

#### Scenario: 需要對話連續性

- **WHEN** Agent 需要跨回合維持對話狀態
- **THEN** 它應（SHALL）使用 SDK 的 Resume 機制，而非自訂的 session 管理方案

---

### Requirement: 設定驅動的 Agent 設置

Agent 設定應（SHALL）由宣告式 JSON/YAML 檔案驅動。引入新 Agent 的門檻必須（MUST）透過依賴設定而非程式碼變更來維持低度。

#### Scenario: 在 ClaudeCab 中註冊新 Agent

- **WHEN** 新增一個 Agent
- **THEN** 它應（SHALL）由 `agent.json` 檔案描述 ClaudeCab 元資料、`settings.local.json` 檔案描述權限設定，以及可選的 `schedules/*.yaml` 檔案描述排程任務

#### Scenario: 定義排程或事件驅動任務

- **WHEN** Agent 需要週期性或事件驅動的任務
- **THEN** 它們應（SHALL）在 Agent 目錄下的 YAML 排程檔中宣告，無需修改引擎程式碼

---

### Requirement: 不重複造輪、不膨脹功能

ClaudeCab 不得（MUST NOT）重新實作現有成熟工具已提供的功能。與 Agent 管理無關的功能不得（MUST NOT）被引入。部署模型應（SHALL）保持簡單，外部依賴最小化。

#### Scenario: 功能已存在於成熟的外部工具中

- **WHEN** 某項能力已存在於成熟工具或函式庫中
- **THEN** ClaudeCab 應（SHALL）透過 MCP 整合，而非建立自訂實作

#### Scenario: 提案功能與 Agent 管理無關

- **WHEN** 提案功能未直接強化「目錄即 Agent」核心概念或基於 Telegram 的 Agent 控制體驗
- **THEN** 它應（SHALL）被拒絕

#### Scenario: 提案新的基礎設施依賴

- **WHEN** 提案新的基礎設施元件或重量級依賴
- **THEN** 若它使部署複雜度超出「單一指令安裝、單一指令啟動」的範圍，應（SHALL）被拒絕

---

### Requirement: 功能評估檢核表

每項提案功能應（SHALL）在開始實作前通過結構化評估。未通過任何必要條件的功能，在沒有明確理由的情況下不得（MUST NOT）進行實作。

#### Scenario: 評估新功能是否實作

- **WHEN** 提案新功能
- **THEN** 在進行前，以下問題各應（SHALL）逐一回答：

  - 它是否強化「目錄即 Agent」核心概念？預期答案：是
  - 它是否改善使用者透過 Telegram 控制 Agent 的體驗？預期答案：是
  - 它能否透過 MCP 整合而非自訂實作達成？若是，必須（MUST）優先使用 MCP
  - 它是否保留部署簡潔性？預期答案：是
  - 使用者在展示中能否感知其效果？若否，它應（SHALL）延後處理

#### Scenario: 功能未通過展示日標準

- **WHEN** 提案功能無法以使用者可感知的方式展示
- **THEN** 它應（SHALL）移至待辦清單，且不得（MUST NOT）阻擋當前迭代工作
