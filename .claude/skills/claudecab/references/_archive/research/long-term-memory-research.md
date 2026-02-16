# AI Agent 長期記憶與知識庫工具研究

> **類型**：研究報告
> **時間範圍**：2026-02-09
> **狀態**：✅ 已完成歸檔（歷史文件，不再更新）
> **後續影響**：確立了「QMD + Markdown + Anthropic Memory Tool」的推薦組合方向。但截至歸檔時尚未實際導入任何外部記憶系統，ClaudeCab 仍使用原有 MEMORY.md + memory/ 日誌模式。

---

## 背景：為什麼做這件事

ClaudeCab 的 agent 記憶系統採用 Markdown-first 設計（MEMORY.md 長期策展 + memory/YYYY-MM-DD.md 每日日誌），但隨著對話歷史增長，出現兩個瓶頸：

1. **搜尋效率低**：跨天記憶只能靠人工翻閱日誌檔案，無語義搜尋能力
2. **Context 浪費**：每次 session 都需載入大量記憶文件，擠壓可用 token 空間

此研究系統性評估了當時生態中主要的記憶/知識庫方案，為 ClaudeCab 導入長期記憶功能提供決策依據。

---

## 核心發現 / 決策

### 評估的方案（6 + 5 個）

| 主要方案 | 類型 | 特色 | 適配性 |
|---------|------|------|--------|
| **QMD**（Tobi Lutke / Shopify CEO） | 本地混合搜尋引擎 | BM25 + Vector + LLM Reranking，MCP 原生 | ⭐ 最佳搜尋品質 |
| **OpenClaw Memory** | 多頻道 AI 助手框架 | 兩層記憶（每日日誌 + MEMORY.md），架構與 ClaudeCab 高度相似 | 設計參考價值高，但與框架耦合 |
| **Claude-Mem** | Claude Code 記憶外掛 | Lifecycle hook 自動化，三層漸進式檢索（10x token 節省） | 專為 Claude Code 設計，AGPL 授權 |
| **Basic Memory** | 語義圖譜 MCP | Markdown 建構語義圖，支援 Obsidian | 簡單但功能有限 |
| **Mem0** | 統一記憶層 | 跨 AI 應用共享記憶 | 功能完整但依賴較多 |
| **Anthropic Memory Tool** | 官方客戶端工具 | 減少 84% token，搭配 context compaction | 官方方向，但功能基礎（無向量搜尋） |

另外還評估了 Cognee MCP、LightRAG MCP 等知識圖譜方案。

### 記憶方案光譜定位

```
簡單 ←──────────────────────────────────────→ 複雜
 檔案型          知識圖譜         向量資料庫       混合系統
 MEMORY.md      Anthropic MCP    Qdrant          QMD
 Basic Memory   Cognee/LightRAG  Chroma/Milvus   Claude-Mem
```

### 推薦組合

1. **QMD** 作為知識庫搜尋引擎（MCP server）— 可直接索引現有 Markdown 記憶檔案
2. **Markdown 檔案**作為記憶 source of truth — 沿用已建立的 MEMORY.md 模式
3. **Anthropic Memory Tool** 或自建記憶寫入邏輯

**推薦理由**：不需整合完整框架（如 OpenClaw），只挑選搜尋元件，保持架構自主性同時享受最佳搜尋品質。

### 待確認事項（截至研究時）

- QMD 在 Windows 上的相容性（ClaudeCab 開發環境是 Windows）
- Bun runtime 是否為硬性依賴
- QMD MCP server 能否限定搜尋範圍到特定 agent 記憶
- 與現有 Serena MCP 的共存性

---

## 執行結果

此研究為**純評估報告**，未產出任何程式碼改動。研究結論記錄了推薦方向，但實際導入被排在後續 phase 處理。

截至歸檔時，ClaudeCab 仍使用：
- `agents/{id}/MEMORY.md` — 長期策展記憶
- `agents/{id}/memory/YYYY-MM-DD.md` — 每日對話日誌
- 無向量搜尋或語義檢索能力

---

## 回顧：學到了什麼

1. **MCP 生態的成熟度**：截至 2026 年初，MCP server 超過 17,000 個，「Knowledge & Memory」是最大類別（283 個）。生態已足夠成熟到可以「挑選元件」而非「從零建構」。
2. **架構相似性的價值**：OpenClaw 的記憶系統與 ClaudeCab 高度相似（兩層 Markdown 記憶 + 每日日誌），驗證了 ClaudeCab 的設計方向並非孤例。
3. **搜尋 vs 記憶管理是兩個問題**：QMD 是搜尋引擎而非記憶管理系統。ClaudeCab 需要的是「搜尋能力」而非「全新的記憶架構」。
4. **官方方向的信號**：Anthropic Memory Tool 的推出（2025-09）暗示記憶管理會逐漸成為平台級功能，自建方案需考慮與官方的相容性。

---

## 關聯文件

- 影響決策：ClaudeCab 記憶系統維持 Markdown-first 不變，搜尋能力待後續導入
- 參考來源：QMD (github.com/tobi/qmd)、OpenClaw (docs.openclaw.ai)、Claude-Mem (github.com/thedotmack/claude-mem)、Anthropic Memory Tool 官方文件
- 相關歷史：[moltbot-gap.md](_archive/research/moltbot-gap.md)（更早期的 Moltbot 記憶機制研究）
