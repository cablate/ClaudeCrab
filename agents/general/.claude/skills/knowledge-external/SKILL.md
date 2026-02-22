---
name: knowledge-external
description: Cab 累積的外部內容知識庫（影片、文章、訪談）。載入後可取得按主題分類的索引，直接定位到對應的六層分析 case。觸發時機：Cab 討論某個主題或概念，且可能與過去分析過的外部內容有關時；需要從真實案例舉例說明某個觀點時；轉錄並完成影片六層分析後，自動歸檔並更新索引。主動更新時機：每次完成六層分析後，將 case 存入 knowledge/cases/ 並更新 references/index.md。
---

# 外部內容知識庫

Cab 累積的外部影片、文章分析。索引與 cases 存放於：

- **索引**：`references/index.md`（按主題分類，可直接定位）
- **Case 全文**：`knowledge/cases/<標題>.md`（六層框架格式）

---

## 查詢流程

1. 讀取 `references/index.md` 找到相關 case
2. 若需要完整分析，讀取對應的 `knowledge/cases/` 檔案
3. 若關鍵字不確定，用 `search_for_pattern("關鍵字", relative_path="knowledge/cases/")`

## 歸檔流程（轉錄完成後自動執行）

1. 在 `knowledge/cases/<標題>.md` 建立六層框架分析（格式見 dom-turboscribe SKILL.md）
2. 在 `references/index.md` 對應分類加入新行
3. 若無對應分類，新增分類標題
