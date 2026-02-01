---
name: project-skill-template
description: |
  Project Skill 文件架構模板。提供結構化的 references 組織規範，支援產品願景、核心原則、架構設計、決策追蹤（ADR + 功能故事）、操作指南。適用於：(1) 建立新的 project skill, (2) 重構現有 project skill 的 references 結構。觸發時機：建立或重構整個專案的知識文件系統。
---

# Project Skill 文件架構

## 核心理念

**Project Skill** 是專案的知識中心，不同於單一功能 skill：
- 涵蓋產品、架構、決策、指南等多面向
- references 數量多，需要結構化管理

## 目錄結構

```
your-project-skill/
├── SKILL.md                     # 主入口（精簡）
└── references/
    ├── _index.md                # 導讀入口（給外部讀者）
    ├── product/                 # 產品相關
    │   ├── vision.md
    │   └── principles.md
    ├── [topic]/                 # 核心主題（按需建立）
    │   ├── philosophy.md
    │   └── guide.md
    ├── system/                  # 系統架構
    │   └── overview.md
    ├── decisions/               # 決策追蹤
    │   ├── _index.md
    │   ├── adr/                 # 架構決策
    │   └── stories/             # 功能故事
    └── operations/              # 操作指南
        ├── quick-nav.md
        └── troubleshooting.md
```

## 建立流程

1. **初始化結構** — 建立目錄骨架
2. **定義產品願景** — 撰寫 `product/vision.md`
3. **建立核心原則** — 撰寫 `product/principles.md`
4. **識別核心主題** — 如 agent-skill, memory-system 等，各自建立子目錄
5. **遷移現有文件** — 將散落的文件歸類
6. **建立決策追蹤** — 將重要決策轉為 ADR 或 Story
7. **撰寫導讀入口** — 完成 `_index.md`

## 分類原則

| 類型 | 放置位置 | 說明 |
|------|----------|------|
| 產品願景、原則 | `product/` | 貫穿生命週期的核心 |
| 核心主題 | `[topic]/` | 如 agent-skill/、memory-system/ |
| 架構設計 | `system/` | 技術架構、模組說明 |
| 架構決策 | `decisions/adr/` | 技術選型、設計模式 |
| 功能故事 | `decisions/stories/` | 背景、痛點、演進 |
| 操作指南 | `operations/` | 快速導航、問題排查 |

