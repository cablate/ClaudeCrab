# Skills CLI 操作指南

## 核心指令

| 指令 | 用途 |
|------|------|
| `npx skills find [query]` | 搜尋 skills |
| `npx skills add <owner/repo@skill> -y` | 安裝 skill（`-y` 跳過確認） |
| `npx skills check` | 檢查更新 |
| `npx skills update` | 更新所有 skills |

## 搜尋流程

### 1. 理解需求

辨識使用者要的：
1. 領域（React、測試、設計、部署等）
2. 具體任務（寫測試、建動畫、審 PR 等）
3. 這是否是常見任務，可能有現成 skill

### 2. 執行搜尋

```bash
npx skills find [query]
```

範例：
- 「如何讓 React app 更快？」→ `npx skills find react performance`
- 「幫我審 PR」→ `npx skills find pr review`
- 「要建 changelog」→ `npx skills find changelog`

回傳格式：
```
Install with npx skills add <owner/repo@skill>

vercel-labs/agent-skills@vercel-react-best-practices
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### 3. 呈現結果

提供：Skill 名稱、功能說明、安裝指令、skills.sh 連結。

### 4. 安裝

```bash
npx skills add <owner/repo@skill> -y
```

不加 `-g`，skill 會安裝到當前 agent 的 `.claude/skills/` 目錄。

## 搜尋技巧

1. **用具體關鍵字**：「react testing」比「testing」更精確
2. **嘗試同義詞**：「deploy」沒結果就試「deployment」或「ci-cd」
3. **檢查熱門來源**：`vercel-labs/agent-skills`、`ComposioHQ/awesome-claude-skills`

## 常見類別

| 類別 | 搜尋關鍵字 |
|------|------------|
| 網頁開發 | react, nextjs, typescript, css, tailwind |
| 測試 | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| 文件 | docs, readme, changelog, api-docs |
| 程式碼品質 | review, lint, refactor, best-practices |
| 設計 | ui, ux, design-system, accessibility |
| 生產力 | workflow, automation, git |

## 找不到時

1. 誠實說明沒找到
2. 提議用通用能力直接協助
3. 建議使用者自己建立：`npx skills init my-skill`

## 官方資源

- **Skills 目錄**：https://skills.sh/
- **Vercel 官方 Skills**：https://github.com/vercel-labs/agent-skills
- **社群 Skills**：https://github.com/ComposioHQ/awesome-claude-skills
