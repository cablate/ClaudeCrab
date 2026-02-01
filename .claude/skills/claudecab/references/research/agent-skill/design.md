# Agent Skill 設計原則

> 從 ClaudeCab 實踐中提煉的 Agent Skill 設計核心洞察

---

## 核心機制：Metadata 預載

Claude Code 會在 session 開始時**自動預載所有 skill 的 metadata**（name, description），這些資訊存在於對話 context 中，即使 agent 尚未調用該 skill。

這是設計 skill 的關鍵洞察：**description 比 SKILL.md 正文更重要**，因為它決定了 skill 是否會被觸發。

---

## 設計原則總覽

| 原則 | 說明 |
|------|------|
| **Description-Driven Triggering** | Skill 的 description 是 LLM 決定是否調用的關鍵，必須清楚說明觸發時機 |
| **被動載入 > 主動引導** | 能透過 metadata 被動傳達的資訊，比需要層層引導才能讀到的更可靠 |
| **CLAUDE.md 精簡化** | 只負責引導和強調，不堆疊內容 |
| **References 子目錄** | 詳細內容放在 `references/`，SKILL.md 作為索引 |

---

## 三層架構

| 層級 | 機制 | 特性 | 作用 |
|------|------|------|------|
| **Skill Description** | 被動預載 | 自動存在於 context | 減輕 CLAUDE.md 引導負擔 |
| **CLAUDE.md** | 主動引導 | 權重確定 | 精簡強調，不需窮舉 |
| **SKILL.md → references/** | 調用後展開 | 正常文件結構 | 詳細內容 |

---

## 關鍵區別：索引 vs 窮舉

在 description 中應該使用**關鍵詞索引**，而非窮舉內容。

| 做法 | 性質 | 判斷 |
|------|------|------|
| 列出「Pattern、ACTIVE.md、檔案分工」 | **索引** — 告訴你「這裡有什麼」 | ✅ 善用機制 |
| 解釋「Pattern 是重複出現的行為模式...」 | **窮舉** — 把內容搬到外面 | ❌ 違反原則 |

**類比**：
- 索引 = 書的目錄，列出章節名稱
- 窮舉 = 把每章的內容摘要都塞進目錄

---

## 協議與人格分離

ClaudeCab 採用兩類核心 skill：

| Skill | 定義 | 內容 |
|-------|------|------|
| `agent-protocols` | 怎麼做（How） | Startup Protocol、Memory System、Safety、Guidelines |
| `persona` | 是誰（Who） | Soul（價值觀、說話風格）、Identity（名字、角色） |

**可攜帶性**：`persona` skill 可複製到其他 agent 快速部署相同人格，環境狀態（USER.md、MEMORY.md）不放入 skill。

---

## Hook 輔助強化注意力

透過 SDK hook 注入提醒，強化 agent 對協議的注意力：

- **UserPromptSubmit hook**：新 session 時提醒執行 Startup Protocol
- **每次訊息時**：提醒檢查記憶寫入

---

*相關 ADR：[ADR-012](../../decisions/adr/adr-012-skill-first.md)、[ADR-013](../../decisions/adr/adr-013-keyword-index.md)*
