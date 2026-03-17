# Vector Memory — Tools Reference

## Core Tools

### memory_recall — 搜尋記憶

Hybrid retrieval（vector 0.7 + BM25 0.3），支援 rerank 和 decay。

| 參數 | 類型 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `query` | string | yes | — | 搜尋語句 |
| `limit` | number | no | 5 | 最多 20 |
| `scope` | string | no | — | 指定 scope |
| `category` | enum | no | — | preference / fact / decision / entity / other |

### memory_store — 存入記憶

| 參數 | 類型 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `text` | string | yes | — | 記憶內容（< 500 chars） |
| `importance` | number | no | 0.7 | 0-1 |
| `category` | enum | no | — | 分類 |
| `scope` | string | no | `agent:<id>` | 目標 scope |

### memory_forget — 刪除記憶

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `query` | string | 二擇一 | 搜尋後刪除 |
| `memoryId` | string | 二擇一 | UUID 或 8+ char prefix |
| `scope` | string | no | scope |

### memory_update — 更新記憶

preference/entity 的 text 更新會建立新版本（supersede），保留歷史。metadata-only 更新（importance, category）原地修改。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `memoryId` | string | yes | UUID 或 8+ char prefix |
| `text` | string | no | 新內容（觸發 re-embedding） |
| `importance` | number | no | 新分數 |
| `category` | enum | no | 新分類 |

---

## Self-Improvement Tools

### self_improvement_log — 記錄學習/錯誤

記錄踩坑或學習。使用時建議同步寫入 CLAUDE.md Lessons Learned。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `type` | enum | yes | `learning` / `error` |
| `summary` | string | yes | 一行摘要 |
| `details` | string | no | 詳細內容 |
| `suggestedAction` | string | no | 預防措施 |
| `category` | string | no | correction / best_practice / knowledge_gap |
| `area` | string | no | frontend / backend / infra / tests / docs / config |
| `priority` | string | no | low / medium / high / critical |

### self_improvement_extract_skill — 從學習條目建立 skill

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `learningId` | string | yes | Learning 條目 ID |
| `skillName` | string | yes | 小寫 + 連字號 |
| `outputDir` | string | no | 預設 `skills` |

### self_improvement_review — 治理概覽

無參數。回傳 pending/high-priority/promoted 統計。

---

## Scope 格式

| 格式 | 說明 |
|------|------|
| `global` | 所有 agent 共享 |
| `agent:<id>` | Agent 私有（預設） |
| `project:<id>` | 專案範圍 |
| `user:<id>` | 使用者範圍 |
