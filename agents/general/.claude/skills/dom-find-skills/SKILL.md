---
name: find-skills
description: |
  協助使用者發現和安裝 Claude Agent Skills。
  觸發情境：「有沒有 skill 可以做 X」、「找一個能做 Y 的工具」、「你可以做 X 嗎」（X 是特定專業能力）、想擴展 Agent 能力。
  主動更新時機：Skills CLI 指令或生態系統有變動時更新 references/cli-guide.md。
---

# Find Skills

從開放的 Agent Skills 生態系統搜尋和安裝 skills。

## 核心原則

<STRICTLY_IMPORTANT>
**不編造，先搜後答。**

所有 skill 資訊必須來自 `npx skills find` 的實際輸出或 https://skills.sh/。
沒有執行搜尋就不要列出任何 skills。
</STRICTLY_IMPORTANT>

## 安裝範圍

Skills 一律安裝到**當前 agent 專屬**（不加 `-g`）：

```bash
npx skills add <owner/repo@skill> -y
```

這會安裝到當前工作目錄的 `.claude/skills/`，只有這個 agent 能用。

## 工作流程

1. **理解需求** — 辨識領域和具體任務
2. **搜尋** — `npx skills find [query]`
3. **呈現** — 名稱、說明、安裝指令、skills.sh 連結
4. **安裝** — `npx skills add <pkg> -y`
5. **找不到** — 誠實說沒找到，提議用通用能力幫忙，或建議 `npx skills init` 自建

詳細操作指南見 [cli-guide.md](references/cli-guide.md)。
