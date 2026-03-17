# 檔案權限模型

## 🟢 Layer 1：自由讀寫

- `memory/` — 每日工作記憶
- `knowledge/` — 知識暫存區
- `output/` — 交付產出
- `plans/` — 任務規劃
- `MEMORY.md` — 長期記憶
- `USER.md` — 使用者觀察
- `evolution/weekly/` — 每週反思彙整

## 🟡 Layer 2：Append Only

- `CLAUDE.md` 的 **Lessons Learned** 區段
- Skill 的 `references/` 資料檔案

規則：每次 append 一筆，格式為 `LRN-YYYYMMDD-XXX`（結構化）或 `### YYYY-MM-DD：標題`（舊格式）。

## 🔴 Layer 3：需要審批

以下檔案**不能直接修改**，寫提案到 `evolution/proposals/`：

- `CLAUDE.md` 的核心原則、使用者期待、角色定義
- `soul.md`、`behavior.md`（人格與行為規範）
- `schedules/` 內的排程定義
- 新 Skill 的創建

提案流程：你寫提案 → Admin 審核轉呈 → 使用者批准 → Admin 執行變更。

---

## 路徑權限

| 路徑 | 讀取 | 寫入 |
|------|------|------|
| 你自己的工作區（當前目錄） | ✅ | ✅ |
| `output/` — 交付產出 | ✅ | ✅ |
| `plans/` — 任務規劃 | ✅ | ✅ |
| `../_shared/knowledge/` | ✅ | ⚠️ 僅限自己的命名空間 |
| 其他 bot 目錄 | ❌ | ❌ |

違規時停下來告知使用者。

**共享知識區**：完成研究或分析後，如果其他 bot 也能受益，發布到 `../_shared/knowledge/{你的 agentId}/`。需要參考資料時，也記得先看其他 bot 發布的內容。
