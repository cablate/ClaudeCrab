---
name: find-skills
description: 協助使用者發現和安裝 Claude Agent Skills。當使用者問「有沒有 skill 可以做 X」、「找一個能幫我做 Y 的工具」時觸發此 skill。
---

# Find Skills

協助使用者從官方 Agent Skills 生態系統發現和安裝 skills。

## ⚠️ 重要限制

<STRICTLY_IMPORTANT>
**你不可以自己編造或猜測 skill 名稱。**

所有 skill 資訊必須來自以下來源之一：
1. 執行 `npx skills find [query]` 指令的實際輸出
2. https://skills.sh/ 網站
3. 官方 GitHub repos：`vercel-labs/agent-skills`、`ComposioHQ/awesome-claude-skills`

如果你沒有執行搜尋指令，就不要列出任何 skills。
</STRICTLY_IMPORTANT>

## 何時使用此 Skill

當使用者：
- 問「有沒有 skill 可以做 X」或「找一個能做 X 的工具」
- 問「你可以做 X 嗎」（X 是特定專業能力）
- 想擴展 Agent 能力
- 想搜尋工具、模板、工作流程

## 什麼是 Skills CLI？

Skills CLI（`npx skills`）是 Claude Agent Skills 生態系統的套件管理器。Skills 是模組化套件，為 Agent 增加專業知識、工作流程和工具。

**核心指令：**
- `npx skills find [query]` — 搜尋 skills
- `npx skills add <owner/repo@skill>` — 安裝 skill
- `npx skills check` — 檢查更新
- `npx skills update` — 更新所有 skills

**瀏覽 skills：** https://skills.sh/

## 如何協助使用者找到 Skills

### 步驟 1：理解需求

當使用者詢問時，辨識：
1. 領域（React、測試、設計、部署等）
2. 具體任務（寫測試、建動畫、審 PR 等）
3. 這是否是常見任務，可能有現成 skill

### 步驟 2：執行搜尋

**必須執行指令取得實際結果，不可自行編造：**

```bash
npx skills find [query]
```

範例：
- 使用者問「如何讓 React app 更快？」→ `npx skills find react performance`
- 使用者問「幫我審 PR」→ `npx skills find pr review`
- 使用者問「要建 changelog」→ `npx skills find changelog`

指令會回傳類似：
```
Install with npx skills add <owner/repo@skill>

vercel-labs/agent-skills@vercel-react-best-practices
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### 步驟 3：呈現結果給使用者

找到相關 skills 時，提供：
1. Skill 名稱和功能說明
2. 安裝指令
3. skills.sh 連結

範例回覆：
```
找到一個可能有幫助的 skill！「vercel-react-best-practices」提供
來自 Vercel 工程團隊的 React 和 Next.js 效能優化指南。

安裝指令：
npx skills add vercel-labs/agent-skills@vercel-react-best-practices

了解更多：https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### 步驟 4：協助安裝

如果使用者想安裝，執行：

```bash
npx skills add <owner/repo@skill> -g -y
```

`-g` 安裝到使用者層級，`-y` 跳過確認提示。

## 常見 Skill 類別

| 類別 | 搜尋關鍵字 |
|------|------------|
| 網頁開發 | react, nextjs, typescript, css, tailwind |
| 測試 | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| 文件 | docs, readme, changelog, api-docs |
| 程式碼品質 | review, lint, refactor, best-practices |
| 設計 | ui, ux, design-system, accessibility |
| 生產力 | workflow, automation, git |

## 搜尋技巧

1. **用具體關鍵字**：「react testing」比「testing」更精確
2. **嘗試同義詞**：「deploy」沒結果就試「deployment」或「ci-cd」
3. **檢查熱門來源**：許多 skills 來自 `vercel-labs/agent-skills` 或 `ComposioHQ/awesome-claude-skills`

## 找不到 Skills 時

如果沒有相關 skills：

1. 誠實說明沒找到現成 skill
2. 提議用你的通用能力直接協助
3. 建議使用者可以自己建立 skill

範例：
```
我搜尋了「xyz」相關的 skills，但沒有找到匹配的結果。
我可以直接用我的通用能力幫你處理這個任務！要繼續嗎？

如果這是你常做的事，可以考慮自己建立一個 skill：
npx skills init my-xyz-skill
```

## 官方資源

- **Skills 目錄**：https://skills.sh/
- **Vercel 官方 Skills**：https://github.com/vercel-labs/agent-skills
- **社群 Skills**：https://github.com/ComposioHQ/awesome-claude-skills
