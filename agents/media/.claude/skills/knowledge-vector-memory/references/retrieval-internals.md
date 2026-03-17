# Vector Memory — Retrieval Internals

Debug 或調參時載入。日常使用不需要。

---

## Hybrid Retrieval 管線

```
Query → Vector Embedding + BM25 → RRF Fusion → Rerank → Decay Boost → Length Norm → Filter
```

### 評分參數

| 參數 | 預設 | 說明 |
|------|------|------|
| vectorWeight | 0.7 | 語意相關性權重 |
| bm25Weight | 0.3 | 關鍵字匹配權重 |
| hardMinScore | 0.35 | Rerank 後最低分數門檻 |
| candidatePoolSize | 20 | Rerank 前候選池大小 |

### Post-Retrieval 評分階段

1. **Recency Boost** — `exp(-ageDays / halfLife) × weight`
2. **Importance Weighting** — `score × (0.7 + 0.3 × importance)`
3. **Length Normalization** — `1 / (1 + 0.5 × log2(charLen/500))`
4. **Time Decay** — `score *= 0.5 + 0.5 × exp(-ageDays / effectiveHalfLife)`
5. **Cross-Encoder Reranking** — 60% API + 40% original fused
6. **MMR Diversity** — cosine similarity > 0.85 被降權

---

## Weibull Decay 模型

記憶根據使用頻率和重要性自動衰減。

### 三層級

| 層級 | Beta | 行為 | Decay Floor |
|------|------|------|-------------|
| Core | 0.8 | 緩慢衰減 | 0.9 |
| Working | 1.0 | 標準指數衰減 | 0.7 |
| Peripheral | 1.3 | 快速衰減 | 0.5 |

### 晉升/降級規則

- **Peripheral → Working**：access >= 3 AND score >= 0.4
- **Working → Core**：access >= 10 AND score >= 0.7 AND importance >= 0.8
- **Working → Peripheral**：score < 0.15 OR (age > 60 days AND access < 3)
- **Core → Working**：score < 0.15 AND access < 3

### Access Reinforcement

常用記憶衰減更慢：
- 僅 `source: "manual"` 的存取計入（auto-recall 不算）
- 對數曲線：越多 access 邊際效益越小
- 上限：`maxHalfLifeMultiplier = 3`

---

## 我們的配置

- Embedding: DeepInfra + Qwen3-Embedding-8B（1024 dims）
- Reranker: 無（vector + BM25 fusion only）
- DB: 每個 agent 獨立（`agents/{agent}/.memory-db`）
- Scope: `agent:main`（預設）
