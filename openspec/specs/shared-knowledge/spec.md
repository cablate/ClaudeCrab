## Purpose

共享知識系統定義了 Agent 產出的知識資產如何被結構化、授權和發布，以供跨 Agent 消費。採用隔離優先模型：知識預設為私有，只有在具備複用價值時才明確發布到共享命名空間。

## Requirements

### Requirement: 目錄結構

共享知識區與 Agent 私有知識區應（SHALL）遵循 `agents/` 目錄下的固定佈局。

共享區應位於 `agents/_shared/knowledge/`，以 `agentId` 子目錄分類。每個 Agent 可（MAY）在 `agents/{agentId}/knowledge/` 維護私有知識工作區。

#### Scenario: 共享區按 Agent 命名空間組織

- **WHEN** 共享知識目錄存在
- **THEN** 應（SHALL）包含每個發布 Agent 的子目錄，以該 Agent 的 `agentId` 命名（如 `agents/_shared/knowledge/general/`、`agents/_shared/knowledge/nitterbot/`）

#### Scenario: Agent 維護私有知識工作區

- **WHEN** Agent 產出知識資產
- **THEN** 可（MAY）在發布前將草稿和進行中的材料存放於 `agents/{agentId}/knowledge/`

---

### Requirement: 權限模型

知識目錄的存取應（SHALL）由命名空間權限模型管控，強制寫入隔離的同時允許對共享區的廣泛讀取。

#### Scenario: 所有 Agent 可讀取共享區任何命名空間

- **WHEN** 任何 Agent 嘗試讀取 `agents/_shared/knowledge/{anyAgentId}/` 下的檔案
- **THEN** 無論讀取者的 `agentId` 為何，讀取操作應（SHALL）被允許

#### Scenario: Agent 只能寫入自己的共享命名空間

- **WHEN** Agent 嘗試寫入 `agents/_shared/knowledge/{targetAgentId}/`
- **THEN** 僅當寫入 Agent 的 `agentId` 與 `targetAgentId` 相符時操作才應（SHALL）被允許
- **AND** 所有對其他 Agent 共享命名空間的寫入嘗試應（SHALL）被禁止

#### Scenario: Agent 的私有工作區對其他 Agent 不可存取

- **WHEN** Agent 嘗試讀取或寫入 `agents/{otherAgentId}/knowledge/`
- **THEN** 若存取 Agent 的 `agentId` 與 `otherAgentId` 不符，操作應（SHALL）被禁止

---

### Requirement: 發布工作流程

Agent 應（SHALL）遵循兩階段工作流程——私有草稿後接明確發布——將知識從私有工作區移至共享區。

#### Scenario: Agent 產出私有草稿

- **WHEN** Agent 正在研究、評估或分析某主題
- **THEN** 應（SHALL）將進行中的產物存放於私有工作區（如 `agents/{agentId}/knowledge/tools/edge-tts.md`）

#### Scenario: Agent 將完成的知識發布至共享區

- **WHEN** 知識產物已完成且具備跨 Agent 複用價值
- **THEN** Agent 應（SHALL）將其複製到自己的共享命名空間（如 `agents/_shared/knowledge/{agentId}/tools/edge-tts.md`）
- **AND** 原始私有檔案可（MAY）由 Agent 自行決定保留或移除

#### Scenario: 其他 Agent 消費已發布的知識

- **WHEN** Agent 需要其他 Agent 產出的知識
- **THEN** 應（SHALL）從 `agents/_shared/knowledge/{publishingAgentId}/` 讀取，且不得（MUST NOT）存取發布 Agent 的私有工作區

---

### Requirement: 知識檔案分類

儲存於私有工作區和共享命名空間的知識檔案應（SHALL）按標準類別子目錄組織。

#### Scenario: 工具評估存放於 tools/

- **WHEN** Agent 產出工具評估或使用指南
- **THEN** 檔案應（SHALL）放置於 `tools/` 子目錄（如 `tools/edge-tts.md`）

#### Scenario: 案例研究存放於 cases/

- **WHEN** Agent 產出案例研究或經驗分析
- **THEN** 檔案應（SHALL）放置於 `cases/` 子目錄（如 `cases/crisis-pr.md`）

#### Scenario: 研究筆記存放於 research/

- **WHEN** Agent 產出主題研究筆記
- **THEN** 檔案應（SHALL）放置於 `research/` 子目錄（如 `research/market-trends.md`）

---

### Requirement: 與記憶系統的區別

知識系統與記憶系統服務於不同目的，不得（MUST NOT）混淆。知識檔案代表可複用、可發布的資產；記憶檔案代表個人的、會話綁定的上下文。

#### Scenario: 個人上下文存於記憶而非知識

- **WHEN** Agent 需要跨 session 持久化對話上下文或個人狀態
- **THEN** 應（SHALL）使用記憶系統（`MEMORY.md` 或 `memory/`），且不得（MUST NOT）將此類內容發布到共享知識區

#### Scenario: 可複用知識資產存於知識而非記憶

- **WHEN** Agent 產出旨在供自身或其他 Agent 複用的產物
- **THEN** 應（SHALL）透過知識系統存儲並視需要發布，而非作為記憶條目

---

### Requirement: 設計原則

共享知識系統應（SHALL）遵循四項核心設計原則，管控其架構與演化。

#### Scenario: 隔離優先——預設私有

- **WHEN** Agent 建立新的知識產物
- **THEN** 應（SHALL）預設存放於 Agent 的私有工作區
- **AND** 僅在該 Agent 執行明確的發布操作後才應出現在共享區

#### Scenario: 命名空間分離防止衝突

- **WHEN** 多個 Agent 發布到共享區
- **THEN** 每個 Agent 的發布內容應（SHALL）被限制在其 `agentId` 命名的子目錄內
- **AND** Agent 之間的命名衝突在結構上應不可能發生

#### Scenario: 已發布內容對其他 Agent 唯讀

- **WHEN** Agent 讀取另一個 Agent 在共享區發布的內容
- **THEN** 不得（MUST NOT）修改或刪除該內容
- **AND** 對其他 Agent 共享命名空間的寫入操作應（SHALL）被拒絕

#### Scenario: 現有 Agent 不被強制採用共享區

- **WHEN** 共享知識系統被引入或更新
- **THEN** 未使用共享區的現有 Agent 應（SHALL）繼續正常運作，無需修改
- **AND** 共享區的採用應（SHALL）保持自願，除非特定 Agent 的配置明確要求
