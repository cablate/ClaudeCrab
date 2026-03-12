# OpenSpec/Spectra 全量遷移計畫

> 日期：2026-03-02
> 狀態：規劃中

## 目標

將現有 `.claude/skills/claudecab/references/` 的專案文件全量遷移至 `openspec/` 管理體系，統一知識管理與變更追蹤流程。

---

## 遷移對照

### Living Docs → `openspec/specs/` （8 個 Specs）

| 現有文件 | Spec ID | 內容說明 |
|----------|---------|----------|
| `product/vision.md` | `product-vision` | 產品定位、核心概念、路線圖 |
| `product/principle.md` | `product-principles` | 功能開發原則、設計原則 |
| `system/overview.md` | `system-architecture` | 技術架構、技術棧、目錄結構 |
| `system/module-map.md` | `module-map` | 模組地圖、耦合分析、依賴矩陣 |
| `system/skill-based-character-system.md` | `skill-character-system` | Skill-Based Character System 三層架構 |
| `system/shared-knowledge.md` | `shared-knowledge` | 跨 Agent 知識發佈/訂閱機制 |
| `system/trigger-mechanism-map.md` | `trigger-mechanisms` | 事件流、觸發路徑、cascade 分析 |
| `product/mmorpg-skill-system.md` | `mmorpg-skill-system` | 遊戲化 Skill 管理設計 |

### ADR → `openspec/changes/archive/` （34 個 Archived Changes）

**格式映射：**

| ADR 區塊 | Spectra Artifact |
|-----------|-----------------|
| 背景 | `proposal.md` → Why |
| 決策 + 理由 | `proposal.md` → What Changes + Capabilities |
| 設計細節 / 方案比較 | `design.md` → Decisions |
| 後果 / 風險 | `design.md` → Risks / Trade-offs |
| 實作步驟（如有） | `tasks.md`（全標 `[x]` 已完成） |

**ADR 清單：**

| ADR | 標題 | 複雜度 |
|-----|------|--------|
| ADR-001 | 選擇 Claude Agent SDK | 低 |
| ADR-002 | Agent 隔離架構 | 低 |
| ADR-003 | SQLite 選型 | 低 |
| ADR-004 | grammY 框架選型 | 低 |
| ADR-005 | Session Key 設計 | 低 |
| ADR-006 | Legacy Mode | 低 |
| ADR-007 | Multi-Bot 架構 | 中 |
| ADR-008 | Memory System | 中 |
| ADR-009 | canUseTool 設計 | 低 |
| ADR-010 | Fire-and-Forget | 低 |
| ADR-011 | Permission Result Workaround | 低 |
| ADR-012 | Skill-First 設計原則 | 中 |
| ADR-013 | Keyword Index | 低 |
| ADR-014 | Equip v2 設計 | 中 |
| ADR-015 | Shared Knowledge | 中 |
| ADR-016 | Path Validator | 低 |
| ADR-017 | Group Chat | 中 |
| ADR-018 | Multi-Bot Group | 中 |
| ADR-019 | Multi-Agent Group | 中 |
| ADR-020 | Virtual Office | 高 |
| ADR-021 | Auto Delegation | 中 |
| ADR-022 | Delegation Enhancement | 中 |
| ADR-023 | Bot Initiative | 中 |
| ADR-024 | Group Commands | 低 |
| ADR-025 | Dashboard Group Analytics | 中 |
| ADR-026 | Group Infra Stabilization | 中 |
| ADR-027 | Dashboard Config Management | 中 |
| ADR-028 | Schedule Trigger Types | 中 |
| ADR-029 | Agent Structure Sync | 低 |
| ADR-030 | Agent Team Mode | 中 |
| ADR-031 | Hook Decoupling | 中 |
| ADR-032 | Live Page Data-Driven | 中 |
| ADR-033 | WebUI Interactive Hooks | 中 |
| ADR-034 | Data Placement Strategy | 中 |

### Stories → `openspec/changes/archive/` （3 個 Archived Changes）

| Story | 標題 |
|-------|------|
| agent-specialization | Agent 專業化演化 |
| next-evolution-plan | 下一階段演化規劃 |
| webui-character-sheet-integration | WebUI 角色面板整合 |

### 不遷移、保留在 `references/` 的文件

| 分類 | 文件 | 理由 |
|------|------|------|
| 操作 | `operations/quick-nav.md` | 開發導航工具，非規格 |
| 操作 | `operations/troubleshooting.md` | 排障手冊，非規格 |
| 操作 | `operations/changelog.md` | 版本歷史，非規格 |
| 操作 | `operations/image-toolchain.md` | 工具鏈文件，非規格 |
| 操作 | `operations/doc-cleanup-*.md` | 文件整理計畫，非規格 |
| 操作 | `operations/adr-audit-report.md` | 審計報告，轉換完成後可刪除 |
| 操作 | `operations/migration-guide-skill-system.md` | 遷移指南 |
| 研究 | `research/agent-skill/design.md` | 研究筆記 |
| 研究 | `research/agent-skill/guide.md` | 實踐指南 |
| 研究 | `research/emergent-cooperation.md` | 觀察報告 |
| 歸檔 | `_archive/*` | 歷史材料，已策展 |
| 敘事 | `project-journey.md` | 專案故事 |
| 產品 | `product/feature-roadmap.md` | Roadmap，隨時變動 |
| 產品 | `product/image-asset-spec.md` | 資產規格（可考慮後續轉 spec） |
| 產品 | `product/strategy-analysis.md` | 策略分析報告 |
| 產品 | `product/mvp-gap-analysis.md` | 落差分析報告 |

---

## 執行步驟

### Step 1：配置 `openspec/config.yaml`

加入 ClaudeCab 專案 context（技術棧、慣例、domain 描述）。

### Step 2：建立 8 個 Specs

從 references 的活文件轉換為 `openspec/specs/<id>/spec.md` 格式。
需遵循 Spectra spec 格式：`### Requirement:` + `#### Scenario:` + SHALL/MUST 規範語言。

### Step 3：轉換 34 ADR → Archived Changes

每個 ADR 建立：
```
openspec/changes/archive/<adr-id>/
├── .openspec.yaml    # schema: spec-driven, created: <adr-date>
├── README.md         # ADR 標題 + 摘要
├── proposal.md       # 背景 → Why, 決策 → What Changes
├── design.md         # 設計細節（中/高複雜度才需要）
└── tasks.md          # 實作步驟（如有，全標 [x]）
```

低複雜度 ADR 只需 `proposal.md`。
中/高複雜度 ADR 額外產生 `design.md` 和/或 `tasks.md`。

### Step 4：轉換 3 Stories → Archived Changes

同 Step 3 格式。

### Step 5：精簡 `references/`

- 移除已轉入 openspec 的文件（product/vision, system/overview 等）
- 移除 `decisions/adr/` 和 `decisions/stories/` 整個目錄
- 保留操作、研究、歸檔類文件

### Step 6：更新 Skill 索引

- 更新 `claudecab` skill 的 SKILL.md 導航，指向 `openspec/`
- 更新 `references/_index.md`，反映新結構
- 更新 `CLAUDE.md` 的 Spectra 說明

---

## 遷移後的目錄結構

```
openspec/
├── config.yaml
├── specs/                          # 8 個規格文件
│   ├── product-vision/spec.md
│   ├── product-principles/spec.md
│   ├── system-architecture/spec.md
│   ├── module-map/spec.md
│   ├── skill-character-system/spec.md
│   ├── shared-knowledge/spec.md
│   ├── trigger-mechanisms/spec.md
│   └── mmorpg-skill-system/spec.md
│
└── changes/
    └── archive/                    # 37 個歷史變更
        ├── adr-001-claude-agent-sdk/
        ├── adr-002-agent-isolation/
        ├── ...
        ├── adr-034-data-placement-strategy/
        ├── story-agent-specialization/
        ├── story-next-evolution-plan/
        └── story-webui-character-sheet-integration/

.claude/skills/claudecab/references/   # 精簡後
├── _index.md                          # 更新指向 openspec
├── operations/                        # 保留
├── research/                          # 保留
├── _archive/                          # 保留
├── product/                           # 只保留非 spec 的補充文件
│   ├── feature-roadmap.md
│   ├── image-asset-spec.md
│   ├── strategy-analysis.md
│   └── mvp-gap-analysis.md
└── project-journey.md                 # 保留
```

---

## 注意事項

- ADR 原始內容為中文，轉換時 **spec 文件必須用英文**（Spectra 規範：specs 使用 SHALL/MUST 規範語言），其餘 artifacts 維持中文
- ADR 的 `status: superseded` 標記需在 archived change 中保留
- 轉換完成後驗證：`npx openspec validate` 確認結構正確
- 可使用 parallel agents 加速批次轉換
