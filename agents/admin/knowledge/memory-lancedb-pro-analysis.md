# memory-lancedb-pro 技術評估報告

> 評估日期：2026-02-27
> 來源：https://github.com/win4r/memory-lancedb-pro

---

## 專案概述

OpenClaw 生態系的長期記憶插件，提供進階的記憶檢索能力。

**核心技術**：
- LanceDB 本地向量資料庫
- Hybrid Retrieval（向量語義 + BM25 關鍵字）
- Cross-Encoder Rerank（重新排序）
- Multi-Scope Isolation（多作用域隔離）

**主要特色**：
- 混合檢索：RRF Fusion → Rerank → Recency Boost → Importance Weight → Filter
- 時間衰減：新記憶權重高、舊記憶權重低
- 重要性加權：可標記關鍵記憶
- 自適應檢索：自動判斷查詢是否需要記憶檢索

---

## 與 ClaudeCab 相容性評估

| 面向 | 評估 |
|------|------|
| 目標平台 | ❌ 專為 OpenClaw 設計，非 Claude Code SDK |
| 插件架構 | ❌ 依賴 OpenClaw 的 `agent_end` / `before_agent_start` hooks |
| 我們的架構 | MCP + file-based memory（markdown 檔案） |
| 直接整合 | 🔴 不可行 |

---

## 架構分析

專案模組化良好，核心功能可拆解：

| 模組 | 功能 | 獨立性 |
|------|------|--------|
| `store.ts` | LanceDB 儲存層 | ✅ 可獨立 |
| `embedder.ts` | 向量嵌入（呼叫 API） | ✅ 可獨立 |
| `retriever.ts` | 混合檢索引擎 | ✅ 可獨立 |
| `cli.ts` | 命令列工具 | ✅ **已經是 CLI** |
| `tools.ts` | OpenClaw agent 工具定義 | ❌ OpenClaw 專屬 |
| `index.ts` | OpenClaw 插件入口 | ❌ OpenClaw 專屬 |

**關鍵發現**：已有 CLI（`cli.ts`），提供 `list`、`search`、`store`、`delete`、`export`、`import` 等命令。

---

## 改造可行性評估

### 路徑 A：直接用 CLI

1. Clone 專案、`npm install`
2. 用 Bash 調用 CLI 命令
3. 不需改任何程式碼

**驗證點**：CLI 是否支援我們需要的操作（store、search、list）

**工作量**：接近零

### 路徑 B：包裝成 MCP Server

1. 保留 `store.ts`、`embedder.ts`、`retriever.ts`
2. 刪除 OpenClaw 相關的 `index.ts`、`tools.ts`
3. 寫一個 MCP server wrapper

**工作量估計**：
- 刪除 OpenClaw 依賴：1-2 小時
- 寫 MCP server wrapper：2-4 小時
- 測試 + 調整：2-4 小時
- **總計：5-10 小時**

---

## 外部依賴

需要 Embedding API（擇一）：
- **Jina**（推薦）：jina-embeddings-v5-text-small，1024維
- **OpenAI**：text-embedding-3-small，1536維
- **Google Gemini**：gemini-embedding-001，3072維
- **Ollama**（本地）：nomic-embed-text

可選 Rerank 提供商：
- Jina（預設）
- SiliconFlow（免費層可用）
- Pinecone

---

## 可借鏡概念

即使不直接使用，以下設計概念值得參考：

1. **Multi-Scope Isolation**：`global` / `agent:<id>` / `project:<id>` 分層，與我們的 `_shared` vs `agents/{id}` 類似

2. **Hybrid Retrieval**：語義搜尋 + 關鍵字搜尋組合，改善「找記憶」的精準度

3. **Recency Boost**：時間衰減機制，讓新記憶更容易被找到

4. **Importance Weight**：重要性加權，標記關鍵記憶優先檢索

5. **Adaptive Retrieval**：自動判斷是否需要檢索，跳過無意義查詢

---

## 結論

**工程不算浩大**。原因：
1. 核心邏輯（store/embedder/retriever）與 OpenClaw 框架耦合度低
2. 已有 CLI，可能直接使用
3. 改成 MCP server 主要是「包裝」而非「重寫」

**建議**：
1. 目前 file-based 方案對記憶量不大時夠用
2. 當記憶量大到搜尋效能有問題時，再考慮向量記憶方案
3. 屆時優先驗證路徑 A（CLI），若不足再走路徑 B（MCP Server）

---

## 下一步（待決定）

- [ ] Clone 下來驗證 CLI 功能
- [ ] 評估是否需要向量記憶（取決於記憶量成長速度）
