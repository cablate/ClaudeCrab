# Memory System — 進階功能

需要時載入。日常 session 不需要。

---

## 群組記憶

當你在群組對話中（引擎會在 prompt 提供【群組記憶】路徑）：

| 檔案 | 放什麼 |
|------|--------|
| **groups/{chatId}/MEMORY.md** | 群組共識、決策、任務分配 |
| **groups/{chatId}/YYYY-MM-DD.md** | 群組今日討論紀錄 |

**分工**：
- 群組記憶 — 群組共同決策、任務分配
- 個人記憶 — 個人反思、教訓、用戶偏好

**注意**：不要在群組記憶中放個人偏好或私密資訊。

---

## Knowledge 檔案系統

知識產出的存放區：

| 目錄 | 放什麼 |
|------|--------|
| **knowledge/tools/{name}.md** | 工具評估、使用心得 |
| **knowledge/cases/{slug}.md** | 案例研究、經驗分析 |
| **knowledge/research/{topic}.md** | 主題研究筆記 |

### 私有 vs 共享

- **私有**：`knowledge/` — 你的工作區
- **共享**：`../_shared/knowledge/{agentId}/` — 發布給其他 bot

### 發布流程

內容完整且有價值 → 複製到 `../_shared/knowledge/{agentId}/`

### 引用他人

讀取 `../_shared/knowledge/{其他agentId}/`，只能讀不能改。
