# ADR 狀態審計報告

**審計日期**：2026-02-16
**審計範圍**：`.claude/skills/claudecab/references/decisions/adr/` 全部 ADR 檔案

---

## 總覽

- 審計 ADR 數量：33（含 2 個 ADR-031）
- Status 正確（檔案內 vs _index.md 一致）：25
- Status 可能不正確：5
- 缺少的 ADR：1（ADR-032）
- 編號衝突：1（ADR-031 有兩個檔案）

---

## Status 可能不正確的 ADR

| ADR | 檔案內 Status | _index.md Status | 建議 Status | 理由 |
|-----|-------------|-----------------|------------|------|
| ADR-019 | ✅ accepted（已實作） | ✅ accepted | implemented | 檔案內明確標註「已實作」，index 應同步 |
| ADR-020 | 📋 proposed | ✅ accepted (Phase 1+2) | 需人工確認 | 檔案標 proposed，index 標 accepted (Phase 1+2)，兩者矛盾。需確認實際實作進度 |
| ADR-022 | ✅ accepted → implemented | ✅ accepted | implemented | 檔案內已標示 accepted → implemented 演進，index 落後未更新 |
| ADR-028 | 已接受（accepted） | ✅ implemented | 需人工確認 | 反向矛盾：index 標 implemented 但檔案只標「已接受」。需確認排程 trigger 功能是否已實作完成 |
| ADR-031-hook | PathValidator 已完成遷移（部分實作） | 📋 proposed | partial-implemented | 檔案內標示 PathValidator 已遷移完成，其餘 hook 仍在引擎內。index 仍標 proposed，與現況不符 |

---

## 其他問題

### adr-031 位置

`adr-031-hook-decoupling.md` 已在 `decisions/adr/` 子目錄內，位置正確，無需移動。

### adr-032 檔案

`_index.md` 列出 ADR-032（Live Page Data-Driven — 消除前端 hardcode，後端驅動渲染），狀態標記為 ✅ implemented，但 `adr/` 目錄下**無對應的 .md 檔案**。需補建 `adr-032-live-page-data-driven.md`。

### ADR-031 編號衝突

`adr/` 目錄下有兩個 ADR-031：
- `adr-031-data-placement-strategy.md` — Skill-Based Character System 資料配置策略（✅ Accepted & Implemented）
- `adr-031-hook-decoupling.md` — Hook 系統解耦（部分實作）

`_index.md` 中 ADR-031 連結指向 `adr-031-hook-decoupling.md`，而 `adr-031-data-placement-strategy.md` 未被列入 index。建議：
1. 將其中一個重新編號（建議 `adr-031-data-placement-strategy.md` 改為 ADR-031a 或重分配編號）
2. 確保 `_index.md` 列出所有 ADR

---

## 遵循說明

本報告僅記錄發現，**未修改任何 ADR 檔案內容**（遵循 ADR 不可變原則）。Status 更新需由專案負責人審核後，僅更新 metadata 欄位。
