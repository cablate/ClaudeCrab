---
name: dom-project-docs
description: |
  專案文件管理能力。觸發時機：使用者要建立新專案的文件系統、整理現有專案文件、記錄架構決策、或需要查閱特定專案的規格與脈絡時。
  能力範圍：初始化 proj-* skill 結構、維護產品願景與原則、記錄 ADR（架構決策）、撰寫功能故事、維護操作指南。
  目標：讓每個專案都有清晰的知識中心，任何時候回來都能快速上手。
  主動更新時機：發現新的文件組織模式或最佳實踐時更新 references/。
---

# 專案文件管理

## 核心理念

**文件是給未來的自己看的**

好的文件讓你三個月後回來看，五分鐘內就能恢復狀態。壞的文件讓你自己都看不懂自己當時在想什麼。

**記錄決策，不只記錄結果**

「我們用 X」不夠，要記錄「為什麼用 X，而不是 Y」。決策背後的理由比決策本身更有價值。

## 專案 Skill 結構

每個專案對應一個 `proj-[專案名]` skill，結構如下：

```
proj-[name]/
├── SKILL.md                    # 專案入口（精簡摘要）
└── references/
    ├── _index.md               # 導讀入口
    ├── product/
    │   ├── vision.md           # 產品願景
    │   └── principles.md       # 核心原則
    ├── system/
    │   └── overview.md         # 系統架構總覽
    ├── decisions/
    │   ├── _index.md           # 決策索引
    │   ├── adr/                # 架構決策記錄
    │   └── stories/            # 功能故事
    └── operations/
        ├── quick-nav.md        # 快速導航
        └── troubleshooting.md  # 問題排查
```

## 建立新專案 Skill

1. **初始化結構** — 用模板建立目錄骨架
2. **填寫願景** — `product/vision.md`（這個專案要解決什麼問題）
3. **定義原則** — `product/principles.md`（開發這個專案的核心原則）
4. **記錄現有架構** — `system/overview.md`（現在的系統長什麼樣）
5. **建立決策追蹤** — 把重要的技術選型補進 `decisions/adr/`

> 各文件的格式與範本見 [`references/doc-standards.md`](references/doc-standards.md)（ADR 格式、Story 格式、命名規範）。

## 已知專案清單

| 專案 | Skill | 狀態 |
|------|-------|------|
| ClaudeCab | proj-claudecab | 初始化中 |

> 新增專案時，更新此表格。

## 參考文件

| 文件 | 內容 |
|------|------|
| [doc-standards.md](references/doc-standards.md) | 文件撰寫規範與範本 |
