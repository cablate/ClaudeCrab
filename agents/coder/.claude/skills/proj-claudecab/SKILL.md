---
name: proj-claudecab
description: |
  ClaudeCab 專案知識庫。觸發時機：使用者要開發、維護、討論 ClaudeCab 相關功能時。
  能力範圍：ClaudeCab 架構理解、系統設計、功能開發、技術決策查閱。
  知識來源：專案根目錄的 claudecab skill（F:\_Program\OwnProject\ClaudeCab\.claude\skills\claudecab\）
  主動更新時機：以下情況發生時更新此 Skill —— 新增或移除主要模組、事件流程有變動、技術棧更換、做了影響全局的架構決策（ADR）。功能迭代或 bug 修復不需要更新。
---

# ClaudeCab 專案知識

## 專案簡介

ClaudeCab 是一個 multi-agent Telegram bot 框架，基於 Claude Agent SDK 建構。
暱稱「龍蝦」，讓多個 AI agent 在 Telegram 上協作運作。

## 知識庫位置

完整文件在專案根目錄的 claudecab skill：
```
F:\_Program\OwnProject\ClaudeCab\.claude\skills\claudecab\references\
```

快速導航：

| 需求 | 看哪裡 |
|------|--------|
| 系統架構總覽 | `system/overview.md` |
| 事件流與觸發機制 | `system/trigger-mechanism-map.md` |
| Skill 系統設計 | `system/skill-based-character-system.md` |
| 產品願景與原則 | `product/vision.md` + `product/principle.md` |
| 架構決策記錄 | `decisions/_index.md` |
| 常見問題排查 | `operations/troubleshooting.md` |
| 版本歷史 | `operations/changelog.md` |

## 技術棧

- **語言**：TypeScript
- **框架**：Claude Agent SDK
- **平台**：Telegram Bot
- **架構**：Multi-agent，event bus 驅動

## Coder 的開發注意事項

開發前必讀：
1. `system/overview.md` — 了解整體架構
2. `operations/quick-nav.md` — 快速定位相關程式碼
3. `product/principle.md` — 遵循開發原則
