# 文件大整理 — 執行計畫

> 依據 [doc-cleanup-charter.md](doc-cleanup-charter.md) 的原則執行

---

## 文件全量分類

### A. 歷史文件（策展歸檔）

| # | 文件 | 類型 | 時間點 | 處理方式 |
|---|------|------|--------|---------|
| H1 | `research/moltbot-gap.md` | 差距分析 | 2026-01-28 | 套模板策展 → `_archive/research/` |
| H2 | `research/personality-design-report.md` | 研究報告 | ~2026-02 | 套模板策展 → `_archive/research/` |
| H3 | `research/long-term-memory-research.md` | 研究報告 | ~2026-02 | 套模板策展 → `_archive/research/` |
| H4 | `product/mvp-gap-analysis.md` | 差距分析 | 2026-02-13 | 套模板策展 → `_archive/planning/` |
| H5 | `product/strategy-analysis.md` | 策略分析 | 2026-02-08 | 套模板策展 → `_archive/analysis/` |
| H6 | `decisions/stories/next-evolution-plan.md` | 規劃文件 | 2026-02-09 | 套模板策展 → `_archive/planning/` |
| H7 | `operations/migration-guide-skill-system.md` | 遷移指南 | ~2026-02 | 套模板策展 → `_archive/operations/` |
| H8 | `operations/changelog.md` (舊版部分) | 版本歷史 | v0.1~v1.25 | 分割：舊版 → `_archive/`，近期留原位 |

### B. ADR 狀態審計（內容不可變，僅更新 status）

| # | 範圍 | 處理方式 |
|---|------|---------|
| A1 | 33 個 ADR | 逐一驗證 status 是否準確（proposed/accepted/implemented/deprecated） |
| A2 | `adr-031-hook-decoupling.md` | 移入 `adr/` 子目錄（目前在 `decisions/` 根目錄） |
| A3 | `decisions/_index.md` | 更新 status 標記 |
| A4 | ADR-032 | 缺實體文件（_index 有列但無 .md），需補建或標記 |

### C. 活文件審計（比對程式碼，100% 驗證）

| # | 文件 | 工作量 | 可平行 |
|---|------|--------|--------|
| L1 | `system/overview.md` | 🔴 大 | 獨立 |
| L2 | `system/trigger-mechanism-map.md` | 🔴 大 | 獨立 |
| L3 | `system/shared-knowledge.md` | 🟢 小 | 獨立 |
| L4 | `system/skill-based-character-system.md` | 🟡 中 | 獨立 |
| L5 | `product/vision.md` | 🟡 中 | 獨立 |
| L6 | `product/principle.md` | 🟢 小 | 獨立 |
| L7 | `product/mmorpg-skill-system.md` | 🟡 中 | 獨立 |
| L8 | `product/image-asset-spec.md` | 🟢 小 | 獨立 |
| L9 | `operations/quick-nav.md` | 🟡 中 | 獨立 |
| L10 | `operations/troubleshooting.md` | 🟡 中 | 獨立 |
| L11 | `operations/image-toolchain.md` | 🟢 小 | 獨立 |
| L12 | `research/agent-skill/design.md` | 🟢 小 | 獨立 |
| L13 | `research/agent-skill/guide.md` | 🟢 小 | 獨立 |
| L14 | `research/emergent-cooperation.md` | 🟢 小 | 獨立 |

### D. 索引與入口更新（Phase 1-3 完成後）

| # | 文件 | 依賴 |
|---|------|------|
| I1 | `_index.md` | A+C 全部完成 |
| I2 | `decisions/_index.md` | B 完成 |
| I3 | `SKILL.md` | A+C 全部完成 |

### E. 敘事層（最後）

| # | 文件 | 依賴 |
|---|------|------|
| N1 | `project-journey.md` | A+B 完成（需要歷史材料） |

---

## 執行批次（平行化設計）

### Batch 1：歷史策展 + ADR 審計（完全平行）

```
┌─ Track A：歷史文件策展（H1~H7）
│  每份獨立，可同時處理多份
│
├─ Track B：ADR 狀態審計（A1~A4）
│  純 metadata 檢查，不依賴程式碼
│
└─ Track C：Changelog 分割（H8）
   獨立作業
```

### Batch 2：活文件審計（分組平行）

按工作量分組，每組內平行：

```
Group 1（大型）：L1 overview + L2 trigger-map
  → 需要大量程式碼比對，各自獨立

Group 2（中型）：L4 skill-system + L5 vision + L7 mmorpg + L9 quick-nav + L10 troubleshooting
  → 各自獨立比對

Group 3（小型）：L3 + L6 + L8 + L11 + L12 + L13 + L14
  → 快速驗證
```

### Batch 3：索引更新 + 敘事（依序）

```
I1 + I2 + I3 → N1
```

---

## 進度追蹤

| Batch | 狀態 | 完成項 |
|-------|------|--------|
| Batch 1 Track A | ✅ 完成 | H1~H7 全部策展歸檔，原始文件已加 deprecation notice |
| Batch 1 Track B | ✅ 完成 | ADR 審計完成：ADR-019/022 status→implemented，ADR-031 搬到 adr/，ADR-034 重新編號，ADR-032 補建 .md |
| Batch 1 Track C | ✅ 完成 | Changelog 分割：v0.1~v1.24→archive，v1.25+ 留原位 |
| Batch 2 Group 1 | ✅ 完成 | L1 overview.md（settingSources×3 + 12 模組 + schedule + 3 repos），L2 trigger-map（Social 預設值 + 3 EventBus 事件） |
| Batch 2 Group 2 | ✅ 完成 | L3 shared-knowledge（目錄更新），L4 skill-system（遷移現況×5 agents），L5 vision（Phase 2 🔶），L7 mmorpg（拆分已完成/待部署），L8 image-asset-spec（日夜系統 + emoji 修正） |
| Batch 2 Group 3 | ✅ 完成 | L9 quick-nav（396 tests + JWT + isSocial + 測試清單），L10 troubleshooting（settingSources + InteractionHandler + AppBootstrap + DedupTracker），L13 guide（settingSources）。L6/L11/L12/L14 驗證通過無需修改 |
| Batch 3 Indexes | ✅ 完成 | I1 _index.md（重構含 _archive 區塊），I2 decisions/_index.md（ADR-032 連結 + ADR-034），I3 SKILL.md（更新導航） |
| Batch 3 Narrative | ✅ 完成 | N1 project-journey.md — 21 天演化敘事，6 章節 + 架構總覽 + 數字里程碑 |