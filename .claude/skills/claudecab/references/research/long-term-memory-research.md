> **⚠️ 歷史文件 — 已策展歸檔**：策展版本請見 [`_archive/research/long-term-memory-research.md`](../_archive/research/long-term-memory-research.md)
> 本檔案為原始開發紀錄，保留供完整追溯。

# AI Agent 長期記憶與知識庫工具研究報告

**日期**：2026-02-09
**目標**：評估 QMD、OpenClaw 記憶系統及其他方案，為 ClaudeCab 導入長期記憶/知識庫功能提供決策依據

---

## 目錄

1. [QMD (tobi/qmd)](#1-qmd-tobiqmd)
2. [OpenClaw 記憶系統](#2-openclaw-記憶系統)
3. [Claude-Mem](#3-claude-mem)
4. [其他生態系工具](#4-其他生態系工具)
5. [Anthropic 官方 Memory Tool](#5-anthropic-官方-memory-tool)
6. [MCP 知識庫生態總覽](#6-mcp-知識庫生態總覽)
7. [綜合比較與建議](#7-綜合比較與建議)

---

## 1. QMD (tobi/qmd)

**GitHub**: [https://github.com/tobi/qmd](https://github.com/tobi/qmd)
**作者**: Tobi Lutke（Shopify CEO）
**授權**: MIT
**技術棧**: Bun + SQLite + node-llama-cpp + GGUF 模型

### 核心功能

QMD 是一個**完全本地端**的 Markdown 搜尋引擎，結合三種搜尋方法：BM25 全文檢索、向量語義搜尋、LLM 重排序。專為 AI Agent 工作流設計，能將 token 使用量減少 95% 以上。

### 架構 — 四階段混合搜尋管線

```
使用者查詢
    │
    ▼
[1. Query Expansion] ── LLM 產生 2 個查詢變體（原始查詢權重 2x）
    │
    ▼
[2. 平行檢索] ── 同時執行 6 條搜尋（3 BM25 + 3 Vector）
    │
    ▼
[3. Reciprocal Rank Fusion] ── k=60，前 30 候選文件
    │
    ▼
[4. LLM Re-ranking] ── qwen3-reranker 評分 + 位置感知融合
    │
    ▼
最終排序結果
```

**位置感知融合策略**：
- Rank 1-3: 75% RRF / 25% reranker
- Rank 4-10: 60% RRF / 40% reranker
- Rank 11+: 40% RRF / 60% reranker

### 三種搜尋模式

| 模式 | 演算法 | 速度 | 適用場景 |
|------|--------|------|----------|
| `search` | BM25 via FTS5 | ~10ms | 精確關鍵字匹配 |
| `vsearch` | Cosine similarity via sqlite-vec | ~100ms | 語義同義詞搜尋 |
| `query` | 完整混合管線 | ~1-2s | 最佳整體召回率 |

### 本地 GGUF 模型

| 模型 | 用途 | 大小 |
|------|------|------|
| embedding-gemma-300M-Q8_0 | 768 維向量嵌入 | ~300MB |
| qwen3-reranker-0.6b-q8_0 | 文件重排序 | ~640MB |
| qmd-query-expansion-1.7B-q4_k_m | 查詢擴展 | ~1.1GB |

模型自動從 HuggingFace 下載，快取於 `~/.cache/qmd/models/`。

### 安裝與使用

```bash
# 安裝
bun install -g github:tobi/qmd

# 建立集合
qmd collection add ~/notes --name notes
qmd context add qmd://notes "個人筆記和想法"
qmd embed

# 搜尋
qmd search "authentication" -n 10       # BM25
qmd vsearch "how to login"              # 向量
qmd query "user authentication"         # 混合（最佳品質）

# 取得文件
qmd get docs/guide.md
qmd multi-get "journals/2025-05*.md" --json
```

### MCP Server 整合

QMD 暴露 6 個 MCP 工具：

| 工具 | 功能 |
|------|------|
| `qmd_search` | BM25 關鍵字搜尋 |
| `qmd_vsearch` | 向量語義搜尋 |
| `qmd_query` | 混合搜尋含重排序 |
| `qmd_get` | 單一文件取得（支援模糊匹配） |
| `qmd_multi_get` | 批次取得（glob/docid 列表） |
| `qmd_status` | 索引狀態資訊 |

**Claude Desktop 設定**：
```json
{
  "mcpServers": {
    "qmd": {
      "command": "qmd",
      "args": ["mcp"]
    }
  }
}
```

### 資料儲存架構

- **內容可定址存儲**：content 表以 SHA-256 hash 索引，documents 表映射路徑到 hash
- **Docid**：content hash 前 6 字元（如 `#abc123`），跨檔案移動仍保持穩定
- **虛擬路徑**：`qmd://collection-name/path/to/file.md`
- **分塊**：800 token 區塊，15% 重疊（120 tokens）

### 設定檔格式

```yaml
# ~/.config/qmd/index.yml
global_context: "Knowledge base description"
collections:
  notes:
    path: /home/user/notes
    pattern: "**/*.md"
    context:
      "/": "Personal notes"
      "/2024": "Current year"
    update: "git pull"  # Optional bash command
```

### 優點

- 完全本地運行，無需 API key 或雲端服務
- 混合搜尋品質優於單一方法（BM25 + Vector + LLM Reranking）
- MCP 原生支援，與 Claude Code / Claude Desktop 無縫整合
- 輸出格式多樣（JSON、CSV、MD、XML），適合 agent 工作流
- Tobi Lutke 親自維護，更新頻繁
- MIT 授權

### 缺點

- 需要 Bun runtime（非 Node.js）
- 本地模型初次下載約 2.1GB
- **不處理「記憶寫入」——它是搜尋引擎，不是記憶管理系統**
- Windows 支援尚未完善
- 主要為 macOS 優化

---

## 2. OpenClaw 記憶系統

**GitHub**: [https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
**文件**: [https://docs.openclaw.ai/concepts/memory](https://docs.openclaw.ai/concepts/memory)
**授權**: MIT
**技術棧**: TypeScript + Node.js + SQLite + 多種嵌入提供者

### 核心功能

OpenClaw 是一個**本地端多頻道 AI 助手框架**，連接 WhatsApp、Telegram、Slack、Discord 等 15+ 通訊平台。其記憶系統採用**檔案優先**策略。

### 記憶架構 — 兩層設計

```
記憶系統
├── memory/YYYY-MM-DD.md   ← 每日日誌（append-only）
│   ├── 對話紀錄
│   ├── 決策記錄
│   └── 事件日誌
│
├── MEMORY.md               ← 長期策展記憶
│   ├── 使用者偏好
│   ├── 持久事實
│   └── 重要決策
│
└── Vector Index (SQLite)   ← 語義搜尋索引
    ├── 嵌入向量
    ├── BM25 索引
    └── 混合搜尋
```

**啟動時自動載入**：今天 + 昨天的日誌檔案。MEMORY.md 僅在私人對話中載入。

### 記憶工具

| 工具 | 功能 |
|------|------|
| `memory_search` | 語義搜尋 Markdown 區塊（~400 token 目標），回傳片段、路徑、行號、分數 |
| `memory_get` | 讀取特定記憶檔案（限定記憶目錄內） |

### 混合搜尋

```
finalScore = vectorWeight * vectorScore + textWeight * textScore
```

- **Vector**：擅長同義改寫（「運行 gateway 的機器」 vs 「gateway 主機」）
- **BM25**：擅長精確 token（ID、程式碼符號、錯誤字串）
- 權重可設定：預設 vector 0.7 / text 0.3

### QMD 後端（實驗性）

OpenClaw 可選用 QMD 作為搜尋後端：

```yaml
memory:
  backend: "qmd"
  qmd:
    sessions:
      enabled: true  # 索引對話記錄
```

**已知問題**：
- 每次搜尋都啟動新的 qmd subprocess，較慢（[Issue #9581](https://github.com/openclaw/openclaw/issues/9581)）
- 可能搜尋到 QMD 全域索引中的非相關集合（[Issue #10042](https://github.com/openclaw/openclaw/issues/10042)）
- 與 OpenAI embeddings 設定有衝突（[Issue #9143](https://github.com/openclaw/openclaw/issues/9143)）

### 嵌入提供者選項

| 提供者 | 類型 | 需求 |
|--------|------|------|
| local | GGUF 模型 via node-llama-cpp | 無 API key |
| openai | text-embedding-3-small | OpenAI API key |
| gemini | Gemini embeddings | Google API key |
| voyage | Voyage embeddings | Voyage API key |

### 記憶外掛生態

- **Cognee 外掛**：在 Markdown 之上建構知識圖譜，發現概念間隱藏連結
- **Mem0 外掛**：提供跨 session 持久記憶，30 秒內完成設定
- **QMD 後端**：本地混合搜尋 sidecar

### 優點

- Markdown 作為 source of truth，人可讀、可版本控制
- 記憶自動 flush 機制（context compaction 前自動保存）
- 豐富的外掛生態（Cognee、Mem0、QMD）
- 多頻道整合（適合個人 AI 助手場景）
- 隱私保護設計（群組不載入 MEMORY.md）
- 架構設計與 ClaudeCab 高度相似

### 缺點

- 記憶系統與 OpenClaw 框架緊密耦合，難以獨立使用
- Markdown 檔案會隨時間膨脹
- 依賴 LLM 主動寫入記憶（模型可能「忘記」寫入）
- QMD 後端仍為實驗性質，有已知 bug

---

## 3. Claude-Mem

**GitHub**: [https://github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
**授權**: AGPL-3.0
**技術棧**: Node.js + Bun + SQLite + Chroma Vector DB

### 核心功能

Claude-Mem 是**專為 Claude Code 設計的記憶外掛**，自動捕捉 Claude 在編碼 session 中的所有操作，用 AI 壓縮後注入未來的 session。

### 架構

```
Claude Code Session
    │
    ├── [SessionStart] ← Hook: 載入相關記憶
    ├── [UserPromptSubmit] ← Hook: 查詢歷史上下文
    ├── [PostToolUse] ← Hook: 記錄工具操作觀察
    ├── [Stop] ← Hook: AI 壓縮觀察為摘要
    └── [SessionEnd] ← Hook: 儲存 session 資料
         │
         ▼
    Worker Service (port 37777)
    ├── Express API
    ├── Web Viewer UI
    ├── SQLite DB (~/.claude-mem/claude-mem.db)
    └── Chroma Vector DB (語義搜尋)
```

### 三層漸進式檢索（Token 效率最佳化）

```
[1. Search]           ~50-100 tokens → 精簡索引 + ID 列表
    │
    ▼
[2. Timeline]         ~200 tokens   → 相關結果的時間軸上下文
    │
    ▼
[3. Get Observations] ~500-1000 tokens → 篩選後的完整詳情
```

與傳統 RAG 相比，達到約 **10 倍 token 節省**。

### MCP 工具

| 工具 | 功能 |
|------|------|
| `search` | 全文查詢，支援類型/日期/專案篩選 |
| `timeline` | 觀察結果周圍的時間軸上下文 |
| `get_observations` | 批次取得完整觀察詳情 |
| `save_memory` | 手動儲存重要資訊 |

### 優點

- 專為 Claude Code 設計，lifecycle hook 自動化
- Token 效率極高（漸進式揭露）
- 隱私控制（`<private>` 標籤）
- Web UI 視覺化檢視記憶
- 觀察自動分類（decision, bugfix, feature, refactor, discovery, change）

### 缺點

- 僅支援 Claude Code（非通用方案）
- 需要同時運行 Bun worker 服務 + Chroma
- AGPL-3.0 授權對商用不友善
- 依賴較多
- 仍在 beta 階段

---

## 4. 其他生態系工具

### 4.1 Basic Memory

**GitHub**: [https://github.com/basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory)

以 Markdown 建構持久語義圖譜的 MCP server。知識存儲在本地 Markdown 檔案中，用 SQLite 索引，支援 Obsidian 格式。

### 4.2 Mem0 / OpenMemory

**GitHub**: [https://github.com/mem0ai/mem0](https://github.com/mem0ai/mem0)

統一記憶層，支援多 AI 應用共享記憶。OpenMemory MCP server 在本地運行。

### 4.3 Anthropic Memory MCP Server

官方的 Knowledge Graph Memory MCP，以 local JSON 追蹤實體和關係。

### 4.4 Cognee MCP

提供 Graph-RAG 能力，自動從文件建構互聯知識圖譜。

### 4.5 LightRAG MCP

結合知識圖譜與向量嵌入，提供 context-aware 資訊檢索。

---

## 5. Anthropic 官方 Memory Tool

**文件**: [https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool)

Anthropic 於 2025 年 9 月推出 Memory Tool（Beta），是**客戶端工具**，讓 Claude 能在 `/memories` 目錄中 CRUD 檔案。

### 關鍵數據

- 搭配 context compaction 可減少 **84% token 用量**
- 搭配 context editing 在 agentic search 任務上提升 **39%**
- 需要 beta header: `context-management-2025-06-27`

### 定位

官方推薦的方向，但功能相對基礎（純檔案操作，無向量搜尋）。適合搭配 QMD 等搜尋引擎使用。

---

## 6. MCP 知識庫生態總覽

截至 2026 年初，MCP server 超過 **17,000 個**，「Knowledge & Memory」是最大類別（283 個 server）。

### 記憶方案光譜

```
簡單 ←──────────────────────────────────────→ 複雜

 檔案型          知識圖譜         向量資料庫       混合系統
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│MEMORY.md │   │Anthropic │   │  Qdrant  │   │   QMD    │
│Basic Mem │   │Memory MCP│   │  Chroma  │   │Claude-Mem│
│Anthropic │   │  Cognee  │   │  Milvus  │   │ OpenClaw │
│Memory    │   │ LightRAG │   │  Mem0    │   │          │
│Tool      │   │          │   │          │   │          │
└──────────┘   └──────────┘   └──────────┘   └──────────┘
 零依賴           中等           需要 infra      多元件
 人可讀           關係推理        語義最佳        最佳品質
 無語義搜尋       較重            成本較高        設定複雜
```

---

## 7. 綜合比較與建議

### 功能對照表

| 特性 | QMD | OpenClaw Memory | Claude-Mem | Basic Memory | Mem0 | Anthropic Memory Tool |
|------|-----|-----------------|------------|-------------|------|----------------------|
| **本地運行** | 100% | 可選 | 100% | 100% | 可選 | 100% |
| **向量搜尋** | sqlite-vec | SQLite/外部 | Chroma | SQLite | Qdrant | 無 |
| **BM25** | FTS5 | 有 | 有 | 有 | 無 | 無 |
| **LLM Re-ranking** | 有 | 無 | 無 | 無 | 無 | 無 |
| **MCP Server** | 原生 | 間接 | 原生 | 原生 | 原生 | 原生 |
| **自動記憶寫入** | 否（純搜尋） | 半自動 | 自動 hook | 手動 | 自動 | 半自動 |
| **Claude Code 整合** | MCP | 獨立框架 | Plugin | MCP | MCP | API Beta |
| **記憶格式** | Markdown | Markdown | SQLite + Vector | Markdown | 結構化 | 檔案系統 |
| **Windows 支援** | 有限 | 有 | 有 | 有 | 有 | 有 |
| **授權** | MIT | MIT | AGPL-3.0 | MIT | Apache 2.0 | N/A |

### ClaudeCab 整合建議

**推薦組合**：
1. **QMD** 作為知識庫搜尋引擎（MCP server）
2. **Markdown 檔案**作為記憶 source of truth（沿用現有 MEMORY.md 模式）
3. **Anthropic Memory Tool** 或自建記憶寫入邏輯

**理由**：
- ClaudeCab 已有 Markdown-first 的記憶系統（MEMORY.md, memory/YYYY-MM-DD.md），QMD 可以直接索引這些檔案
- QMD 的 MCP server 可以讓 agent 透過語義搜尋找到跨天的記憶
- 不需要整合完整框架（如 OpenClaw），只需挑選搜尋元件
- 保持架構自主性，同時享受最佳搜尋品質

### 潛在使用場景

| 場景 | 現況 | QMD 後 |
|------|------|--------|
| 「上次討論 token 經濟模型是什麼時候？」 | 手動翻日誌 | `qmd_query` 語義搜尋 |
| 「Cab 之前對 X 功能的態度是？」 | 依賴 MEMORY.md | 搜尋全部日誌 + MEMORY.md |
| 「共享知識庫裡有沒有相關資料？」 | Read 整個檔案 | `qmd_search` 精確檢索 |
| 「過去三個月我們做了哪些架構決策？」 | 翻 ADR 目錄 | `qmd_query` 跨集合搜尋 |

### 待確認事項

- [ ] QMD 在 Windows 上的相容性（ClaudeCab 開發環境是 Windows）
- [ ] Bun runtime 是否為硬性依賴，能否用 Node.js 替代
- [ ] QMD 的 MCP server 是否能限定搜尋範圍到特定 agent 的記憶
- [ ] 初次索引的效能（大量歷史記憶檔案）
- [ ] 與現有 Serena MCP 的共存性

---

### 參考來源

- [tobi/qmd GitHub](https://github.com/tobi/qmd)
- [QMD DeepWiki](https://deepwiki.com/tobi/qmd)
- [OpenClaw Memory 文件](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [OpenClaw QMD PR #3160](https://github.com/openclaw/openclaw/pull/3160)
- [Claude-Mem GitHub](https://github.com/thedotmack/claude-mem)
- [Basic Memory GitHub](https://github.com/basicmachines-co/basic-memory)
- [Mem0 GitHub](https://github.com/mem0ai/mem0)
- [Anthropic Memory Tool 文件](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool)
- [Anthropic Context Management](https://www.anthropic.com/news/context-management)
- [Cognee OpenClaw Integration](https://www.cognee.ai/blog/integrations/what-is-openclaw-ai-and-how-we-give-it-memory-with-cognee)
- [Mem0 for OpenClaw](https://mem0.ai/blog/mem0-memory-for-openclaw)
