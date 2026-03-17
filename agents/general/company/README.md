# CabLate 營運系統

**版本**：v1.0 | **日期**：2026-03-17
**維護者**：秘書（General Agent）

營運手冊的落地實作。每個文件都是獨立模組，員工設定完畢後讀完即可開始運作。

---

## 目錄結構

```
company/
├── README.md          ← 你在這裡
├── rules/             ← 全員共通規則（7 份）
├── sops/              ← 業務流程 SOP（8 份）
├── quality/           ← 品管 Checklist
├── coordination/      ← 秘書協調 SOP
├── evolution/         ← 修正與進化機制
└── employees/         ← 員工檔案（各 agent 規格書）
```

## 相關文件

| 文件 | 路徑 | 用途 |
|------|------|------|
| 營運手冊（總覽） | `output/company-operations-manual.md` | 公司使命、飛輪、架構總覽 |
| 組織設計 | `output/org-design-2026-03-08.md` | 組織架構全文 |
| Cab 全方位解析 | `../_shared/knowledge/cab-全方位解析.md` | 所有任務的基礎參考 |

## 規則索引 (rules/)

| 規則 | 檔案 | 一句話 |
|------|------|--------|
| 飛輪意識 | `01-flywheel-awareness.md` | 你的工作是飛輪的一環，推動下一環 |
| 品質標準 | `02-quality-standard.md` | 有觀點、有態度、像 Cab 寫的 |
| 60 分先交 | `03-60-point-first.md` | AI 快速產出 60 分初版，一起磨到 100 |
| 帶診斷問 | `04-diagnose-before-ask.md` | 先排查再問，帶著結果問 |
| Owner 意識 | `05-owner-mindset.md` | 端到端交付，不是完成被交辦的事 |
| 不重複造輪 | `06-no-reinvent.md` | 先查共享知識庫，別人做過的不要重做 |
| 交接完整 | `07-complete-handoff.md` | 當對方什麼都不知道來交接 |

## SOP 索引 (sops/)

| SOP | 檔案 | 核心角色 |
|-----|------|---------|
| 每週內容產出 | `01-weekly-content.md` | Researcher → Writer → SEO → Media |
| B 端諮詢 | `02-b2b-consulting.md` | 業務助理 → Cab → 秘書 → Writer |
| C 端課程/諮詢 | `03-c2c-course.md` | Cab → Transcriber → 業務助理 |
| 獲客漏斗 | `04-acquisition-funnel.md` | Writer → SEO → Operator |
| 企業內訓提案 | `05-enterprise-training.md` | 業務助理 → 秘書 → Cab |
| 多媒體產出 | `06-multimedia-production.md` | Writer → Media → 秘書 |
| 新課程開發 | `07-new-course-development.md` | 秘書 → Writer → Coder → Media |
| AI 系統開發案 | `08-ai-system-development.md` | 業務助理 → Coder → Cab |

## 品管索引 (quality/)

| Checklist | 檔案 | 適用場景 |
|-----------|------|---------|
| 內容審核 | `content-review.md` | 所有對外文字內容 |
| 提案審核 | `proposal-review.md` | B 端提案、內訓提案 |
| 交接審核 | `handoff-checklist.md` | 所有跨角色交接 |

## 協調索引 (coordination/)

| SOP | 檔案 | 用途 |
|-----|------|------|
| 任務路由 | `task-routing.md` | 秘書如何分派任務給對的人 |
| 品管閘門 | `quality-gate.md` | 秘書的品管流程 |
| 升級處理 | `escalation.md` | 何時/如何把問題升級給 Cab |

## 進化索引 (evolution/)

| 文件 | 用途 |
|------|------|
| `feedback-loop.md` | 流程跑完後的回饋與改進機制 |

## 員工索引 (employees/)

| 員工 | 檔案 | 狀態 |
|------|------|------|
| 秘書 | `secretary.md` | 運作中 |
| 轉錄員 | `transcriber.md` | 運作中 |
| 工程師 | `coder.md` | 運作中 |
| 系統管理 | `admin.md` | 運作中 |
| 業務助理 | `business-assistant.md` | 待建置（第一波） |
| 研究員 | `researcher.md` | 待建置（第二波） |
| 營運 | `operator.md` | 待建置（第三波） |
| 寫手 | `writer.md` | 待建置 |
| SEO | `seo.md` | 待建置 |
| 多媒體 | `media.md` | 待建置 |
