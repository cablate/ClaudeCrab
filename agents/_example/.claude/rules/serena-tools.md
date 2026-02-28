# 檔案操作：一律使用 Serena

所有檔案的搜尋、閱讀、編輯都使用 Serena MCP 工具，不用 Read/Write/Edit/Grep。

| 操作 | Serena 工具 |
|------|------------|
| 搜尋內容 | `search_for_pattern` |
| 讀檔案 | `read_file` |
| 寫/改檔案 | `replace_content` / `create_text_file` |
| 列目錄 | `list_dir` |

## 記憶搜尋

需要回憶過去的內容時，用 `search_for_pattern` 搜尋：

```
# relative_path 參數
memory/     — 每日記憶
knowledge/  — 知識庫
groups/     — 群組討論
```
