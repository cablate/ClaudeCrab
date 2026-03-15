# Skills & Workspace 比對

## Paperclip: Runtime Skills Injection + Workspace Management

### Skills 系統

#### 概述
Paperclip 的 skills 是 **agent 的 system prompt 增強模組**。位於 `skills/` 目錄，包含：

```
skills/
├── paperclip/              # Paperclip 操作技能
├── create-agent-adapter/   # Adapter 開發指引
├── paperclip-create-agent/ # Agent 建立流程
└── para-memory-files/      # 記憶管理
```

#### 注入機制
- Agent 啟動時，根據設定注入對應的 skill 內容到 system prompt
- **Runtime Injection**: 不需要重新訓練或重建 agent，修改 skill 檔案後下次 heartbeat 自動生效
- Skill 內容是 Markdown 格式的知識文件
- 透過 AGENTS.md（Claude Code 的 CLAUDE.md 等效物）整合

#### Skill 範圍
Paperclip 的 skills 更像是 **操作手冊**，告訴 agent：
- 如何使用 Paperclip API
- 如何建立和管理其他 agent
- 如何處理工作區

### Workspace 管理

#### Project Workspaces
```typescript
project_workspaces = {
  id: uuid,
  companyId: uuid,
  projectId: uuid,
  name: text,
  cwd: text?,              // 工作目錄路徑
  repoUrl: text?,          // Git repo URL
  repoRef: text?,          // Git branch/ref
  metadata: jsonb?,
  isPrimary: boolean,      // 主要工作區
}
```

#### Workspace Resolution 流程
```
1. Issue → 取得 projectId
2. Project → 查找 project_workspaces
3. 選擇 isPrimary = true 的 workspace
4. 驗證 cwd 目錄存在
5. 不存在 → fallback 到 agent home directory（~/.paperclip/agents/{agentId}）
```

#### Session + Workspace 連動
- Task session 記錄 `sessionParams.cwd`（工作目錄）
- 當 project workspace 變更時，自動遷移 session 的 cwd
- `resolveRuntimeSessionParamsForWorkspace()` 處理遷移邏輯

#### Workspace Runtime Services
```typescript
workspace_runtime_services = {
  id: uuid,
  companyId: uuid,
  projectWorkspaceId: uuid?,
  serviceName: text,
  status: text,            // "starting" | "running" | "stopped" | "failed"
  lifecycle: text,         // "shared" | "ephemeral"
  command: text?,
  cwd: text?,
  port: integer?,
  url: text?,
}
```
- 支援 per-workspace 的背景服務（如 dev server、database）
- `shared` lifecycle：跨 run 共享
- `ephemeral` lifecycle：每次 run 重建

#### Execution Workspace Policy
- Project 級別可設定 workspace 策略
- Issue 級別可覆寫策略
- 控制 agent 是否使用 project workspace、是否建立獨立 workspace

---

## ClaudeCab: Skills + Agent Path

### Skills 系統

#### 概述
ClaudeCab 的 skills 位於每個 agent 的 `.claude/skills/` 目錄：

```
agents/coder/.claude/skills/
├── dom-dev-workflow/
│   ├── SKILL.md
│   └── references/
├── proj-claudecab/
│   ├── SKILL.md
│   └── references/
├── persona/
│   ├── SKILL.md
│   └── references/
└── sys-agent-protocols/
    ├── SKILL.md
    └── references/
```

#### 注入機制
- **Startup Protocol**: Session 開始時自動載入核心 skills
- **On-demand**: Claude Code 的 `/skill-name` 觸發載入
- **CLAUDE.md 指令**: 明確指定「哪些任務必須先載入哪些 skill」
- Skill 內容透過 Skill tool 注入到 conversation context

#### Skill 分類
| 類型 | 前綴 | 說明 |
|------|------|------|
| System | `sys-` | 啟動協議、行為規範 |
| Domain | `dom-` | 領域技能（開發、影片、文件） |
| Method | `method-` | 方法論（code review、知識庫建立） |
| Project | `proj-` | 專案特定知識 |
| Persona | `persona` | 人格與行為風格 |

#### 關鍵差異
- ClaudeCab skills 包含 **references/** 子目錄，存放詳細資料
- Skill + references 構成完整的知識體系
- 有三層進化機制（Layer 1 自由區 → Layer 2 append only → Layer 3 需審批）

### Workspace 管理

#### Agent Path
```yaml
# config.yml
agents:
  coder:
    name: "工程師"
    path: "./agents/coder"  # ← 固定工作目錄
```

- 每個 agent 有固定的 `path`（工作目錄）
- 沒有動態 workspace resolution
- 沒有 per-project workspace 切換

#### Project 操作
- Agent 操作其他專案時，需要 `cd` 到目標目錄
- 有 `project-whitelist` hook 限制可操作的目錄
- 沒有 workspace 資料庫記錄

---

## 比對分析

| 面向 | Paperclip | ClaudeCab |
|------|-----------|-----------|
| **Skill 格式** | Markdown 文件 | SKILL.md + references/ |
| **Skill 深度** | 操作手冊級（淺） | 知識體系級（深） |
| **注入方式** | System prompt 拼接 | Conversation context 注入 |
| **Skill 進化** | 無特殊機制 | 三層進化（自由/append/審批） |
| **Workspace** | DB 管理 + 動態 resolution | 固定 path + whitelist |
| **Multi-project** | ✅ Project workspace 表 | 手動 cd + whitelist |
| **Runtime Services** | ✅ Per-workspace 背景服務 | 無 |
| **Workspace 切換** | 自動（根據 issue → project） | 手動 |

## 值得借鑑

### 💡 觀察：Skills 系統 ClaudeCab 更強
ClaudeCab 的 skill 系統在知識深度和進化機制上**明顯優於** Paperclip：
- Paperclip skills 只是操作手冊（如何使用 API）
- ClaudeCab skills 是完整知識體系（含 references、進化規則、專案脈絡）
- 這是 ClaudeCab 的**核心優勢**之一

### 🟢 P2：Workspace 資料庫化
- 目前 agent path 是靜態設定
- 如果一個 agent 需要操作多個專案，可以參考 Paperclip 的 project_workspaces 模式
- 在 DB 中記錄 agent ↔ project ↔ workspace 映射
- **但目前 ClaudeCab 的 whitelist hook 已經解決了安全問題**

### 🟢 P3：Runtime Services
- Per-workspace 背景服務（dev server、DB）是進階功能
- 目前不需要，但如果 ClaudeCab agent 需要長期運行本地服務
- 可以參考 Paperclip 的 lifecycle 管理（shared vs ephemeral）
