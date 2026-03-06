## Context

ClaudeCab 的每個 Agent 在 `agents/{id}/` 下有自己的工作空間。目前的目錄結構是有機成長的——各 agent 根據需求自行建立子目錄，沒有統一規範。隨著自主排程（反思、學習、考核）上線，agent 會在無人監督下寫入檔案，目錄語意不清導致內容混放。

**現況審計**（各 agent 實際目錄差異）：

| 目錄 | _example | general | coder | admin | transcriber |
|------|----------|---------|-------|-------|-------------|
| memory/ | ✅ 定義 | ✅ | ✅ | ✅ | — |
| knowledge/ | ✅ 定義 | ✅（+cases/research/tools/） | ✅（+digital-human/） | ✅（+growth-reviews/） | ✅ |
| evolution/ | ✅ 定義 | ✅ | ✅ | ✅ | — |
| output/ | ❌ | ✅（混亂） | ✅（空） | ❌ | — |
| plans/ | ❌ | ❌ | ✅ | ❌ | — |
| tasks/ | ❌ | ❌ | ✅ | ❌ | — |
| schedules/ | ❌ | ✅ | ✅ | ✅ | — |
| groups/ | 提及 | — | — | — | — |

**knowledge/ 內容混亂分析**（general 為例）：

| 檔案 | 實際性質 | 應歸屬 |
|------|----------|--------|
| `writing-style-強觀點表達與中立平衡.md` | 反思學到的知識 | knowledge/ ✅ |
| `ganttai-fundraising-v2-review.md` | 使用者交辦的分析報告 | output/ |
| `turboscribe-api-complete.md` | 工具 API 文件 | skill references/ |
| `cases/*.md` | 內容案例分析 | knowledge/ ✅ |
| `research/*.md` | 調查研究 | 混合（知識 or 交付） |

## Goals / Non-Goals

**Goals:**

- 定義標準目錄結構模板（`_example/`），明確每個目錄的語意和寫入規則
- 讓 agent 在自主運作時能靠路徑語意判斷「這個東西放哪裡」
- 為未來知識資料庫遷移做準備——確保每個目錄的內容是同質的
- 清理現有 agent 目錄中的錯放檔案

**Non-Goals:**

- 不改引擎程式碼（純文件/協議層面的變更）
- 不改變 `.claude/skills/` 的結構（已經定義良好）
- 不實作知識資料庫（只確保目錄結構相容）
- 不改變 memory/ 的日誌格式和使用方式

## Decisions

### Decision 1：標準目錄結構定義

```
agents/{id}/
├── .claude/skills/       # 技能系統（不改）
├── memory/               # 工作日誌（不改）
├── knowledge/            # 知識暫存區（嚴格限定）
├── output/               # 交付產出（新標準目錄）
├── evolution/            # 自我進化
│   ├── proposals/
│   ├── weekly/
│   └── reviews/          # 新增：考核紀錄（原 admin 的 growth-reviews）
├── schedules/            # 排程定義（已存在，納入模板）
└── plans/                # 任務規劃（已存在，納入模板）
```

**理由**：最小改動原則。不新建全新目錄，而是收斂現有的混亂——把已經在用的目錄標準化，把混放的內容歸位。

### Decision 2：knowledge/ 嚴格定義為知識暫存區

**定義**：只放「學到的、可被未來任務直接引用的知識素材」。

**可以放**：
- 反思學到的技巧/方法論（`writing-style-強觀點表達與中立平衡.md`）
- 主動研究某領域的筆記（`digital-human/`）
- 工具評估和使用心得（`edge-tts.md`）
- 案例分析和拆解（`cases/`）

**不能放**：
- 使用者交辦的分析報告/調查結果 → `output/`
- 管理操作紀錄（agent-changes-log）→ `evolution/` 或 skill references
- 考核結果（growth-reviews）→ `evolution/reviews/`
- 排程產出的過程文件 → `output/`

**知識生命週期**：
```
反思/研究學到 → knowledge/（暫存）
                  ↓ 累積到 2-3 個相關知識點
              提案建立 Skill → .claude/skills/{name}/references/（歸檔）
                  ↓ 歸納完成
              knowledge/ 原檔標記 `<!-- 已歸納至 {skill-name} -->`
```

歸納後不刪除原檔（保留原始素材供參考），但標記讓員工掃目錄時知道這筆已處理。未來導入知識資料庫時，可按標記狀態批量處理。

**替代方案**：歸納後直接刪除。不採用，因為 Skill references 是精煉後的版本，原始素材有時仍有參考價值。

### Decision 3：output/ 標準化為所有 agent 的交付目錄

**定義**：使用者交辦任務的成果物、過程中產生的文件。

**子目錄按任務/專案組織**，不按檔案類型：
```
output/
├── newsletter-ep15/     # EP15 電子報
├── ganttai-analysis/    # GanttAI 分析系列
└── ...
```

**理由**：按任務分組比按類型分組（images/、docs/、videos/）更容易找到相關檔案。

### Decision 4：evolution/ 擴展為完整的進化目錄

```
evolution/
├── proposals/           # Layer 3 變更提案（不改）
├── weekly/              # 每週反思摘要（不改）
└── reviews/             # 考核紀錄
    ├── daily/           # Admin 日報（原 knowledge/growth-reviews/daily/）
    └── weekly/          # Admin 週報（原 knowledge/growth-reviews/weekly/）
```

**理由**：growth-reviews 是管理操作的產出，不是知識。放在 evolution/ 下語意正確——考核是進化機制的一環。

### Decision 5：plans/ 納入標準模板

Coder 已經在用 `plans/` 存放 plan mode 產出的規劃文件。這個需求是通用的（任何 agent 都可能有規劃），納入 `_example/` 模板。

### Decision 6：協議文件更新策略

需要同步更新的協議文件清單：

| 文件 | 更新內容 |
|------|----------|
| `_example/CLAUDE.md` 目錄結構參考表 | 新增 output/、plans/；更新 knowledge/ 描述 |
| `_example/.claude/rules/self-evolution.md` | Layer 1 清單新增 output/、plans/ |
| `_example/evolution/REFLECTION-PROTOCOL.md` Phase 4 | 知識暫存區定義 + 歸納標記機制 |
| `_example/.claude/skills/sys-self-evolution/SKILL.md` | 知識分類表更新 |
| `_example/.claude/skills/sys-agent-protocols/references/memory-system.md` | 檔案系統表更新 |
| `_example/.claude/skills/sys-agent-protocols/references/behavior.md` | 路徑權限表更新 |

**不更新各 agent 的本地副本**：`_example/` 改完後，各 agent 透過 `@../` 引用自動生效（rules/）。但 CLAUDE.md 需要每個 agent 單獨改。

## Risks / Trade-offs

- **[遷移遺漏]** 移動檔案可能遺漏某些 agent 的特殊檔案 → 任務中逐 agent 審計，列清單後再移
- **[Skill 引用路徑]** 如果某些 Skill 硬編碼了 `knowledge/` 路徑 → 搜尋所有 SKILL.md 中的 knowledge/ 引用，逐一檢查
- **[向後相容]** Agent 舊 session 的 memory 可能還引用舊路徑 → memory 是流水帳，不影響
- **[Admin knowledge/ 特殊性]** Admin 的 `agent-changes-log.md` 和 `self-evolution-management-guide.md` 是管理參考文件，不是知識暫存 → 移到 Skill references 更合適，但這需要 Admin agent 的 skill 調整
