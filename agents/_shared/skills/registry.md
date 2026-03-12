# Shared Skills Registry

共用 Skill 索引。當任何 Agent 需要使用共用能力時，先查此 registry 找到路徑，再讀取完整 SKILL.md。

> **注意**：共用 skill 不在各 agent 的 `.claude/skills/` 目錄，不會被自動發現。需要主動查詢此 registry。

---

## 索引

| Skill | 用途 | 路徑 | 適用 Agent |
|-------|------|------|------------|
| content-analyzer | 分析文章內容分類（主題、類型、關鍵詞） | `_shared/skills/content-analyzer/` | Writer, General |

---

## 使用方式

1. 接到涉及共用能力的任務時，先查此 registry
2. 找到對應 skill 的路徑
3. 讀取 `{路徑}/SKILL.md` 取得完整指令

---

## 維護規則

Admin 在新增或移動共用 skill 時，同步更新此 registry。
