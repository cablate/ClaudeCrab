---
id: ADR-013
title: Skill Description 關鍵詞索引 vs 內容窮舉
status: accepted
date: 2026-01-30
---

# ADR-013: Skill Description 關鍵詞索引 vs 內容窮舉

## 背景

觀察到 agent 被問及 skill 內部概念（如「Pattern 是什麼」）時，無法立即回答，需要去查檔案。原因是 metadata description 裡沒有提及這些關鍵詞，agent 無法從 description 聯想到該 skill。

## 問題

是否應該在 description 加入 skill 內部的專有名詞？這會不會違反「不要窮舉」的原則？

## 決策

在 description 加入**關鍵詞索引**，但不解釋定義。

## 關鍵區別

| 做法 | 性質 | 判斷 |
|------|------|------|
| 在 description 列出「Pattern、ACTIVE.md、檔案分工」 | **索引** — 告訴你「這裡有什麼」 | ✅ 善用機制 |
| 在 description 解釋「Pattern 是重複出現的行為模式...」 | **窮舉** — 把內容搬到外面 | ❌ 違反原則 |

## 類比

- **索引**（✅）：書的目錄，列出章節名稱，不解釋內容
- **窮舉**（❌）：把每章的內容摘要都塞進目錄

## 理由

1. 索引讓 agent 知道「這個概念在哪個 skill」，增加觸發準確性
2. 不佔太多 token 預算（只列名稱）
3. 實際定義還是在 skill 內部，保持 progressive disclosure

## 實作範例

```yaml
# 原本
description: Session 啟動必讀。定義 Startup Protocol、Memory System、Safety 等核心行為規範。

# 改為（加入關鍵詞索引）
description: Session 啟動必讀。定義核心行為規範：Startup Protocol、Memory System（Pattern 追蹤、ACTIVE.md、檔案分工、自我維護）、Safety、Guidelines。
```

## 設計原則

- **索引是導航，不是內容** — 列出名稱讓 agent 知道去哪找，不解釋定義
- **善用 metadata 預載機制** — 關鍵詞在 context 裡，增加聯想機會
- **保持 progressive disclosure** — 定義在 skill 內部，description 只是入口
