# Topics 判斷範例

## 粒度判斷

| 情境 | 錯誤 | 正確 | 為什麼 |
|---|---|---|---|
| 貼文在講 AI Skill 的設計與複用 | `AI工具` | `AI Skill` | 「AI工具」涵蓋太廣，無法區分在講 skill、agent、還是 ChatGPT |
| 貼文在講 Claude Code 的使用心得 | `AI工具` | `Claude Code` | 具體工具應該用具體名稱 |
| 貼文在講 RAG 架構設計 | `AI技術` | `RAG` | 技術概念應保留其專有名稱 |
| 貼文在講如何漲粉 | `社群` | `自媒體經營` | 「社群」太泛，「自媒體經營」準確描述了意圖 |

## 「提到」vs「在講」

| 原文 | 錯誤判斷 | 正確判斷 | 為什麼 |
|---|---|---|---|
| 「AgentSkill 講座已經 28 人購買了，感謝大家」 | 標 `AI Skill` (related, 0.7) | 不標 `AI Skill` | 「AgentSkill」只是講座名稱，這篇在講銷售數字，不是在討論 skill |
| 「沒關係，搓個 Bot 來抱怨吧！」 | 標 `Bot 開發` (core, 0.7) | 不標 `Bot 開發` | 「搓個 Bot」是幽默修辭，這篇沒有在討論 Bot 的開發 |
| 「當時也沒有 skill、沒有 sub-agent」 | 標 `AI Skill` (related) | 不標 `AI Skill` | 只是在回顧時間背景，不是在討論 skill 本身 |
| 「MCP 有社群大佬做了漸進式揭露機制」 | 標 `MCP` (related, 0.7) | 標 `MCP` (peripheral, 0.3) | 有提到 MCP 的具體應用，但只是一句帶過，給 peripheral 即可 |

## 論點 vs 論據

| 原文 | 錯誤判斷 | 正確判斷 | 為什麼 |
|---|---|---|---|
| 「File base memory 是新名詞嗎？SDD、AgentSkill 不都算 memory base？」 | 標 `AI Skill`, `SDD` | 標 `AI 記憶機制` | 作者在辯論的是「記憶機制」這個概念，SDD 和 AgentSkill 只是舉例佐證 |

## 行為 vs 主題

| 原文 | 錯誤判斷 | 正確判斷 | 為什麼 |
|---|---|---|---|
| 「料理最後一天！大家抓緊機會下單啦」 | 標 `自媒體經營` (core, 0.8) | 不標 | 發促銷文是行銷「行為」，但內容沒有在「討論」行銷策略 |
| 「在技術聚會聽到什麼，直接丟給秘書整理」 | 標 `工程師日常` (core, 0.7) | 不標 | 這是一句日常分享，不是在討論工程師的工作方法論 |

## 命名原則

- 優先使用已存在的 topic 名稱（從 `GET /api/analyses/topics/distinct` 取得）
- 只有在現有 topic 確實無法涵蓋時才新增
- 新增的 topic 使用簡潔名稱（中文或業界慣用英文皆可，如「AI Skill」、「Prompt Engineering」、「自媒體經營」）
